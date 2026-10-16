# CivicView — native-app metadata (force-update gate).
# Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.
#
# GET /api/app/version — the versionCode thresholds the Android shell
# checks on launch (components/AppUpdateGate.js):
#
#   min_version_code    — HARD gate. A shell below this shows a
#                         full-screen "Update required" blocker and
#                         cannot be used until updated.
#   latest_version_code — SOFT gate. A shell below this (but at/above
#                         min) sees a dismissible "Update available"
#                         banner.
#
# Both come from env vars on Render (APP_MIN_VERSION_CODE /
# APP_LATEST_VERSION_CODE) so Jeffrey can flip the gate per incident
# without a deploy — env change + service restart. Defaults of 0 make
# the gate INERT until the vars are set: every shipped versionCode is
# >= 1, so nothing blocks and nothing nags. Raise min_version_code
# only when an old shell is genuinely broken/dangerous (e.g. a plugin
# it lacks becomes load-bearing); raise latest_version_code whenever a
# new AAB goes live on Play.
#
# Unauthenticated + cache-friendly: this is public config, polled once
# per app launch.
#
# GET /api/app/notice: the site-wide notice banner (2026-10-16,
# components/SiteNoticeBanner.js). The privacy policy and the Terms
# promise "a notice on CivicView" at least 30 days before a material
# change; this is that notice. SITE_NOTICE_TEXT turns it on and is the
# text; SITE_NOTICE_URL is an optional "Read more" link (https://...,
# http://... or a path on this site such as /privacy). Unset text means
# no banner. Same env-change-and-restart flow as the version gate.

from __future__ import annotations

import os

from typing import Optional

from fastapi import APIRouter, Response
from pydantic import BaseModel

router = APIRouter()

PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.civicview"


class AppVersionResponse(BaseModel):
    min_version_code: int
    latest_version_code: int
    store_url: str


def _env_int(name: str) -> int:
    raw = (os.environ.get(name) or "").strip()
    try:
        return max(0, int(raw)) if raw else 0
    except ValueError:
        return 0


@router.get("/version", response_model=AppVersionResponse)
def app_version() -> AppVersionResponse:
    return AppVersionResponse(
        min_version_code=_env_int("APP_MIN_VERSION_CODE"),
        latest_version_code=_env_int("APP_LATEST_VERSION_CODE"),
        store_url=PLAY_STORE_URL,
    )


# ── Site-wide notice ──────────────────────────────────────────────────
SITE_NOTICE_MAX_CHARS = 500


class SiteNoticeResponse(BaseModel):
    text: Optional[str] = None
    url: Optional[str] = None


def _notice_url(raw: Optional[str]) -> Optional[str]:
    """A web address or a path on this site; anything else (a typo, a
    javascript: link) is dropped and the banner shows without a link."""
    value = (raw or "").strip()
    if not value or any(ch.isspace() for ch in value):
        return None
    lowered = value.lower()
    if lowered.startswith(("https://", "http://")):
        return value
    if value.startswith("/") and not value.startswith("//"):
        return value
    return None


@router.get("/notice", response_model=SiteNoticeResponse)
def site_notice(response: Response) -> SiteNoticeResponse:
    # Spaces and line breaks in the env value collapse to single spaces.
    text = " ".join((os.environ.get("SITE_NOTICE_TEXT") or "").split())[:SITE_NOTICE_MAX_CHARS]
    # A minute in the browser and at the edge, so turning the notice
    # off takes effect quickly.
    response.headers["Cache-Control"] = "public, max-age=60, s-maxage=60"
    if not text:
        return SiteNoticeResponse()
    return SiteNoticeResponse(text=text, url=_notice_url(os.environ.get("SITE_NOTICE_URL")))
