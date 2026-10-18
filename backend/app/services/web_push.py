# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Web push (2026-10-18): desktop browsers, browsers on Android phones,
CivicView on an iPhone or iPad Home Screen (iOS 16.4 and later) and the
Windows app. The Android app keeps FCM (services/push_service.py).

The same pushes as the phone, through the same engine
(push_service._deliver_tracked_push, push_election_reminder,
push_summaries): the settings list, Mute, quiet hours, summaries and
TTLs apply to a browser exactly as to a phone. Each push is sent to the
browser's own push service (Google for Chrome and for Edge on Android,
Microsoft for Edge on Windows, Mozilla for Firefox, Apple for Safari and
Home Screen apps), encrypted for that one subscription, so the push
service sees only the endpoint, the size and the headers (TTL, urgency
and an opaque topic, never a name or an id).

Env (Render), all three or web push stays off:
  VAPID_PUBLIC_KEY   base64url, the uncompressed P-256 public key (65 bytes)
  VAPID_PRIVATE_KEY  base64url, the raw P-256 private key (32 bytes)
  VAPID_SUBJECT      mailto:civicview@civicview.app
The frontend subscribes with NEXT_PUBLIC_VAPID_PUBLIC_KEY (Vercel), the
same public key. scripts/generate_vapid_keys.py makes the pair; it is
run on Jeffrey's own computer and the private key is never in the repo
or a log. Changing the pair ends every browser subscription: each
browser subscribes again the next time CivicView is opened in it.

What a push contains is built from the same PushMessage the phone gets
and its text from push_service.shown(), so a notification shows only
the general line ("New update from an official you track", or a count
line for a summary) unless the person chose Notification details: Show
details. public/sw.js shows it.

A subscription is removed only when its push service answers 404 or 410
(the subscription is gone). Anything else is kept: a 403 means our key
or clock is wrong, which would otherwise wipe every subscription at
once (the same lesson as push_service._is_dead_token_error).

Libraries: http-ece (RFC 8291 aes128gcm encryption) and py-vapid
(RFC 8292 VAPID), the two pywebpush is built on; sent over httpx.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import List, Optional, Tuple
from urllib.parse import urlsplit

from app.services.push_service import (
    CHANNELS,
    POST_TTL_SECONDS,
    PushMessage,
    SendResult,
    channel_of,
    shown,
)

logger = logging.getLogger(__name__)

# The push services a subscription endpoint may point at. Anything else
# is refused at registration, so nobody can make the server POST to an
# address of their choosing (an internal service, a third party).
_PUSH_HOSTS = (
    "fcm.googleapis.com",       # Chrome, Edge on Android, Opera, Samsung Internet
    "android.googleapis.com",   # older Chrome subscriptions
    "jmt17.google.com",         # some Chrome builds
)
_PUSH_HOST_SUFFIXES = (
    "push.services.mozilla.com",  # Firefox (updates.push.services.mozilla.com)
    "notify.windows.com",         # Edge on Windows (wns2-*.notify.windows.com)
    "push.apple.com",             # Safari and Home Screen apps (web.push.apple.com)
)
MAX_ENDPOINT_LEN = 1024

# A push service accepts at most 4096 bytes of encrypted payload; the
# body text is capped well under it.
_BODY_MAX = 300
_TITLE_MAX = 120
_MAX_TTL_SECONDS = 28 * 24 * 3600
# Replies and election reminders are time-critical (Android shows them
# as high importance too).
_HIGH_URGENCY = {"replies", "elections"}
_SEND_WORKERS = 8
_TIMEOUT_SECONDS = 10.0


def b64url_decode(value: str) -> bytes:
    value = (value or "").strip()
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def is_allowed_endpoint(url: str) -> bool:
    """https on a known push service, on the default port, no userinfo."""
    if not isinstance(url, str) or not url or len(url) > MAX_ENDPOINT_LEN:
        return False
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    if parts.scheme != "https" or parts.username or parts.password or port not in (None, 443):
        return False
    host = (parts.hostname or "").lower().rstrip(".")
    if host in _PUSH_HOSTS:
        return True
    return any(host == s or host.endswith("." + s) for s in _PUSH_HOST_SUFFIXES)


