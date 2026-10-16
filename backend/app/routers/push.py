# CivicView — device push-token registration.
# Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.
#
# POST /api/push/register    — upsert a device token. Signed-in citizen
#                              -> token binds to the account (personal
#                              tracked-activity pushes). Anonymous ->
#                              token joins the 'announcements' broadcast
#                              topic (background task) AND — since
#                              Notifications v2 part 3 — may carry its
#                              own tracked-official key list + a channel
#                              prefs snapshot, so tracked-activity
#                              pushes reach installs that never sign in.
# POST /api/push/unregister: forget a token (push turned off).
# POST /api/push/unbind: sign-out (2026-10-16). The device stays
#   registered but belongs to nobody, with an empty tracked list. A
#   register with no citizen session unbinds a bound device too.
#
# CSRF: NOT exempt — the standard middleware applies. The frontend
# fetches /api/csrf and sends X-CSRF-Token like every other write.
# (Exempting would let a cross-site POST bind an attacker's device to a
# victim's session and siphon their personal notifications.)

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import CitizenAccount, DeviceToken
from app.services.push_service import ANNOUNCEMENTS_TOPIC, get_push_service

logger = logging.getLogger(__name__)
router = APIRouter()

# Caps for the optional v2 register fields. Tracked keys use the same
# officialKey() format as the frontend (bioguide id / backend id,
# lowercased) — 64 chars matches TrackedOfficial.official_key.
_TRACKED_MAX_KEYS = 200
_TRACKED_MAX_KEY_LEN = 64


class PushTokenIn(BaseModel):
    token: str = Field(min_length=8, max_length=512)
    platform: str = Field(default="android", max_length=16)
    # Notifications v2 (both optional; absent = leave stored value
    # untouched, so an old-app register can't wipe a newer one):
    #   tracked — this device's tracked-official keys. Consulted by the
    #     fan-out only for anonymous rows; bound accounts resolve
    #     tracking server-side. [] explicitly clears.
    #   prefs: channel-prefs snapshot ({quiet_hours, push_cadence,
    #     tz_offset_minutes}) for per-device quiet hours and push
    #     timing when the device is anonymous.
    tracked: Optional[List[str]] = None
    prefs: Optional[dict] = None


def _normalize_tracked(keys: List[str]) -> List[str]:
    """Lowercase, trim, dedupe, and cap the tracked-key list. Oversize
    single keys are dropped rather than erroring — one junk entry
    shouldn't break a whole device registration."""
    seen: set = set()
    out: List[str] = []
    for raw in keys[:_TRACKED_MAX_KEYS]:
        if not isinstance(raw, str):
            continue
        key = raw.strip().lower()
        if not key or len(key) > _TRACKED_MAX_KEY_LEN or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


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
    # The device belongs to whoever is signed in on it right now
    # (2026-10-16). A signed-in register binds it; a register with no
    # citizen session (the app opened after a sign-out made offline, or
    # a session that expired) unbinds it, so a shared phone never keeps
    # the last account's alerts.
    new_owner = citizen.id if citizen is not None else None
    if row.id is not None and row.citizen_id != new_owner:
        _forget_owner_state(db, row)
    row.citizen_id = new_owner
    # v2 optional fields — None means "not sent" (old app build or a
    # launch-time re-register before stores hydrate) and leaves the
    # stored value alone; an explicit [] / {} clears.
    if payload.tracked is not None:
        normalized = _normalize_tracked(payload.tracked)
        row.tracked_json = json.dumps(normalized) if normalized else None
    if payload.prefs is not None:
        from app.routers.auth_citizen import sanitize_notification_prefs

        prefs = sanitize_notification_prefs(payload.prefs)
        row.prefs_json = json.dumps(prefs, ensure_ascii=False) if prefs else None
    db.commit()
    if citizen is None:
        # Anonymous device -> broadcast channel. Signed-in devices get
        # personal pushes instead; they can join announcements later if
        # a preference for that ships.
        background_tasks.add_task(_subscribe_announcements_bg, payload.token)
    return {"ok": True, "bound": citizen is not None}


def _forget_owner_state(db: Session, row: DeviceToken) -> None:
    """The device changes hands: drop the tracked list it carried and
    any updates held for the previous owner's summary push."""
    from app.models.pages import PushHeldItem

    row.tracked_json = None
    row.summary_sent_at = None
    db.query(PushHeldItem).filter(PushHeldItem.device_token_id == row.id).delete(
        synchronize_session=False)


class PushUnbindIn(BaseModel):
    token: str = Field(min_length=8, max_length=512)


@router.post("/unbind")
def unbind_device(payload: PushUnbindIn, db: Session = Depends(get_db)):
    """Sign-out (2026-10-16): the device stays registered, so push keeps
    working for whoever uses the app next, but it no longer belongs to
    the account that signed out: no account, an empty tracked list, no
    held updates. Like /unregister, holding the device token is the
    proof; it can only take alerts away from a device."""
    row = db.query(DeviceToken).filter(DeviceToken.token == payload.token).first()
    if row is None:
        return {"ok": True, "unbound": False}
    was_bound = row.citizen_id is not None
    _forget_owner_state(db, row)
    row.citizen_id = None
    db.commit()
    if was_bound:
        logger.info("push: device unbound on sign-out")
    return {"ok": True, "unbound": was_bound}


@router.post("/unregister")
def unregister_device(
    payload: PushTokenIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    from app.models.pages import PushHeldItem

    row = db.query(DeviceToken).filter(DeviceToken.token == payload.token).first()
    deleted = 0
    if row is not None:
        # Turning push off deletes the token and everything stored with
        # it, including updates held for a summary (privacy policy).
        db.query(PushHeldItem).filter(PushHeldItem.device_token_id == row.id).delete(
            synchronize_session=False)
        deleted = db.query(DeviceToken).filter(DeviceToken.id == row.id).delete(synchronize_session=False)
    db.commit()
    if deleted:
        background_tasks.add_task(
            lambda t: get_push_service().unsubscribe_from_topic([t], ANNOUNCEMENTS_TOPIC),
            payload.token,
        )
    return {"ok": True, "deleted": int(deleted)}
