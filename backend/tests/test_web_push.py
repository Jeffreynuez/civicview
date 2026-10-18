# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Web push (2026-10-18): services/web_push.py, routers/push.py (/web/...),
and the browsers in push_service and push_summaries.

Run:  cd backend && python3 tests/test_web_push.py   (exit 0 = pass)

The VAPID keys and every browser's keys are generated when the test runs
and never printed. The push services are an httpx MockTransport that
checks the VAPID header and decrypts each push with the browser's own
private key, as a real browser would.

  1. Encryption matches RFC 8291's test vector; the VAPID header verifies
     and names the push service, our subject and an expiry within a day.
  2. Registering: off until the keys are set; only real push services,
     keys that are a point on P-256, and our own public key; a sign-in
     binds, a sign-out unbinds, another citizen takes the browser over,
     Turn off deletes.
  3. A tracked post reaches the citizen's phone and browser; the phone's
     push is what it was; the browser's shows only the general line
     unless Show details; it carries the bell row and the unread count.
  4. The settings list and Mute decide for browsers as for phones.
  5. A signed-out browser gets posts from officials it tracks, not events.
  6. Events carry their tag as Topic and a TTL until they start; replies
     and election reminders are urgent. The Topic is an HMAC under a key
     derived from the private key: nobody can recompute it from a tag.
  7. Quiet hours and the daily summary hold browser pushes and send them
     in one summary, by the same rules as a phone.
  8. A 404 or 410 removes the subscription with its held updates; 403 and
     500 keep it; a stored subscription whose keys can't be encrypted for
     is removed at the first send instead of being retried forever.
  9. With the keys removed nothing is sent and held updates wait.
 10. Deleting the account removes its browsers; the admin test push
     reaches this browser; a long body is capped.
 11. Auto-migrate: an existing push_held_items table, where
     device_token_id is NOT NULL, takes a browser's held update.
 12. A web push failure never undoes the phones: their held updates,
     last_push_at and count survive web_push.deliver raising, in a
     tracked push, an election reminder and a summary pass.
"""
import base64
import json
import os
import sqlite3
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

# 11. The table as it was before 2026-10-18, before the app creates it.
_db_path = os.environ["DATABASE_URL"].replace("sqlite:///", "")
_conn = sqlite3.connect(_db_path)
_conn.execute(
    "CREATE TABLE push_held_items (id INTEGER NOT NULL PRIMARY KEY, device_token_id INTEGER NOT NULL, "
    "reason VARCHAR(16) NOT NULL, kind VARCHAR(32) NOT NULL, official_id VARCHAR(64), official_name VARCHAR(255), "
    "notification_id INTEGER, title VARCHAR(255) NOT NULL, body TEXT NOT NULL, data_json TEXT, "
    "created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL)")
_conn.execute("INSERT INTO push_held_items (device_token_id, reason, kind, title, body) "
              "VALUES (999, 'summary', 'tracked_post', 'old', 'row')")
_conn.commit()
_conn.close()

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _pub(key) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _set_keys():
    key = ec.generate_private_key(ec.SECP256R1())
    os.environ["VAPID_PRIVATE_KEY"] = _b64(key.private_numbers().private_value.to_bytes(32, "big"))
    os.environ["VAPID_PUBLIC_KEY"] = _b64(_pub(key))
    os.environ["VAPID_SUBJECT"] = "mailto:civicview@civicview.app"
    return os.environ["VAPID_PUBLIC_KEY"]


def _clear_keys():
    for k in ("VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT"):
        os.environ.pop(k, None)


PUSHES = []      # FCM
REQUESTS = []    # web: what each push service received
STATUS = {}      # endpoint -> status the push service answers (default 201)
BROWSERS = {}    # endpoint -> (private key, auth secret)
_n = [0]


class _CapturePush:
    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        for t in tokens:
            PUSHES.append({"token": t, "title": title, "body": body, "data": dict(data or {}), "ttl": ttl_seconds})
        return []

    def subscribe_to_topic(self, tokens, topic):
        pass

    def unsubscribe_from_topic(self, tokens, topic):
        pass


def new_browser(host="fcm.googleapis.com", path="/fcm/send/"):
    """A browser's subscription: its endpoint and keys, as a browser makes them."""
    _n[0] += 1
    key = ec.generate_private_key(ec.SECP256R1())
    auth = os.urandom(16)
    endpoint = f"https://{host}{path}test-{_n[0]}"
    BROWSERS[endpoint] = (key, auth)
    return {"endpoint": endpoint, "keys": {"p256dh": _b64(_pub(key)), "auth": _b64(auth)}}