def valid_keys(p256dh: str, auth: str) -> bool:
    """The subscription's keys: an uncompressed P-256 point (65 bytes)
    and a 16-byte auth secret."""
    try:
        return len(b64url_decode(p256dh)) == 65 and b64url_decode(p256dh)[0] == 4 \
            and len(b64url_decode(auth)) == 16
    except (ValueError, TypeError):
        return False


# ── Keys ─────────────────────────────────────────────────────────────

@dataclass
class VapidConfig:
    public_key: str      # base64url, no padding
    subject: str
    vapid: object        # py_vapid.Vapid02


_config: Optional[VapidConfig] = None
_config_checked = False
_config_lock = threading.Lock()


def _load_config() -> Optional[VapidConfig]:
    public = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
    private = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    subject = os.environ.get("VAPID_SUBJECT", "").strip()
    if not (public and private and subject):
        logger.info("Web push off: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are not all set")
        return None
    if not (subject.startswith("mailto:") or subject.startswith("https://")):
        logger.error("Web push off: VAPID_SUBJECT must start with mailto: or https://")
        return None
    try:
        from cryptography.hazmat.primitives import serialization
        from py_vapid import Vapid02

        vapid = Vapid02.from_string(private_key=private)
        derived = vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        if derived != b64url_decode(public):
            # Never log either key, only that they do not belong together.
            logger.error("Web push off: VAPID_PUBLIC_KEY is not the public key of VAPID_PRIVATE_KEY")
            return None
    except Exception:
        logger.error("Web push off: VAPID_PRIVATE_KEY could not be read (expected the base64url raw key)")
        return None
    logger.info("Web push: VAPID keys loaded, web push active")
    return VapidConfig(public_key=b64url_encode(derived), subject=subject, vapid=vapid)


def config() -> Optional[VapidConfig]:
    """The VAPID keys, read once. None (web push off) until all three
    env vars are set and the two keys belong together."""
    global _config, _config_checked
    if _config_checked:
        return _config
    with _config_lock:
        if not _config_checked:
            _config = _load_config()
            _config_checked = True
    return _config


def enabled() -> bool:
    return config() is not None


def public_key() -> Optional[str]:
    cfg = config()
    return cfg.public_key if cfg else None


def reset_for_tests() -> None:
    global _config, _config_checked, _service
    _config, _config_checked, _service = None, False, None


# ── Encryption (RFC 8291) and VAPID (RFC 8292) ──────────────────────

def encrypt(payload: bytes, p256dh: str, auth: str, *, salt: Optional[bytes] = None,
            server_private_key=None) -> bytes:
    """The aes128gcm body for one subscription. A new key pair and salt
    for every message; salt and server_private_key are only passed by
    the RFC 8291 test vector."""
    import http_ece
    from cryptography.hazmat.primitives.asymmetric import ec

    key = server_private_key or ec.generate_private_key(ec.SECP256R1())
    return http_ece.encrypt(
        payload,
        salt=salt or os.urandom(16),
        private_key=key,
        dh=b64url_decode(p256dh),
        auth_secret=b64url_decode(auth),
        version="aes128gcm",
    )


_jwt_cache: dict = {}
_JWT_LIFETIME = 12 * 3600
_JWT_REUSE = 6 * 3600


