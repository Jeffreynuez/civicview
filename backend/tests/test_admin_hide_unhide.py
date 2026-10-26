"""Admin Hide and Unhide follow the moderation rules (2026-10-26 admin audit).

Run:  cd backend && python3 tests/test_admin_hide_unhide.py   (exit 0 = pass)

Guards five fixes:
  1. Unhide refuses content its author deleted, and a citizen poll its
     author closed, so an admin can't put either back in public. The
     queue row says why the content is down (target_state).
  2. A row stays unhideable after its report is resolved: target_state
     still reads admin_hidden on a resolved row.
  3. Unhide closes the item's open reports, and only open reports count
     toward auto-hide, so restored content is not hidden again by the
     next single report.
  4. Granting an appeal on hidden content closes its reports the same way.
  5. Suspending a user hides nothing, even when an old client still sends
     cascade_hide, and leaves the reports on their content open.
"""
import os
import sys
import tempfile
from datetime import datetime


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ["REPORT_AUTO_HIDE_THRESHOLD"] = "5"
    os.environ["ADMIN_EMAILS"] = "admin.person@example.com"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.db import SessionLocal
    from app.models.pages import (
        Appeal, CitizenAccount, CommentReport, Poll, PollOption, PollReport,
        Post, PostComment, PostReport, RepAccount,
    )
    from app.services.moderation import record_report

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    oid = "hide-unhide-official"
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            adm = RepAccount(email="admin.person@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Admin", official_id="admin-test-official", is_active=True,
                             totp_enabled_at=datetime.utcnow())  # admin needs 2FA
            db.add(adm)
            db.commit()
            adm_id = adm.id
        at = issue_session_token(adm_id)
        ah = {"Authorization": f"Bearer {at}", "X-CSRF-Token": compute_csrf_token(at)}

        def admin_post(path, json=None):
            c.cookies.clear()
            return c.post(path, headers=ah, json=json)

        def queue(include_acted=True):
            c.cookies.clear()
            r = c.get("/api/admin/reports", headers=ah,
                      params={"include_acted": "true"} if include_acted else None)
            check(r.status_code == 200, f"report list {r.status_code} {r.text[:120]}")
            return r.json().get("items", [])

        def row_for(items, kind, target_id):
            return [i for i in items if i["kind"] == kind and i["target_id"] == target_id]

        n = [0]

        def citizen(method="idme"):
            n[0] += 1
            with SessionLocal() as db:
                cz = CitizenAccount(
                    email=f"c{n[0]}@example.test", password_hash="x", display_name=f"Citizen {n[0]}",
                    state="FL", city="Orlando", congressional_district="FL-10",
                    verified=(method != "demo"), verified_method=method, is_active=True,
                )
                db.add(cz)
                db.commit()
                return cz.id

        def report_post(post_id, reporter_id):
            with SessionLocal() as db:
                db.add(PostReport(post_id=post_id, reporter_citizen_id=reporter_id, reason="spam"))
                record_report(db, db.get(Post, post_id), kind="post")
                db.commit()

        def report_comment(comment_id, reporter_id):
            with SessionLocal() as db:
                db.add(CommentReport(comment_id=comment_id, reporter_citizen_id=reporter_id, reason="spam"))
                record_report(db, db.get(PostComment, comment_id), kind="post_comment")
                db.commit()

        # 1a. A reported post its author then deleted: no Unhide.
        with SessionLocal() as db:
            p = Post(official_id=oid, body="Reported, then deleted by its author.")
            db.add(p)
            db.commit()
            del_post_id = p.id
        report_post(del_post_id, citizen())
        with SessionLocal() as db:
            db.get(Post, del_post_id).deleted_at = datetime.utcnow()   # the author's own Delete
            db.commit()
        rows = row_for(queue(), "post", del_post_id)
        check(rows and rows[0].get("target_state") == "author_deleted",
              f"author-deleted post reads author_deleted, got {rows and rows[0].get('target_state')}")
        r = admin_post(f"/api/admin/targets/post/{del_post_id}/unhide")
        check(r.status_code == 409, f"unhide of an author-deleted post must be refused, got {r.status_code}")
        with SessionLocal() as db:
            check(db.get(Post, del_post_id).deleted_at is not None, "author-deleted post must stay deleted")

        # 1b. A reported citizen poll its author closed: no Unhide.
        asker = citizen()
        poll_reporter = citizen()
        with SessionLocal() as db:
            poll = Poll(post_id=None, question="Closed by its author?", author_kind="citizen",
                        author_citizen_id=asker, target_official_id=oid,
                        default_visibility_scope="country", presentation_mode="full",
                        created_at=datetime.utcnow())
            db.add(poll)
            db.flush()
            db.add(PollOption(poll_id=poll.id, text="Yes", sort_order=0))
            db.add(PollReport(poll_id=poll.id, reporter_citizen_id=poll_reporter, reason="spam"))
            poll.archived_at = datetime.utcnow()
            poll.archived_reason = "citizen_closed"
            db.commit()
            closed_poll_id = poll.id
        rows = row_for(queue(), "poll", closed_poll_id)
        check(rows and rows[0].get("target_state") == "author_closed",
              f"author-closed poll reads author_closed, got {rows and rows[0].get('target_state')}")
        r = admin_post(f"/api/admin/targets/poll/{closed_poll_id}/unhide")
        check(r.status_code == 409, f"unhide of an author-closed poll must be refused, got {r.status_code}")
        with SessionLocal() as db:
            pl = db.get(Poll, closed_poll_id)
            check(pl.archived_at is not None and pl.archived_reason == "citizen_closed",
                  "author-closed poll must stay closed")

        # 2. Admin Hide resolves the report, and the resolved row can still be unhidden.
        with SessionLocal() as db:
            p = Post(official_id=oid, body="An admin hides this one.")
            db.add(p)
            db.commit()
            hid_post_id = p.id
        report_post(hid_post_id, citizen())
        rid = row_for(queue(), "post", hid_post_id)[0]["id"]
        r = admin_post(f"/api/admin/reports/post/{rid}/hide")
        check(r.status_code == 200, f"admin hide {r.status_code} {r.text[:120]}")
        rows = row_for(queue(), "post", hid_post_id)
        check(rows and rows[0]["acted_at"] and rows[0].get("target_state") == "admin_hidden",
              "a resolved row on hidden content must still read admin_hidden so Unhide can show")
        check(not row_for(queue(include_acted=False), "post", hid_post_id), "hide closes the report")
        r = admin_post(f"/api/admin/targets/post/{hid_post_id}/unhide")
        check(r.status_code == 200, f"unhide after the report is resolved {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            pp = db.get(Post, hid_post_id)
            check(pp.deleted_at is None and pp.hide_reason is None, "unhide restores the post")

        # 3. Auto-hidden, then unhidden: one more report must not hide it again.
        with SessionLocal() as db:
            p = Post(official_id=oid, body="Five verified reports, then restored.")
            db.add(p)
            db.commit()
            auto_post_id = p.id
        for _ in range(5):
            report_post(auto_post_id, citizen())
        with SessionLocal() as db:
            check(db.get(Post, auto_post_id).hide_reason == "auto_hidden", "five verified reports auto-hide")
        r = admin_post(f"/api/admin/targets/post/{auto_post_id}/unhide")
        check(r.status_code == 200, f"unhide auto-hidden {r.status_code} {r.text[:120]}")
        check(not row_for(queue(include_acted=False), "post", auto_post_id),
              "unhide closes every open report on the post")
        report_post(auto_post_id, citizen())
        with SessionLocal() as db:
            check(db.get(Post, auto_post_id).deleted_at is None,
                  "one report after a restore must not hide the post again")
        for _ in range(4):
            report_post(auto_post_id, citizen())
        with SessionLocal() as db:
            check(db.get(Post, auto_post_id).hide_reason == "auto_hidden",
                  "five NEW verified reports still auto-hide it")

        # 4. A granted appeal closes the content's reports too.
        author = citizen()
        with SessionLocal() as db:
            host = Post(official_id=oid, body="A post with a comment thread.")
            db.add(host)
            db.flush()
            cm = PostComment(post_id=host.id, citizen_id=author, citizen_display_name="Author", body="A comment five people report.")
            db.add(cm)
            db.commit()
            comment_id = cm.id
        for _ in range(5):
            report_comment(comment_id, citizen())
        with SessionLocal() as db:
            check(db.get(PostComment, comment_id).hide_reason == "auto_hidden", "comment auto-hidden")
            ap = Appeal(target_kind="post_comment", target_id=comment_id, appellant_kind="citizen",
                        appellant_id=author, rationale="x" * 60)
            db.add(ap)
            db.commit()
            appeal_id = ap.id
        r = admin_post(f"/api/admin/appeals/{appeal_id}/grant", json={"admin_note": None})
        check(r.status_code == 200, f"grant appeal {r.status_code} {r.text[:120]}")
        check(not row_for(queue(include_acted=False), "post_comment", comment_id),
              "granting the appeal closes the comment's open reports")
        report_comment(comment_id, citizen())
        with SessionLocal() as db:
            check(db.get(PostComment, comment_id).deleted_at is None,
                  "one report after a granted appeal must not hide the comment again")

        # 5. Suspend hides nothing and leaves reports open, even with cascade_hide sent.
        target = citizen()
        with SessionLocal() as db:
            host = Post(official_id=oid, body="Host post.")
            db.add(host)
            db.flush()
            reported = PostComment(post_id=host.id, citizen_id=target, citizen_display_name="Target", body="Reported comment.")
            unreported = PostComment(post_id=host.id, citizen_id=target, citizen_display_name="Target", body="Never reported.")
            db.add_all([reported, unreported])
            db.commit()
            reported_id, unreported_id = reported.id, unreported.id
        report_comment(reported_id, citizen())
        r = admin_post(f"/api/admin/users/citizen/{target}/suspend",
                       json={"reason": "test", "cascade_hide": True})
        check(r.status_code == 200, f"suspend {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, target).suspended_at is not None, "account is suspended")
            check(db.get(PostComment, reported_id).deleted_at is None, "suspend must not hide reported content")
            check(db.get(PostComment, unreported_id).deleted_at is None, "suspend must not hide unreported content")
        check(row_for(queue(include_acted=False), "post_comment", reported_id),
              "the report on the suspended user's comment stays open for review")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ADMIN HIDE AND UNHIDE FOLLOW THE MODERATION RULES.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
