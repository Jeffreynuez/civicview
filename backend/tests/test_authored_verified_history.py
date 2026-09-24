"""Speech written unverified stays labeled unverified (audit B4).

Run:  cd backend && python3 tests/test_authored_verified_history.py   (exit 0 = pass)

A citizen votes while unverified, verifies later, and the boot backfill
runs: the old vote must keep authored_verified=False. Rep-authored rows
are still stamped True by the backfill.
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
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, Poll, PollOption, PollReaction, PollVote, RepAccount
    from app.services.authored_verified_backfill import backfill_authored_verified

    failures = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with TestClient(m.app):
        with SessionLocal() as db:
            cit = CitizenAccount(email="later@example.com", password_hash="x", display_name="Later",
                                 city="Orlando", state="FL", congressional_district="FL-10",
                                 is_active=True, verified=False)
            rep = RepAccount(email="rep.av@example.com", password_hash="x", display_name="Rep AV",
                             official_id="av-test", is_active=True)
            db.add_all([cit, rep])
            db.flush()
            poll = Poll(post_id=None, question="History?", author_kind="citizen", target_official_id="X",
                        default_visibility_scope="country", presentation_mode="full", created_at=now)
            db.add(poll)
            db.flush()
            opt = PollOption(poll_id=poll.id, text="A", sort_order=0)
            db.add(opt)
            db.flush()
            vote = PollVote(poll_id=poll.id, option_id=opt.id, citizen_id=cit.id, authored_verified=False)
            react = PollReaction(poll_id=poll.id, author_rep_id=rep.id, kind="up", authored_verified=False)
            db.add_all([vote, react])
            db.commit()
            vote_id, react_id, cit_id = vote.id, react.id, cit.id

        with SessionLocal() as db:
            c = db.get(CitizenAccount, cit_id)
            c.verified = True
            c.verified_method = "idme"
            db.commit()
        backfill_authored_verified()

        with SessionLocal() as db:
            if db.get(PollVote, vote_id).authored_verified is not False:
                failures.append("an unverified-era vote was relabeled verified")
            if db.get(PollReaction, react_id).authored_verified is not True:
                failures.append("rep-authored rows should still be stamped verified")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("UNVERIFIED HISTORY STAYS UNVERIFIED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
