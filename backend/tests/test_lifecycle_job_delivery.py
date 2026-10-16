# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""The former-pages job sends each notice once, safely (2026-10-16).

Run:  cd backend && python3 tests/test_lifecycle_job_delivery.py   (exit 0 = pass)

services/page_lifecycle_job.py used to email inside its loop and commit
once at the end (a failure resent everything), claim nothing (two
instances during a deploy could both send), run synchronously at boot,
and email suspended, self-deleted and closed accounts.

  1. Preview: what would go out, to how many, how many by email; it
     sends and writes nothing.
  2. Run: the preview's numbers are what was sent.
  3. Per-recipient claims: another instance's claim is respected; a
     second run sends nothing.
  4. A failure part way through: what was sent stays sent, the rest
     goes on the next run, nobody gets two.
  5. The per-pass limit: the rest waits for the next pass, and the
     notice is stamped only when everyone is done.
  6. Suspended, self-deleted and closed accounts get nothing; an
     inactive owner gets nothing either.
  7. Batches: a pause between batches when the loop runs it.
  8. The loop's lock: a second instance steps aside.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

SENT = []


class _CaptureEmail:
    def send(self, *, to, subject, text_body, html_body=None, reply_to=None, **_kw):
        SENT.append({"to": to, "subject": subject})
        return True


