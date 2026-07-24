# CivicView — push notification service (FCM).
# Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.
#
# Same env-gated abstract/prod/dev pattern as email_service /
# stripe_service / idme_service: FIREBASE_SERVICE_ACCOUNT_JSON set ->
# FCMPushService (firebase-admin, lazy import); unset -> DevPushService
# that logs to stdout so every environment boots cleanly.
#
# v1 scope (2026-07-24, agreed with Jeffrey): pushes mirror the
# tracked-activity slice of the in-app bell — an official the citizen
# tracks posting a post/poll. Anonymous devices (no citizen session)
# are subscribed server-side to the ANNOUNCEMENTS_TOPIC broadcast
# channel instead (launch news, election-day reminders — use sparingly).

from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import Iterable, List, Optional

logger = logging.getLogger(__name__)

ANNOUNCEMENTS_TOPIC = "announcements"
# FCM multicast hard limit per request.
_BATCH = 500


class PushService(ABC):
    """Send push notifications to device tokens / topics."""

    @abstractmethod
    def send_to_tokens(
        self, tokens: List[str], *, title: str, body: str,
        data: Optional[dict] = None,
    ) -> List[str]:
        """Send to a list of device tokens. Returns the subset of
        tokens FCM reports as invalid/unregistered so the caller can
        prune them from the DB."""

    @abstractmethod
    def subscribe_to_topic(self, tokens: List[str], topic: str) -> None: ...

    @abstractmethod
    def unsubscribe_from_topic(self, tokens: List[str], topic: str) -> None: ...

    @abstractmethod
    def send_to_topic(
        self, topic: str, *, title: str, body: str,
        data: Optional[dict] = None,
    ) -> None: ...


class DevPushService(PushService):
    """No-credentials fallback — logs what WOULD be sent."""

    def send_to_tokens(self, tokens, *, title, body, data=None):
        logger.info(
            "[dev-push] would send to %d token(s): %r / %r data=%r",
            len(tokens), title, body, data,
        )
        return []

    def subscribe_to_topic(self, tokens, topic):
        logger.info("[dev-push] would subscribe %d token(s) to %r", len(tokens), topic)

    def unsubscribe_from_topic(self, tokens, topic):
        logger.info("[dev-push] would unsubscribe %d token(s) from %r", len(tokens), topic)

    def send_to_topic(self, topic, *, title, body, data=None):
        logger.info("[dev-push] would send to topic %r: %r / %r", topic, title, body)


class FCMPushService(PushService):
    """Firebase Cloud Messaging via firebase-admin.

    The service-account JSON arrives as the raw env-var STRING
    (FIREBASE_SERVICE_ACCOUNT_JSON on Render) — not a file path —
    so nothing secret ever touches the repo or disk."""

    def __init__(self, service_account_json: str):
        import firebase_admin
        from firebase_admin import credentials

        cred = credentials.Certificate(json.loads(service_account_json))
        # Named app + get_app guard so uvicorn reload / multiple
        # imports never trip "app already exists".
        try:
            self._app = firebase_admin.get_app("civicview")
        except ValueError:
            self._app = firebase_admin.initialize_app(cred, name="civicview")

    def send_to_tokens(self, tokens, *, title, body, data=None):
        from firebase_admin import messaging

        str_data = {k: str(v) for k, v in (data or {}).items()}
        invalid: List[str] = []
        for i in range(0, len(tokens), _BATCH):
            batch = tokens[i:i + _BATCH]
            message = messaging.MulticastMessage(
                tokens=batch,
                notification=messaging.Notification(title=title, body=body),
                data=str_data,
                android=messaging.AndroidConfig(priority="high"),
            )
            try:
                resp = messaging.send_each_for_multicast(message, app=self._app)
            except Exception:
                logger.exception("FCM multicast send failed (batch of %d)", len(batch))
                continue
            for token, r in zip(batch, resp.responses):
                if r.success:
                    continue
                # Unregistered / invalid-argument => token is dead;
                # report it for pruning. Other errors are transient.
                exc = r.exception
                name = type(exc).__name__ if exc else ""
                if name in ("UnregisteredError", "InvalidArgumentError"):
                    invalid.append(token)
        return invalid

    def subscribe_to_topic(self, tokens, topic):
        from firebase_admin import messaging
        for i in range(0, len(tokens), _BATCH):
            try:
                messaging.subscribe_to_topic(tokens[i:i + _BATCH], topic, app=self._app)
            except Exception:
                logger.exception("FCM topic subscribe failed (%s)", topic)

    def unsubscribe_from_topic(self, tokens, topic):
        from firebase_admin import messaging
        for i in range(0, len(tokens), _BATCH):
            try:
                messaging.unsubscribe_from_topic(tokens[i:i + _BATCH], topic, app=self._app)
            except Exception:
                logger.exception("FCM topic unsubscribe failed (%s)", topic)

    def send_to_topic(self, topic, *, title, body, data=None):
        from firebase_admin import messaging
        message = messaging.Message(
            topic=topic,
            notification=messaging.Notification(title=title, body=body),
            data={k: str(v) for k, v in (data or {}).items()},
            android=messaging.AndroidConfig(priority="high"),
        )
        try:
            messaging.send(message, app=self._app)
        except Exception:
            logger.exception("FCM topic send failed (%s)", topic)