def vapid_authorization(cfg: VapidConfig, endpoint: str, now: Optional[float] = None) -> str:
    """The Authorization header for one push service: "vapid t=<JWT>,
    k=<public key>". The JWT is good for 12 hours (FCM and Apple accept
    up to 24) and reused for 6, per push service."""
    parts = urlsplit(endpoint)
    # The push service's origin: a port only when it isn't the default.
    port = parts.port
    default = 443 if parts.scheme == "https" else 80
    aud = f"{parts.scheme}://{parts.hostname}" + (f":{port}" if port and port != default else "")
    now = now or time.time()
    cached = _jwt_cache.get(aud)
    if cached and cached[1] - now > _JWT_LIFETIME - _JWT_REUSE:
        return cached[0]
    exp = int(now) + _JWT_LIFETIME
    header = cfg.vapid.sign({"aud": aud, "exp": exp, "sub": cfg.subject})["Authorization"]
    _jwt_cache[aud] = (header, exp)
    return header


# ── What a push contains ─────────────────────────────────────────────

def payload_for(m: PushMessage, *, badge: Optional[int] = None) -> dict:
    """The JSON public/sw.js shows. title and body are what the phone
    shows (push_service.shown): the general line, no body, unless the
    person chose Show details. group: the count line when 3 or more of
    one channel are on screen. data: kind and ids for the tap (the same
    as the phone's), with the bell row id."""
    title, body = shown(m)
    channel = channel_of(m)
    out = {
        "v": 1,
        "title": (title or "CivicView")[:_TITLE_MAX],
        "body": (body or "")[:_BODY_MAX],
        "channel": channel,
        "group": CHANNELS[channel]["group"],
        "details": bool(m.show_details),
        "data": {k: v for k, v in (m.data or {}).items() if isinstance(v, (str, int, float, bool))},
    }
    if m.tag:
        out["tag"] = m.tag
    if isinstance(badge, int) and badge >= 0:
        out["badge"] = badge
    return out


def _topic(tag: Optional[str]) -> Optional[str]:
    """The Topic header (RFC 8030): a newer undelivered push with the
    same topic replaces the older one at the push service. The push
    service reads it in the clear, unlike the encrypted payload, and a
    tag can name an official's page (page-<id>), so it is a hash of the
    tag: 22 characters of the URL-safe base64 alphabet (at most 32)."""
    if not tag:
        return None
    return b64url_encode(hashlib.sha256(("civicview-topic:" + tag).encode("utf-8")).digest())[:22]


