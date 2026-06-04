# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Integration test for the demographic results breakdown endpoint + server-side
min-cell suppression (Phase 1, step 3).

Setup: a citizen poll with a `party` form. 11 verified citizens vote option A
and self-report Democrat; 3 vote option B and self-report Republican (14 total).

Guards (MIN_CELL = 10):
  1. Plain results (no demographic dimension) are NOT suppressed.
  2. by=party: the Democrat bucket (11) shows; the Republican bucket (3) is
     suppressed.
  3. filter_party=democrat (subset 11) shows; filter_party=republican (subset 3)
     is suppressed.
  4. Invalid filter value / non-attached `by` are ignored.

Run:  cd backend && python3 tests/test_poll_demographics_breakdown.py
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

    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import (
        CitizenAccount, Poll, PollOption, PollVote, PollVoteDemographic,
    )
    from app.services import poll_demographics as pd

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            poll = Poll(
                post_id=None, question="Breakdown poll?", author_kind="citizen",
                target_official_id="TEST_OFC", default_visibility_scope="country",
                presentation_mode="full", created_at=datetime.utcnow(),
            )
            db.add(poll); db.flush()
            oa = PollOption(poll_id=poll.id, text="A", sort_order=0)
            ob = PollOption(poll_id=poll.id, text="B", sort_order=1)
            db.add_all([oa, ob]); db.flush()
            pd.attach_questions(db, poll.id, ["party", "age_band"])
            poll_id, opt_a, opt_b = poll.id, oa.id, ob.id

            def add_voter(i, option_id, party):
                cit = CitizenAccount(
                    email=f"v{i}@example.com", password_hash="x",
                    display_name=f"Voter {i}", state="FL",
                    address_line1="1 Main St", city="Naples", county="Collier",
                    zip_code="34102", congressional_district="19",
                )
                db.add(cit); db.flush()
                v = PollVote(poll_id=poll_id, option_id=option_id, citizen_id=cit.id,
                             scope_state="FL")
                db.add(v); db.flush()
                db.add(PollVoteDemographic(poll_id=poll_id, poll_vote_id=v.id,
                                           question_key="party", answer_value=party))

            for i in range(11):
                add_voter(i, opt_a, "democrat")
            for i in range(11, 14):
                add_voter(i, opt_b, "republican")
            db.commit()

        base = f"/api/polls/{poll_id}/results/breakdown"

        # 1) plain results — not a demographic cut, never suppressed
        r = c.get(base).json()
        check(r["suppressed"] is False, "plain results not suppressed")
        check(r["subset_total"] == 14, f"plain subset 14 (got {r['subset_total']})")
        ocounts = {o["id"]: o["count"] for o in r["options"]}
        check(ocounts == {opt_a: 11, opt_b: 3}, f"plain option counts (got {ocounts})")

        # 2) by=party cross-tab
        r = c.get(base, params={"by": "party"}).json()
        bk = {b["value"]: b for b in r["breakdown"]["buckets"]}
        check(bk["democrat"]["total"] == 11 and bk["democrat"]["suppressed"] is False,
              "democrat bucket (11) shown")
        dem_counts = {o["id"]: o["count"] for o in bk["democrat"]["options"]}
        check(dem_counts.get(opt_a) == 11, f"democrat -> A=11 (got {dem_counts})")
        check(bk["republican"]["total"] == 3 and bk["republican"]["suppressed"] is True,
              "republican bucket (3) suppressed")
        check(bk["republican"]["options"] == [], "suppressed bucket has no counts")

        # 3) filter subsets
        big = c.get(base, params={"filter_party": "democrat"}).json()
        check(big["suppressed"] is False and big["subset_total"] == 11, "democrat filter shown (11)")
        small = c.get(base, params={"filter_party": "republican"}).json()
        check(small["suppressed"] is True and small["subset_total"] == 3, "republican filter suppressed (3)")
        check(small["options"] == [], "suppressed filter has no option counts")

        # 4) invalid filter value ignored -> behaves like plain
        inv = c.get(base, params={"filter_party": "not_a_party"}).json()
        check(inv["applied_filters"] == {} and inv["suppressed"] is False and inv["subset_total"] == 14,
              "invalid filter value ignored")
        # non-attached `by` ignored
        nb = c.get(base, params={"by": "sex"}).json()
        check(nb["by"] is None and "breakdown" not in nb, "non-attached by ignored")

    if failures:
        print("FAIL:")
        for f in failures:
            print("  -", f)
        return 1
    print("PASS — breakdown + suppression guards green")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
