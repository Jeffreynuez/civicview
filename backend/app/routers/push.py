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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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
    _merge_tracked(row, payload.tracked, payload.tracked_remove)
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


def _forget_owner_state(db: Session, row) -> None:
    """The device changes hands: drop the tracked list it carried and
    any updates held for the previous owner's summary push. A phone
    (DeviceToken) or a browser (WebPushSubscription)."""
    from app.models.pages import PushHeldItem
    from app.services.push_service import is_web

    row.tracked_json = None
    row.summary_sent_at = None
    held_col = PushHeldItem.web_subscription_id if is_web(row) else PushHeldItem.device_token_id
    db.query(PushHeldItem).filter(held_col == row.id).delete(synchronize_session=False)


def _merge_tracked(row, tracked: Optional[List[str]], tracked_remove: Optional[List[str]]) -> None:
    """tracked is merged into the stored list and tracked_remove takes
    keys out (2026-10-16), for phones and browsers alike."""
    if tracked is None and not tracked_remove:
        return
    stored = []
    try:
        stored = json.loads(row.tracked_json) if row.tracked_json else []
    except (ValueError, TypeError):
        stored = []
    # The new keys first, so the cap keeps them over the oldest.
    merged = _normalize_tracked(list(tracked or []) + [k for k in stored if isinstance(k, str)])
    removed = set(_normalize_tracked(list(tracked_remove or [])))
    merged = [k for k in merged if k not in removed]
    row.tracked_json = json.dumps(merged) if merged else None


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


# ── Web push (2026-10-18): browsers, the iPhone Home Screen app and the
# Windows app. The same rules as the phone routes above: a register with
# a citizen session binds the browser, one without unbinds it, unbind is
# the sign-out, unregister is "Turn off". Holding the endpoint is the
# proof for unbind and unregister, as the token is for a phone; both can
# only take alerts away. CSRF and the push rate limit apply as above.

class WebPushKeys(BaseModel):
    p256dh: str = Field(min_length=80, max_length=128)
    auth: str = Field(min_length=16, max_length=64)


class WebPushIn(BaseModel):
    endpoint: str = Field(min_length=12, max_length=1024)
    keys: WebPushKeys
    # The public key the browser subscribed with; must be ours.
    application_server_key: Optional[str] = Field(default=None, max_length=128)
    platform: str = Field(default="desktop", max_length=16)
    tracked: Optional[List[str]] = None
    tracked_remove: Optional[List[str]] = None
    prefs: Optional[dict] = None


class WebPushEndpointIn(BaseModel):
    endpoint: str = Field(min_length=12, max_length=1024)


_WEB_PLATFORMS = {"desktop", "android", "ios"}


