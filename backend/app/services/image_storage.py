# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Image storage abstraction (Task #83).

Single source of truth for "where do post images live on disk vs in
object storage?". Two implementations:

  • LocalDiskStorage — writes to backend/uploads/posts/<uuid>.<ext>.
    Used in dev (no env vars needed). On Render this is ephemeral —
    every restart wipes the directory and existing PostImage rows
    point at missing files. Acceptable for dev; not for prod.

  • R2Storage — writes to a Cloudflare R2 bucket via boto3's
    S3-compatible API. Durable, no egress fees, scales to GB of
    rep/candidate post media for $0.015/GB/month after the 10 GB
    free tier. Returns presigned GET URLs for reads so the FastAPI
    endpoint stays a thin redirect rather than streaming bytes.

Factory: get_storage() picks based on env vars:
  • R2_BUCKET_NAME + R2_ACCOUNT_ID + R2_ACCESS_KEY_ID +
    R2_SECRET_ACCESS_KEY all set → R2Storage
  • otherwise → LocalDiskStorage

Optional: R2_PUBLIC_BASE_URL — if set (e.g. images.civicview.app
or pub-<hash>.r2.dev), reads return that direct URL instead of a
presigned URL. Cleaner for public published-post images; presigned
is the safer default for now.

The factory is cached so a process doesn't re-initialize the boto3
client on every request — repeated get_storage() calls return the
same singleton.
"""
from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional


logger = logging.getLogger(__name__)


class Storage(ABC):
    """Image storage protocol. Implementations handle the bytes-on-disk
    or bytes-in-object-store concern; everything else (PostImage row
    creation, auth, ownership checks) lives in the router."""

    @abstractmethod
    def write(self, filename: str, data: bytes, content_type: str) -> None:
        """Persist `data` under `filename`. content_type is hint for
        the storage layer (R2 uses it as the Content-Type metadata so
        the GET response gets the right header without sniffing)."""

    @abstractmethod
    def delete(self, filename: str) -> None:
        """Remove `filename` from storage. No-op if absent."""

    @abstractmethod
    def url(self, filename: str, content_type: str) -> Optional[str]:
        """Return an absolute URL the browser can fetch directly. None
        means 'no URL available — caller should stream via path()'.
        Used by R2 (presigned or public URL); LocalDisk returns None."""

    @abstractmethod
    def path(self, filename: str) -> Optional[Path]:
        """Return a local filesystem path the caller can hand to
        FastAPI's FileResponse. None means 'not stored locally —
        caller should redirect to url()'. Used by LocalDisk; R2
        returns None."""


# ─────────────────────────────────────────────────────────────────────
class LocalDiskStorage(Storage):
    """Writes to backend/uploads/posts/. Used in dev + as the fallback
    when R2 env vars aren't set. Files survive a single process
    lifetime but vanish on Render restarts — that's why production
    needs R2."""

    def __init__(self, base_dir: Optional[Path] = None):
        if base_dir is None:
            # Default mirrors the original hard-coded path in pages.py
            # so nothing moves for existing dev installs.
            base_dir = (
                Path(__file__).resolve().parent.parent.parent / "uploads" / "posts"
            )
        self._dir = base_dir

    def _ensure(self) -> Path:
        self._dir.mkdir(parents=True, exist_ok=True)
        return self._dir

    def write(self, filename: str, data: bytes, content_type: str) -> None:
        target = self._ensure() / filename
        target.write_bytes(data)

    def delete(self, filename: str) -> None:
        target = self._dir / filename
        try:
            target.unlink()
        except FileNotFoundError:
            pass

    def url(self, filename: str, content_type: str) -> Optional[str]:
        return None  # signal to caller: use path() + FileResponse

    def path(self, filename: str) -> Optional[Path]:
        return self._dir / filename


# ─────────────────────────────────────────────────────────────────────
class R2Storage(Storage):
    """Cloudflare R2 backend via boto3's S3-compatible client.

    Configuration env vars (all required):
      R2_ACCOUNT_ID         — your Cloudflare account ID. R2 endpoint
                              is https://<account>.r2.cloudflarestorage.com.
      R2_ACCESS_KEY_ID      — from the API token you generated in the
                              Cloudflare dashboard under R2 → Manage
                              R2 API tokens.
      R2_SECRET_ACCESS_KEY  — matching secret.
      R2_BUCKET_NAME        — the bucket the post images live in.
      R2_PUBLIC_BASE_URL    — OPTIONAL. If set, url() returns
                              {base}/{filename} directly (skipping
                              presigning). Use this when you've set
                              up either the auto pub-<hash>.r2.dev
                              public URL OR a custom domain like
                              images.civicview.app. When unset,
                              url() returns a 1-hour-presigned URL —
                              safe default that doesn't require
                              configuring public access on the bucket.

    Boto3 is imported lazily inside __init__ so dev environments that
    don't have it installed (and aren't using R2) don't crash at
    module-load time.
    """

    def __init__(self):
        try:
            import boto3
        except ImportError as e:
            raise RuntimeError(
                "R2 storage requested but boto3 isn't installed. "
                "Run `pip install -r requirements.txt` to pick up boto3>=1.34."
            ) from e

        self._account_id = _require_env("R2_ACCOUNT_ID")
        self._access_key = _require_env("R2_ACCESS_KEY_ID")
        self._secret_key = _require_env("R2_SECRET_ACCESS_KEY")
        self._bucket = _require_env("R2_BUCKET_NAME")
        self._public_base = (os.getenv("R2_PUBLIC_BASE_URL") or "").rstrip("/") or None

        # region_name='auto' is R2's convention — they're not really
        # regional in the AWS sense, but boto3 requires the field.
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{self._account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
            region_name="auto",
        )

    def write(self, filename: str, data: bytes, content_type: str) -> None:
        # ContentType lands as the object's Content-Type metadata so
        # the eventual GET response (via presigned URL or public URL)
        # carries the right header — important for browser <img> tags
        # to render without MIME sniffing.
        self._client.put_object(
            Bucket=self._bucket,
            Key=filename,
            Body=data,
            ContentType=content_type,
        )

    def delete(self, filename: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=filename)

    def url(self, filename: str, content_type: str) -> Optional[str]:
        if self._public_base:
            # Bucket is public via Cloudflare custom domain or
            # pub-<hash>.r2.dev — return the direct URL. No
            # signature math, no expiry to refresh.
            return f"{self._public_base}/{filename}"
        # Presigned GET URL valid for 1 hour. Browser follows the
        # 302 redirect from /api/pages/images/<id> and fetches
        # directly from R2 — no backend bandwidth used.
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": filename},
            ExpiresIn=3600,
        )

    def path(self, filename: str) -> Optional[Path]:
        return None  # signal to caller: use url() + RedirectResponse


def _require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(
            f"R2 storage requested but {name} is not set in the environment. "
            f"Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, "
            f"and R2_BUCKET_NAME together — partial config breaks at runtime."
        )
    return val


# ─────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────
_STORAGE_SINGLETON: Optional[Storage] = None


def get_storage() -> Storage:
    """Return the active storage backend. Picks R2 when the full R2
    env var set is present, otherwise falls back to LocalDiskStorage.
    Cached singleton — re-uses the same boto3 client across requests."""
    global _STORAGE_SINGLETON
    if _STORAGE_SINGLETON is not None:
        return _STORAGE_SINGLETON

    if _r2_env_present():
        try:
            _STORAGE_SINGLETON = R2Storage()
            logger.info(
                "Image storage: R2 backend active (bucket=%s, public=%s)",
                os.getenv("R2_BUCKET_NAME"),
                "yes" if os.getenv("R2_PUBLIC_BASE_URL") else "no (presigned)",
            )
            return _STORAGE_SINGLETON
        except Exception:
            logger.exception(
                "R2 env vars are set but R2Storage failed to initialize — "
                "falling back to LocalDiskStorage. Check the boto3 install + "
                "verify R2_* credentials in the Cloudflare dashboard."
            )

    _STORAGE_SINGLETON = LocalDiskStorage()
    logger.info("Image storage: LocalDisk backend active (uploads/posts/)")
    return _STORAGE_SINGLETON


def reset_storage_for_tests() -> None:
    """Test-only hook to clear the cached singleton so env-var changes
    take effect between test cases. Not used in production code."""
    global _STORAGE_SINGLETON
    _STORAGE_SINGLETON = None


def _r2_env_present() -> bool:
    """True iff every required R2 env var is set + non-empty."""
    required = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME")
    return all((os.getenv(name) or "").strip() for name in required)
