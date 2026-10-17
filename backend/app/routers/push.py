# CivicView — device push-token registration.
# Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.
#
# POST /api/push/register    — upsert a device token. Signed-in citizen
#                              -> token binds to the account (personal
#                              tracked-activity pushes). Anonymous ->
#                              may carry its own tracked-official key
#                              list + a channel prefs snapshot, so
#                              tracked-activity pushes reach installs
#                              that never sign in. (Until 2026-10-16 it
#                              also joined the unused 'announcements'
#                              topic.)
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
from app.services.admin_auth import get_current_admin
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
    #     tracking server-side. Since 2026-10-16 the keys are ADDED to
    #     the stored list, never replace it: an anonymous app keeps its
    #     tracking in memory only, so each session starts with an empty
    #     list, and a replace wiped everything tracked in earlier ones.
    #   tracked_remove: keys the user untracked; the only way a key
    #     leaves the stored list.
    #   prefs: channel-prefs snapshot ({quiet_hours, push_cadence,
    #     tz_offset_minutes}) for per-device quiet hours and push
    #     timing when the device is anonymous.
    tracked: Optional[List[str]] = None
    tracked_remove: Optional[List[str]] = None
    prefs: Optional[dict] = None
    # 2026-10-17 (phone notifications), both optional:
    #   app_build: the Android app's versionCode. 5 (1.2.0) and later
    #     build their own notifications (push_service.NATIVE_BUILD).
    #   os_enabled: false when notifications for CivicView are off in
    #     Android settings (the app checks at every launch and resume).
    #     The device is then skipped by every send path until it reports
    #     true again; the token is kept, so turning them back on in
    #     Android settings is all it takes.
    app_build: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    os_enabled: Optional[bool] = None


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


@router.post("/register")
def register_device(
    payload: PushTokenIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    row = db.query(DeviceToken).filter(DeviceToken.token == payload.token).first()
    if row is None:
        # New devices never join the old 'announcements' topic (2026-10-16).
        row = DeviceToken(token=payload.token, platform=payload.platform,
                          announcements_cleared_at=datetime.utcnow())
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
    # v2 optional fields. tracked is merged into the stored list and
    # tracked_remove takes keys out (2026-10-16); prefs {} clears.
    if payload.tracked is not None or payload.tracked_remove:
        stored = []
        try:
            stored = json.loads(row.tracked_json) if row.tracked_json else []
        except (ValueError, TypeError):
            stored = []
        # The new keys first, so the cap keeps them over the oldest.
        merged = _normalize_tracked(
            list(payload.tracked or []) + [k for k in stored if isinstance(k, str)])
        removed = set(_normalize_tracked(list(payload.tracked_remove or [])))
        merged = [k for k in merged if k not in removed]
        row.tracked_json = json.dumps(merged) if merged else None
    if payload.prefs is not None:
        from app.routers.auth_citizen import sanitize_notification_prefs

        prefs = sanitize_notification_prefs(payload.prefs)
        row.prefs_json = json.dumps(prefs, ensure_ascii=False) if prefs else None
    if payload.app_build is not None:
        row.app_build = payload.app_build
    if payload.os_enabled is False:
        if row.notifications_off_at is None:
            row.notifications_off_at = datetime.utcnow()
    elif payload.os_enabled is True:
        row.notifications_off_at = None
    db.commit()
    return {"ok": True, "bound": citizen is not None, "os_enabled": row.notifications_off_at is None}


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


# ── Admin: "Send me a test push" (2026-10-16) ────────────────────────
admin_router = APIRouter()


class TestPushIn(BaseModel):
    # The token saved on the device the admin page is open on, when it
    # is open in the app. Only a token already registered here is used.
    token: Optional[str] = Field(default=None, max_length=512)


@admin_router.post("/test")
def send_test_push(
    payload: Optional[TestPushIn] = None,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
):
    """Send one test push to the admin's own devices: those bound to
    their citizen account, plus this device's token when the page is
    open in the app. Reports what happened and logs it."""
    from app.models.pages import PushHeldItem
    from app.services.push_service import DevPushService, message_for, send_push_messages

    rows = []
    if actor.get("kind") == "citizen":
        rows = db.query(DeviceToken).filter(DeviceToken.citizen_id == actor.get("id")).all()
    token = (payload.token or "").strip() if payload is not None else ""
    if token and token not in {r.token for r in rows}:
        extra = db.query(DeviceToken).filter(DeviceToken.token == token).first()
        if extra is not None:
            rows.append(extra)
    service = "dev" if isinstance(get_push_service(), DevPushService) else "fcm"
    if not rows:
        logger.info("admin %s:%s test push: no registered device", actor.get("kind"), actor.get("id"))
        return {"devices": 0, "sent": 0, "failed": 0, "pruned": 0, "service": service}
    result = send_push_messages([
        message_for(r, {"lock_screen_details": True}, title="CivicView test push",
                    body="If you can read this, push works on this device.",
                    data={"kind": "test"}, channel="officials", ttl_seconds=600)
        for r in rows
    ])
    pruned = 0
    if result.invalid:
        dead = [r.id for r in rows if r.token in result.invalid]
        db.query(PushHeldItem).filter(PushHeldItem.device_token_id.in_(dead)).delete(synchronize_session=False)
        pruned = db.query(DeviceToken).filter(DeviceToken.id.in_(dead)).delete(synchronize_session=False)
        db.commit()
    out = {"devices": len(rows), "sent": len(result.sent), "failed": len(result.failed),
           "pruned": pruned, "service": service}
    logger.info("admin %s:%s test push: %s", actor.get("kind"), actor.get("id"), out)
    return out
