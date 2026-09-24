"""Demographic cuts count verified people only (audit S10).

Run:  cd backend && python3 tests/test_demographics_verified_only.py   (exit 0 = pass)

Attack being closed: nine demo accounts vote with known answers next
to one real respondent, the cell reaches the 10-vote minimum, and the
real person's vote falls out of the shown counts.

1. A vote from an unverified (demo) citizen stores no answers.
2. Answer rows already stored for unverified voters are ignored by the
   breakdown, so 9 demo + 1 real stays a suppressed cell of 1.
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
    from app.auth import compute_csrf_token
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, Poll, PollOption, PollVote, PollVoteDemographic
    from app.services import poll_demographics as pd

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            poll = Poll(
                post_id=None, question="Padding attack?", author_kind="citizen",
                target_official_id="TEST_OFC", default_visibility_scope="country",
                presentation_mode="full", created_at=now,
            )
            db.add(poll)
            db.flush()
            oa = PollOption(poll_id=poll.id, text="A", sort_order=0)
            ob = PollOption(poll_id=poll.id, text="B", sort_order=1)
            db.add_all([oa, ob])
            db.flush()
            pd.attach_questions(db, poll.id, ["party"])
            poll_id, opt_a, opt_b = poll.id, oa.id, ob.id

            def add_voter(i, option_id, verified, method):
                cit = CitizenAccount(
                    email=f"pad{i}@example.com", password_hash="x", display_name=f"Pad {i}",
                    state="FL", city="Naples", congressional_district="FL-19",
                    verified=verified, verified_method=method,
                )
                db.add(cit)
                db.flush()
                v = PollVote(poll_id=poll_id, option_id=option_id, citizen_id=cit.id, scope_state="FL")
                db.add(v)
                db.flush()
                db.add(PollVoteDemographic(poll_id=poll_id, poll_vote_id=v.id,
                                           question_key="party", answer_value="democrat"))

            for i in range(9):
                add_voter(i, opt_a, True, "demo")       # demo accounts, pre-existing rows
            add_voter(99, opt_b, True, "idme")          # the one real respondent
            db.commit()

        r = c.get(f"/api/polls/{poll_id}/results/breakdown", params={"filter_party": "democrat"}).json()
        check(r["subset_total"] == 1, f"only the verified answer counts (got {r['subset_total']})")
        check(r["suppressed"] is True, "a cell of 1 must be suppressed")
        r = c.get(f"/api/polls/{poll_id}/results/breakdown", params={"by": "party"}).json()
        dem = next(b for b in r.get("breakdown", {}).get("buckets", []) if b["value"] == "democrat")
        check(dem["total"] == 1 and dem["suppressed"] is True,
              f"democrat bucket should be 1 and suppressed, got {dem}")

        # 1. an unverified vote through the API stores nothing
        c.cookies.clear()
        s = c.post("/api/citizen-auth/demo-signup", json={
            "display_name": "Demo Voter", "state": "FL",
            "congressional_district": "FL-19", "city": "Naples",
        })
        assert s.status_code == 201, s.text
        tok = s.json()["citizen_token"]
        demo_id = s.json()["citizen"]["id"]
        c.cookies.clear()
        r = c.post(f"/api/citizen-polls/{poll_id}/vote",
                   json={"option_id": opt_a, "demographics": {"party": "democrat"}},
                   headers={"X-Citizen-Token": tok, "X-CSRF-Token": compute_csrf_token(tok)})
        check(r.status_code in (200, 201), f"demo vote should succeed, got {r.status_code} {r.text[:160]}")
        with SessionLocal() as db:
            vote = db.query(PollVote).filter_by(poll_id=poll_id, citizen_id=demo_id).first()
            check(vote is not None, "demo vote row should exist")
            if vote is not None:
                n = db.query(PollVoteDemographic).filter_by(poll_vote_id=vote.id).count()
                check(n == 0, f"no demographic rows for an unverified voter, got {n}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("DEMOGRAPHIC CUTS COUNT VERIFIED PEOPLE ONLY.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