_service: Optional[PushService] = None


def get_push_service() -> PushService:
    """Factory + singleton. FCM when FIREBASE_SERVICE_ACCOUNT_JSON is
    set (and firebase-admin importable); Dev fallback otherwise —
    loudly, so an operator knows push isn't live."""
    global _service
    if _service is not None:
        return _service
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        try:
            _service = FCMPushService(raw)
            logger.info("Push service: FCM (firebase-admin) active")
        except Exception:
            logger.exception(
                "FIREBASE_SERVICE_ACCOUNT_JSON is set but FCM init failed — "
                "falling back to DevPushService"
            )
            _service = DevPushService()
    else:
        logger.warning("FIREBASE_SERVICE_ACCOUNT_JSON not set — DevPushService active (no real pushes)")
        _service = DevPushService()
    return _service


# ── Quiet-hours + cadence enforcement (Notifications v2 part 4) ──────
# Semantics agreed with Jeffrey 2026-07-24: SUPPRESS, don't queue.
# A suppressed push is not lost information — the in-app bell row is
# already committed by the time this runs; push is purely the
# interruption channel, and quiet hours means "don't interrupt me."
# Cadence is a min-gap throttle per device: 'daily' ≈ at most one push
# per 20h, 'weekly' ≈ one per 6d (the slack absorbs clock drift and
# posts that land a few minutes earlier than yesterday's).
#
# Enforcement ONLY applies when a prefs blob exists (account-synced for
# bound devices, register-time snapshot for anonymous ones). No prefs =
# pre-v2 behavior (send everything) — devices/accounts opt into
# enforcement by syncing, never by our assumption. quiet-hours checks
# additionally require tz_offset_minutes, since "10pm" is meaningless
# without knowing the device's local clock.

_CADENCE_MIN_GAP_HOURS = {"daily": 20, "weekly": 6 * 24}


def _local_now(tz_offset_minutes: int) -> datetime:
    return datetime.utcnow() + timedelta(minutes=tz_offset_minutes)


def _in_quiet_hours(prefs: Optional[dict]) -> bool:
    """True when the device's local clock is inside its quiet window.
    quiet_hours choices mirror the frontend CHANNEL_SCHEMA slider:
    off / nights (10pm–8am) / nights_weekends (nights + all weekend) /
    work_hours_only (quiet EXCEPT Mon–Fri 9am–6pm)."""
    if not prefs:
        return False
    mode = prefs.get("quiet_hours") or "off"
    if mode == "off":
        return False
    tz = prefs.get("tz_offset_minutes")
    if not isinstance(tz, int) or isinstance(tz, bool) or abs(tz) > 14 * 60:
        return False  # No usable local clock — don't guess.
    now = _local_now(tz)
    night = now.hour >= 22 or now.hour < 8
    weekend = now.weekday() >= 5  # Sat=5, Sun=6
    if mode == "nights":
        return night
    if mode == "nights_weekends":
        return night or weekend
    if mode == "work_hours_only":
        working = (not weekend) and 9 <= now.hour < 18
        return not working
    return False  # Unknown mode — fail open (send).


