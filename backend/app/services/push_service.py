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


def push_tracked_post(
    db, citizen_ids: Iterable[int], *, official_id: str,
    official_name: str, post_id: int, preview: str, has_poll: bool,
) -> int:
    """Device-push mirror of the tracked_post in-app fan-out. Looks up
    the tracking citizens' registered device tokens, sends, and prunes
    tokens FCM reports dead. Never raises — a push failure must not
    disturb the in-app notification flow that calls this."""
    try:
        from app.models.pages import DeviceToken

        ids = list(citizen_ids)
        if not ids:
            return 0
        tokens = [
            t for (t,) in db.query(DeviceToken.token)
            .filter(DeviceToken.citizen_id.in_(ids))
            .all()
        ]
        if not tokens:
            return 0
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
        if invalid:
            db.query(DeviceToken).filter(DeviceToken.token.in_(invalid)).delete(
                synchronize_session=False
            )
            db.commit()
            logger.info("pruned %d dead device token(s)", len(invalid))
        return len(tokens)
    except Exception:
        logger.exception("push_tracked_post failed (non-fatal)")
        return 0
