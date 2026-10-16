# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Each push carries its recipient's bell row (2026-10-16).

Run:  cd backend && python3 tests/test_push_deep_links.py   (exit 0 = pass)

Tapping a push opens the post and marks the bell row it mirrors read,
so the push data names that row. Tracked pushes are one message per
device for this reason.

  1. A post fan-out: every signed-in tracker's push carries the id of
     their own bell row; a signed-out device's push carries none.
  2. That id is theirs: marking it read through the API works for them.
  3. Events carry it too.
  4. A summary leaves out updates already read in the bell.
"""
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

PUSHES = []


class _CapturePush:
    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        for t in tokens:
            PUSHES.append({"token": t, "title": title, "data": dict(data or {})})
        return []

    def subscribe_to_topic(self, tokens, topic):
        pass

    def unsubscribe_from_topic(self, tokens, topic):
        pass


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import DeviceToken, Notification, TrackedOfficial
    from app.services import notifications_inapp as ni
    from app.services import push_summaries as sm

    ps._service = _CapturePush()
    check = fh.Checks()
    db = SessionLocal()
    page = "tst-off-deep"

    def device(token, cit=None, prefs=None, tracked=None):
        db.add(DeviceToken(token=token, platform="android", citizen_id=cit.id if cit else None,
                           prefs_json=json.dumps(prefs) if prefs else None,
                           tracked_json=json.dumps(tracked) if tracked else None))
        db.commit()

    def bell(cid, kind):
        db.expire_all()
        return db.query(Notification).filter(Notification.recipient_kind == "citizen",
                                             Notification.recipient_id == cid,
                                             Notification.kind == kind).all()

    with TestClient(m.app) as c:
        ana = fh.make_citizen(db, "Ana One", "ana@example.org")
        ben = fh.make_citizen(db, "Ben Two", "ben@example.org", district="FL-12")
        for cit in (ana, ben):
            db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=cit.id, official_key=page,
                                   prefs_json=json.dumps({"on_event": True})))
        db.commit()
        device("tok-deep-ana", ana)
        device("tok-deep-ben", ben)
        device("tok-deep-anon", None, tracked=[page])

        # ── 1. post ──────────────────────────────────────────────────
        PUSHES.clear()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Pat Page",
                                              post_id=501, preview="Hello", has_poll=False)
        by = {p["token"]: p for p in PUSHES}
        a_row, b_row = bell(ana.id, "tracked_post"), bell(ben.id, "tracked_post")
        check("1 every device got the push", set(by) == {"tok-deep-ana", "tok-deep-ben", "tok-deep-anon"}, by)
        check("1 Ana's push names Ana's bell row",
              a_row and str(by.get("tok-deep-ana", {}).get("data", {}).get("notification_id")) == str(a_row[0].id), by)
        check("1 Ben's push names Ben's bell row",
              b_row and str(by.get("tok-deep-ben", {}).get("data", {}).get("notification_id")) == str(b_row[0].id), by)
        check("1 a signed-out device has no bell row to name",
              "notification_id" not in by.get("tok-deep-anon", {}).get("data", {}), by)
        check("1 the post is still named for the deep link",
              str(by.get("tok-deep-ana", {}).get("data", {}).get("post_id")) == "501", by)

        # ── 2. the tap marks it read ─────────────────────────────────
        nid = by["tok-deep-ana"]["data"]["notification_id"]
        r = c.post(f"/api/notifications/{nid}/read", headers=fh.citizen_headers(ana))
        check("2 marking it read works for its owner", r.status_code == 200 and r.json()["updated"] == 1, r.text)
        r = c.post(f"/api/notifications/{nid}/read", headers=fh.citizen_headers(ben))
        check("2 nobody else can", r.json()["updated"] == 0, r.text)
        check("2 Ben's row is untouched", bell(ben.id, "tracked_post")[0].read_at is None)

        # ── 3. events ────────────────────────────────────────────────
        PUSHES.clear()
        ni.emit_tracked_event_notifications(db, official_id=page, official_name="Pat Page", event_id=77,
                                            title="Town hall", start_at="2030-01-10T23:00:00.000Z",
                                            location="Library")
        ev = {p["token"]: p for p in PUSHES}
        e_row = bell(ana.id, "tracked_event")
        check("3 an event push names the bell row",
              e_row and str(ev.get("tok-deep-ana", {}).get("data", {}).get("notification_id")) == str(e_row[0].id), ev)

        # ── 4. a summary leaves out what was read ────────────────────
        ana.notification_prefs_json = json.dumps({"push_cadence": "daily", "quiet_hours": "off",
                                                  "tz_offset_minutes": -240})
        db.commit()
        PUSHES.clear()
        when = datetime(2030, 1, 7, 13, 0)
        for post_id in (601, 602, 603):
            db.expire_all()
            ni.emit_tracked_content_notifications(db, official_id=page, official_name="Pat Page",
                                                  post_id=post_id, preview="p", has_poll=False)
        rows = sorted(bell(ana.id, "tracked_post"), key=lambda n: n.id)[-3:]
        c.post(f"/api/notifications/{rows[0].id}/read", headers=fh.citizen_headers(ana))
        # Pin the held rows to a known morning so the 6 p.m. slot is clear.
        from app.models.pages import PushHeldItem
        db.query(PushHeldItem).update({PushHeldItem.created_at: when}, synchronize_session=False)
        db.commit()
        PUSHES.clear()
        sm.run_summaries(db, now_utc=datetime(2030, 1, 7, 23, 0))   # 6 p.m. EST is 23:00 UTC
        got = [p for p in PUSHES if p["token"] == "tok-deep-ana"]
        check("4 one summary, counting only the unread updates",
              len(got) == 1 and got[0]["title"] == "2 updates from officials you track", got)

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
