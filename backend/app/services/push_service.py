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
#
# 2026-10-16: tracked-activity pushes go out one message per device
# (send_messages), so each can carry its own data, and a push that is
# not sent at once is held for a summary (services/push_summaries.py),
# never dropped.

from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Iterable, List, Optional

logger = logging.getLogger(__name__)

ANNOUNCEMENTS_TOPIC = "announcements"
# FCM multicast hard limit per request.
_BATCH = 500


@dataclass
class PushMessage:
    """One push to one device."""
    token: str
    title: str
    body: str
    data: dict = field(default_factory=dict)
    ttl_seconds: Optional[int] = None


@dataclass
class SendResult:
    """What happened to each token in a send_messages call.
    invalid: FCM says the token is dead (prune it). failed: a transient
    error (keep the token; a summary caller keeps its held rows)."""
    sent: set = field(default_factory=set)
    invalid: set = field(default_factory=set)
    failed: set = field(default_factory=set)


class PushService(ABC):
    """Send push notifications to device tokens / topics."""

    def send_messages(self, messages: List[PushMessage]) -> SendResult:
        """Send each message to its own device. The default groups
        identical messages into send_to_tokens calls; FCMPushService
        sends them with send_each (one request per 500 messages)."""
        return _send_grouped(self, messages)

    @abstractmethod
    def send_to_tokens(
        self, tokens: List[str], *, title: str, body: str,
        data: Optional[dict] = None, ttl_seconds: Optional[int] = None,
    ) -> List[str]:
        """Send to a list of device tokens. Returns the subset of
        tokens FCM reports as invalid/unregistered so the caller can
        prune them from the DB. ttl_seconds, when given, is how long
        FCM keeps trying to deliver to an offline device before it
        drops the message (election reminders expire at their
        deadline)."""

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

    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        logger.info(
            "[dev-push] would send to %d token(s): %r / %r data=%r ttl=%r",
            len(tokens), title, body, data, ttl_seconds,
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

    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        from firebase_admin import messaging

        str_data = {k: str(v) for k, v in (data or {}).items()}
        invalid: List[str] = []
        for i in range(0, len(tokens), _BATCH):
            batch = tokens[i:i + _BATCH]
            message = messaging.MulticastMessage(
                tokens=batch,
                notification=messaging.Notification(title=title, body=body),
                data=str_data,
                android=(
                    messaging.AndroidConfig(priority="high", ttl=int(ttl_seconds))
                    if ttl_seconds is not None
                    else messaging.AndroidConfig(priority="high")
                ),
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

    def send_messages(self, messages):
        from firebase_admin import messaging

        result = SendResult()
        for i in range(0, len(messages), _BATCH):
            batch = messages[i:i + _BATCH]
            fcm = [
                messaging.Message(
                    token=m.token,
                    notification=messaging.Notification(title=m.title, body=m.body),
                    data={k: str(v) for k, v in (m.data or {}).items()},
                    android=(
                        messaging.AndroidConfig(priority="high", ttl=int(m.ttl_seconds))
                        if m.ttl_seconds is not None
                        else messaging.AndroidConfig(priority="high")
                    ),
                )
                for m in batch
            ]
            try:
                resp = messaging.send_each(fcm, app=self._app)
            except Exception:
                logger.exception("FCM send_each failed (batch of %d)", len(batch))
                result.failed.update(m.token for m in batch)
                continue
            for m, r in zip(batch, resp.responses):
                if r.success:
                    result.sent.add(m.token)
                elif _is_dead_token_error(r.exception):
                    result.invalid.add(m.token)
                else:
                    result.failed.add(m.token)
        return result

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


def _is_dead_token_error(exc) -> bool:
    """True when FCM's error means this device token is dead."""
    name = type(exc).__name__ if exc else ""
    return name in ("UnregisteredError", "InvalidArgumentError")


def _send_grouped(svc, messages: List[PushMessage]) -> SendResult:
    """send_messages for a backend that only has send_to_tokens (the
    dev service, and test doubles): one call per identical message."""
    result = SendResult()
    groups: dict = {}
    for m in messages:
        key = (m.title, m.body, json.dumps(m.data or {}, sort_keys=True, default=str), m.ttl_seconds)
        groups.setdefault(key, []).append(m.token)
    for (title, body, data_raw, ttl), tokens in groups.items():
        kwargs = {"title": title, "body": body, "data": json.loads(data_raw)}
        if ttl is not None:
            kwargs["ttl_seconds"] = ttl
        try:
            invalid = set(svc.send_to_tokens(tokens, **kwargs) or [])
        except Exception:
            logger.exception("push send failed (%d device(s))", len(tokens))
            result.failed.update(tokens)
            continue
        result.invalid.update(invalid)
        result.sent.update(t for t in tokens if t not in invalid)
    return result


def send_push_messages(messages: List[PushMessage]) -> SendResult:
    """Send through the active service, whichever methods it has."""
    if not messages:
        return SendResult()
    svc = get_push_service()
    sender = getattr(svc, "send_messages", None)
    if callable(sender):
        return sender(messages)
    return _send_grouped(svc, messages)


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


# ── Quiet hours and push timing (Notifications v2 part 4, 2026-10-16) ──
# Quiet hours: no push inside the device's quiet window. The bell row is
# already committed by the time this runs. Since 2026-10-16 (Jeffrey) a
# tracked-activity push held by quiet hours is not lost either: it is
# kept (models.PushHeldItem) and goes out in one summary push when quiet
# hours end (services/push_summaries.py).
#
# Push timing ("Push alerts" in the bell, prefs key push_cadence):
#   realtime  each update at once (the default since 2026-10-16)
#   daily     one summary push at 6 p.m. local time
#   weekly    one summary push Saturday at 10 a.m. local time
# Until 2026-10-16 the key was digest_cadence, defaulted to 'daily',
# and 'daily'/'weekly' meant "at most one push per 20 hours / 6 days,
# drop the rest". Stored 'daily' values were never chosen by anyone
# (they were the silent default), so effective_cadence() reads a legacy
# 'daily' as realtime and keeps 'weekly'.
#
# Every app registration and every signed-in account sync carries the
# device's prefs (lib/push.js, lib/channelPrefs.js). A NULL blob only
# exists for devices registered before 2026-07-24; it gets what the
# server can apply without a clock: realtime, no quiet hours. Quiet
# hours additionally require tz_offset_minutes, since "10pm" is
# meaningless without knowing the device's local clock.
#
# Election reminders (push_election_reminder below) never come through
# here: no timing setting, never held, quiet hours as before.

PUSH_CADENCES = ("realtime", "daily", "weekly")


def effective_cadence(prefs: Optional[dict]) -> str:
    """The device's push timing: push_cadence when set, else the legacy
    digest_cadence ('weekly' kept, anything else realtime)."""
    if not isinstance(prefs, dict):
        return "realtime"
    value = prefs.get("push_cadence")
    if value in PUSH_CADENCES:
        return value
    return "weekly" if prefs.get("digest_cadence") == "weekly" else "realtime"


def _local_now(tz_offset_minutes: int, now_utc: Optional[datetime] = None) -> datetime:
    return (now_utc or datetime.utcnow()) + timedelta(minutes=tz_offset_minutes)


def _in_quiet_hours(prefs: Optional[dict], now_utc: Optional[datetime] = None) -> bool:
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
    now = _local_now(tz, now_utc)
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


def _parse_json_or_none(raw: Optional[str]):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


def device_prefs(row, account_prefs: dict) -> Optional[dict]:
    """The prefs that govern one device: its account's synced prefs when
    it is bound and the account has them, else its register snapshot."""
    prefs = account_prefs.get(row.citizen_id) if row.citizen_id is not None else None
    if prefs is None:
        prefs = _parse_json_or_none(row.prefs_json)
    return prefs if isinstance(prefs, dict) else None


def _hold(db, row, *, reason: str, message: PushMessage, kind: str,
          official_id: Optional[str], official_name: Optional[str],
          notification_id: Optional[int], now: datetime) -> None:
    from app.models.pages import PushHeldItem
    db.add(PushHeldItem(
        device_token_id=row.id, reason=reason, kind=kind,
        official_id=official_id, official_name=(official_name or "")[:255] or None,
        notification_id=notification_id, title=message.title[:255], body=message.body,
        data_json=json.dumps(message.data or {}, ensure_ascii=False, default=str),
        created_at=now,
    ))


def _deliver_tracked_push(
    db, citizen_ids: Iterable[int], *, anon_key: Optional[str],
    title: str, body: str, data: dict,
    official_name: Optional[str] = None,
    notification_ids: Optional[dict] = None,
    now_utc: Optional[datetime] = None,
) -> int:
    """Shared delivery engine for tracked-activity pushes (2026-07-26,
    extracted so tracked_event could ship without cloning 60 lines).

    Flow:
      1. Bound devices — tokens for the given citizens; per-account
         prefs (CitizenAccount.notification_prefs_json, falling back to
         the device's register-time snapshot).
      2. Anonymous devices — only when anon_key is provided: rows with
         citizen_id NULL whose tracked_json contains the key
         (Notifications v2 part 3). Callers pass anon_key=None to skip
         anonymous delivery (e.g. events, where the on_event pref is an
         explicit opt-in anonymous devices never expressed).
      notification_ids, {citizen_id: bell row id}, puts each bound
      device's own bell row in its push data, so tapping the push marks
      that row read (2026-10-16).
      3. Each device: a daily or weekly "Push alerts" setting holds the
         push for that device's summary; quiet hours hold it for the
         summary when they end; otherwise it is sent now. Dead tokens
         are pruned, last_push_at is stamped on the devices sent to,
         and one log line counts all of it.

    Returns the number of devices sent to now. Raises freely: the
    public wrappers own the never-raise guarantee.
    """
    from app.models.pages import CitizenAccount, DeviceToken, PushHeldItem

    now = now_utc or datetime.utcnow()
    kind = data.get("kind", "tracked push")
    ids = list(citizen_ids)

    # 1. Bound devices for the tracking citizens. Accounts that are
    # soft-deleted, suspended or inactive get nothing: a user inside the
    # 30-day deletion window asked to leave (audit B3).
    if ids:
        live_ids = {
            cid for (cid,) in db.query(CitizenAccount.id).filter(
                CitizenAccount.id.in_(ids),
                CitizenAccount.self_deleted_at.is_(None),
                CitizenAccount.suspended_at.is_(None),
                CitizenAccount.is_active.is_(True),
            )
        }
        ids = [i for i in ids if i in live_ids]
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

    # 2. Anonymous devices tracking this key on-device. Python-side
    # filter over the (small) anonymous-with-tracking set; see
    # DeviceToken.tracked_json for the JSONB/GIN upgrade path.
    key = (anon_key or "").strip().lower()
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
        # This exact silence cost a debugging session (2026-07-26):
        # fan-out logged "-> N citizens" and then NOTHING, because
        # every device row was anonymous with no tracked_json. Say
        # so explicitly.
        logger.info("%s: no registered devices for %d tracking citizen(s)", kind, len(ids))
        return 0

    # 3. Send now, or hold for a summary.
    sendable = []
    held_summary = held_quiet = 0
    notification_ids = notification_ids or {}
    for row in rows:
        prefs = device_prefs(row, account_prefs)
        nid = notification_ids.get(row.citizen_id) if row.citizen_id is not None else None
        row_data = dict(data)
        if nid:
            row_data["notification_id"] = nid
        message = PushMessage(token=row.token, title=title, body=body, data=row_data)
        cadence = effective_cadence(prefs)
        reason = None
        if cadence != "realtime":
            reason = "summary"
        elif _in_quiet_hours(prefs, now):
            reason = "quiet"
        if reason:
            _hold(db, row, reason=reason, message=message, kind=kind,
                  official_id=data.get("official_id"), official_name=official_name,
                  notification_id=nid, now=now)
            if reason == "summary":
                held_summary += 1
            else:
                held_quiet += 1
            continue
        sendable.append((row, message))

    result = send_push_messages([m for _row, m in sendable])
    for row, _m in sendable:
        if row.token in result.sent:
            row.last_push_at = now
    pruned = 0
    if result.invalid:
        dead_ids = [r.id for r in rows if r.token in result.invalid]
        db.query(PushHeldItem).filter(PushHeldItem.device_token_id.in_(dead_ids)).delete(
            synchronize_session=False
        )
        pruned = db.query(DeviceToken).filter(DeviceToken.token.in_(result.invalid)).delete(
            synchronize_session=False
        )
    db.commit()
    logger.info(
        "push %s official=%s: sent=%d held_for_summary=%d held_quiet_hours=%d failed=%d pruned=%d",
        kind, data.get("official_id"), len(result.sent), held_summary, held_quiet,
        len(result.failed), pruned,
    )
    return len(result.sent)


def push_tracked_post(
    db, citizen_ids: Iterable[int], *, official_id: str,
    official_name: str, post_id: int, preview: str, has_poll: bool,
    notification_ids: Optional[dict] = None,
) -> int:
    """Device-push mirror of the tracked_post in-app fan-out.
    Never raises — a push failure must not disturb the in-app
    notification flow that calls this."""
    try:
        title = f"{official_name} posted" + (" a poll" if has_poll else "")
        return _deliver_tracked_push(
            db, citizen_ids,
            anon_key=official_id,
            title=title,
            body=preview,
            data={
                "kind": "tracked_post",
                "official_id": official_id,
                "post_id": post_id,
            },
            official_name=official_name,
            notification_ids=notification_ids,
        )
    except Exception:
        db.rollback()
        logger.exception("push_tracked_post failed (non-fatal)")
        return 0


def push_tracked_event(
    db, citizen_ids: Iterable[int], *, official_id: str,
    official_name: str, event_id: int, title: str,
    start_at: str, location: Optional[str],
    notification_ids: Optional[dict] = None,
) -> int:
    """Device-push mirror of the tracked_event in-app fan-out.
    Bound devices only (anon_key=None): the on_event pref is a
    per-official opt-in that anonymous devices can't express, so
    they never receive event pushes. Never raises."""
    try:
        when = (start_at or "")[:16].replace("T", " ")
        body_bits = [b for b in (title, when, location) if b]
        return _deliver_tracked_push(
            db, citizen_ids,
            anon_key=None,
            title=f"{official_name} scheduled an event",
            body=" · ".join(body_bits),
            data={
                "kind": "tracked_event",
                "official_id": official_id,
                "event_id": event_id,
            },
            official_name=official_name,
            notification_ids=notification_ids,
        )
    except Exception:
        db.rollback()
        logger.exception("push_tracked_event failed (non-fatal)")
        return 0


def push_election_reminder(
    db, citizen_ttls, *, title: str, body: str, data: dict,
    now_utc: Optional[datetime] = None,
) -> dict:
    """Device push for one election reminder (services/election_reminders.py).

    citizen_ttls: [(citizen_id, seconds until the reminder's deadline)].
    Differs from the tracked-activity pushes on purpose (Jeffrey,
    2026-10-16): no cadence limit, since these are few and
    time-critical, and last_push_at is left alone so they never use up
    a daily or weekly allowance; quiet hours still apply, so a device
    inside its quiet window gets no push (the bell row is already
    there). Bound devices only. Each push carries a TTL, so a phone
    that is off until after the deadline never receives a stale one.

    Returns {citizen_id: devices sent}. Never raises."""
    from app.models.pages import DeviceToken

    try:
        ttl_by_citizen = {cid: ttl for cid, ttl in citizen_ttls if ttl and ttl >= 60}
        if not ttl_by_citizen:
            return {}
        rows = db.query(DeviceToken).filter(DeviceToken.citizen_id.in_(list(ttl_by_citizen))).all()
        if not rows:
            return {}
        from app.models.pages import CitizenAccount
        account_prefs = {
            cid: _parse_json_or_none(blob)
            for cid, blob in db.query(CitizenAccount.id, CitizenAccount.notification_prefs_json)
            .filter(CitizenAccount.id.in_({r.citizen_id for r in rows}))
        }
        # FCM multicast takes one TTL per request: group devices by TTL
        # rounded down to the minute.
        groups: dict = {}
        suppressed = 0
        for row in rows:
            prefs = account_prefs.get(row.citizen_id)
            if prefs is None:
                prefs = _parse_json_or_none(row.prefs_json)
            if _in_quiet_hours(prefs, now_utc):
                suppressed += 1
                continue
            ttl = (ttl_by_citizen[row.citizen_id] // 60) * 60
            groups.setdefault(ttl, []).append(row)
        if suppressed:
            logger.info("election_reminder: %d device(s) in quiet hours, no push", suppressed)
        sent: dict = {}
        invalid_all: list = []
        for ttl, group in groups.items():
            tokens = [r.token for r in group]
            invalid = set(get_push_service().send_to_tokens(
                tokens, title=title, body=body, data=data, ttl_seconds=ttl,
            ))
            invalid_all.extend(invalid)
            for r in group:
                if r.token not in invalid:
                    sent[r.citizen_id] = sent.get(r.citizen_id, 0) + 1
        if invalid_all:
            db.query(DeviceToken).filter(DeviceToken.token.in_(invalid_all)).delete(
                synchronize_session=False
            )
            db.commit()
        logger.info("election_reminder: pushed to %d device(s)", sum(sent.values()))
        return sent
    except Exception:
        db.rollback()
        logger.exception("push_election_reminder failed (non-fatal)")
        return {}
