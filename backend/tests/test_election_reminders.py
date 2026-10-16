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
  7. Who: decided from the data alone. Nobody in a state without
     sourced dates gets one, unless they track an election in a state
     that has them; a tracked election's own alert settings apply; a
     state whose file gains sourced dates is covered with no code change.
  8. Admin preview: every reminder with its wording, source, status and
     recipient count; admins only.
  9. "I already voted": no more reminders for that election, other
     elections carry on, and it can be undone.
 10. Opt-in email: only to citizens who turned it on, never to a demo
     address; same words, the official link, the source and a footer
     link to settings.
 11. Future elections: any election ahead in the data gets reminders
     once its dates have sources.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()
# Requests that read the clock themselves (settings, I already voted,
# the preview) see October 16, 2026, so the checks keep passing after
# the election. run() below passes its own time.
TEST_NOW = "2026-10-16T12:00:00"
os.environ["ELECTION_REMINDERS_NOW"] = TEST_NOW
os.environ.pop("ELECTION_REMINDERS_ENABLED", None)

PUSHES = []
EMAILS = []


class _CaptureEmail:
    def send(self, *, to, subject, text_body, html_body=None, reply_to=None):
        EMAILS.append({"to": to, "subject": subject, "text": text_body, "html": html_body})
        return True


class _CapturePush:
    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        PUSHES.append({"tokens": list(tokens), "title": title, "body": body,
                       "data": dict(data or {}), "ttl": ttl_seconds})
        return []


