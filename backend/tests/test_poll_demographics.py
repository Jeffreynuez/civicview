# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Integration test for optional poll demographic forms (Phase 1, backend).

Guards:
  1. GET /api/polls/demographics/catalog returns the standardized catalog.
  2. GET /api/polls/{id}/demographics returns the poll's attached questions
     (invalid keys dropped at attach time).
  3. A verified citizen's vote stores only valid, attached answers; invalid
     values and non-attached keys are dropped.
  4. Re-voting REPLACES the prior answers (no stale rows).
  5. Voting with no demographics ("Prefer not to say") stores nothing.
  6. A poll with no attached form stores nothing even if demographics are sent.

Run:  cd backend && python3 tests/test_poll_demographics.py   (exit 0 = pass)
"""
import os
import sys
import tempfile
from datetime import datetime


def _bootstrap_env():
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")


def main() -> int:
    _bootstrap_env()
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.INFO)

    import tests.test_feed_dual as t
    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.auth_citizen import get_current_citizen, get_optional_citizen
    from app.models.pages import (
        CitizenAccount, Poll, PollOption, PollVoteDemographic,
    )
    from app.services import poll_demographics as pd

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    def demo_rows(poll_id):
        with SessionLocal() as d:
            return {
                (r.question_key, r.answer_value)
                for r in d.query(PollVoteDemographic).filter(
                    PollVoteDemographic.poll_id == poll_id).all()
            }

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            t._seed(db)
            marisol_id = db.query(CitizenAccount.id).filter(
                CitizenAccount.display_name == "Marisol Vega").first()[0]

            # Poll WITH a form (age_band + party; bogus key dropped at attach).
            poll = Poll(
                post_id=None, question="Form poll?", author_kind="citizen",
                author_citizen_id=marisol_id, target_official_id="TEST_OFC",
                default_visibility_scope="country", presentation_mode="full",
                created_at=datetime.utcnow(),
            )
            db.add(poll); db.flush()
            oa = PollOption(poll_id=poll.id, text="A", sort_order=0)
            ob = PollOption(poll_id=poll.id, text="B", sort_order=1)
            db.add_all([oa, ob]); db.flush()
            pd.attach_questions(db, poll.id, ["age_band", "party", "bogus_key"])

            # Poll WITHOUT a form.
            poll2 = Poll(
                post_id=None, question="No form?", author_kind="citizen",
                author_citizen_id=marisol_id, target_official_id="TEST_OFC",
                default_visibility_scope="country", presentation_mode="full",
                created_at=datetime.utcnow(),
            )
            db.add(poll2); db.flush()
            o2a = PollOption(poll_id=poll2.id, text="Y", sort_order=0)
            o2b = PollOption(poll_id=poll2.id, text="N", sort_order=1)
            db.add_all([o2a, o2b])
            db.commit()
            poll_id, opt_a, opt_b = poll.id, oa.id, ob.id
            poll2_id, opt2_a = poll2.id, o2a.id

        # 1) catalog endpoint
        cat = c.get("/api/polls/demographics/catalog").json()
        check(cat.get("version") == 1, "catalog version present")
        keys = {q["key"] for q in cat.get("questions", [])}
        check({"age_band", "sex", "party", "race_ethnicity"} <= keys, "catalog has expected keys")
        check(all(o["value"] for q in cat["questions"] for o in q["options"]), "catalog options have values")

        # 2) per-poll demographics endpoint (bogus key dropped at attach)
        pdresp = c.get(f"/api/polls/{poll_id}/demographics").json()
        check(pdresp["has_form"] is True, "poll has_form True")
        attached = [q["key"] for q in pdresp["questions"]]
        check(attached == ["age_band", "party"], f"attached keys = age_band,party (got {attached})")
        check(c.get(f"/api/polls/{poll2_id}/demographics").json()["has_form"] is False,
              "no-form poll has_form False")
        check(c.get("/api/polls/999999/demographics").status_code == 404, "missing poll 404")

        # Authenticate as Marisol (verified citizen).
        def _as_marisol():
            with SessionLocal() as d:
                return d.get(CitizenAccount, marisol_id)
        m.app.dependency_overrides[get_current_citizen] = _as_marisol
        m.app.dependency_overrides[get_optional_citizen] = _as_marisol

        # 3) vote with mixed valid/invalid demographics
        r = c.post(f"/api/citizen-polls/{poll_id}/vote", json={
            "option_id": opt_a,
            "demographics": {
                "age_band": "35_44",     # valid + attached -> stored
                "party": "NOT_A_PARTY",  # attached but invalid value -> dropped
                "sex": "female",         # valid value but NOT attached -> dropped
            },
        })
        check(r.status_code == 200, f"vote 1 status 200 (got {r.status_code})")
        check(demo_rows(poll_id) == {("age_band", "35_44")},
              f"only valid+attached stored (got {demo_rows(poll_id)})")

        # 4) re-vote REPLACES prior answers
        c.post(f"/api/citizen-polls/{poll_id}/vote", json={
            "option_id": opt_b,
            "demographics": {"age_band": "45_54", "party": "independent"},
        })
        check(demo_rows(poll_id) == {("age_band", "45_54"), ("party", "independent")},
              f"re-vote replaced answers (got {demo_rows(poll_id)})")

        # 5) vote with no demographics (Prefer not to say) clears them
        c.post(f"/api/citizen-polls/{poll_id}/vote", json={"option_id": opt_a})
        check(demo_rows(poll_id) == set(), f"empty demographics clears rows (got {demo_rows(poll_id)})")

        # 6) poll with no form ignores demographics entirely
        c.post(f"/api/citizen-polls/{poll2_id}/vote", json={
            "option_id": opt2_a, "demographics": {"age_band": "25_34"},
        })
        check(demo_rows(poll2_id) == set(), "no-form poll stores nothing")

    if failures:
        print("FAIL:")
        for f in failures:
            print("  -", f)
        return 1
    print("PASS — all poll-demographics guards green")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
