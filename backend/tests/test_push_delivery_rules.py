# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Push delivery rules (2026-10-16): services/push_service.py.

Run:  cd backend && python3 tests/test_push_delivery_rules.py   (exit 0 = pass)

  1. TTL per kind: a post push keeps trying for about 3 days, an event
     push until the event starts, and an event that has started is not
     pushed (its bell row still comes).
  2. Pruning: only a token FCM reports dead is forgotten. An
     InvalidArgument about the message itself, which FCM returns for
     every token in the batch, prunes nothing.
  3. Moderation: the screen runs before the fan-out; a post it flags is
     not pushed (the bell row stays), and one it passes, or could not
     screen, is.
  4. The 'announcements' topic: new devices never join it; existing
     ones are taken off once.
  5. firebase-admin's floor is 7.7.0.
"""
import json
import os
import re
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

PUSHES = []
TOPIC_CALLS = []


class _CapturePush:
    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        for t in tokens:
            PUSHES.append({"token": t, "title": title, "data": dict(data or {}), "ttl": ttl_seconds})
        return []

    def subscribe_to_topic(self, tokens, topic):
        TOPIC_CALLS.append(("subscribe", list(tokens), topic))

    def unsubscribe_from_topic(self, tokens, topic):
        TOPIC_CALLS.append(("unsubscribe", list(tokens), topic))


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import (ContentModerationVerdict, DeviceToken, Notification, Post,
                                  TrackedOfficial)
    from app.services import notifications_inapp as ni

    ps._service = _CapturePush()
    check = fh.Checks()
    db = SessionLocal()
    now = datetime.now(UTC).replace(tzinfo=None)

    def bell(cid, kind):
        db.expire_all()
        return db.query(Notification).filter(Notification.recipient_id == cid, Notification.kind == kind).count()

    with TestClient(m.app) as c:
        ana = fh.make_citizen(db, "Ana Phone", "ana@example.org")
        page = "tst-off-rules"
        rep = fh.make_rep(db, page, "Rae Rules", "rae@example.org")
        db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=ana.id, official_key=page,
                               prefs_json=json.dumps({"on_event": True})))
        db.add(DeviceToken(token="tok-rules-ana", citizen_id=ana.id))
        db.commit()

        # ── 1. TTL ───────────────────────────────────────────────────
        PUSHES.clear()
        p1 = Post(official_id=page, author_id=rep.id, body="Hello", created_at=now)
        db.add(p1)
        db.commit()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Rules", post_id=p1.id,
                                              preview="Hello", has_poll=False)
        check("1 a post push keeps trying for 3 days", [p["ttl"] for p in PUSHES] == [3 * 24 * 3600], PUSHES)
        PUSHES.clear()
        start = (now + timedelta(hours=5)).isoformat() + "Z"
        ni.emit_tracked_event_notifications(db, official_id=page, official_name="Rae Rules", event_id=1,
                                            title="Town hall", start_at=start, location=None)
        ttl = PUSHES[0]["ttl"] if PUSHES else None
        check("1 an event push keeps trying until the event starts", ttl and 5 * 3600 - 120 <= ttl <= 5 * 3600, ttl)
        PUSHES.clear()
        before = bell(ana.id, "tracked_event")
        ni.emit_tracked_event_notifications(db, official_id=page, official_name="Rae Rules", event_id=2,
                                            title="Earlier", start_at=(now - timedelta(hours=1)).isoformat() + "Z",
                                            location=None)
        check("1 an event that has started is not pushed", not PUSHES, PUSHES)
        check("1 but its bell row comes", bell(ana.id, "tracked_event") == before + 1)

        # ── 2. pruning ───────────────────────────────────────────────
        class UnregisteredError(Exception):
            pass

        class InvalidArgumentError(Exception):
            pass

        class SenderIdMismatchError(Exception):
            pass

        class QuotaExceededError(Exception):
            pass

        dead = ps._is_dead_token_error
        check("2 unregistered is dead", dead(UnregisteredError("gone")))
        check("2 another project's token is dead", dead(SenderIdMismatchError("x")))
        check("2 an invalid registration token is dead",
              dead(InvalidArgumentError("The registration token is not a valid FCM registration token")))
        check("2 an invalid message is not", not dead(InvalidArgumentError("Invalid value for TTL")))
        check("2 a quota error is not", not dead(QuotaExceededError("slow down")))

        from firebase_admin import messaging

        class _Resp:
            def __init__(self, ok, exc=None):
                self.success, self.exception = ok, exc

        class _Batch:
            def __init__(self, responses):
                self.responses = responses

        real_each = messaging.send_each
        fcm = ps.FCMPushService.__new__(ps.FCMPushService)
        fcm._app = None
        messaging.send_each = lambda msgs, app=None: _Batch(
            [_Resp(False, InvalidArgumentError("Request contains an invalid argument."))] * len(msgs))
        res = fcm.send_messages([ps.PushMessage(token=f"t{i}", title="t", body="b") for i in range(3)])
        check("2 a bad message prunes nothing", not res.invalid and res.failed == {"t0", "t1", "t2"}, res)
        messaging.send_each = lambda msgs, app=None: _Batch([
            _Resp(True),
            _Resp(False, UnregisteredError("Requested entity was not found.")),
            _Resp(False, InvalidArgumentError("The registration token is not a valid FCM registration token")),
            _Resp(False, QuotaExceededError("later")),
        ])
        res = fcm.send_messages([ps.PushMessage(token=f"u{i}", title="t", body="b") for i in range(4)])
        check("2 only the tokens FCM reports are pruned",
              res.sent == {"u0"} and res.invalid == {"u1", "u2"} and res.failed == {"u3"}, res)
        messaging.send_each = real_each

        # ── 3. moderation ────────────────────────────────────────────
        PUSHES.clear()
        p2 = Post(official_id=page, author_id=rep.id, body="Flag me", created_at=now)
        db.add(p2)
        db.commit()
        db.add(ContentModerationVerdict(content_type="post", content_id=p2.id, category="threat",
                                        severity=0.6, decision="flag"))
        db.commit()
        before = bell(ana.id, "tracked_post")
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Rules", post_id=p2.id,
                                              preview="Flag me", has_poll=False)
        check("3 a flagged post is not pushed", not PUSHES, PUSHES)
        check("3 its bell row stays", bell(ana.id, "tracked_post") == before + 1)
        PUSHES.clear()
        p3 = Post(official_id=page, author_id=rep.id, body="Fine", created_at=now)
        db.add(p3)
        db.commit()
        db.add(ContentModerationVerdict(content_type="post", content_id=p3.id, category="none",
                                        severity=0.0, decision="skipped"))
        db.commit()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Rules", post_id=p3.id,
                                              preview="Fine", has_poll=False)
        check("3 a post the screen could not check is pushed", len(PUSHES) == 1, PUSHES)

        # Through the API: moderation runs before the fan-out.
        import app.services.moderation_service as mod
        real_assess = mod.assess

        def flag_everything(db_, *, content_type, content_id, text, author_kind=None, author_id=None):
            return mod._record(db_, content_type=content_type, content_id=content_id, author_kind=author_kind,
                               author_id=author_id, category="threat", severity=0.9, decision="flag",
                               rationale="test", offending_span=None, model=None)

        mod.assess = flag_everything
        PUSHES.clear()
        r = c.post(f"/api/pages/{page}/posts", json={"body": "Posted through the API"}, headers=fh.rep_headers(rep))
        mod.assess = real_assess
        check("3 API: the post is created", r.status_code == 201, r.text)
        check("3 API: the screen ran first, so the flagged post is not pushed", not PUSHES, PUSHES)
        db.expire_all()
        newest = db.query(Notification).filter(Notification.recipient_id == ana.id,
                                               Notification.kind == "tracked_post").order_by(Notification.id.desc()).first()
        check("3 API: the bell row is there", newest is not None
              and json.loads(newest.payload_json)["post_id"] == r.json()["id"])

        # ── 4. announcements topic ───────────────────────────────────
        TOPIC_CALLS.clear()
        r = c.post("/api/push/register", json={"token": "fcm-new-anon-device-01"})
        check("4 a new device does not join the topic", r.status_code == 200
              and not [t for t in TOPIC_CALLS if t[0] == "subscribe"], TOPIC_CALLS)
        db.add(DeviceToken(token="fcm-old-anon-device-01"))
        db.add(DeviceToken(token="fcm-old-anon-device-02"))
        db.commit()
        TOPIC_CALLS.clear()
        n = ps.unsubscribe_announcements(db)
        unsub = [t for t in TOPIC_CALLS if t[0] == "unsubscribe" and t[2] == "announcements"]
        took_off = {tok for call in unsub for tok in call[1]}
        check("4 older devices are taken off the topic",
              {"fcm-old-anon-device-01", "fcm-old-anon-device-02"} <= took_off, TOPIC_CALLS)
        check("4 new devices are not touched", "fcm-new-anon-device-01" not in took_off, took_off)
        TOPIC_CALLS.clear()
        check("4 once", ps.unsubscribe_announcements(db) == 0 and not TOPIC_CALLS and n >= 2, (n, TOPIC_CALLS))

        # ── 5. firebase-admin floor ──────────────────────────────────
        req = open(os.path.join(os.path.dirname(__file__), "..", "requirements.in"), encoding="utf-8").read()
        check("5 firebase-admin>=7.7.0", re.search(r"^firebase-admin>=7\.7\.0,<8$", req, re.M) is not None)

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
