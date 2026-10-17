# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""The daily bill update pass (2026-10-17): services/bill_updates.py.

Run:  cd backend && python3 tests/test_bill_updates.py   (exit 0 = pass)

Congress.gov is faked; nothing here reaches the network.

  1. Only federal bill keys are checked, each once however many follow it.
  2. The first look at a bill records it and sends nothing (no backlog).
  3. A change: a status change, a recorded vote or another action, from
     the new actions; one bell row per tracker, a push on the Bills
     channel tagged so a newer update replaces the older one, and one
     email per person who chose email (never a demo address), with its
     own one-click unsubscribe.
  4. My Tracked shows the new status for everyone tracking the bill.
  5. Once per person: running the delivery again sends nothing.
  6. The Bill updates row decides (Off: nothing).
  7. Schedule: due once a day after 9 a.m. Eastern; off outside
     production unless BILL_UPDATES_ENABLED says so.
  8. A failed fetch is counted, not fatal. No dashes in what is sent.
"""
import asyncio
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

MESSAGES = []
EMAILS = []


class _CapturePush:
    def send_messages(self, messages):
        from app.services.push_service import SendResult
        MESSAGES.extend(messages)
        return SendResult(sent={m.token for m in messages})

    def send_to_tokens(self, tokens, **_kw):
        return []

    def subscribe_to_topic(self, tokens, topic):
        pass

    def unsubscribe_from_topic(self, tokens, topic):
        pass


class _CaptureEmail:
    def send(self, *, to, subject, text_body, html_body=None, headers=None, **_kw):
        EMAILS.append({"to": to, "subject": subject, "text": text_body, "html": html_body, "headers": headers or {}})
        return True


STATE = {
    "119-hr-1": {"title": "An act about roads", "latest_date": "2026-10-01", "latest_text": "Referred to committee."},
    "119-s-5": {"title": "An act about water", "latest_date": "2026-09-20", "latest_text": "Introduced in Senate."},
}
ACTIONS = {"119-hr-1": [], "119-s-5": [], "119-sres-9": []}
CALLS = []
FAIL = set()


async def fake_fetch(congress, bill_type, number):
    key = f"{congress}-{bill_type}-{number}"
    CALLS.append(key)
    if key in FAIL:
        raise RuntimeError("Congress.gov is down")
    return dict(STATE[key])


async def fake_actions(congress, bill_type, number):
    return list(ACTIONS[f"{congress}-{bill_type}-{number}"])


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m

    with TestClient(m.app):  # boot: creates the tables
        return _run()


def _run() -> int:
    import app.services.email_service as es
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import (BillUpdate, BillWatch, DeviceToken, JobRun, Notification, TrackedBill)
    from app.services import alert_settings as als
    from app.services import bill_updates as bu

    ps._service = _CapturePush()
    es.get_email_service = lambda: _CaptureEmail()
    check = fh.Checks()
    db = SessionLocal()

    def run():
        return asyncio.run(bu.run_pass(force=True, fetch=fake_fetch, fetch_acts=fake_actions))

    def bell(cid):
        db.expire_all()
        return db.query(Notification).filter(Notification.recipient_id == cid,
                                             Notification.kind == "bill_update").all()

    ana = fh.make_citizen(db, "Ana Bills", "ana@example.org")
    ben = fh.make_citizen(db, "Ben Bills", "ben@example.org", district="FL-12")
    cy = fh.make_citizen(db, "Cy Demo", "cy@demo-citizens.civicview.app")
    for cit, keys in ((ana, ["119-hr-1", "119-s-5"]), (ben, ["119-hr-1"]), (cy, ["119-hr-1"])):
        for k in keys:
            db.add(TrackedBill(tracker_kind="citizen", tracker_id=cit.id, bill_key=k,
                               snapshot_json=json.dumps({"citation": k})))
    # Not federal keys: never checked.
    db.add(TrackedBill(tracker_kind="citizen", tracker_id=ana.id, bill_key="ocd-bill/1234-abcd", snapshot_json="{}"))
    db.add(TrackedBill(tracker_kind="citizen", tracker_id=ana.id, bill_key="not a bill", snapshot_json="{}"))
    db.add(DeviceToken(token="tok-ana", citizen_id=ana.id, app_build=5))
    db.add(DeviceToken(token="tok-ben", citizen_id=ben.id, app_build=4))
    db.commit()
    als.set_choice(db, ana, "bills", "bell_push_email")
    als.set_choice(db, cy, "bills", "bell_push_email")

    # ── 1, 2. first look ─────────────────────────────────────────────
    res = run()
    check("1 only federal keys, each bill once", sorted(CALLS) == ["119-hr-1", "119-s-5"], CALLS)
    check("2 the first look records and sends nothing", res.get("seeded") == 2 and res.get("updates") == 0
          and not bell(ana.id) and not MESSAGES and not EMAILS, res)
    check("2 the watch rows hold what Congress.gov said",
          db.query(BillWatch).filter(BillWatch.bill_key == "119-hr-1").one().latest_action_text == "Referred to committee.")

    # ── 3. a change ──────────────────────────────────────────────────
    STATE["119-hr-1"].update(latest_date="2026-10-15", latest_text="Passed/agreed to in House: On passage Passed by recorded vote.")
    ACTIONS["119-hr-1"] = [
        {"actionDate": "2026-10-15", "text": "Passed/agreed to in House: On passage Passed by recorded vote.",
         "type": "Floor", "recordedVotes": [{"rollNumber": 301}]},
        {"actionDate": "2026-10-15", "text": "Passed/agreed to in House: On passage Passed by recorded vote.",
         "type": "Floor"},
        {"actionDate": "2026-10-14", "text": "Considered under the rule.", "type": "Floor"},
        {"actionDate": "2026-10-01", "text": "Referred to committee.", "type": "IntroReferral"},
    ]
    STATE["119-s-5"].update(latest_date="2026-10-10", latest_text="Committee on Environment. Hearings held.")
    ACTIONS["119-s-5"] = [{"actionDate": "2026-10-10", "text": "Committee on Environment. Hearings held.",
                           "type": "Committee"}]
    CALLS.clear()
    res = run()
    check("3 two bills changed", res.get("updates") == 2, res)
    a_rows = bell(ana.id)
    p = {json.loads(n.payload_json)["bill_key"]: json.loads(n.payload_json) for n in a_rows}
    check("3 a bell row per bill per tracker", len(a_rows) == 2 and len(bell(ben.id)) == 1 and len(bell(cy.id)) == 1)
    check("3 passing a chamber is a status change", p["119-hr-1"]["change_kind"] == "status", p["119-hr-1"])
    check("3 the new actions only, one per date and text",
          p["119-hr-1"]["more"] == 1 and p["119-hr-1"]["action"].startswith("Passed/agreed to in House"), p["119-hr-1"])
    check("3 a hearing is a new action", p["119-s-5"]["change_kind"] == "action")
    check("3 the citation and the Congress.gov page", p["119-hr-1"]["citation"] == "H.R. 1"
          and p["119-hr-1"]["url"] == "https://www.congress.gov/bill/119th-congress/house-bill/1")
    pushes = [m for m in MESSAGES if m.data.get("kind") == "bill_update"]
    ana_push = [m for m in pushes if m.token == "tok-ana" and m.data["bill_key"] == "119-hr-1"]
    check("3 the push: Bills channel, tagged per bill, with its bell row",
          len(ana_push) == 1 and ana_push[0].channel == "bills" and ana_push[0].tag == "bill-119-hr-1"
          and ana_push[0].native and ana_push[0].data.get("notification_id") in {n.id for n in a_rows},
          [vars(x) for x in pushes])
    check("3 the push says what happened", ana_push and ana_push[0].title == "H.R. 1: status change"
          and "(and 1 more)" in ana_push[0].body, ana_push and ana_push[0].body)
    check("3 Ben's 1.1.0 phone gets the standard message", any(m.token == "tok-ben" and not m.native for m in pushes))
    check("3 one email, to the person who chose it, never a demo address",
          [e["to"] for e in EMAILS] == ["ana@example.org"], EMAILS)
    email = EMAILS[0] if EMAILS else {}
    check("3 the email lists both bills", email.get("subject") == "Updates on 2 bills you track"
          and "H.R. 1" in email.get("text", "") and "S. 5" in email.get("text", ""), email.get("subject"))
    check("3 with its own one-click unsubscribe", "List-Unsubscribe" in email.get("headers", {})
          and "/unsubscribe?token=" in email.get("text", ""))
    check("3 no dashes in the email or the push",
          not any(ch in (email.get("text", "") + email.get("subject", "") + "".join(m.title + m.body for m in pushes))
                  for ch in ("\u2013", "\u2014")))

    # ── 4. My Tracked ────────────────────────────────────────────────
    db.expire_all()
    snaps = [json.loads(r.snapshot_json) for r in db.query(TrackedBill).filter(TrackedBill.bill_key == "119-hr-1")]
    check("4 every tracker's snapshot shows the new status",
          len(snaps) == 3 and all(s["latest_action_date"] == "2026-10-15" for s in snaps), snaps)

    # ── 5. once per person ───────────────────────────────────────────
    update = db.query(BillUpdate).filter(BillUpdate.bill_key == "119-hr-1").one()
    again = bu.deliver(db, update, json.loads(update.payload_json), {})
    check("5 running the delivery again sends nothing", again["claimed"] == 0 and again["already"] == 3, again)
    MESSAGES.clear()
    EMAILS.clear()
    res = run()
    check("5 an unchanged bill: nothing", res.get("updates") == 0 and res.get("unchanged") == 2
          and not MESSAGES and not EMAILS, res)

    # ── 6. the Bill updates row ──────────────────────────────────────
    als.set_choice(db, db.get(type(ben), ben.id), "bills", "off")
    STATE["119-hr-1"].update(latest_date="2026-10-16", latest_text="Received in the Senate.")
    ACTIONS["119-hr-1"] = [{"actionDate": "2026-10-16", "text": "Received in the Senate.", "type": "IntroReferral"}]
    res = run()
    check("6 Off: no bell row for Ben", len(bell(ben.id)) == 1 and len(bell(ana.id)) == 3, res)
    check("6 a vote action is a recorded vote",
          bu.classify({"text": "On the cloture motion", "recordedVotes": [{}]}) == "vote")
    check("6 became law is a status change", bu.classify({"text": "Became Public Law No: 119-12.", "type": "BecameLaw"})
          == "status")
    for text in ("Motion to reconsider laid on the table Agreed to without objection.",
                 "On agreeing to the Smith amendment (A001) Agreed to by voice vote.",
                 "S.Amdt.1234 Amendment SA 1234 agreed to in Senate by Unanimous Consent.",
                 "Amendment SA 1234 agreed to in Senate by Voice Vote.",
                 "On agreeing to the Jones amendment Failed by recorded vote: 200 - 220."):
        check(f"6 not a status change: {text[:40]}", bu.classify({"text": text, "type": "Floor"}) == "action")
    for text in ("Resolution agreed to in Senate without amendment and with a preamble by Unanimous Consent.",
                 "Passed Senate without amendment by Unanimous Consent.",
                 "On passage Failed by the Yeas and Nays: 200 - 220 (Roll no. 400)."):
        check(f"6 a status change: {text[:40]}", bu.classify({"text": text, "type": "Floor"}) == "status")

    # ── 6b. first look records every action of the latest day ──────
    STATE["119-sres-9"] = {"title": "A resolution about a week", "latest_date": "2026-10-16",
                           "latest_text": "Referred to the Committee on the Judiciary."}
    ACTIONS["119-sres-9"] = [
        {"actionDate": "2026-10-16", "text": "Referred to the Committee on the Judiciary.", "type": "IntroReferral"},
        {"actionDate": "2026-10-16", "text": "Submitted in the Senate.", "type": "IntroReferral"},
    ]
    db.add(TrackedBill(tracker_kind="citizen", tracker_id=ana.id, bill_key="119-sres-9",
                       snapshot_json=json.dumps({"citation": "S.Res. 9"})))
    db.commit()
    res = run()
    check("6b a newly tracked bill is seeded, nothing sent", res.get("seeded") == 1 and res.get("updates") == 0, res)
    STATE["119-sres-9"].update(latest_text="Resolution agreed to in Senate without amendment by Unanimous Consent.")
    ACTIONS["119-sres-9"].insert(0, {"actionDate": "2026-10-16", "type": "Floor",
                                     "text": "Resolution agreed to in Senate without amendment by Unanimous Consent."})
    res = run()
    sres = [json.loads(n.payload_json) for n in bell(ana.id) if json.loads(n.payload_json)["bill_key"] == "119-sres-9"]
    check("6b a same-day change lists only what is new since the first look",
          len(sres) == 1 and sres[0]["more"] == 0 and sres[0]["change_kind"] == "status"
          and sres[0]["action"].startswith("Resolution agreed to"), sres)

    # ── 7. schedule ──────────────────────────────────────────────────
    check("7 not due before 9 a.m. Eastern", bu.due_run_key(db, datetime(2026, 10, 20, 12, 30)) is None)
    key = bu.due_run_key(db, datetime(2026, 10, 20, 13, 30))
    check("7 due after 9 a.m. Eastern", key == "2026-10-20", key)
    check("7 claimed once a day", bu.claim_run(db, key) is not None and bu.claim_run(db, key) is None
          and bu.due_run_key(db, datetime(2026, 10, 20, 20, 0)) is None)
    check("7 the runs are recorded", db.query(JobRun).filter(JobRun.job == "bill-updates").count() >= 4)
    os.environ.pop("BILL_UPDATES_ENABLED", None)
    check("7 off outside production", bu.updates_enabled() is False)
    os.environ["BILL_UPDATES_ENABLED"] = "true"
    check("7 the switch turns it on", bu.updates_enabled() is True)
    os.environ.pop("BILL_UPDATES_ENABLED", None)
    no_key = asyncio.run(bu.run_pass(force=True))
    check("7 without CONGRESS_API_KEY the real pass does nothing", no_key.get("skipped") == "CONGRESS_API_KEY is not set",
          no_key)

    # ── 8. a failed fetch ────────────────────────────────────────────
    FAIL.add("119-s-5")
    res = run()
    check("8 a failed fetch is counted, not fatal", res.get("errors") == 1 and "error" not in res, res)
    status = bu.status(db)
    check("8 the admin view", status["tracked_bills"] == 3 and status["watched_bills"] == 3
          and status["updates_last_7_days"] >= 3, status)

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