@router.post("/web/register")
def register_web_push(
    payload: WebPushIn,
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    from app.models.pages import WebPushSubscription
    from app.services import web_push

    if not web_push.enabled():
        raise HTTPException(status_code=503, detail="web_push_off")
    # Only the real push services: nobody can point the server at an
    # address of their choosing.
    if not web_push.is_allowed_endpoint(payload.endpoint):
        raise HTTPException(status_code=400, detail="endpoint_not_allowed")
    if not web_push.valid_keys(payload.keys.p256dh, payload.keys.auth):
        raise HTTPException(status_code=400, detail="invalid_keys")
    key = (payload.application_server_key or "").strip().rstrip("=")
    if key and key != web_push.public_key():
        # NEXT_PUBLIC_VAPID_PUBLIC_KEY (Vercel) is not VAPID_PUBLIC_KEY
        # (Render): our pushes could never reach this subscription.
        logger.warning("web push: a browser subscribed with another public key; check that "
                       "NEXT_PUBLIC_VAPID_PUBLIC_KEY matches VAPID_PUBLIC_KEY")
        raise HTTPException(status_code=409, detail="vapid_key_mismatch")

    now = datetime.utcnow()
    row = db.query(WebPushSubscription).filter(WebPushSubscription.endpoint == payload.endpoint).first()
    if row is None:
        row = WebPushSubscription(endpoint=payload.endpoint, p256dh=payload.keys.p256dh,
                                  auth=payload.keys.auth)
        db.add(row)
    row.p256dh = payload.keys.p256dh
    row.auth = payload.keys.auth
    row.platform = payload.platform if payload.platform in _WEB_PLATFORMS else "desktop"
    row.last_seen_at = now
    # The browser belongs to whoever is signed in on it right now.
    new_owner = citizen.id if citizen is not None else None
    if row.id is not None and row.citizen_id != new_owner:
        _forget_owner_state(db, row)
    row.citizen_id = new_owner
    _merge_tracked(row, payload.tracked, payload.tracked_remove)
    if payload.prefs is not None:
        from app.routers.auth_citizen import sanitize_notification_prefs

        prefs = sanitize_notification_prefs(payload.prefs)
        row.prefs_json = json.dumps(prefs, ensure_ascii=False) if prefs else None
    db.commit()
    return {"ok": True, "bound": citizen is not None}


@router.post("/web/unbind")
def unbind_web_push(payload: WebPushEndpointIn, db: Session = Depends(get_db)):
    """Sign-out: the browser keeps push for whoever uses it next but no
    longer belongs to the account, with an empty tracked list."""
    from app.models.pages import WebPushSubscription

    row = db.query(WebPushSubscription).filter(WebPushSubscription.endpoint == payload.endpoint).first()
    if row is None:
        return {"ok": True, "unbound": False}
    was_bound = row.citizen_id is not None
    _forget_owner_state(db, row)
    row.citizen_id = None
    db.commit()
    if was_bound:
        logger.info("web push: browser unbound on sign-out")
    return {"ok": True, "unbound": was_bound}


@router.post("/web/unregister")
def unregister_web_push(payload: WebPushEndpointIn, db: Session = Depends(get_db)):
    """Turn off: the subscription and everything stored with it go."""
    from app.models.pages import PushHeldItem, WebPushSubscription

    row = db.query(WebPushSubscription).filter(WebPushSubscription.endpoint == payload.endpoint).first()
    deleted = 0
    if row is not None:
        db.query(PushHeldItem).filter(PushHeldItem.web_subscription_id == row.id).delete(
            synchronize_session=False)
        deleted = db.query(WebPushSubscription).filter(WebPushSubscription.id == row.id).delete(
            synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": int(deleted)}


# ── Admin: "Send me a test push" (2026-10-16) ────────────────────────
admin_router = APIRouter()


class TestPushIn(BaseModel):
    # The token saved on the device the admin page is open on, when it
    # is open in the app. Only a token already registered here is used.
    token: Optional[str] = Field(default=None, max_length=512)
    # This browser's web push endpoint (2026-10-18), likewise.
    endpoint: Optional[str] = Field(default=None, max_length=1024)


@admin_router.post("/test")
def send_test_push(
    payload: Optional[TestPushIn] = None,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
):
    """Send one test push to the admin's own devices: those bound to
    their citizen account, plus this device's token when the page is
    open in the app, and since 2026-10-18 the browsers bound to the
    account plus this browser. Reports what happened and logs it."""
    from app.models.pages import PushHeldItem, WebPushSubscription
    from app.services import web_push
    from app.services.push_service import DevPushService, message_for, send_push_messages, web_rows_for

    rows = []
    web_rows = []
    if actor.get("kind") == "citizen":
        rows = db.query(DeviceToken).filter(DeviceToken.citizen_id == actor.get("id")).all()
        web_rows = web_rows_for(db, [actor.get("id")])
    token = (payload.token or "").strip() if payload is not None else ""
    if token and token not in {r.token for r in rows}:
        extra = db.query(DeviceToken).filter(DeviceToken.token == token).first()
        if extra is not None:
            rows.append(extra)
    endpoint = (payload.endpoint or "").strip() if payload is not None else ""
    if endpoint and web_push.enabled() and endpoint not in {r.endpoint for r in web_rows}:
        extra = db.query(WebPushSubscription).filter(WebPushSubscription.endpoint == endpoint).first()
        if extra is not None:
            web_rows.append(extra)
    service = "dev" if isinstance(get_push_service(), DevPushService) else "fcm"
    web = "on" if web_push.enabled() else "off"
    if not rows and not web_rows:
        logger.info("admin %s:%s test push: no registered device", actor.get("kind"), actor.get("id"))
        return {"devices": 0, "sent": 0, "failed": 0, "pruned": 0, "service": service, "web": web}

    def test_message(r):
        return message_for(r, {"lock_screen_details": True}, title="CivicView test push",
                           body="If you can read this, push works on this device.",
                           data={"kind": "test"}, channel="officials", ttl_seconds=600)

    result = send_push_messages([test_message(r) for r in rows])
    pruned = 0
    if result.invalid:
        dead = [r.id for r in rows if r.token in result.invalid]
        db.query(PushHeldItem).filter(PushHeldItem.device_token_id.in_(dead)).delete(synchronize_session=False)
        pruned = db.query(DeviceToken).filter(DeviceToken.id.in_(dead)).delete(synchronize_session=False)
        db.commit()
    web_result = web_push.deliver(db, [(r, test_message(r)) for r in web_rows])
    if web_rows:
        db.commit()
    pruned += len(web_result.invalid)
    out = {"devices": len(rows) + len(web_rows), "sent": len(result.sent) + len(web_result.sent),
           "failed": len(result.failed) + len(web_result.failed),
           "pruned": pruned, "service": service, "web": web}
    logger.info("admin %s:%s test push: %s", actor.get("kind"), actor.get("id"), out)
    return out
