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
import threading
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
# Uploads and image reads run on worker threads; two first requests at
# once must not both build the boto3 client, which is not thread-safe
# to create.
_STORAGE_LOCK = threading.Lock()


def get_storage() -> Storage:
    """Return the active storage backend. Picks R2 when the full R2
    env var set is present, otherwise falls back to LocalDiskStorage.
    Cached singleton — re-uses the same boto3 client across requests."""
    if _STORAGE_SINGLETON is not None:
        return _STORAGE_SINGLETON
    with _STORAGE_LOCK:
        return _make_storage()


def _make_storage() -> Storage:
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


# ─────────────────────────────────────────────────────────────────────
# Metadata stripping (2026-10-16)
# ─────────────────────────────────────────────────────────────────────
# Uploaded post images are public, and a photo straight off a phone
# carries EXIF: where it was taken (GPS), when, and the device. Every
# upload is decoded and re-encoded from its pixels alone before it is
# stored, so none of that is kept: no EXIF, no XMP, no JPEG comments,
# no PNG text chunks, no embedded color profile and no secondary
# images (the depth or preview images some phones attach as MPO).
#
# What is kept is what you see: the EXIF orientation is applied to the
# pixels first, so a photo shot sideways stays upright; a non-sRGB color
# profile (an iPhone's Display P3, say) is converted to sRGB so colors
# look the same without the profile; PNG transparency, animation frames
# and timing are kept; and the format stays the same (a JPEG stays a
# JPEG, a lossless WebP stays lossless). A JPEG that needs no rotation
# or color conversion keeps its original quantization tables, so it is
# not degraded by the re-encode.

# Decoded size limit, across all frames. 50 megapixels admits a 48 MP
# phone photo and keeps a small file that expands into an enormous
# image (a decompression bomb) from exhausting the server's memory.
MAX_DECODED_PIXELS = 50_000_000

# Pillow's format name -> the content type we store and serve. MPO is a
# JPEG with extra images appended; it is stored as a plain JPEG.
_FORMAT_CONTENT_TYPES = {
    "JPEG": "image/jpeg",
    "MPO": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
_SAVE_FORMAT = {"JPEG": "JPEG", "MPO": "JPEG", "PNG": "PNG", "WEBP": "WEBP"}
_ORIENTATION_TAG = 0x0112


class ImageRejected(ValueError):
    """The upload can't be stored. str(error) is a message for the user."""


def strip_image_metadata(data: bytes) -> tuple[bytes, str]:
    """Return (clean bytes, content type) for an uploaded image.

    The content type comes from the file's actual format, not from what
    the browser declared. Raises ImageRejected for anything that is not
    a readable JPEG, PNG or WebP, or that decodes to more than
    MAX_DECODED_PIXELS."""
    from io import BytesIO

    from PIL import Image

    try:
        src = Image.open(BytesIO(data))
        fmt = src.format
        if fmt not in _FORMAT_CONTENT_TYPES:
            raise ImageRejected("Only JPEG, PNG, and WebP images are supported.")
        # MPO reports its appended images as frames; they are not an
        # animation and are dropped with the rest of the metadata.
        frames = 1 if fmt == "MPO" else int(getattr(src, "n_frames", 1) or 1)
        width, height = src.size
        if width * height * frames > MAX_DECODED_PIXELS:
            raise ImageRejected("This image is too large to process. Please upload a smaller one.")
        out = BytesIO()
        if _SAVE_FORMAT[fmt] == "JPEG":
            _save_jpeg(src, fmt, out)
        elif frames > 1:
            _save_animated(src, fmt, data, out)
        else:
            _save_still(src, fmt, data, out)
    except ImageRejected:
        raise
    except Exception as e:
        # Pillow raises a range of types for a damaged or disguised file
        # (UnidentifiedImageError, SyntaxError, struct.error, ...).
        raise ImageRejected("This file couldn't be read as an image.") from e
    return out.getvalue(), _FORMAT_CONTENT_TYPES[fmt]


def _orientation(im) -> int:
    try:
        return int(im.getexif().get(_ORIENTATION_TAG, 1) or 1)
    except Exception:
        return 1


def _transpose_method(orientation: int):
    from PIL import Image

    return {
        2: Image.Transpose.FLIP_LEFT_RIGHT,
        3: Image.Transpose.ROTATE_180,
        4: Image.Transpose.FLIP_TOP_BOTTOM,
        5: Image.Transpose.TRANSPOSE,
        6: Image.Transpose.ROTATE_270,
        7: Image.Transpose.TRANSVERSE,
        8: Image.Transpose.ROTATE_90,
    }.get(orientation)


_CONVERTIBLE_MODES = {"RGB": "RGB", "RGBA": "RGBA", "CMYK": "RGB"}


def _foreign_profile(icc, mode: str) -> Optional[bytes]:
    """The embedded color profile when converting to sRGB would change
    how the image looks; None when there is none, it is sRGB, or the
    image's mode is one LittleCMS can't convert (the profile is then
    simply dropped)."""
    if not icc or mode not in _CONVERTIBLE_MODES:
        return None
    try:
        from io import BytesIO

        from PIL import ImageCms

        desc = ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(BytesIO(icc))) or ""
    except Exception:
        return None  # unreadable profile: dropped, nothing to convert from
    return None if "srgb" in desc.lower() else icc