def request_for(cfg: VapidConfig, sub, m: PushMessage, *, badge: Optional[int] = None) -> Tuple[dict, bytes]:
    """(headers, body) of the POST to the subscription's endpoint."""
    raw = json.dumps(payload_for(m, badge=badge), ensure_ascii=False, separators=(",", ":"),
                     default=str).encode("utf-8")
    body = encrypt(raw, sub.p256dh, sub.auth)
    ttl = m.ttl_seconds if m.ttl_seconds is not None else POST_TTL_SECONDS
    headers = {
        "Authorization": vapid_authorization(cfg, sub.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(max(0, min(int(ttl), _MAX_TTL_SECONDS))),
        "Urgency": "high" if channel_of(m) in _HIGH_URGENCY else "normal",
    }
    topic = _topic(m.tag)
    if topic:
        headers["Topic"] = topic
    return headers, body


# ── Sending ──────────────────────────────────────────────────────────

@dataclass
class WebPush:
    """One push to one browser. sub: a WebPushSubscription row (or
    anything with endpoint, p256dh and auth)."""
    sub: object
    message: PushMessage
    badge: Optional[int] = None


class WebPushService:
    """POSTs each push to its subscription's push service. transport:
    an httpx transport, for tests (httpx.MockTransport)."""

    def __init__(self, cfg: VapidConfig, transport=None):
        self.cfg = cfg
        self._transport = transport

    def _client(self):
        import httpx
        return httpx.Client(timeout=_TIMEOUT_SECONDS, transport=self._transport,
                            headers={"User-Agent": "CivicView web push (civicview@civicview.app)"})

    def send(self, pushes: List[WebPush]) -> SendResult:
        """result.sent / invalid / failed hold endpoints. invalid: the
        push service answered 404 or 410 (remove the subscription)."""
        result = SendResult()
        if not pushes:
            return result
        lock = threading.Lock()
        forbidden = []

        def one(client, p: WebPush):
            endpoint = p.sub.endpoint
            try:
                headers, body = request_for(self.cfg, p.sub, p.message, badge=p.badge)
                r = client.post(endpoint, content=body, headers=headers)
                status = r.status_code
            except Exception as exc:
                logger.warning("web push: send failed (%s)", type(exc).__name__)
                status = None
            with lock:
                if status in (200, 201, 202):
                    result.sent.add(endpoint)
                elif status in (404, 410):
                    result.invalid.add(endpoint)
                else:
                    result.failed.add(endpoint)
                    if status in (401, 403):
                        forbidden.append(status)
                    elif status is not None:
                        logger.info("web push: push service answered %s", status)

        with self._client() as client:
            if len(pushes) == 1:
                one(client, pushes[0])
            else:
                with ThreadPoolExecutor(max_workers=min(_SEND_WORKERS, len(pushes))) as pool:
                    list(pool.map(lambda p: one(client, p), pushes))
        if forbidden:
            # Our key or clock, not the subscription: kept, and said loudly.
            logger.error("web push: %d push(es) refused with %s (check the VAPID keys and the server clock); "
                         "subscriptions kept", len(forbidden), sorted(set(forbidden)))
        return result


_service: Optional[WebPushService] = None


def get_service() -> Optional[WebPushService]:
    """The sender, or None while web push is off."""
    global _service
    if _service is not None:
        return _service
    cfg = config()
    if cfg is None:
        return None
    _service = WebPushService(cfg)
    return _service


def send(pushes: List[WebPush]) -> SendResult:
    """Send through the active service; with web push off nothing is
    sent and every push counts as failed (kept, never pruned)."""
    if not pushes:
        return SendResult()
    svc = get_service()
    if svc is None:
        r = SendResult()
        r.failed.update(p.sub.endpoint for p in pushes)
        return r
    return svc.send(pushes)


def deliver(db, pairs, *, now=None, stamp: bool = True) -> SendResult:
    """Send [(WebPushSubscription row, PushMessage)] now: each bound
    browser's push carries the person's unread count for the app badge;
    last_push_at is stamped on those sent (unless stamp=False: election
    reminders); a subscription whose push service answered 404 or 410 is
    removed with its held updates. Does not commit."""
    from datetime import datetime

    from app.models.pages import PushHeldItem, WebPushSubscription

    if not pairs:
        return SendResult()
    now = now or datetime.utcnow()
    badges = unread_counts(db, {row.citizen_id for row, _m in pairs if row.citizen_id is not None})
    result = send([WebPush(sub=row, message=m, badge=badges.get(row.citizen_id)) for row, m in pairs])
    if stamp:
        for row, _m in pairs:
            if row.endpoint in result.sent:
                row.last_push_at = now
    if result.invalid:
        dead = [row.id for row, _m in pairs if row.endpoint in result.invalid]
        db.query(PushHeldItem).filter(PushHeldItem.web_subscription_id.in_(dead)).delete(
            synchronize_session=False)
        db.query(WebPushSubscription).filter(WebPushSubscription.id.in_(dead)).delete(
            synchronize_session=False)
    return result


def unread_counts(db, citizen_ids) -> dict:
    """{citizen_id: unread bell rows}, for the app badge. One query."""
    from sqlalchemy import func

    from app.models.pages import Notification

    ids = list({int(i) for i in citizen_ids if i is not None})
    if not ids:
        return {}
    rows = (
        db.query(Notification.recipient_id, func.count(Notification.id))
        .filter(Notification.recipient_kind == "citizen", Notification.recipient_id.in_(ids),
                Notification.read_at.is_(None), Notification.cleared_at.is_(None))
        .group_by(Notification.recipient_id)
        .all()
    )
    out = {cid: 0 for cid in ids}
    out.update({cid: int(n) for cid, n in rows})
    return out