def main() -> int:
    from datetime import date, datetime
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.email_service as es
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import (CitizenAccount, DeviceToken, ElectionReminderDelivery, Notification,
                                  TrackedElection)
    from app.services import election_reminders as er

    ps._service = _CapturePush()
    es.get_email_service = lambda: _CaptureEmail()
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
    check("7 nobody in a state without sourced dates gets one (an Ohio citizen tracking nothing)",
          not bell(oh.id))
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
    covered = er.covered_states(today=date(2026, 10, 1))
    check("7 the states covered come from the data: those whose files have sourced reminder dates",
          covered == sorted(s for s, d in er._load_state_docs().items() if d.get("key_date_sources")), covered)
    uncovered = {n.recipient_id for n in
                 db.query(Notification).filter(Notification.kind == "election_reminder").all()
                 if db.get(CitizenAccount, n.recipient_id).state not in covered}
    check("7 nobody in a state without sourced dates got one, except by tracking an election",
          uncovered == {oh_tracker.id}, uncovered)

    # A state whose file gains sourced dates is covered with no code
    # change. Test-only Ohio data (not real dates), as if a later session
    # had added data/oh/elections.json in the documented format.
    real_docs = er._load_state_docs()
    test_oh = {
        "state": "OH", "state_name": "Ohio", "cycle": "2026",
        "key_dates": {"general": "2026-11-03", "voter_registration_deadline_general": "2026-10-05"},
        "key_date_sources": {"general": "https://www.ohiosos.gov/test-only-source",
                             "voter_registration_deadline_general": "https://www.ohiosos.gov/test-only-source"},
        "key_date_retrieved": {"general": "2026-10-15", "voter_registration_deadline_general": "2026-10-15"},
        "voter_info": {"official_site": "https://www.ohiosos.gov/",
                       "poll_hours": {"open": "06:30", "close": "19:30", "retrieved": "2026-10-15",
                                      "source_url": "https://www.ohiosos.gov/test-only-source"}},
    }
    loader = er._load_state_docs
    er._load_state_docs = lambda: {**real_docs, "OH": test_oh}
    try:
        check("7 Ohio is covered once its file has sourced dates",
              "OH" in er.covered_states(today=date(2026, 10, 1)))
        run("2026-11-02T16:00:00")
        oh_rows = bell(oh.id)
        oh_now = {json.loads(n.payload_json)["reminder_id"] for n in oh_rows}
        check("7 ... and its citizens get its reminders, with no code change",
              oh_now == {"oh-2026-11-03-election-day-1d"}, oh_now)
        check("7 ... with the state's own poll hours",
              bool(oh_rows) and "6:30 a.m. to 7:30 p.m." in json.loads(oh_rows[0].payload_json)["body"])
    finally:
        er._load_state_docs = loader

    # ── 6b. A citizen turns them off, then on ────────────────────────
    quiet = fh.make_citizen(db, "Quinn Off", "quinn@example.org", state="NY", district="NY-12", city="")
    r = client.post("/api/election-reminders/off", headers=fh.citizen_headers(quiet))
    check("6 one tap turns election reminders off", r.status_code == 200 and r.json()["enabled"] is False, r.text)
    run("2026-10-23T15:00:00")  # NY registration 1d + early voting 1d
    check("6 a citizen who turned them off gets none", not bell(quiet.id))
    r = client.get("/api/election-reminders/settings", headers=fh.citizen_headers(quiet))
    check("6 settings report off and the covered states",
          r.status_code == 200 and r.json() == {"enabled": False, "covered_states": ["CA", "FL", "NY", "PA", "TX"],
                                                "your_state_covered": True, "email": False,
                                                "email_available": True}, r.text)
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
        os.environ["ELECTION_REMINDERS_NOW"] = TEST_NOW

    # ── 9. "I already voted" ─────────────────────────────────────────
    voter = fh.make_citizen(db, "Vera Voter", "vera@example.org", state="CA", district="CA-11", city="")
    db.add(TrackedElection(tracker_kind="citizen", tracker_id=voter.id, election_key="2026-general",
                           snapshot_json=json.dumps({"state": "FL", "date": "2026-11-03"}), prefs_json="{}"))
    db.commit()
    r = client.post("/api/election-reminders/voted", json={"reminder_id": ca_reg3}, headers=fh.citizen_headers(voter))
    check("9 I already voted: accepted for California's election",
          r.status_code == 200 and r.json() == {"voted": True, "state": "CA", "election_key": "2026-general"}, r.text)
    r = client.post("/api/election-reminders/voted", json={"reminder_id": ca_reg3}, headers=fh.citizen_headers(voter))
    check("9 a second tap is harmless", r.status_code == 200, r.text)
    run("2026-10-18T18:00:00")
    check("9 no more California reminders", not bell(voter.id, "ca-2026-11-03-registration-1d"))
    run("2026-10-19T15:00:00")
    check("9 the other election it tracks (Florida) carries on",
          len(bell(voter.id, "fl-2026-11-03-mail-request-3d")) == 1)
    r = client.post("/api/election-reminders/voted", json={"reminder_id": ca_reg3, "voted": False},
                    headers=fh.citizen_headers(voter))
    check("9 undo", r.status_code == 200 and r.json()["voted"] is False, r.text)
    run("2026-11-02T15:00:00")
    check("9 after undo, California reminders resume", len(bell(voter.id, "ca-2026-11-03-election-day-1d")) == 1)
    r = client.post("/api/election-reminders/voted", json={"reminder_id": "zz-2020-11-03-registration-3d"},
                    headers=fh.citizen_headers(voter))
    check("9 an unknown or past reminder: 404", r.status_code == 404, r.status_code)
    check("9 signed out: 401",
          client.post("/api/election-reminders/voted", json={"reminder_id": ca_reg3}).status_code == 401)

    # ── 10. Opt-in email ─────────────────────────────────────────────
    emma = fh.make_citizen(db, "Emma Mailer", "emma@example.org", state="PA", district="PA-07", city="")
    nolan = fh.make_citizen(db, "Nolan Nomail", "nolan@example.org", state="PA", district="PA-08", city="")
    demo = fh.make_citizen(db, "Dana Demo", "dana@demo-citizens.civicview.app", state="PA", district="PA-09", city="")
    r = client.put("/api/election-reminders/settings", json={"email": True}, headers=fh.citizen_headers(emma))
    check("10 a citizen turns on reminder emails", r.status_code == 200 and r.json()["email"] is True, r.text)
    r = client.put("/api/election-reminders/settings", json={"email": True}, headers=fh.citizen_headers(demo))
    check("10 a demo address cannot: 409", r.status_code == 409, r.status_code)
    r = client.get("/api/election-reminders/settings", headers=fh.citizen_headers(demo))
    check("10 settings tell the app a demo address gets no email", r.json().get("email_available") is False, r.text)
    EMAILS.clear()
    run("2026-10-24T15:00:00")  # Pennsylvania mail request, 11 a.m. Eastern
    pa_mail = "pa-2026-11-03-mail-request-3d"
    check("10 everyone in Pennsylvania gets the bell row",
          all(len(bell(c.id, pa_mail)) == 1 for c in (emma, nolan, demo)))
    to = [e["to"] for e in EMAILS]
    check("10 only the citizen who opted in gets the email", to == ["emma@example.org"], to)
    mail = EMAILS[0] if EMAILS else {"subject": "", "text": "", "html": ""}
    rem = {r.id: r for r in er.build_schedule(today=date(2026, 10, 1)).reminders}[pa_mail]
    check("10 subject and sentence match the bell row",
          mail["subject"] == rem.title and rem.body in mail["text"], mail["subject"])
    check("10 the email has the official link, the source and the settings link",
          rem.link_url in mail["text"] and rem.source_url in mail["text"] and er.SETTINGS_URL in mail["text"]
          and er.SETTINGS_URL in mail["html"] and rem.link_url in mail["html"])
    check("10 no dashes in the email", not re.search("[\u2013\u2014]", mail["text"] + mail["html"]))
    db.expire_all()
    row = db.query(ElectionReminderDelivery).filter(ElectionReminderDelivery.reminder_id == pa_mail,
                                                    ElectionReminderDelivery.citizen_id == emma.id).one()
    check("10 the delivery records the email", row.email_sent_at is not None)
    client.put("/api/election-reminders/settings", json={"email": False}, headers=fh.citizen_headers(emma))
    EMAILS.clear()
    run("2026-11-02T15:00:00")
    check("10 turned off: the bell row still comes, the email does not",
          len(bell(emma.id, "pa-2026-11-03-election-day-1d")) == 1 and not EMAILS, [e["to"] for e in EMAILS])

    # ── 11. Future elections from the data ───────────────────────────
    fl_doc = json.load(open(os.path.join(os.path.dirname(__file__), "..", "app", "data", "fl", "elections.json")))
    future = {"FL": {
        "state": "FL", "state_name": "Florida", "cycle": "2028",
        "key_dates": {"primary": "2028-08-15", "general": "2028-11-07",
                      "voter_registration_deadline_primary": "2028-07-17",
                      "voter_registration_deadline_general": "2028-10-10",
                      "vote_by_mail_request_deadline_general": "2028-10-26"},
        "key_date_sources": {"primary": "https://dos.fl.gov/elections/for-voters/election-dates/",
                             "general": "https://dos.fl.gov/elections/for-voters/election-dates/",
                             "voter_registration_deadline_primary": "https://dos.fl.gov/elections/",
                             "voter_registration_deadline_general": "https://dos.fl.gov/elections/",
                             "early_voting_window_general": "https://dos.fl.gov/elections/"},
        # early_voting_window_general has a source but no retrieved date.
        "key_date_retrieved": {"primary": "2028-01-02", "general": "2028-01-02",
                               "voter_registration_deadline_primary": "2028-01-02",
                               "voter_registration_deadline_general": "2028-01-02"},
        "voter_info": fl_doc["voter_info"],
    }}
    future["FL"]["key_dates"]["early_voting_window_general"] = "2028-10-28 to 2028-11-04"
    fut = er.build_schedule(today=date(2028, 1, 1), docs=future)
    fut_ids = {r.id for r in fut.reminders}
    check("11 a 2028 primary and general get their reminders",
          {"fl-2028-08-15-registration-3d", "fl-2028-08-15-election-day-1d",
           "fl-2028-11-07-registration-1d", "fl-2028-11-07-election-day-1d"} <= fut_ids, sorted(fut_ids))
    check("11 tracked-election keys follow the cycle",
          {r.election_key for r in fut.reminders} == {"2028-primary", "2028-general"})
    check("11 a date without a source is not sent, and says why",
          "fl-2028-11-07-mail-request-3d" not in fut_ids
          and any(s.kind == "mail_request_3d" and "source" in s.reason for s in fut.skipped))
    check("11 a source without its retrieved date is not sent, and says why",
          "fl-2028-11-07-early-voting-1d" not in fut_ids
          and any(s.kind == "early_voting_1d" and "retrieved" in s.reason for s in fut.skipped))

    db.close()
    client.__exit__(None, None, None)
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
