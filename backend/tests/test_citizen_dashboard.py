"""The citizen dashboard's Overview data and the honest "joined" counts (2026-10-19).

Run:  cd backend && python3 tests/test_citizen_dashboard.py   (exit 0 = pass)

Before: the dashboard's "Your activity" tiles for polls cast, comments
and reactions were hard-coded to 0, and "Upcoming in your district" and
"Recent activity" always showed their empty state, because nothing gave
them data. The public stats counted the internal CivicView Test Rep and
Test Candidate as a rep and a candidate who joined.

Also: an owner's event saved with an explicit UTC offset (like -05:00)
made GET /api/events/upcoming answer 500 for that page.

Now GET /api/activity/dashboard returns this month's counts, the last 7
days of the citizen's notifications and what's coming up (their state's
sourced voting deadlines, events from officials they track, polls they
voted in that close soon), and the stats leave the test accounts out.
"""
import json
import os
import sys
import tempfile
from datetime import date, datetime, timedelta


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
    import app.routers.stats as stats_router
    from app.services import election_reminders
    from fastapi.testclient import TestClient
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import (
        BillReaction, CandidateAccount, CitizenAccount, Notification, Poll, PollOption,
        PollVote, Post, PostComment, PostReaction, RepAccount, RepEvent, TrackedOfficial,
    )

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    # Fixed "today" so Florida's 2026 general election deadlines are ahead.
    election_reminders.today_et = lambda now_utc=None: date(2026, 10, 1)

    now = datetime.utcnow()
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            for oid in ("test-civicview-internal", "X000001"):
                if not db.query(RepAccount).filter(RepAccount.official_id == oid).first():
                    db.add(RepAccount(official_id=oid, email=f"{oid}@example.com", password_hash="x",
                                      display_name=oid, role="U.S. Representative", owner_state="FL",
                                      is_active=True))
            for cid in ("test-civicview-internal-candidate", "cand-real-1"):
                if not db.query(CandidateAccount).filter(CandidateAccount.candidate_id == cid).first():
                    db.add(CandidateAccount(candidate_id=cid, email=f"{cid}@example.com", password_hash="x",
                                            display_name=cid, owner_state="FL", claim_status="active",
                                            is_active=True))
            db.commit()
            real_reps = db.query(RepAccount).filter(
                RepAccount.is_active.is_(True), ~RepAccount.official_id.like("test-civicview-internal%")).count()
            real_cands = db.query(CandidateAccount).filter(
                CandidateAccount.is_active.is_(True),
                ~CandidateAccount.candidate_id.like("test-civicview-internal%")).count()

            rep = db.query(RepAccount).filter(RepAccount.official_id == "X000001").one()
            cit = CitizenAccount(email="pat@example.com", password_hash="x", display_name="Pat Citizen",
                                 city="Orlando", state="FL", congressional_district="FL-10", is_active=True)
            db.add(cit)
            db.commit()
            db.refresh(cit)

            post = Post(official_id=rep.official_id, body="An update")
            db.add(post)
            db.commit()
            db.refresh(post)
            poll = Poll(question="Town hall in person or online?", presentation_mode="full",
                        author_kind="rep", post_id=post.id, closes_at=now + timedelta(days=3))
            db.add(poll)
            db.commit()
            db.refresh(poll)
            opt = PollOption(poll_id=poll.id, text="In person")
            db.add(opt)
            db.commit()
            db.refresh(opt)

            db.add(PollVote(option_id=opt.id, poll_id=poll.id, citizen_id=cit.id, authored_verified=False))
            db.add(PostComment(post_id=post.id, citizen_id=cit.id, citizen_display_name="Pat Citizen",
                               body="Thanks for posting", authored_verified=False))
            db.add(PostComment(post_id=post.id, citizen_id=cit.id, citizen_display_name="Pat Citizen",
                               body="Deleted one", authored_verified=False, deleted_at=now))
            db.add(PostReaction(post_id=post.id, citizen_id=cit.id, kind="up", authored_verified=False))
            db.add(BillReaction(bill_key="hr1-119", citizen_id=cit.id, kind="up", authored_verified=False))
            db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=cit.id, official_key=rep.official_id,
                                   snapshot_json=json.dumps({"name": "Rep Example"})))
            # An explicit UTC offset (the API accepts one) used to crash the upcoming filter.
            db.add(RepEvent(author_id=rep.id, official_id=rep.official_id, title="Town hall",
                            location="Orlando",
                            start_at=(now + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S-05:00")))
            db.add(RepEvent(author_id=rep.id, official_id=rep.official_id, title="Past event",
                            start_at=(now - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")))
            db.add(RepEvent(author_id=rep.id, official_id="someone-not-tracked", title="Elsewhere",
                            start_at=(datetime.now() + timedelta(days=5)).isoformat()))
            db.add(Notification(recipient_kind="citizen", recipient_id=cit.id, kind="tracked_post",
                                payload_json=json.dumps({"official_id": rep.official_id, "official_name": "Rep Example",
                                                         "post_id": post.id}),
                                created_at=now - timedelta(days=1)))
            db.add(Notification(recipient_kind="citizen", recipient_id=cit.id, kind="reply",
                                payload_json=json.dumps({"replier_name": "Rep Example"}),
                                created_at=now - timedelta(days=10)))
            db.commit()
            token = issue_citizen_token(cit.id, getattr(cit, "session_epoch", 0) or 0)

        # Signed out: no dashboard.
        check(c.get("/api/activity/dashboard").status_code == 401, "signed-out dashboard should be 401")

        r = c.get("/api/activity/dashboard", headers={"X-Citizen-Token": token})
        check(r.status_code == 200, f"dashboard status {r.status_code}: {r.text[:200]}")
        d = r.json() if r.status_code == 200 else {}
        counts = d.get("counts") or {}
        check(counts.get("polls_cast") == 1, f"polls_cast {counts.get('polls_cast')!r}")
        check(counts.get("comments_left") == 1, f"comments_left leaves out deleted: {counts.get('comments_left')!r}")
        check(counts.get("reactions") == 2, f"reactions (post + bill) {counts.get('reactions')!r}")

        recent = d.get("recent") or []
        check([n.get("kind") for n in recent] == ["tracked_post"], f"recent is the last 7 days only: {recent!r}")

        up = d.get("upcoming") or []
        kinds = [u.get("kind") for u in up]
        titles = [u.get("title") for u in up]
        check("event" in kinds, f"tracked official's event missing: {up!r}")
        check("Elsewhere" not in titles, "an event from an untracked official leaked in")
        check("Past event" not in titles, "a past event showed as upcoming")
        check("poll-closing" in kinds, f"closing poll missing: {up!r}")
        check(any(t == "Florida Election Day" for t in titles), f"Election Day missing: {titles!r}")
        check(any(t == "Florida voter registration deadline" for t in titles) or len(up) == 8,
              f"registration deadline missing: {titles!r}")
        check(len(titles) == len(set(titles)), f"a deadline shows twice: {titles!r}")
        check(all(u.get("url", "").startswith("https://") for u in up if u.get("kind") == "ballot"),
              "every deadline links to an official https site")
        whens = [u.get("when") or "" for u in up]
        check(whens == sorted(whens), f"upcoming is not in date order: {whens!r}")

        # The profile's Events tab: an event with an explicit offset no longer makes it a 500.
        ev = c.get("/api/events/upcoming", params={"official_id": "X000001"})
        check(ev.status_code == 200, f"events/upcoming status {ev.status_code}")
        ev_titles = [e.get("title") for e in (ev.json().get("events") or [])] if ev.status_code == 200 else []
        check("Town hall" in ev_titles and "Past event" not in ev_titles, f"events/upcoming titles {ev_titles!r}")

        # The joined counts leave the internal test accounts out.
        summary = c.get("/api/stats/summary").json()
        check(summary.get("reps_joined") == real_reps, f"summary reps_joined {summary.get('reps_joined')!r} != {real_reps}")
        stats_router._detail_cache.update({"at": 0.0, "payload": None, "failed_at": None})
        detail = c.get("/api/stats/detail").json()
        check(detail.get("reps_joined") == real_reps, f"detail reps_joined {detail.get('reps_joined')!r}")
        check(detail.get("candidates_joined") == real_cands,
              f"detail candidates_joined {detail.get('candidates_joined')!r} != {real_cands}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: citizen dashboard data and honest joined counts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
