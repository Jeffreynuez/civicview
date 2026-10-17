# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Push timing and summary pushes (2026-10-16).

Run:  cd backend && python3 tests/test_push_timing.py   (exit 0 = pass)

Until 2026-10-16 the default "digest cadence" was 'daily', which let
one push per device through every 20 hours and dropped the rest. Now:

  1. The default is "As they happen": a device with no setting, or the
     old 'daily' default, gets each push at once.
  2. Daily summary: nothing is sent at once; at 6 p.m. local time one
     push covers everything held, naming the officials; a second pass
     sends nothing.
  3. A summary of one update is that update's own push.
  4. Weekly summary: Saturday at 10 a.m. local time.
  5. Quiet hours: a push held at night goes out as one summary when
     quiet hours end; a summary time inside quiet hours waits for them.
  6. Switching back to "As they happen" sends what was held.
  7. Signed-out devices: the summary opens the newest update's page.
  8. Two instances: the per-device claim lets only one send.
  9. Election reminders are never held, whatever the setting.
 10. The one-time migration: 'daily' becomes realtime, 'weekly' stays,
     counted; a second run changes nothing; an old client's save is
     read the same way.
 11. Turning push off deletes the device's held updates with it.
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
            PUSHES.append({"token": t, "title": title, "body": body, "data": dict(data or {}),
                           "ttl": ttl_seconds})
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
    from app.models.pages import CitizenAccount, DeviceToken, PushHeldItem, TrackedOfficial
    from app.services import push_summaries as sm

    ps._service = _CapturePush()
    check = fh.Checks()
    db = SessionLocal()

    def device(token, citizen=None, prefs=None, tracked=None):
        row = DeviceToken(token=token, platform="android",
                          citizen_id=citizen.id if citizen else None,
                          prefs_json=json.dumps(prefs) if prefs is not None else None,
                          tracked_json=json.dumps(tracked) if tracked is not None else None)
        db.add(row)
        db.commit()
        return row

    def set_prefs(cit, **prefs):
        cit.notification_prefs_json = json.dumps(prefs)
        db.commit()

    def post(cids, official="tst-off-1", name="Jane Doe", post_id=1, when=None):
        # In the app these pushes come from tracking (the fan-out's
        # audience), and a summary leaves out an official no longer
        # tracked (2026-10-17), so the citizens here track the official.
        for cid in cids:
            if not db.query(TrackedOfficial).filter(TrackedOfficial.tracker_kind == "citizen",
                                                    TrackedOfficial.tracker_id == cid,
                                                    TrackedOfficial.official_key == official).first():
                db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=cid, official_key=official,
                                       prefs_json="{}"))
        db.commit()
        return ps._deliver_tracked_push(
            db, cids, anon_key=official, title=f"{name} posted", body=f"post {post_id}",
            data={"kind": "tracked_post", "official_id": official, "post_id": post_id},
            official_name=name, now_utc=when)

    def to(token):
        return [p for p in PUSHES if p["token"] == token]

    def held(token):
        db.expire_all()
        dev = db.query(DeviceToken).filter(DeviceToken.token == token).one()
        return db.query(PushHeldItem).filter(PushHeldItem.device_token_id == dev.id).count()

    def at(s):
        return datetime.fromisoformat(s)

    with TestClient(m.app):
        # EDT: 4 hours behind UTC. 2026-10-16 is a Friday.
        edt = -240

        # ── 1. default: as they happen ───────────────────────────────
        a = fh.make_citizen(db, "Ann Realtime", "ann@example.org")
        b = fh.make_citizen(db, "Bo Legacy", "bo@example.org", district="FL-11")
        set_prefs(b, digest_cadence="daily", quiet_hours="off", tz_offset_minutes=edt)
        device("tok-a", a)                      # never synced anything
        device("tok-b", b)
        PUSHES.clear()
        post([a.id, b.id], when=at("2026-10-16T14:00:00"))
        check("1 no setting: sent at once", len(to("tok-a")) == 1, PUSHES)
        check("1 the old 'daily' default: sent at once", len(to("tok-b")) == 1, PUSHES)
        check("1 nothing held", held("tok-a") == 0 and held("tok-b") == 0)

        # ── 2. daily summary ─────────────────────────────────────────
        c = fh.make_citizen(db, "Cy Daily", "cy@example.org", district="FL-12")
        set_prefs(c, push_cadence="daily", quiet_hours="off", tz_offset_minutes=edt)
        device("tok-c", c)
        PUSHES.clear()
        post([c.id], official="tst-off-1", name="Jane Doe", post_id=11, when=at("2026-10-16T13:00:00"))
        post([c.id], official="tst-off-2", name="John Roe", post_id=12, when=at("2026-10-16T15:00:00"))
        post([c.id], official="tst-off-3", name="Kim Poe", post_id=13, when=at("2026-10-16T16:00:00"))
        post([c.id], official="tst-off-1", name="Jane Doe", post_id=14, when=at("2026-10-16T17:00:00"))
        check("2 daily: nothing sent at once", not to("tok-c"), PUSHES)
        check("2 daily: four updates held", held("tok-c") == 4, held("tok-c"))
        sm.run_summaries(db, now_utc=at("2026-10-16T21:59:00"))   # 5:59 p.m. EDT
        check("2 not before 6 p.m. local", not to("tok-c"), PUSHES)
        sm.run_summaries(db, now_utc=at("2026-10-16T22:05:00"))   # 6:05 p.m. EDT
        got = to("tok-c")
        check("2 one summary at 6 p.m. local", len(got) == 1, got)
        if got:
            check("2 summary title", got[0]["title"] == "4 updates from officials you track", got[0]["title"])
            check("2 summary names the officials, newest first",
                  got[0]["body"] == "From Jane Doe, Kim Poe and 1 more.", got[0]["body"])
            check("2 summary opens the bell", got[0]["data"] == {"kind": "tracked_summary", "count": "4"}
                  or got[0]["data"] == {"kind": "tracked_summary", "count": 4}, got[0]["data"])
        check("2 held rows cleared", held("tok-c") == 0)
        sm.run_summaries(db, now_utc=at("2026-10-16T22:30:00"))
        check("2 a second pass sends nothing", len(to("tok-c")) == 1)
        # An update after 6 p.m. waits for tomorrow.
        PUSHES.clear()
        post([c.id], post_id=15, when=at("2026-10-16T23:00:00"))
        sm.run_summaries(db, now_utc=at("2026-10-17T02:00:00"))
        check("2 an update after the summary waits for the next one", not to("tok-c") and held("tok-c") == 1)

        # ── 3. a summary of one update is that update ────────────────
        sm.run_summaries(db, now_utc=at("2026-10-17T22:01:00"))
        got = to("tok-c")
        check("3 one held update goes out as itself",
              len(got) == 1 and got[0]["title"] == "Jane Doe posted" and got[0]["body"] == "post 15"
              and got[0]["data"].get("post_id") in (15, "15"), got)

        # ── 4. weekly summary: Saturday 10 a.m. local ────────────────
        w = fh.make_citizen(db, "Wes Weekly", "wes@example.org", district="FL-13")
        set_prefs(w, push_cadence="weekly", quiet_hours="off", tz_offset_minutes=-300)  # CDT
        device("tok-w", w)
        PUSHES.clear()
        post([w.id], post_id=21, when=at("2026-10-19T15:00:00"))   # Monday
        post([w.id], official="tst-off-2", name="John Roe", post_id=22, when=at("2026-10-21T15:00:00"))
        sm.run_summaries(db, now_utc=at("2026-10-23T23:00:00"))    # Friday 6 p.m. CDT
        check("4 weekly: nothing on Friday", not to("tok-w"))
        sm.run_summaries(db, now_utc=at("2026-10-24T14:55:00"))    # Saturday 9:55 a.m. CDT
        check("4 weekly: not before 10 a.m. Saturday", not to("tok-w"))
        sm.run_summaries(db, now_utc=at("2026-10-24T15:05:00"))    # Saturday 10:05 a.m. CDT
        got = to("tok-w")
        check("4 weekly: one summary Saturday 10 a.m. local",
              len(got) == 1 and got[0]["title"] == "2 updates from officials you track"
              and got[0]["body"] == "From John Roe and Jane Doe.", got)

        # ── 5. quiet hours ───────────────────────────────────────────
        q = fh.make_citizen(db, "Quinn Night", "quinn@example.org", district="FL-14")
        set_prefs(q, push_cadence="realtime", quiet_hours="nights", tz_offset_minutes=edt)
        device("tok-q", q)
        PUSHES.clear()
        post([q.id], post_id=31, when=at("2026-10-17T03:00:00"))    # 11 p.m. EDT
        post([q.id], official="tst-off-2", name="John Roe", post_id=32, when=at("2026-10-17T05:00:00"))
        check("5 nothing pushed in quiet hours", not to("tok-q"))
        check("5 held, not dropped", held("tok-q") == 2)
        sm.run_summaries(db, now_utc=at("2026-10-17T10:30:00"))     # 6:30 a.m. EDT, still quiet
        check("5 still waiting inside quiet hours", not to("tok-q"))
        sm.run_summaries(db, now_utc=at("2026-10-17T12:05:00"))     # 8:05 a.m. EDT
        got = to("tok-q")
        check("5 one summary when quiet hours end",
              len(got) == 1 and got[0]["title"] == "2 updates from officials you track"
              and got[0]["body"] == "From John Roe and Jane Doe, while your quiet hours were on.", got)
        # A daily summary time inside quiet hours waits for them to end.
        wk = fh.make_citizen(db, "Wren Work", "wren@example.org", district="FL-15")
        set_prefs(wk, push_cadence="daily", quiet_hours="work_hours_only", tz_offset_minutes=edt)
        device("tok-wk", wk)
        PUSHES.clear()
        post([wk.id], post_id=41, when=at("2026-10-19T14:00:00"))    # Monday 10 a.m. EDT
        post([wk.id], post_id=42, when=at("2026-10-19T15:00:00"))
        sm.run_summaries(db, now_utc=at("2026-10-19T22:05:00"))      # Monday 6:05 p.m.: quiet
        check("5 a summary time in quiet hours waits", not to("tok-wk"))
        sm.run_summaries(db, now_utc=at("2026-10-20T13:05:00"))      # Tuesday 9:05 a.m.
        check("5 and goes out when they end", len(to("tok-wk")) == 1, PUSHES)

        # ── 6. switching back to as they happen sends what was held ──
        sw = fh.make_citizen(db, "Sam Switch", "sam@example.org", district="FL-16")
        set_prefs(sw, push_cadence="daily", quiet_hours="off", tz_offset_minutes=edt)
        device("tok-sw", sw)
        PUSHES.clear()
        post([sw.id], post_id=51, when=at("2026-10-20T14:00:00"))
        post([sw.id], post_id=52, when=at("2026-10-20T14:10:00"))
        set_prefs(sw, push_cadence="realtime", quiet_hours="off", tz_offset_minutes=edt)
        sm.run_summaries(db, now_utc=at("2026-10-20T14:20:00"))
        check("6 held updates go out after switching to as they happen",
              len(to("tok-sw")) == 1 and held("tok-sw") == 0, PUSHES)

        # ── 7. signed-out device ─────────────────────────────────────
        device("tok-anon", None, prefs={"push_cadence": "daily", "quiet_hours": "off",
                                        "tz_offset_minutes": edt}, tracked=["tst-off-7", "tst-off-8"])
        PUSHES.clear()
        post([], official="tst-off-7", name="Lee Seven", post_id=71, when=at("2026-10-20T13:00:00"))
        post([], official="tst-off-8", name="Max Eight", post_id=81, when=at("2026-10-20T14:00:00"))
        sm.run_summaries(db, now_utc=at("2026-10-20T22:05:00"))
        got = to("tok-anon")
        check("7 signed-out summary opens the newest update's page",
              len(got) == 1 and got[0]["data"].get("official_id") == "tst-off-8", got)

        # ── 8. two instances: one claim ──────────────────────────────
        dup = fh.make_citizen(db, "Dee Dup", "dee@example.org", district="FL-17")
        set_prefs(dup, push_cadence="daily", quiet_hours="off", tz_offset_minutes=edt)
        dev = device("tok-dup", dup)
        post([dup.id], post_id=91, when=at("2026-10-21T13:00:00"))
        slot = sm.last_slot_utc("daily", {"tz_offset_minutes": edt}, at("2026-10-21T22:05:00"))
        first, _ = sm._claim(db, dev.id, slot, at("2026-10-21T22:05:00"))
        second, _ = sm._claim(db, dev.id, slot, at("2026-10-21T22:05:01"))
        check("8 only one of two instances claims the summary", first and not second)

        # ── 9. election reminders are never held ─────────────────────
        er = fh.make_citizen(db, "Eve Election", "eve@example.org", district="FL-18")
        set_prefs(er, push_cadence="weekly", quiet_hours="off", tz_offset_minutes=edt)
        device("tok-er", er)
        PUSHES.clear()
        sent = ps.push_election_reminder(db, [(er.id, 3600)], title="t", body="b",
                                         data={"kind": "election_reminder"},
                                         now_utc=at("2026-10-21T14:00:00"))
        check("9 an election reminder goes out on a weekly device", sent.get(er.id) == 1 and len(to("tok-er")) == 1)
        check("9 and is not held", held("tok-er") == 0)

        # ── 10. one-time migration ───────────────────────────────────
        m1 = fh.make_citizen(db, "Mia One", "mia@example.org", district="FL-19")
        m2 = fh.make_citizen(db, "Ned Two", "ned@example.org", district="FL-20")
        m3 = fh.make_citizen(db, "Oz Three", "oz@example.org", district="FL-21")
        set_prefs(m1, digest_cadence="daily", quiet_hours="nights", tz_offset_minutes=edt, in_app=True)
        set_prefs(m2, digest_cadence="weekly", quiet_hours="off")
        set_prefs(m3, digest_cadence="realtime")
        device("tok-m", None, prefs={"digest_cadence": "daily", "quiet_hours": "nights"})
        counts = sm.migrate_legacy_cadence(db)
        check("10 counts accounts", counts["accounts"]["daily_to_realtime"] >= 2   # b from section 1, m1
              and counts["accounts"]["weekly_kept"] == 1 and counts["accounts"]["realtime_kept"] == 1, counts)
        check("10 counts devices", counts["devices"]["daily_to_realtime"] == 1, counts)
        db.expire_all()
        p1 = json.loads(db.get(CitizenAccount, m1.id).notification_prefs_json)
        p2 = json.loads(db.get(CitizenAccount, m2.id).notification_prefs_json)
        check("10 daily became realtime, other settings kept",
              p1 == {"push_cadence": "realtime", "quiet_hours": "nights", "tz_offset_minutes": edt, "in_app": True}, p1)
        check("10 weekly stayed weekly", p2.get("push_cadence") == "weekly" and "digest_cadence" not in p2, p2)
        again = sm.migrate_legacy_cadence(db)
        check("10 a second run changes nothing",
              not any(v for t in again.values() for v in t.values()), again)
        # An old client's save after the migration.
        r = m_client_put(m, fh.citizen_headers(m1), {"digest_cadence": "daily", "quiet_hours": "off"})
        check("10 an old client's 'daily' is saved as realtime",
              r.status_code == 200 and r.json()["prefs"] == {"push_cadence": "realtime", "quiet_hours": "off"},
              r.text)
        r = m_client_put(m, fh.citizen_headers(m1), {"push_cadence": "daily"})
        check("10 a new client's daily is kept", r.json()["prefs"] == {"push_cadence": "daily"}, r.text)
        r = m_client_put(m, fh.citizen_headers(m1), {"push_cadence": "hourly"})
        check("10 an unknown value falls back to realtime", r.json()["prefs"] == {"push_cadence": "realtime"}, r.text)

        # ── 11. turning push off deletes what was held ───────────────
        off = fh.make_citizen(db, "Pat Off", "pat@example.org", district="FL-22")
        set_prefs(off, push_cadence="daily", quiet_hours="off", tz_offset_minutes=edt)
        off_id = device("tok-off-device", off).id
        post([off.id], post_id=111, when=at("2026-10-22T13:00:00"))
        check("11 held before turning push off", held("tok-off-device") == 1)
        from fastapi.testclient import TestClient as _TC
        with _TC(m.app) as c:
            r = c.post("/api/push/unregister", json={"token": "tok-off-device"})
        db.expire_all()
        check("11 unregister deletes the device and its held updates",
              r.status_code == 200 and db.query(DeviceToken).filter(DeviceToken.token == "tok-off-device").count() == 0
              and db.query(PushHeldItem).filter(PushHeldItem.device_token_id == off_id).count() == 0, r.text)

    db.close()
    return check.exit_code()


def m_client_put(m, headers, prefs):
    from fastapi.testclient import TestClient
    with TestClient(m.app) as c:
        return c.put("/api/citizen-auth/me/notification-prefs", json={"prefs": prefs}, headers=headers)


if __name__ == "__main__":
    sys.exit(main())
