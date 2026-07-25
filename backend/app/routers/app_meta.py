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

from __future__ import annotations

import os

from fastapi import APIRouter
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
