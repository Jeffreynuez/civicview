# CivicView — device push-token registration.
# Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.
#
# POST /api/push/register    — upsert a device token. Signed-in citizen
#                              -> token binds to the account (personal
#                              tracked-activity pushes). Anonymous ->
#                              token joins the 'announcements' broadcast
#                              topic instead (background task).
# POST /api/push/unregister  — forget a token (sign-out / opt-out).
#
# CSRF: NOT exempt — the standard middleware applies. The frontend
# fetches /api/csrf and sends X-CSRF-Token like every other write.
# (Exempting would let a cross-site POST bind an attacker's device to a
# victim's session and siphon their personal notifications.)

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import CitizenAccount, DeviceToken
from app.services.push_service import ANNOUNCEMENTS_TOPIC, get_push_service

logger = logging.getLogger(__name__)
router = APIRouter()


class PushTokenIn(BaseModel):
    token: str = Field(min_length=8, max_length=512)
    platform: str = Field(default="android", max_length=16)


def _subscribe_announcements_bg(token: str) -> None:
    """BackgroundTasks entrypoint — topic subscription is a network
    round-trip to FCM; never ride it on the request."""
    try:
        get_push_service().subscribe_to_topic([token], ANNOUNCEMENTS_TOPIC)
    except Exception:
        logger.exception("announcements subscribe failed (non-fatal)")


@router.post("/register")
def register_device(
    payload: PushTokenIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    row = db.query(DeviceToken).filter(DeviceToken.token == payload.token).first()
    if row is None:
        row = DeviceToken(token=payload.token, platform=payload.platform)
        db.add(row)
    row.platform = payload.platform
    row.last_seen_at = datetime.utcnow()
    if citizen is not None:
        # (Re-)bind to the current citizen — a shared/hand-me-down
        # device follows whoever is signed in on it.
        row.citizen_id = citizen.id
    db.commit()
    if citizen is None:
        # Anonymous device -> broadcast channel. Signed-in devices get
        # personal pushes instead; they can join announcements later if
        # a preference for that ships.
        background_tasks.add_task(_subscribe_announcements_bg, payload.token)
    return {"ok": True, "bound": citizen is not None}


@router.post("/unregister")
def unregister_device(
    payload: PushTokenIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    deleted = (
        db.query(DeviceToken)
        .filter(DeviceToken.token == payload.token)
        .delete(synchronize_session=False)
    )
    db.commit()
    if deleted:
        background_tasks.add_task(
            lambda t: get_push_service().unsubscribe_from_topic([t], ANNOUNCEMENTS_TOPIC),
            payload.token,
        )
    return {"ok": True, "deleted": int(deleted)}
