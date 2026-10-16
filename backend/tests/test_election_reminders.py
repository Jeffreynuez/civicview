# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Election reminders (2026-10-16): services/election_reminders.py.

Run:  cd backend && python3 tests/test_election_reminders.py   (exit 0 = pass)

Every run uses the real FL, CA, NY, PA and TX election files and a
chosen clock, so the November 3, 2026 schedule is checked as it will
actually go out. Pushes are captured, never sent.

  1. Schedule by state and date: the November 3 reminders, their send
     days, what is not sent (CA mail requests, CA and PA early voting),
     an https source and an official link on every one, neutral wording
     with no dashes.
  2. Local time: due from 10 a.m. in the recipient's own time zone,
     Eastern when they have none; a "3 days before" reminder may go out
     a day late, a "tomorrow" reminder only on the day before.
  3. Quiet hours: the bell row is created and the push is not sent;
     the cadence limit does not apply and last_push_at is untouched.
  4. TTL: each push expires at its deadline.
  5. One per person, ever: running twice, and two instances claiming the
     same person, send one reminder.
  6. Off switch: nothing without ELECTION_REMINDERS_ENABLED; a citizen
     who turns reminders off gets none, and can turn them back on.
  7. Who: nobody outside the five states, unless they track that
     state's election; a tracked election's own alert settings apply.
  8. Admin preview: every reminder with its wording, source, status and
     recipient count; admins only.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()
os.environ.pop("ELECTION_REMINDERS_NOW", None)
os.environ.pop("ELECTION_REMINDERS_ENABLED", None)

PUSHES = []


class _CapturePush:
    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        PUSHES.append({"tokens": list(tokens), "title": title, "body": body,
                       "data": dict(data or {}), "ttl": ttl_seconds})
        return []