def _handler(request):
    import http_ece
    import httpx

    endpoint = str(request.url)
    key, auth = BROWSERS[endpoint]
    payload = json.loads(http_ece.decrypt(request.content, private_key=key, auth_secret=auth, version="aes128gcm"))
    REQUESTS.append({"endpoint": endpoint, "headers": dict(request.headers), "payload": payload})
    return httpx.Response(STATUS.get(endpoint, 201))


def sent_to(endpoint):
    return [r for r in REQUESTS if r["endpoint"] == endpoint]


def main() -> int:
    import httpx
    from fastapi.testclient import TestClient
    from py_vapid import Vapid02

    import app.main as m
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import (
        CitizenAccount, DeviceToken, Notification, Post, PushHeldItem, TrackedOfficial, WebPushSubscription,
    )
    from app.services import alert_settings as als
    from app.services import notifications_inapp as ni
    from app.services import push_summaries
    from app.services import web_push as wp

    ps._service = _CapturePush()
    check = fh.Checks()
    db = SessionLocal()

    def install():
        wp.reset_for_tests()
        wp._service = wp.WebPushService(wp.config(), transport=httpx.MockTransport(_handler))

    def sub_row(endpoint):
        db.expire_all()
        return db.query(WebPushSubscription).filter(WebPushSubscription.endpoint == endpoint).first()

    # ── 1. encryption and VAPID ──────────────────────────────────────
    as_key = ec.derive_private_key(int.from_bytes(wp.b64url_decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
                                                  "big"), ec.SECP256R1())
    body = wp.encrypt(b"When I grow up, I want to be a watermelon",
                      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                      "BTBZMqHH6r4Tts7J_aSIgg", salt=wp.b64url_decode("DGv6ra1nlYgDCS1FRnbzlw"),
                      server_private_key=as_key)
    rfc_header = wp.b64url_decode("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLo"
                                  "cInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
    rfc_ct = wp.b64url_decode("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ")
    check("1 aes128gcm matches the RFC 8291 test vector", body == rfc_header + rfc_ct)

    _clear_keys()
    wp.reset_for_tests()
    check("1 off without the keys", not wp.enabled() and wp.get_service() is None)
    os.environ["VAPID_PUBLIC_KEY"] = _b64(_pub(ec.generate_private_key(ec.SECP256R1())))
    os.environ["VAPID_PRIVATE_KEY"] = _b64(ec.generate_private_key(ec.SECP256R1()).private_numbers()
                                           .private_value.to_bytes(32, "big"))
    os.environ["VAPID_SUBJECT"] = "mailto:civicview@civicview.app"
    wp.reset_for_tests()
    check("1 off when the public key is not the private key's", not wp.enabled())
    public = _set_keys()
    install()
    check("1 on with a matching pair", wp.enabled() and wp.public_key() == public)
    auth_header = wp.vapid_authorization(wp.config(), "https://fcm.googleapis.com/fcm/send/x")
    claims = json.loads(wp.b64url_decode(auth_header.split("t=")[1].split(",")[0].split(".")[1]))
    check("1 the VAPID header verifies", Vapid02.verify(auth_header) and f"k={public}" in auth_header)
    check("1 its claims: the push service, our subject, under a day",
          claims["aud"] == "https://fcm.googleapis.com" and claims["sub"] == "mailto:civicview@civicview.app"
          and 0 < claims["exp"] - datetime.now().timestamp() <= 24 * 3600, claims)

    for ok in ("https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x",
               "https://wns2-par02p.notify.windows.com/w/?token=x", "https://web.push.apple.com/x",
               "https://jmt17.google.com/fcm/send/x"):
        check(f"1 allowed: {ok.split('/')[2]}", wp.is_allowed_endpoint(ok))
    for bad in ("http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x",
                "https://169.254.169.254/latest", "https://u@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x",
                "https://localhost/x", "https://evilpush.apple.com/x"):
        check(f"1 refused: {bad}", not wp.is_allowed_endpoint(bad))

    # 11. The migration on its own, before the app starts: the app's
    # startup cleanup then removes this row as an orphan (its phone does
    # not exist), as it should.
    from app.db import init_db
    init_db()
    old = db.query(PushHeldItem).filter(PushHeldItem.title == "old").first()
    check("11 the existing row survived the migration", old is not None and old.device_token_id == 999)
    db.expunge_all()

    with TestClient(m.app) as c:
        ana = fh.make_citizen(db, "Ana Browser", "ana@example.org")
        ben = fh.make_citizen(db, "Ben Other", "ben@example.org", district="FL-12")
        page = "tst-off-web"
        rep = fh.make_rep(db, page, "Rae Web", "rae@example.org")
        db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=ana.id, official_key=page, prefs_json="{}"))
        db.add(DeviceToken(token="tok-ana-phone", citizen_id=ana.id, app_build=5))
        db.commit()

        # ── 2. registering ───────────────────────────────────────────
        b1 = new_browser()
        _clear_keys()
        wp.reset_for_tests()
        r = c.post("/api/push/web/register", json=b1)
        check("2 off: 503 web_push_off", r.status_code == 503 and r.json()["detail"] == "web_push_off", r.text)
        _set_keys()
        install()
        public = wp.public_key()
        r = c.post("/api/push/web/register", json={**b1, "endpoint": "https://evil.example/push"})
        check("2 an endpoint that is not a push service: 400", r.status_code == 400
              and r.json()["detail"] == "endpoint_not_allowed", r.text)
        r = c.post("/api/push/web/register", json={**b1, "keys": {"p256dh": "A" * 87, "auth": "B" * 22}})
        check("2 keys that are not a P-256 point: 400", r.status_code == 400, r.text)
        off_curve = _b64(b"\x04" + b"\x01" * 64)  # the right length and prefix, not on the curve
        check("2 a 65-byte key that is not on the curve is not valid",
              not wp.valid_keys(off_curve, b1["keys"]["auth"]) and wp.valid_keys(**b1["keys"]))
        r = c.post("/api/push/web/register", json={**b1, "keys": {"p256dh": off_curve, "auth": b1["keys"]["auth"]}})
        check("2 ... and is refused at registration: 400", r.status_code == 400
              and r.json()["detail"] == "invalid_keys", r.text)
        r = c.post("/api/push/web/register", json={**b1, "application_server_key": _b64(os.urandom(65))})
        check("2 another public key: 409", r.status_code == 409 and r.json()["detail"] == "vapid_key_mismatch", r.text)
        r = c.post("/api/push/web/register", json={**b1, "application_server_key": public, "tracked": [page.upper()],
                                                   "prefs": {"quiet_hours": "off"}})
        row = sub_row(b1["endpoint"])
        check("2 anonymous register", r.status_code == 200 and r.json()["bound"] is False and row.citizen_id is None
              and json.loads(row.tracked_json) == [page], r.text)
        r = c.post("/api/push/web/register", json={**b1, "platform": "ios"}, headers=fh.citizen_headers(ana))
        row = sub_row(b1["endpoint"])
        check("2 a sign-in binds it", r.json()["bound"] is True and row.citizen_id == ana.id
              and row.tracked_json is None and row.platform == "ios", r.text)
        db.add(PushHeldItem(web_subscription_id=row.id, reason="summary", kind="tracked_post", title="t", body="b"))
        db.commit()
        migrated_ok = db.query(PushHeldItem).filter(PushHeldItem.device_token_id.is_(None)).count() == 1
        c.post("/api/push/web/register", json=b1, headers=fh.citizen_headers(ben))
        row = sub_row(b1["endpoint"])
        check("2 another citizen takes it over; the first one's held updates go",
              row.citizen_id == ben.id and db.query(PushHeldItem).filter(
                  PushHeldItem.web_subscription_id == row.id).count() == 0)
        r = c.post("/api/push/web/unbind", json={"endpoint": b1["endpoint"]})
        check("2 sign-out unbinds", r.json()["unbound"] is True and sub_row(b1["endpoint"]).citizen_id is None, r.text)
        r = c.post("/api/push/web/unregister", json={"endpoint": b1["endpoint"]})
        check("2 Turn off deletes it", r.json()["deleted"] == 1 and sub_row(b1["endpoint"]) is None, r.text)
        check("2 unknown endpoints are a harmless no-op",
              c.post("/api/push/web/unbind", json={"endpoint": b1["endpoint"]}).json()["unbound"] is False)

        # ── 3. a tracked post, phone and browser ─────────────────────
        ana_b = new_browser()
        c.post("/api/push/web/register", json=ana_b, headers=fh.citizen_headers(ana))
        db.add(Notification(recipient_kind="citizen", recipient_id=ana.id, kind="reply", payload_json="{}"))
        db.commit()
        now = datetime.now(UTC).replace(tzinfo=None)
        p1 = Post(official_id=page, author_id=rep.id, body="Town hall Thursday", created_at=now)
        db.add(p1)
        db.commit()
        PUSHES.clear()
        REQUESTS.clear()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Web", post_id=p1.id,
                                              preview="Town hall Thursday", has_poll=False)
        got = sent_to(ana_b["endpoint"])
        bell_id = db.query(Notification.id).filter(Notification.recipient_id == ana.id,
                                                   Notification.kind == "tracked_post").scalar()
        # (The capture sees the message before FCM formats it.)
        check("3 the phone gets its push as before", [p["token"] for p in PUSHES] == ["tok-ana-phone"]
              and PUSHES[0]["title"] == "Rae Web posted" and PUSHES[0]["data"]["kind"] == "tracked_post", PUSHES)
        check("3 the browser gets one push", len(got) == 1, REQUESTS)
        pl = got[0]["payload"] if got else {}
        check("3 by default only the general line, no body, no name",
              pl.get("title") == "New update from an official you track" and pl.get("body") == ""
              and "Rae" not in json.dumps(pl), pl)
        check("3 the tap data: kind, page, post, bell row", pl.get("data") == {
            "kind": "tracked_post", "official_id": page, "post_id": p1.id, "notification_id": bell_id}, pl)
        check("3 the unread count rides along for the badge", pl.get("badge") == 2, pl)
        check("3 channel and group line", pl.get("channel") == "officials"
              and pl.get("group") == "{n} updates from officials you track", pl)
        h = got[0]["headers"] if got else {}
        check("3 headers: aes128gcm, a 3 day TTL, normal urgency, VAPID",
              h.get("content-encoding") == "aes128gcm" and h.get("ttl") == str(3 * 24 * 3600)
              and h.get("urgency") == "normal" and Vapid02.verify(h.get("authorization", "")), h)
        check("3 last_push_at is stamped", sub_row(ana_b["endpoint"]).last_push_at is not None)
        ana_acc = db.get(CitizenAccount, ana.id)
        ana_acc.notification_prefs_json = json.dumps({"lock_screen_details": True, "quiet_hours": "off"})
        db.commit()
        REQUESTS.clear()
        ps.push_tracked_post(db, [ana.id], official_id=page, official_name="Rae Web", post_id=p1.id,
                             preview="Town hall Thursday", has_poll=True)
        pl = sent_to(ana_b["endpoint"])[0]["payload"]
        check("3 Show details (the same setting as the phone): who and what",
              pl["title"] == "Rae Web posted a poll" and pl["body"] == "Town hall Thursday", pl)

        # ── 4. the settings list and Mute ────────────────────────────
        als.set_choice(db, db.get(CitizenAccount, ana.id), "officials", "bell")
        REQUESTS.clear()
        PUSHES.clear()
        p2 = Post(official_id=page, author_id=rep.id, body="Second", created_at=now)
        db.add(p2)
        db.commit()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Web", post_id=p2.id,
                                              preview="Second", has_poll=False)
        check("4 Bell only: no push to the phone or the browser", not REQUESTS and not PUSHES, (REQUESTS, PUSHES))
        als.set_choice(db, db.get(CitizenAccount, ana.id), "officials", "bell_push")
        tr = db.query(TrackedOfficial).filter(TrackedOfficial.tracker_id == ana.id).one()
        tr.prefs_json = json.dumps({"muted": True})
        db.commit()
        p3 = Post(official_id=page, author_id=rep.id, body="Third", created_at=now)
        db.add(p3)
        db.commit()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Web", post_id=p3.id,
                                              preview="Third", has_poll=False)
        check("4 muted: no push to the browser", not sent_to(ana_b["endpoint"]), REQUESTS)
        tr.prefs_json = "{}"
        db.commit()

        # ── 5. a signed-out browser ──────────────────────────────────
        anon = new_browser(host="updates.push.services.mozilla.com", path="/wpush/v2/")
        c.post("/api/push/web/register", json={**anon, "tracked": [page], "prefs": {"quiet_hours": "off"}})
        REQUESTS.clear()
        p4 = Post(official_id=page, author_id=rep.id, body="Fourth", created_at=now)
        db.add(p4)
        db.commit()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Web", post_id=p4.id,
                                              preview="Fourth", has_poll=False)
        check("5 it gets posts from officials it tracks", len(sent_to(anon["endpoint"])) == 1, REQUESTS)
        REQUESTS.clear()
        start = (now + timedelta(days=2)).isoformat()
        ni.emit_tracked_event_notifications(db, official_id=page, official_name="Rae Web", event_id=11,
                                            title="Town hall", start_at=start, location="Library")
        check("5 but not events", not sent_to(anon["endpoint"]), REQUESTS)

        # ── 6. events, replies, election reminders ───────────────────
        ev = sent_to(ana_b["endpoint"])
        evh = ev[0]["headers"] if ev else {}
        check("6 an event: its tag (hashed) as Topic, a TTL until it starts",
              len(ev) == 1 and evh.get("topic") == wp._topic(wp.config(), "event-11") and ev[0]["payload"].get("tag") == "event-11"
              and 2 * 24 * 3600 - 120 < int(evh.get("ttl", 0)) <= 2 * 24 * 3600, evh)
        REQUESTS.clear()
        ps.push_to_citizens(db, [ana.id], title="Ben replied to your comment", body="Agreed",
                            data={"kind": "reply", "official_id": page, "post_id": p1.id}, channel="replies",
                            official_name="Ben", timing=False)
        rp = sent_to(ana_b["endpoint"])
        check("6 a reply is urgent", len(rp) == 1 and rp[0]["headers"].get("urgency") == "high", rp)
        REQUESTS.clear()
        out = ps.push_election_reminder(db, [(ana.id, 3 * 3600 + 59)], title="Election Day is tomorrow",
                                        body="Polls open at 7 a.m.",
                                        data={"kind": "election_reminder", "reminder_id": "fl-2026-ed", "state": "FL"})
        er = sent_to(ana_b["endpoint"])
        check("6 an election reminder: urgent, the TTL to its deadline, counted",
              len(er) == 1 and er[0]["headers"].get("urgency") == "high" and er[0]["headers"].get("ttl") == "10800"
              and er[0]["payload"]["channel"] == "elections" and out.get(ana.id) == 2, (er, out))

        import hashlib
        import hmac
        topic = wp._topic(wp.config(), "page-S001217")
        check("6 the Topic the push service reads in the clear names nobody",
              "S001217" not in topic and "page" not in topic and len(topic) == 22
              and all(ch.isalnum() or ch in "-_" for ch in topic), topic)
        guessable = [_b64(hashlib.sha256(t.encode()).digest())[:22] for t in
                     ("page-S001217", "civicview-topic:page-S001217")]
        check("6 it is an HMAC under the server's key, not a hash anyone can recompute from a tag",
              topic not in guessable and topic == _b64(hmac.new(wp.config().topic_key, b"page-S001217",
                                                                 hashlib.sha256).digest())[:22])
        other = wp.VapidConfig(public_key="", subject="", vapid=None, topic_key=os.urandom(32))
        check("6 another key gives another Topic for the same tag", wp._topic(other, "page-S001217") != topic)

        # ── 7. quiet hours and summaries ─────────────────────────────
        dee = fh.make_citizen(db, "Dee Daily", "dee@example.org", district="FL-14")
        dee.notification_prefs_json = json.dumps({"push_cadence": "daily", "quiet_hours": "nights",
                                                  "tz_offset_minutes": 0})
        db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=dee.id, official_key=page, prefs_json="{}"))
        db.commit()
        dee_b = new_browser(host="web.push.apple.com", path="/")
        c.post("/api/push/web/register", json=dee_b, headers=fh.citizen_headers(dee))
        dee_row = sub_row(dee_b["endpoint"])
        REQUESTS.clear()
        noon = datetime(2026, 10, 21, 12, 0)
        ps._deliver_tracked_push(db, [dee.id], anon_key=None, title="Rae Web posted", body="One",
                                 data={"kind": "tracked_post", "official_id": page, "post_id": 1},
                                 official_name="Rae Web", now_utc=noon)
        ps._deliver_tracked_push(db, [dee.id], anon_key=None, title="Rae Web posted", body="Two",
                                 data={"kind": "tracked_post", "official_id": page, "post_id": 2},
                                 official_name="Rae Web", now_utc=noon)
        ps._deliver_tracked_push(db, [dee.id], anon_key=None, title="Ben replied to your comment", body="Hi",
                                 data={"kind": "reply", "official_id": page, "post_id": 1}, channel="replies",
                                 timing=False, now_utc=noon)
        db.expire_all()
        held = db.query(PushHeldItem).filter(PushHeldItem.web_subscription_id == dee_row.id).all()
        check("7 a daily browser holds posts; the reply (no timing) goes now",
              sorted(i.reason for i in held) == ["summary", "summary"] and len(sent_to(dee_b["endpoint"])) == 1
              and all(i.device_token_id is None for i in held), [(i.reason, i.kind) for i in held])
        REQUESTS.clear()
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 21, 17, 0))
        check("7 nothing before 6 p.m.", not sent_to(dee_b["endpoint"]), REQUESTS)
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 21, 18, 5))
        sm = sent_to(dee_b["endpoint"])
        check("7 at 6 p.m. one summary: a count line, the Summaries tag",
              len(sm) == 1 and sm[0]["payload"]["title"] == "2 updates from officials you track"
              and sm[0]["payload"]["body"] == "" and sm[0]["payload"]["tag"] == "summary"
              and sm[0]["headers"].get("topic") == wp._topic(wp.config(), "summary")
              and sm[0]["payload"]["data"]["kind"] == "tracked_summary",
              sm)
        db.expire_all()
        check("7 the held updates are gone", db.query(PushHeldItem).filter(
            PushHeldItem.web_subscription_id == dee_row.id).count() == 0)
        for i in held:
            db.expunge(i)  # the bulk delete left these in the session
        REQUESTS.clear()
        ps._deliver_tracked_push(db, [dee.id], anon_key=None, title="Ben replied to your comment", body="Late",
                                 data={"kind": "reply", "official_id": page, "post_id": 1}, channel="replies",
                                 timing=False, now_utc=datetime(2026, 10, 21, 23, 0))
        db.expire_all()
        check("7 a reply inside quiet hours is held", not sent_to(dee_b["endpoint"]) and db.query(PushHeldItem).filter(
            PushHeldItem.web_subscription_id == dee_row.id, PushHeldItem.reason == "quiet").count() == 1)
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 22, 7, 0))
        check("7 inside quiet hours it waits", not sent_to(dee_b["endpoint"]), REQUESTS)
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 22, 8, 5))
        qh = sent_to(dee_b["endpoint"])
        check("7 when they end, the reply goes as itself on its own channel",
              len(qh) == 1 and qh[0]["payload"]["channel"] == "replies"
              and qh[0]["payload"]["title"] == "New reply to your comment", qh)

        # ── 8. pruning ───────────────────────────────────────────────
        gone = new_browser()
        c.post("/api/push/web/register", json=gone, headers=fh.citizen_headers(ben))
        gone_id = sub_row(gone["endpoint"]).id
        db.add(PushHeldItem(web_subscription_id=gone_id, reason="quiet", kind="reply", title="t", body="b"))
        db.commit()
        for status, kept in ((403, True), (500, True), (404, False)):
            STATUS[gone["endpoint"]] = status
            ps.push_to_citizens(db, [ben.id], title="t", body="b", data={"kind": "reply"}, channel="replies",
                                timing=False)
            check(f"8 {status}: the subscription is {'kept' if kept else 'removed'}",
                  (sub_row(gone["endpoint"]) is not None) == kept)
        check("8 its held updates went with it",
              db.query(PushHeldItem).filter(PushHeldItem.web_subscription_id == gone_id).count() == 0)
        gone2 = new_browser()
        c.post("/api/push/web/register", json=gone2, headers=fh.citizen_headers(ben))
        STATUS[gone2["endpoint"]] = 410
        ps.push_to_citizens(db, [ben.id], title="t", body="b", data={"kind": "reply"}, channel="replies", timing=False)
        check("8 410: removed", sub_row(gone2["endpoint"]) is None)
        # A row stored before the curve check (or written by hand): its key
        # has the right length and prefix but is not on P-256.
        junk = WebPushSubscription(endpoint="https://fcm.googleapis.com/fcm/send/junk-keys", citizen_id=ben.id,
                                   p256dh=_b64(b"\x04" + b"\x01" * 64), auth=_b64(os.urandom(16)),
                                   platform="desktop")
        db.add(junk)
        db.commit()
        junk_id = junk.id
        db.add(PushHeldItem(web_subscription_id=junk_id, reason="quiet", kind="reply", title="t", body="b"))
        db.commit()
        REQUESTS.clear()
        ps.push_to_citizens(db, [ben.id], title="t", body="b", data={"kind": "reply"}, channel="replies", timing=False)
        db.expire_all()
        check("8 keys that can't be encrypted for: removed at the first send, with its held updates, nothing posted",
              db.get(WebPushSubscription, junk_id) is None and not REQUESTS and db.query(PushHeldItem).filter(
                  PushHeldItem.web_subscription_id == junk_id).count() == 0, REQUESTS)

        # ── 9. keys removed ──────────────────────────────────────────
        _clear_keys()
        wp.reset_for_tests()
        REQUESTS.clear()
        ps.push_tracked_post(db, [ana.id], official_id=page, official_name="Rae Web", post_id=p1.id,
                             preview="x", has_poll=False)
        check("9 web push off: nothing sent to browsers", not REQUESTS, REQUESTS)
        db.add(PushHeldItem(web_subscription_id=sub_row(ana_b["endpoint"]).id, reason="quiet", kind="reply",
                            title="t", body="b", data_json=json.dumps({"_channel": "replies"}),
                            created_at=datetime(2026, 10, 22, 1, 0)))
        db.commit()
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 22, 12, 0))
        check("9 held updates wait for the keys", db.query(PushHeldItem).filter(
            PushHeldItem.web_subscription_id == sub_row(ana_b["endpoint"]).id).count() == 1 and not REQUESTS)
        _set_keys()
        install()
        # The browsers subscribed with the old public key; a real push
        # service would refuse them now (403) and keep nothing pruned.

        # ── 10. deletion, the admin test push, the body cap ──────────
        from app.services.account_deletion import delete_account_keyed_rows
        delete_account_keyed_rows(db, "citizen", dee.id)
        db.commit()
        check("10 deleting the account removes its browsers", sub_row(dee_b["endpoint"]) is None)
        adm = new_browser(host="wns2-par02p.notify.windows.com", path="/w/?token=")
        c.post("/api/push/web/register", json=adm)
        REQUESTS.clear()
        r = c.post("/api/admin/push/test", json={"endpoint": adm["endpoint"]}, headers=fh.admin_headers(db))
        at = sent_to(adm["endpoint"])
        check("10 the admin test push reaches this browser, with its details",
              r.status_code == 200 and r.json()["sent"] == 1 and r.json()["web"] == "on" and len(at) == 1
              and at[0]["payload"]["title"] == "CivicView test push", (r.text, at))
        REQUESTS.clear()
        ana_acc = db.get(CitizenAccount, ana.id)
        ana_acc.notification_prefs_json = json.dumps({"lock_screen_details": True, "quiet_hours": "off"})
        db.commit()
        ps.push_to_citizens(db, [ana.id], title="T", body="x" * 5000, data={"kind": "reply"}, channel="replies",
                            timing=False)
        lp = sent_to(ana_b["endpoint"])
        check("10 a long body is capped", len(lp) == 1 and len(lp[0]["payload"]["body"]) == 300, lp)

        check("11 and the table takes browser rows (device_token_id NULL)", migrated_ok)

        # ── 12. a web push failure never undoes the phones ───────────
        cy = fh.make_citizen(db, "Cy Phones", "cy@example.org", district="FL-15")
        held_phone = DeviceToken(token="tok-cy-daily", citizen_id=cy.id, app_build=5,
                                 prefs_json=json.dumps({"push_cadence": "daily", "quiet_hours": "off"}))
        live_phone = DeviceToken(token="tok-cy-live", citizen_id=cy.id, app_build=5,
                                 prefs_json=json.dumps({"quiet_hours": "off"}))
        db.add_all([held_phone, live_phone])
        db.commit()
        held_id, live_id = held_phone.id, live_phone.id
        cy_b = new_browser()
        c.post("/api/push/web/register", json={**cy_b, "prefs": {"quiet_hours": "off"}},
               headers=fh.citizen_headers(cy))
        cy_row_id = sub_row(cy_b["endpoint"]).id
        real_deliver = wp.deliver

        def broken_deliver(*_a, **_k):
            raise RuntimeError("push service exploded")

        wp.deliver = broken_deliver
        try:
            PUSHES.clear()
            noon = datetime(2026, 10, 23, 12, 0)
            n = ps._deliver_tracked_push(db, [cy.id], anon_key=None, title="Rae Web posted", body="Hello",
                                         data={"kind": "tracked_post", "official_id": page, "post_id": 7},
                                         official_name="Rae Web", now_utc=noon)
            db.expire_all()
            check("12 deliver raised: the call still returns the phones' count",
                  n == 1 and [p["token"] for p in PUSHES] == ["tok-cy-live"], (n, PUSHES))
            check("12 the daily phone's held update survived", db.query(PushHeldItem).filter(
                PushHeldItem.device_token_id == held_id).count() == 1)
            check("12 the live phone's last_push_at survived", db.get(DeviceToken, live_id).last_push_at == noon)
            check("12 the browser is kept, unstamped", db.get(WebPushSubscription, cy_row_id) is not None
                  and db.get(WebPushSubscription, cy_row_id).last_push_at is None)
            PUSHES.clear()
            out = ps.push_election_reminder(db, [(cy.id, 7200)], title="Election Day is tomorrow",
                                            body="Polls open at 7 a.m.",
                                            data={"kind": "election_reminder", "reminder_id": "fl-2026-x",
                                                  "state": "FL"})
            check("12 an election reminder still counts the phones", out.get(cy.id) == 2, out)
            db.add(PushHeldItem(web_subscription_id=cy_row_id, reason="quiet", kind="reply", title="t", body="b",
                                data_json=json.dumps({"_channel": "replies"}), created_at=datetime(2026, 10, 23, 1, 0)))
            db.commit()
            counts = push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 23, 12, 5))
            db.expire_all()
            check("12 a summary pass: the browser counts as failed, its update and claim are kept",
                  counts["failed"] >= 1 and db.query(PushHeldItem).filter(
                      PushHeldItem.web_subscription_id == cy_row_id).count() == 1
                  and db.get(WebPushSubscription, cy_row_id).summary_sent_at is None, counts)
        finally:
            wp.deliver = real_deliver
        REQUESTS.clear()
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 23, 12, 10))
        check("12 the next pass sends it", len(sent_to(cy_b["endpoint"])) == 1, REQUESTS)

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