def _cadence_gap_ok(prefs: Optional[dict], last_push_at) -> bool:
    """True when this device's cadence throttle allows a push now.
    'realtime' (or no prefs) always allows; 'daily'/'weekly' require
    the min gap since the device's last actual push."""
    if not prefs:
        return True
    gap_hours = _CADENCE_MIN_GAP_HOURS.get(prefs.get("digest_cadence") or "")
    if not gap_hours or last_push_at is None:
        return True
    return datetime.utcnow() - last_push_at >= timedelta(hours=gap_hours)


def _parse_json_or_none(raw: Optional[str]):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


def push_tracked_post(
    db, citizen_ids: Iterable[int], *, official_id: str,
    official_name: str, post_id: int, preview: str, has_poll: bool,
) -> int:
    """Device-push mirror of the tracked_post in-app fan-out.

    v2 flow:
      1. Bound devices — tokens for the tracking citizens; per-account
         quiet-hours/cadence prefs (CitizenAccount.notification_prefs_json,
         falling back to the device's register-time snapshot).
      2. Anonymous devices — rows with citizen_id NULL whose tracked_json
         contains this official (Notifications v2 part 3); per-device
         prefs snapshot only.
      3. Suppression pass (quiet hours, cadence min-gap), send, prune
         dead tokens, stamp last_push_at on the devices actually sent.

    Never raises — a push failure must not disturb the in-app
    notification flow that calls this."""
    try:
        from app.models.pages import CitizenAccount, DeviceToken

        ids = list(citizen_ids)
        key = (official_id or "").strip().lower()

        # 1. Bound devices for the tracking citizens.
        rows = (
            db.query(DeviceToken).filter(DeviceToken.citizen_id.in_(ids)).all()
            if ids else []
        )
        account_prefs: dict = {}
        if rows:
            prefs_rows = (
                db.query(CitizenAccount.id, CitizenAccount.notification_prefs_json)
                .filter(CitizenAccount.id.in_({r.citizen_id for r in rows}))
                .all()
            )
            account_prefs = {cid: _parse_json_or_none(blob) for cid, blob in prefs_rows}

        # 2. Anonymous devices tracking this official on-device. Python-
        # side filter over the (small) anonymous-with-tracking set; see
        # DeviceToken.tracked_json for the JSONB/GIN upgrade path.
        if key:
            anon_rows = (
                db.query(DeviceToken)
                .filter(
                    DeviceToken.citizen_id.is_(None),
                    DeviceToken.tracked_json.isnot(None),
                )
                .all()
            )
            for row in anon_rows:
                tracked = _parse_json_or_none(row.tracked_json)
                if isinstance(tracked, list) and key in tracked:
                    rows.append(row)

        if not rows:
            return 0

        # 3. Quiet-hours + cadence suppression (see module comment).
        sendable = []
        suppressed = 0
        for row in rows:
            prefs = None
            if row.citizen_id is not None:
                prefs = account_prefs.get(row.citizen_id)
            if prefs is None:
                prefs = _parse_json_or_none(row.prefs_json)
            if _in_quiet_hours(prefs) or not _cadence_gap_ok(prefs, row.last_push_at):
                suppressed += 1
                continue
            sendable.append(row)
        if suppressed:
            logger.info(
                "push_tracked_post: %d device(s) suppressed (quiet hours / cadence)",
                suppressed,
            )
        if not sendable:
            return 0

        tokens = [r.token for r in sendable]
        title = f"{official_name} posted" + (" a poll" if has_poll else "")
        invalid = get_push_service().send_to_tokens(
            tokens,
            title=title,
            body=preview,
            data={
                "kind": "tracked_post",
                "official_id": official_id,
                "post_id": post_id,
            },
        )
        invalid_set = set(invalid)
        now = datetime.utcnow()
        for row in sendable:
            if row.token not in invalid_set:
                row.last_push_at = now
        if invalid:
            db.query(DeviceToken).filter(DeviceToken.token.in_(invalid)).delete(
                synchronize_session=False
            )
            logger.info("pruned %d dead device token(s)", len(invalid))
        db.commit()
        return len(tokens)
    except Exception:
        logger.exception("push_tracked_post failed (non-fatal)")
        return 0