def main() -> int:
    from datetime import date, datetime
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import (CitizenAccount, DeviceToken, ElectionReminderDelivery, Notification,
                                  TrackedElection)
    from app.services import election_reminders as er

    ps._service = _CapturePush()
    check = fh.Checks()
    client = TestClient(m.app)
    client.__enter__()
    db = SessionLocal()

    def utc(s):
        return datetime.fromisoformat(s)

    def bell(cid, reminder_id=None):
        db.expire_all()
        rows = db.query(Notification).filter(Notification.recipient_kind == "citizen",
                                             Notification.recipient_id == cid,
                                             Notification.kind == "election_reminder").all()
        if reminder_id:
            rows = [n for n in rows if json.loads(n.payload_json)["reminder_id"] == reminder_id]
        return rows

    def set_prefs(cit, **prefs):
        cit.notification_prefs_json = json.dumps(prefs)
        db.commit()

    def run(when):
        PUSHES.clear()
        return er.run_due(db, now_utc=utc(when))

    # ── 1. Schedule by state and date ────────────────────────────────
    sched = er.build_schedule(today=date(2026, 10, 1))
    by_id = {r.id: r for r in sched.reminders}
    expected = {
        "fl-2026-11-03-registration-3d": ("2026-10-02", "2026-10-03"),
        "fl-2026-11-03-registration-1d": ("2026-10-04", "2026-10-04"),
        "tx-2026-11-03-registration-3d": ("2026-10-02", "2026-10-03"),
        "tx-2026-11-03-registration-1d": ("2026-10-04", "2026-10-04"),
        "ca-2026-11-03-registration-3d": ("2026-10-16", "2026-10-17"),
        "pa-2026-11-03-registration-3d": ("2026-10-16", "2026-10-17"),
        "ca-2026-11-03-registration-1d": ("2026-10-18", "2026-10-18"),
        "pa-2026-11-03-registration-1d": ("2026-10-18", "2026-10-18"),
        "tx-2026-11-03-early-voting-1d": ("2026-10-18", "2026-10-18"),
        "fl-2026-11-03-mail-request-3d": ("2026-10-19", "2026-10-20"),
        "tx-2026-11-03-mail-request-3d": ("2026-10-20", "2026-10-21"),
        "ny-2026-11-03-registration-3d": ("2026-10-21", "2026-10-22"),
        "ny-2026-11-03-mail-request-3d": ("2026-10-21", "2026-10-22"),
        "ny-2026-11-03-registration-1d": ("2026-10-23", "2026-10-23"),
        "ny-2026-11-03-early-voting-1d": ("2026-10-23", "2026-10-23"),
        "fl-2026-11-03-early-voting-1d": ("2026-10-23", "2026-10-23"),
        "pa-2026-11-03-mail-request-3d": ("2026-10-24", "2026-10-25"),
        "fl-2026-11-03-election-day-1d": ("2026-11-02", "2026-11-02"),
        "ca-2026-11-03-election-day-1d": ("2026-11-02", "2026-11-02"),
        "ny-2026-11-03-election-day-1d": ("2026-11-02", "2026-11-02"),
        "pa-2026-11-03-election-day-1d": ("2026-11-02", "2026-11-02"),
        "tx-2026-11-03-election-day-1d": ("2026-11-02", "2026-11-02"),
    }
    check("1 schedule: exactly the expected November 3 reminders",
          set(by_id) == set(expected), sorted(set(by_id) ^ set(expected)))
    for rid, (first, last) in expected.items():
        r = by_id.get(rid)
        check(f"1 {rid} sends {first}..{last}",
              r is not None and (r.send_on.isoformat(), r.last_send_on.isoformat()) == (first, last),
              r and (r.send_on, r.last_send_on))
    skipped = {(s.state, s.kind) for s in sched.skipped}
    check("1 not sent: CA mail request (no deadline), CA and PA early voting (no statewide start)",
          skipped == {("CA", "mail_request_3d"), ("CA", "early_voting_1d"), ("PA", "early_voting_1d")}, skipped)
    check("1 every skipped reminder says why, with an https source",
          all(s.reason and str(s.source_url).startswith("https://") for s in sched.skipped))
    check("1 every reminder has an https source and an https official link",
          all(r.source_url.startswith("https://") and r.link_url.startswith("https://") for r in sched.reminders))
    check("1 Election Day reminders carry the poll hours and their source",
          all(("Polls are open from" in r.body and r.hours_source_url.startswith("https://"))
              for r in sched.reminders if r.kind == "election_day_1d"))
    texts = " ".join(r.title + " " + r.body for r in sched.reminders)
    check("1 no em or en dashes in any reminder", not re.search("[\u2013\u2014]", texts))
    check("1 neutral: no party, candidate or measure words",
          not re.search(r"\b(Republican|Democrat|Democratic|GOP|Libertarian|Green Party|candidate|"
                        r"Amendment|Proposition|measure|support|oppose)\b", texts, re.I))
    tx_ev = by_id["tx-2026-11-03-early-voting-1d"]
    check("1 Texas early voting wording",
          tx_ev.body == ("Texas early voting starts tomorrow, Monday, October 19, and runs through Friday, "
                         "October 30. Hours vary by location. Find your early voting location on the "
                         "official Texas site."), tx_ev.body)
    check("1 New York Election Day hours are 6 a.m. to 9 p.m.",
          "6 a.m. to 9 p.m." in by_id["ny-2026-11-03-election-day-1d"].body)
    check("1 an election that already happened gets no reminders",
          not [r for r in er.build_schedule(today=date(2026, 11, 4)).reminders])

    # ── People ───────────────────────────────────────────────────────
    ca = fh.make_citizen(db, "Cal Pacific", "cal@example.org", state="CA", district="CA-12", city="")
    pa = fh.make_citizen(db, "Penn Eastern", "penn@example.org", state="PA", district="PA-03", city="")
    oh = fh.make_citizen(db, "Ohio Nobody", "ohio@example.org", state="OH", district="OH-03", city="")
    oh_tracker = fh.make_citizen(db, "Ohio Tracker", "ohio2@example.org", state="OH", district="OH-04", city="")
    fl = fh.make_citizen(db, "Flo Ridian", "flo@example.org", state="FL", district="FL-10", city="")
    tx = fh.make_citizen(db, "Tex Weekend", "tex@example.org", state="TX", district="TX-07", city="")
    ny = fh.make_citizen(db, "Nora York", "nora@example.org", state="NY", district="NY-10", city="")
    set_prefs(ca, tz_offset_minutes=-420, quiet_hours="off")       # Pacific daylight time
    # pa: no prefs at all -> Eastern, no quiet hours
    set_prefs(tx, tz_offset_minutes=-300, quiet_hours="nights_weekends", digest_cadence="weekly")
    set_prefs(ny, tz_offset_minutes=-240, quiet_hours="off", digest_cadence="daily")
    for cit, tok in ((ca, "tok-ca"), (pa, "tok-pa"), (tx, "tok-tx"), (ny, "tok-ny")):
        db.add(DeviceToken(token=tok, platform="android", citizen_id=cit.id))
    db.commit()
    # Ohio citizen tracking Florida's general election.
    db.add(TrackedElection(tracker_kind="citizen", tracker_id=oh_tracker.id, election_key="2026-general",
                           snapshot_json=json.dumps({"state": "FL", "date": "2026-11-03"}), prefs_json="{}"))
    # Florida citizen tracking it with registration alerts off.
    db.add(TrackedElection(tracker_kind="citizen", tracker_id=fl.id, election_key="2026-general",
                           snapshot_json=json.dumps({"state": "FL", "date": "2026-11-03"}),
                           prefs_json=json.dumps({"on_registration_deadline": False})))
    db.commit()

    # ── 6a. Off switch (environment) ─────────────────────────────────
    res = run("2026-10-16T18:00:00")
    check("6 nothing runs while ELECTION_REMINDERS_ENABLED is unset",
          res == {"enabled": False} and not bell(ca.id) and not PUSHES, res)
    os.environ["ELECTION_REMINDERS_ENABLED"] = "true"

    # ── 2. Local time ────────────────────────────────────────────────
    ca_reg3 = "ca-2026-11-03-registration-3d"
    pa_reg3 = "pa-2026-11-03-registration-3d"
    run("2026-10-16T13:59:00")  # 9:59 Eastern, 6:59 Pacific
    check("2 nobody before 10 a.m. local", not bell(ca.id) and not bell(pa.id))
    run("2026-10-16T14:00:00")  # 10:00 Eastern
    check("2 Eastern fallback: Pennsylvania (no time zone set) at 10 a.m. Eastern", len(bell(pa.id, pa_reg3)) == 1)
    check("2 California at 7 a.m. Pacific: not yet", not bell(ca.id, ca_reg3))
    run("2026-10-16T16:59:00")
    check("2 California at 9:59 a.m. Pacific: not yet", not bell(ca.id, ca_reg3))
    run("2026-10-16T17:00:00")
    check("2 California at 10 a.m. Pacific: sent", len(bell(ca.id, ca_reg3)) == 1)
    p = PUSHES[0] if PUSHES else {}
    check("2 California push went to the phone with the reminder text",
          p.get("tokens") == ["tok-ca"] and p.get("title") == "California voter registration deadline: Monday, October 19"
          and p.get("data", {}).get("kind") == "election_reminder", p)

    # ── 4. TTL ───────────────────────────────────────────────────────
    # Deadline Oct 19 11:59 p.m. Pacific = Oct 20 06:59 UTC; sent Oct 16 17:00 UTC.
    check("4 push TTL runs to the deadline, rounded down to the minute",
          p.get("ttl") == ((3 * 86400 + 13 * 3600 + 59 * 60) // 60) * 60, p.get("ttl"))

    # ── 5. One per person, ever ──────────────────────────────────────
    run("2026-10-16T17:30:00")
    run("2026-10-17T18:00:00")  # still inside the 3-day reminder's window
    check("5 running again sends nothing more", len(bell(ca.id, ca_reg3)) == 1 and len(bell(pa.id, pa_reg3)) == 1
          and not [x for x in PUSHES if x["data"]["reminder_id"] in (ca_reg3, pa_reg3)])
    # Two instances: the other one claimed this person a moment ago.
    late = fh.make_citizen(db, "Paula Late", "paula@example.org", state="PA", district="PA-05", city="")
    claim = er._claim(db, pa_reg3, late.id)
    reminder = {r.id: r for r in er.build_schedule(today=date(2026, 10, 16)).reminders}[pa_reg3]
    counts = er.deliver(db, reminder, [er.Recipient(late.id, None, False)], utc("2026-10-17T15:00:00"))
    check("5 two instances: the second finds the claim and sends nothing",
          claim is not None and counts["already"] == 1 and counts["notified"] == 0 and not bell(late.id), counts)
    other = SessionLocal()
    try:
        check("5 the database refuses a second claim from another session",
              er._claim(other, pa_reg3, late.id) is None)
    finally:
        other.close()
    db.expire_all()
    check("5 one delivery row per reminder and person",
          db.query(ElectionReminderDelivery).filter(ElectionReminderDelivery.reminder_id == pa_reg3).count() == 2)

    # ── 2b. Windows ──────────────────────────────────────────────────
    late2 = fh.make_citizen(db, "Carl Late", "carl@example.org", state="CA", district="CA-14", city="")
    run("2026-10-17T18:00:00")  # 11 a.m. Eastern, Oct 17: a day late is still fine
    check("2 a '3 days before' reminder missed on its day goes out the next day", len(bell(late2.id, ca_reg3)) == 1)
    late3 = fh.make_citizen(db, "Cora Later", "cora@example.org", state="CA", district="CA-15", city="")
    run("2026-10-18T18:00:00")
    check("2 ... but not on the day before the deadline", not bell(late3.id, ca_reg3))
    check("2 the day before, the 'tomorrow' reminder goes out", len(bell(late3.id, "ca-2026-11-03-registration-1d")) == 1)
    late4 = fh.make_citizen(db, "Cody Toolate", "cody@example.org", state="CA", district="CA-16", city="")
    run("2026-10-19T18:00:00")
    check("2 a 'tomorrow' reminder is never sent on the deadline day itself",
          not bell(late4.id, "ca-2026-11-03-registration-1d"))

    # ── 3. Quiet hours and cadence ───────────────────────────────────
    tx_ev = "tx-2026-11-03-early-voting-1d"
    tx_dev = db.query(DeviceToken).filter(DeviceToken.token == "tok-tx").one()
    tx_dev.last_push_at = datetime(2026, 10, 18, 14, 0)  # pushed an hour ago; weekly cadence
    db.commit()
    run("2026-10-18T15:00:00")  # Sunday 10 a.m. Central, quiet hours nights_weekends
    check("3 quiet hours: the bell row is still created", len(bell(tx.id, tx_ev)) == 1)
    check("3 quiet hours: no push", not [x for x in PUSHES if "tok-tx" in x["tokens"]])
    ny_dev = db.query(DeviceToken).filter(DeviceToken.token == "tok-ny").one()
    ny_dev.last_push_at = datetime(2026, 10, 21, 13, 0)  # an hour ago, daily cadence would block
    db.commit()
    run("2026-10-21T14:05:00")  # Wednesday 10:05 a.m. Eastern
    ny_push = [x for x in PUSHES if "tok-ny" in x["tokens"]]
    check("3 the cadence limit does not hold back an election reminder", len(ny_push) == 2, len(ny_push))
    db.expire_all()
    check("3 an election reminder leaves last_push_at alone",
          db.query(DeviceToken).filter(DeviceToken.token == "tok-ny").one().last_push_at == datetime(2026, 10, 21, 13, 0))
    ny_mail = [x for x in ny_push if x["data"]["reminder_id"] == "ny-2026-11-03-mail-request-3d"]
    check("4 New York mail request TTL ends Saturday 11:59 p.m. Eastern",
          ny_mail and ny_mail[0]["ttl"] == ((3 * 86400 + 13 * 3600 + 54 * 60) // 60) * 60,
          ny_mail and ny_mail[0]["ttl"])

    # ── 7. Who ───────────────────────────────────────────────────────
    run("2026-10-19T15:00:00")  # Florida mail reminder day, 11 a.m. Eastern
    run("2026-11-02T15:00:00")  # Election Day eve
    check("7 an Ohio citizen tracking nothing gets nothing", not bell(oh.id))
    oh_ids = {json.loads(n.payload_json)["reminder_id"] for n in bell(oh_tracker.id)}
    check("7 an Ohio citizen tracking Florida's election gets Florida's reminders, only",
          oh_ids == {"fl-2026-11-03-mail-request-3d", "fl-2026-11-03-election-day-1d"}, oh_ids)
    fl_ids = {json.loads(n.payload_json)["reminder_id"] for n in bell(fl.id)}
    check("7 a Florida citizen gets Florida's reminders",
          {"fl-2026-11-03-mail-request-3d", "fl-2026-11-03-election-day-1d"} <= fl_ids, fl_ids)
    check("7 everyone gets only their own state's reminders",
          all(json.loads(n.payload_json)["state"] == c.state
              for c in (ca, pa, tx, ny, fl) for n in bell(c.id)))
    sched_fl = {r.id: r for r in er.build_schedule(today=date(2026, 10, 1)).reminders}
    recips = {x.citizen_id for x in er.eligible_recipients(db, sched_fl["fl-2026-11-03-registration-1d"])}
    check("7 a tracked election's own alert settings apply (registration alerts off)",
          fl.id not in recips and oh_tracker.id in recips, recips)
    states = {db.get(CitizenAccount, n.recipient_id).state for n in
              db.query(Notification).filter(Notification.kind == "election_reminder").all()}
    check("7 nobody outside the five states got one, except by tracking",
          states <= {"FL", "CA", "NY", "PA", "TX", "OH"}
          and all(n.recipient_id != oh.id for n in db.query(Notification).all()), states)

    # ── 6b. A citizen turns them off, then on ────────────────────────
    quiet = fh.make_citizen(db, "Quinn Off", "quinn@example.org", state="NY", district="NY-12", city="")
    r = client.post("/api/election-reminders/off", headers=fh.citizen_headers(quiet))
    check("6 one tap turns election reminders off", r.status_code == 200 and r.json()["enabled"] is False, r.text)
    run("2026-10-23T15:00:00")  # NY registration 1d + early voting 1d
    check("6 a citizen who turned them off gets none", not bell(quiet.id))
    r = client.get("/api/election-reminders/settings", headers=fh.citizen_headers(quiet))
    check("6 settings report off and the covered states",
          r.status_code == 200 and r.json() == {"enabled": False, "covered_states": ["FL", "CA", "NY", "PA", "TX"],
                                                "your_state_covered": True}, r.text)
    r = client.put("/api/election-reminders/settings", json={"enabled": True}, headers=fh.citizen_headers(quiet))
    check("6 and back on", r.status_code == 200 and r.json()["enabled"] is True, r.text)
    run("2026-10-23T15:30:00")
    check("6 back on: the reminders still due today arrive", len(bell(quiet.id)) == 2, len(bell(quiet.id)))
    check("6 signed out: 401", client.post("/api/election-reminders/off").status_code == 401)

    # ── 8. Admin preview ─────────────────────────────────────────────
    os.environ["ELECTION_REMINDERS_NOW"] = "2026-10-16T12:00:00"
    try:
        r = client.get("/api/admin/election-reminders", headers=fh.admin_headers(db))
        body = r.json() if r.status_code == 200 else {}
        items = {i["id"]: i for i in body.get("reminders", [])}
        check("8 preview lists every reminder", r.status_code == 200 and set(items) == set(expected), r.text[:300])
        ok_fields = all(all(k in i for k in ("send_on", "state", "kind", "kind_label", "title", "body",
                                             "source_url", "link_url", "status", "recipient_count"))
                        for i in items.values())
        check("8 each item has date, state, kind, wording, source and recipient count", ok_fields)
        check("8 statuses on October 16: Florida registration passed, California sending, Election Day scheduled",
              items.get("fl-2026-11-03-registration-1d", {}).get("status") == "passed"
              and items.get(ca_reg3, {}).get("status") == "sending"
              and items.get("tx-2026-11-03-election-day-1d", {}).get("status") == "scheduled")
        check("8 recipient counts: California's reminder is for the four CA citizens",
              items.get(ca_reg3, {}).get("recipient_count") == 4, items.get(ca_reg3))
        check("8 the preview lists what will not be sent", len(body.get("skipped", [])) == 3)
        check("8 the preview reports the switch", body.get("enabled") is True)
        r = client.get("/api/admin/election-reminders", headers=fh.citizen_headers(ca))
        check("8 not an admin: 403", r.status_code == 403, r.status_code)
    finally:
        os.environ.pop("ELECTION_REMINDERS_NOW", None)

    db.close()
    client.__exit__(None, None, None)
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