def main() -> int:
    from datetime import UTC, datetime
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.email_service as es
    from app.db import SessionLocal
    from app.models.pages import Notification, PageNoticeDelivery, PageTransition, TrackedOfficial
    from app.services import page_lifecycle_job as job

    es.get_email_service = lambda: _CaptureEmail()
    check = fh.Checks()
    db = SessionLocal()

    def notes(kind, rid, nkind):
        db.expire_all()
        return db.query(Notification).filter(Notification.recipient_kind == kind,
                                             Notification.recipient_id == rid,
                                             Notification.kind == nkind).count()

    def track(cit, key):
        db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=cit.id, official_key=key))
        db.commit()

    def left(c, page, name):
        fh.set_transition(c, db, page_id=page, page_kind="official", event="left_office", event_on=fh.days(0),
                          office_label="State Senator, Florida District 90", served_from="2018", served_to="2026",
                          display_name=name)

    with TestClient(m.app) as c:
        admin = fh.admin_headers(db)
        trackers = [fh.make_citizen(db, f"Tracker {i}", f"t{i}@example.org", district=f"FL-{10 + i}")
                    for i in range(5)]

        # ── 1. preview ───────────────────────────────────────────────
        page = "tst-sen-90"
        fh.make_rep(db, page, "Riley Owner", "riley@example.org")
        for t in trackers:
            track(t, page)
        left(c, page, "Riley Owner")
        before_rows = db.query(PageTransition).count()
        SENT.clear()
        r = c.get("/api/admin/transitions/run/preview", headers=admin)
        check("1 preview answers", r.status_code == 200, r.text)
        pv = r.json()
        mine = [i for i in pv["items"] if i["page_id"] == page]
        by = {i["notice"]: i for i in mine}
        check("1 the person's notice and the trackers' notice", set(by) == {"person_left", "trackers"}, by)
        check("1 counts: 5 trackers, 5 by email", by.get("trackers", {}).get("recipients") == 5
              and by["trackers"]["emails"] == 5 and by["trackers"]["bell"] == 5, by.get("trackers"))
        check("1 subject and text shown", by["trackers"]["subject"] == "Riley Owner is no longer in office"
              and by["trackers"]["text"].startswith("Riley Owner left office"), by["trackers"])
        check("1 nothing sent", not SENT and notes("citizen", trackers[0].id, "tracked_left_office") == 0)
        check("1 nothing written", db.query(PageNoticeDelivery).count() == 0
              and db.query(PageTransition).count() == before_rows)
        r = c.get("/api/admin/transitions/run/preview", headers=fh.citizen_headers(trackers[0]))
        check("1 admins only", r.status_code == 403, r.status_code)

        # ── 2. run ───────────────────────────────────────────────────
        r = c.post("/api/admin/transitions/run", headers=admin)
        out = r.json()
        check("2 the run sends what the preview said",
              out["tracker_notices"] >= 5 and all(notes("citizen", t.id, "tracked_left_office") == 1 for t in trackers),
              out)
        check("2 emails went out", sum(1 for e in SENT if e["subject"] == "Riley Owner is no longer in office") == 5, SENT)

        # ── 3. claims ────────────────────────────────────────────────
        SENT.clear()
        c.post("/api/admin/transitions/run", headers=admin)
        check("3 a second run sends nothing",
              not SENT and all(notes("citizen", t.id, "tracked_left_office") == 1 for t in trackers))
        page2 = "tst-sen-91"
        for t in trackers[:3]:
            track(t, page2)
        left(c, page2, "Sky Second")
        # Another instance already claimed tracker 0.
        db.add(PageNoticeDelivery(page_id=page2, notice="trackers", recipient_kind="citizen",
                                  recipient_id=trackers[0].id))
        db.commit()
        SENT.clear()
        job.run_page_lifecycle(db)
        check("3 another instance's claim is respected",
              notes("citizen", trackers[0].id, "tracked_left_office") == 1          # only page 1's
              and notes("citizen", trackers[1].id, "tracked_left_office") == 2)

        # ── 4. a failure part way through ────────────────────────────
        def counts():
            return [notes("citizen", t.id, "tracked_left_office") for t in trackers]

        page3 = "tst-sen-92"
        for t in trackers:
            track(t, page3)
        left(c, page3, "Fin Third")
        base = counts()
        real_send = job._send_email
        calls = {"n": 0}

        def flaky(plan, acct):
            calls["n"] += 1
            if plan.page_id == page3 and calls["n"] == 3:
                raise SystemExit("simulated crash")   # not an Exception: stops the pass like a killed process
            return real_send(plan, acct)

        job._send_email = flaky
        try:
            job.run_page_lifecycle(db)
        except BaseException:
            db.rollback()
        job._send_email = real_send
        got = [n - b for n, b in zip(counts(), base)]
        check("4 what went out before the failure stayed (committed per person)",
              got.count(1) >= 2 and got.count(0) >= 1 and set(got) <= {0, 1}, got)
        row = db.query(PageTransition).filter(PageTransition.page_id == page3).one()
        check("4 the notice is not stamped done", row.trackers_notice_at is None)
        job.run_page_lifecycle(db)
        got = [n - b for n, b in zip(counts(), base)]
        check("4 the next run finishes, nobody gets two", got == [1] * 5, got)
        db.expire_all()
        check("4 now stamped", db.query(PageTransition).filter(PageTransition.page_id == page3).one()
              .trackers_notice_at is not None)

        # ── 5. per-pass limit ────────────────────────────────────────
        page4 = "tst-sen-93"
        for t in trackers:
            track(t, page4)
        left(c, page4, "Lim Fourth")
        base = counts()
        out = job.run_page_lifecycle(db, max_recipients=2)
        row = db.query(PageTransition).filter(PageTransition.page_id == page4).one()
        got = [n - b for n, b in zip(counts(), base)]
        check("5 the limit stops the pass and says so", out["work_left"] is True and sum(got) == 2, (out, got))
        check("5 not stamped until everyone is done", row.trackers_notice_at is None)
        out = job.run_page_lifecycle(db)
        got = [n - b for n, b in zip(counts(), base)]
        check("5 the next pass finishes", got == [1] * 5 and out["work_left"] is False, (out, got))

        # ── 6. accounts that get nothing ─────────────────────────────
        page5 = "tst-sen-94"
        owner = fh.make_rep(db, page5, "Cleo Closed", "cleo@example.org")
        owner.closed_at = datetime.now(UTC).replace(tzinfo=None)
        sus = fh.make_citizen(db, "Sue Suspended", "sue@example.org", district="FL-20")
        sus.suspended_at = datetime.now(UTC).replace(tzinfo=None)
        gone = fh.make_citizen(db, "Gil Leaving", "gil@example.org", district="FL-21")
        gone.self_deleted_at = datetime.now(UTC).replace(tzinfo=None)
        ok = fh.make_citizen(db, "Ola Open", "ola@example.org", district="FL-22")
        db.commit()
        for t in (sus, gone, ok):
            track(t, page5)
        left(c, page5, "Cleo Closed")
        SENT.clear()
        out = job.run_page_lifecycle(db)
        check("6 a suspended account gets nothing", notes("citizen", sus.id, "tracked_left_office") == 0
              and not any(e["to"] == "sue@example.org" for e in SENT))
        check("6 a self-deleted account gets nothing", notes("citizen", gone.id, "tracked_left_office") == 0
              and not any(e["to"] == "gil@example.org" for e in SENT))
        check("6 a closed owner gets nothing", notes("rep", owner.id, "office_ended") == 0
              and not any(e["to"] == "cleo@example.org" for e in SENT))
        check("6 an open account still does", notes("citizen", ok.id, "tracked_left_office") == 1
              and any(e["to"] == "ola@example.org" for e in SENT))
        check("6 counted", out["skipped_accounts"] == 3, out)

        # ── 7. batches ───────────────────────────────────────────────
        page6 = "tst-sen-95"
        for t in trackers:
            track(t, page6)
        left(c, page6, "Bat Sixth")
        sleeps = []
        real_sleep, real_batch = job.time.sleep, job.BATCH_SIZE
        job.time.sleep = lambda s: sleeps.append(s)
        job.BATCH_SIZE = 2
        try:
            job.run_page_lifecycle(db, pause_seconds=0.5)
        finally:
            job.time.sleep, job.BATCH_SIZE = real_sleep, real_batch
        check("7 a pause between batches of 2 for 5 trackers", sleeps == [0.5, 0.5], sleeps)

        # ── 8. the loop's lock ───────────────────────────────────────
        from app.services.db_locks import AdvisoryLock
        held = AdvisoryLock(job.LOCK_NAME)
        check("8 setup: lock taken", held.try_acquire())
        try:
            res = job.run_pass_with_session()
        finally:
            held.release()
        check("8 a second instance steps aside", "skipped" in res, res)

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
