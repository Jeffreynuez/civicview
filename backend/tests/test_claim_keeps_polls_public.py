"""Claiming a page keeps the citizen polls on it public (audit P4).

Run:  cd backend && python3 tests/test_claim_keeps_polls_public.py   (exit 0 = pass)

Before: active citizen polls were archived at claim time and the
archive was returned only to the page owner, so the polls citizens ran
about an official vanished when that official joined.

Now: they close to new votes (archived, reason rep_claimed) and every
viewer still gets them in the page listing, with results. The owner's
"hide" changes only the owner's view. Voting on them is refused.
"""
import os
import sys
import tempfile
from datetime import datetime, timezone


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, Poll, PollOption, RepAccount
    from app.schemas.pages import POLL_REPORT_REASONS
    from app.services.citizen_polls_service import archive_polls_for_claim

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    oid = "claim-test-official"
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            cit = CitizenAccount(email="asker@example.com", password_hash="x", display_name="Asker",
                                 city="Orlando", state="FL", congressional_district="FL-10", is_active=True)
            db.add(cit)
            db.flush()
            poll = Poll(post_id=None, question="Should the official hold a town hall?", author_kind="citizen",
                        author_citizen_id=cit.id, target_official_id=oid,
                        default_visibility_scope="country", presentation_mode="full", created_at=now)
            db.add(poll)
            db.flush()
            db.add(PollOption(poll_id=poll.id, text="Yes", sort_order=0))
            db.commit()
            poll_id = poll.id

        r = c.get(f"/api/pages/{oid}/citizen-polls").json()
        check(len(r.get("active", [])) == 1, "before claim the poll is active")

        with SessionLocal() as db:
            rep = RepAccount(email="official@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="The Official", official_id=oid, is_active=True)
            db.add(rep)
            db.flush()
            archive_polls_for_claim(db, oid)
            db.commit()
            rep_id = rep.id

        c.cookies.clear()
        r = c.get(f"/api/pages/{oid}/citizen-polls").json()
        check(r.get("page_claimed") is True, "page should read as claimed")
        ids = [p["id"] for p in r.get("archived", [])]
        check(ids == [poll_id], f"anonymous viewer should still see the pre-claim poll, got {ids}")

        # owner hides it from their own view; public unaffected
        tok = issue_session_token(rep_id)
        h = {"Authorization": f"Bearer {tok}", "X-CSRF-Token": compute_csrf_token(tok)}
        c.cookies.clear()
        r = c.post(f"/api/pages/{oid}/citizen-polls/dismiss-archive", headers=h)
        check(r.status_code == 200, f"owner dismiss {r.status_code}")
        c.cookies.clear()
        r = c.get(f"/api/pages/{oid}/citizen-polls", headers={"Authorization": f"Bearer {tok}"}).json()
        check(r.get("archived") == [], "owner's own view should be empty after hiding")
        c.cookies.clear()
        r = c.get(f"/api/pages/{oid}/citizen-polls").json()
        check([p["id"] for p in r.get("archived", [])] == [poll_id], "public view must not change when the owner hides")

        # closed to new votes
        s = c.post("/api/citizen-auth/demo-signup", json={
            "display_name": "Late Voter", "state": "FL", "congressional_district": "FL-10", "city": "Orlando"})
        vt = s.json()["citizen_token"]
        with SessionLocal() as db:
            opt_id = db.query(PollOption).filter_by(poll_id=poll_id).first().id
        c.cookies.clear()
        r = c.post(f"/api/citizen-polls/{poll_id}/vote", json={"option_id": opt_id},
                   headers={"X-Citizen-Token": vt, "X-CSRF-Token": compute_csrf_token(vt)})
        check(r.status_code >= 400, f"voting on a claimed-page poll should be refused, got {r.status_code}")

        # Takedown still works on a pre-claim poll (review finding on P4):
        # a report plus an admin Hide must actually hide it, and Unhide
        # must put it back closed and public, not open for votes.
        from app.models.pages import PollReport
        os.environ["ADMIN_EMAILS"] = "admin.person@example.com"
        with SessionLocal() as db:
            adm = RepAccount(email="admin.person@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Admin", official_id="admin-test-official", is_active=True)
            db.add(adm)
            db.commit()
            adm_id = adm.id
        at = issue_session_token(adm_id)
        ah = {"Authorization": f"Bearer {at}", "X-CSRF-Token": compute_csrf_token(at)}
        c.cookies.clear()
        r = c.post(f"/api/citizen-polls/{poll_id}/report", json={"reason": POLL_REPORT_REASONS[0]}, headers=h)
        check(r.status_code == 200, f"rep report on pre-claim poll {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            rid = db.query(PollReport).filter_by(poll_id=poll_id).first().id
        c.cookies.clear()
        r = c.post(f"/api/admin/reports/poll/{rid}/hide", headers=ah)
        check(r.status_code == 200, f"admin hide {r.status_code} {r.text[:120]}")
        c.cookies.clear()
        r = c.get(f"/api/pages/{oid}/citizen-polls").json()
        check(poll_id not in [p["id"] for p in r.get("archived", [])], "hidden pre-claim poll must leave the public listing")
        c.cookies.clear()
        r = c.get(f"/api/pages/{oid}/citizen-polls", headers={"Authorization": f"Bearer {tok}"}).json()
        check(poll_id not in [p["id"] for p in r.get("archived", [])], "hidden poll must not show to the page owner either")
        with SessionLocal() as db:
            reason = db.get(Poll, poll_id).archived_reason
        check(reason == "admin_hidden", f"reason should be admin_hidden, got {reason}")
        c.cookies.clear()
        r = c.post(f"/api/admin/targets/poll/{poll_id}/unhide", headers=ah)
        check(r.status_code == 200, f"admin unhide {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            p = db.get(Poll, poll_id)
            check(p.archived_reason == "rep_claimed" and p.archived_at is not None,
                  f"unhide should restore closed-and-public, got {p.archived_reason} {p.archived_at}")
        c.cookies.clear()
        r = c.get(f"/api/pages/{oid}/citizen-polls").json()
        check(poll_id in [p["id"] for p in r.get("archived", [])], "restored poll should be public again")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("PRE-CLAIM POLLS STAY PUBLIC AND CLOSED, AND CAN STILL BE TAKEN DOWN.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