def _to_srgb(im, icc: Optional[bytes]):
    """Convert pixels from the embedded profile to sRGB, so the profile
    can be dropped without changing colors."""
    out_mode = _CONVERTIBLE_MODES.get(im.mode)
    if not icc or out_mode is None:
        return im
    try:
        from io import BytesIO

        from PIL import ImageCms

        return ImageCms.profileToProfile(
            im, ImageCms.ImageCmsProfile(BytesIO(icc)), ImageCms.createProfile("sRGB"),
            outputMode=out_mode,
        )
    except Exception:
        return im


def _upright(im, orientation: int):
    method = _transpose_method(orientation)
    return im.transpose(method) if method is not None else im.copy()


def _save_jpeg(src, fmt: str, out) -> None:
    from PIL import JpegImagePlugin

    orientation = _orientation(src)
    icc = _foreign_profile(src.info.get("icc_profile"), src.mode)
    if fmt == "JPEG" and _transpose_method(orientation) is None and icc is None:
        # Nothing to change in the pixels: re-encode with the original
        # quantization tables and subsampling. Pillow writes no EXIF,
        # XMP or profile unless asked; the comment is the one thing it
        # copies from .info, so .info is emptied first.
        src.info = {}
        try:
            src.save(out, "JPEG", quality="keep", subsampling="keep")
            return
        except Exception:
            out.seek(0)
            out.truncate()
    sampling = JpegImagePlugin.get_sampling(src)
    im = _to_srgb(_upright(src, orientation), icc)
    im.info = {}
    options = {"quality": 90}
    if sampling in (0, 1, 2):
        options["subsampling"] = sampling
    im.save(out, "JPEG", **options)


def _webp_is_lossless(data: bytes) -> bool:
    """True when the WebP's first image chunk is VP8L (lossless)."""
    pos = 12  # after "RIFF", the size and "WEBP"
    while pos + 8 <= len(data):
        fourcc = data[pos:pos + 4]
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        if fourcc == b"VP8L":
            return True
        if fourcc == b"VP8 ":
            return False
        if fourcc == b"ANMF":
            # 16-byte frame header, then the frame's own chunks; an
            # alpha (ALPH) chunk is followed by lossy VP8 data.
            return data[pos + 24:pos + 28] == b"VP8L"
        pos += 8 + size + (size & 1)
    return False


def _webp_options(data: bytes) -> dict:
    return {"lossless": True} if _webp_is_lossless(data) else {"quality": 90}


def _save_still(src, fmt: str, data: bytes, out) -> None:
    transparency = src.info.get("transparency")
    icc = _foreign_profile(src.info.get("icc_profile"), src.mode)
    im = _to_srgb(_upright(src, _orientation(src)), icc)
    im.info = {}
    options = {}
    if fmt == "PNG" and transparency is not None and im.mode in ("1", "L", "P", "RGB", "I", "I;16"):
        # The tRNS chunk is how a palette or grayscale PNG says which
        # color is see-through: pixels, not metadata.
        options["transparency"] = transparency
    if fmt == "WEBP":
        options.update(_webp_options(data))
    im.save(out, _SAVE_FORMAT[fmt], **options)


def _save_animated(src, fmt: str, data: bytes, out) -> None:
    """Animated PNG or WebP: Pillow hands each frame over composited
    onto the full canvas, so saving the composited frames with their
    durations reproduces the animation exactly. A color profile on an
    animation is dropped without conversion."""
    from PIL import ImageSequence

    method = _transpose_method(_orientation(src))
    loop = src.info.get("loop", 0)
    frames, durations = [], []
    for frame in ImageSequence.Iterator(src):
        frame.load()  # WebP sets a frame's duration when it is decoded
        durations.append(frame.info.get("duration", 100))
        clean = frame.convert("RGBA")
        if method is not None:
            clean = clean.transpose(method)
        clean.info = {}
        frames.append(clean)
    options = {"save_all": True, "append_images": frames[1:], "duration": durations, "loop": loop}
    if fmt == "WEBP":
        options.update(_webp_options(data))
    frames[0].save(out, _SAVE_FORMAT[fmt], **options)
