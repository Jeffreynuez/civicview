"""Account deletion removes everything keyed to the account (audit B3).

Run:  cd backend && python3 tests/test_account_deletion_cleanup.py   (exit 0 = pass)

1. Hard delete removes the account's tracked items, featured picks,
   saved items, notifications, push devices, reset tokens and login
   attempts, and leaves other accounts' rows alone.
2. The boot sweep removes rows whose account is already gone.
3. A soft-deleted citizen gets no pushes during the grace window.
4. Login attempts older than the retention period are purged.
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone


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
    from app.auth import compute_csrf_token, hash_password
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import (
        CitizenAccount, DeviceToken, FeaturedTracked, LoginAttempt, Notification,
        PasswordResetToken, SavedItem, TrackedBill, TrackedElection, TrackedOfficial,
    )
    from app.services import account_deletion, login_attempts, push_service

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def seed_rows(db, cid, tag):
        db.add_all([
            TrackedBill(tracker_kind="citizen", tracker_id=cid, bill_key=f"119-hr-{tag}"),
            TrackedOfficial(tracker_kind="citizen", tracker_id=cid, official_key=f"off-{tag}"),
            TrackedElection(tracker_kind="citizen", tracker_id=cid, election_key=f"el-{tag}"),
            FeaturedTracked(tracker_kind="citizen", tracker_id=cid, category="bill", item_key=f"119-hr-{tag}"),
            SavedItem(tracker_kind="citizen", tracker_id=cid, item_type="post", item_id=int(tag)),
            Notification(recipient_kind="citizen", recipient_id=cid, kind="tracked_post", payload_json="{}"),
            DeviceToken(token=f"device-{tag}", platform="android", citizen_id=cid),
            PasswordResetToken(token_hash=f"{tag:0>64}", identity_kind="citizen", account_id=cid,
                               expires_at=now + timedelta(hours=1)),
            LoginAttempt(identity_kind="citizen", identity_id=cid, email_attempted=f"c{tag}@example.com",
                         success=True),
        ])

    def count_for(db, cid):
        return {
            "tracked_bills": db.query(TrackedBill).filter_by(tracker_kind="citizen", tracker_id=cid).count(),
            "tracked_officials": db.query(TrackedOfficial).filter_by(tracker_kind="citizen", tracker_id=cid).count(),
            "tracked_elections": db.query(TrackedElection).filter_by(tracker_kind="citizen", tracker_id=cid).count(),
            "featured": db.query(FeaturedTracked).filter_by(tracker_kind="citizen", tracker_id=cid).count(),
            "saved": db.query(SavedItem).filter_by(tracker_kind="citizen", tracker_id=cid).count(),
            "notifications": db.query(Notification).filter_by(recipient_kind="citizen", recipient_id=cid).count(),
            "devices": db.query(DeviceToken).filter_by(citizen_id=cid).count(),
            "reset_tokens": db.query(PasswordResetToken).filter_by(identity_kind="citizen", account_id=cid).count(),
            "login_attempts": db.query(LoginAttempt).filter_by(identity_kind="citizen", identity_id=cid).count(),
        }

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            accts = []
            for tag in ("1", "2"):
                a = CitizenAccount(email=f"c{tag}@example.com", password_hash=hash_password("pw-12345678"),
                                   display_name=f"C{tag}", city="Orlando", state="FL",
                                   congressional_district="FL-10", is_active=True, verified=False)
                db.add(a)
                db.flush()
                accts.append(a.id)
                seed_rows(db, a.id, tag)
            db.commit()
        gone, kept = accts

        # 1. hard delete through the API
        tok = issue_citizen_token(gone)
        c.cookies.clear()
        r = c.post("/api/citizen-auth/delete",
                   json={"confirm_email": "c1@example.com", "mode": "hard", "password": "pw-12345678"},
                   headers={"X-Citizen-Token": tok, "X-CSRF-Token": compute_csrf_token(tok)})
        check(r.status_code == 200, f"hard delete {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            left = {k: v for k, v in count_for(db, gone).items() if v}
            check(not left, f"rows left behind after delete: {left}")
            other = count_for(db, kept)
            check(all(v == 1 for v in other.values()), f"other account's rows touched: {other}")

        # 1b. a citizen's own polls and their demographic answers go too
        from app.models.pages import Poll, PollComment, PollOption, PollVote, PollVoteDemographic
        with SessionLocal() as db:
            author = CitizenAccount(email="author3@example.com", password_hash=hash_password("pw-12345678"),
                                    display_name="C3", city="Orlando", state="FL",
                                    congressional_district="FL-10", is_active=True, verified=False)
            db.add(author)
            db.flush()
            poll = Poll(post_id=None, question="Mine?", author_kind="citizen", author_citizen_id=author.id,
                        target_official_id="X", default_visibility_scope="country",
                        presentation_mode="full", created_at=now)
            db.add(poll)
            db.flush()
            opt = PollOption(poll_id=poll.id, text="A", sort_order=0)
            db.add(opt)
            db.flush()
            other_vote = PollVote(poll_id=poll.id, option_id=opt.id, citizen_id=kept)
            db.add(other_vote)
            db.add(PollComment(poll_id=poll.id, citizen_id=kept, citizen_display_name="C2", body="a comment"))
            # the author's own vote on someone else's poll, with an answer
            poll2 = Poll(post_id=None, question="Theirs?", author_kind="citizen", author_citizen_id=kept,
                         target_official_id="X", default_visibility_scope="country",
                         presentation_mode="full", created_at=now)
            db.add(poll2)
            db.flush()
            opt2 = PollOption(poll_id=poll2.id, text="B", sort_order=0)
            db.add(opt2)
            db.flush()
            v2 = PollVote(poll_id=poll2.id, option_id=opt2.id, citizen_id=author.id)
            db.add(v2)
            db.flush()
            db.add(PollVoteDemographic(poll_id=poll2.id, poll_vote_id=v2.id, question_key="party",
                                       answer_value="democrat"))
            db.commit()
            author_id, poll_id, poll2_id, v2_id = author.id, poll.id, poll2.id, v2.id
        with SessionLocal() as db:
            account_deletion.hard_delete_account(db, "citizen", db.get(CitizenAccount, author_id))
        with SessionLocal() as db:
            check(db.get(Poll, poll_id) is None, "the deleted citizen's poll should be gone")
            check(db.query(PollOption).filter_by(poll_id=poll_id).count() == 0, "its options should be gone")
            check(db.get(Poll, poll2_id) is not None, "someone else's poll stays")
            check(db.query(PollVoteDemographic).filter_by(poll_vote_id=v2_id).count() == 0,
                  "the deleted citizen's demographic answers should be gone")

        # 2. boot sweep for rows already orphaned
        with SessionLocal() as db:
            seed_rows(db, 99999, "9")
            db.commit()
        removed = account_deletion.purge_orphaned_account_rows()
        with SessionLocal() as db:
            left = {k: v for k, v in count_for(db, 99999).items() if v}
            check(not left, f"sweep left orphans: {left} (removed {removed})")
            check(all(v == 1 for v in count_for(db, kept).values()), "sweep touched a live account")

        # 3. no pushes during the soft-delete window
        sent = []

        class FakePush:
            def send_to_tokens(self, tokens, **kw):
                sent.extend(tokens)
                return []

        push_service._service = FakePush()
        with SessionLocal() as db:
            push_service._deliver_tracked_push(db, [kept], anon_key=None, title="t", body="b", data={})
        check("device-2" in sent, f"control: a live citizen's device should be pushed, got {sent}")
        sent.clear()
        with SessionLocal() as db:
            dev = db.query(DeviceToken).filter_by(token="device-2").one()
            dev.last_push_at = None
            db.commit()
        with SessionLocal() as db:
            acct = db.get(CitizenAccount, kept)
            acct.self_deleted_at = now
            db.commit()
            push_service._deliver_tracked_push(db, [kept], anon_key=None, title="t", body="b", data={})
        check("device-2" not in sent, f"soft-deleted citizen still pushed: {sent}")

        # 4. login attempt retention
        with SessionLocal() as db:
            db.add(LoginAttempt(identity_kind="citizen", identity_id=kept, email_attempted="c2@example.com",
                                success=False, occurred_at=now - timedelta(days=120)))
            db.commit()
        n = login_attempts.purge_old_login_attempts(days=90)
        check(n == 1, f"one 120-day-old attempt should be purged, got {n}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ACCOUNT DELETION CLEANS UP.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
