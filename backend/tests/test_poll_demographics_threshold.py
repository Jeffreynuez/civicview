# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Per-poll suppression threshold (Phase 1 P1). A poll with min_cell_override=25
should suppress an 11-response cut that WOULD show at the default floor of 10,
and the breakdown must report min_cell=25.

Run:  cd backend && python3 tests/test_poll_demographics_threshold.py
"""
import os
import sys
import tempfile
from datetime import datetime


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False); db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging; logging.disable(logging.INFO)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, Poll, PollOption, PollVote, PollVoteDemographic
    from app.services import poll_demographics as pd

    failures = []
    def check(c, msg):
        if not c: failures.append(msg)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            poll = Poll(post_id=None, question="Strict poll?", author_kind="citizen",
                        target_official_id="T", default_visibility_scope="country",
                        presentation_mode="full", created_at=datetime.utcnow(),
                        min_cell_override=25)  # stricter than the floor of 10
            db.add(poll); db.flush()
            oa = PollOption(poll_id=poll.id, text="A", sort_order=0)
            ob = PollOption(poll_id=poll.id, text="B", sort_order=1)
            db.add_all([oa, ob]); db.flush()
            pd.attach_questions(db, poll.id, ["party"])
            for i in range(11):  # 11 < 25 -> must suppress under this poll's threshold
                cit = CitizenAccount(email=f"t{i}@e.com", password_hash="x", display_name=f"T{i}",
                                     state="FL", address_line1="1 St", city="Naples",
                                     county="Collier", zip_code="34102", congressional_district="19")
                db.add(cit); db.flush()
                v = PollVote(poll_id=poll.id, option_id=oa.id, citizen_id=cit.id, scope_state="FL")
                db.add(v); db.flush()
                db.add(PollVoteDemographic(poll_id=poll.id, poll_vote_id=v.id,
                                           question_key="party", answer_value="democrat"))
            db.commit()
            poll_id = poll.id

        base = f"/api/polls/{poll_id}/results/breakdown"
        r = c.get(base, params={"filter_party": "democrat"}).json()
        check(r["min_cell"] == 25, f"effective min_cell=25 (got {r['min_cell']})")
        check(r["suppressed"] is True and r["subset_total"] == 11,
              f"11 responses suppressed at threshold 25 (suppressed={r['suppressed']})")
        bk = c.get(base, params={"by": "party"}).json()
        dem = next(b for b in bk["breakdown"]["buckets"] if b["value"] == "democrat")
        check(dem["total"] == 11 and dem["suppressed"] is True, "democrat bucket (11) suppressed at 25")
        # plain results (no demographic dimension) are never suppressed regardless of threshold
        plain = c.get(base).json()
        check(plain["suppressed"] is False and plain["subset_total"] == 11, "plain results not suppressed")

    if failures:
        print("FAIL:"); [print("  -", f) for f in failures]; return 1
    print("PASS — per-poll threshold guards green")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
