"""Admin page, last small fixes (2026-10-26 admin audit, L3, L12, L16).

Run:  cd backend && python3 tests/test_admin_small_fixes.py   (exit 0 = pass)

Guards:
  L3   The reports and appeals lists take a limit and say how many match
       (total), so a cap is never silent.
  L12  Deleting a reported comment with no replies keeps the row and its
       reports (it used to hard-delete, and the cascade erased them); an
       unreported one is still removed; the queue shows the original text
       of a comment its author deleted under replies.
  L16  Pending appeals come oldest first, then decided ones.
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ["ADMIN_EMAILS"] = "small.admin@example.com"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import (
        Appeal, CitizenAccount, CommentReport, Post, PostComment, PostReport, RepAccount,
    )

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    now = datetime.utcnow()
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            adm = RepAccount(email="small.admin@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Small Admin", official_id="small-admin-official",
                             is_active=True, totp_enabled_at=now)
            rep = RepAccount(email="small.rep@example.com", password_hash="x", display_name="Small Rep",
                             official_id="small-rep-official", is_active=True)
            author = CitizenAccount(email="small.author@example.com", password_hash="x", display_name="Author",
                                    state="FL", city="Orlando", congressional_district="FL-10",
                                    verified=True, verified_method="idme", is_active=True)
            reporter = CitizenAccount(email="small.reporter@example.com", password_hash="x", display_name="Reporter",
                                      state="FL", city="Orlando", congressional_district="FL-10",
                                      verified=True, verified_method="idme", is_active=True)
            db.add_all([adm, rep, author, reporter])
            db.flush()
            post = Post(official_id="small-rep-official", author_id=rep.id, body="A post with comments.")
            db.add(post)
            db.flush()
            posts = [Post(official_id="small-rep-official", author_id=rep.id, body=f"Reported post {i}")
                     for i in range(5)]
            db.add_all(posts)
            db.flush()
            for p in posts:
                db.add(PostReport(post_id=p.id, reporter_citizen_id=reporter.id, reason="spam"))
            reported = PostComment(post_id=post.id, citizen_id=author.id, citizen_display_name="Author",
                                   body="A reported comment its author deletes.")
            plain = PostComment(post_id=post.id, citizen_id=author.id, citizen_display_name="Author",
                                body="An unreported comment its author deletes.")
            parent = PostComment(post_id=post.id, citizen_id=author.id, citizen_display_name="Author",
                                 body="A reported comment with a reply, then deleted.")
            db.add_all([reported, plain, parent])
            db.flush()
            reply = PostComment(post_id=post.id, citizen_id=reporter.id, citizen_display_name="Reporter",
                                parent_comment_id=parent.id, body="A reply.")
            db.add(reply)
            db.add_all([CommentReport(comment_id=reported.id, reporter_citizen_id=reporter.id, reason="spam"),
                        CommentReport(comment_id=parent.id, reporter_citizen_id=reporter.id, reason="spam")])
            # Appeals: two pending (10 days and 1 day old), one decided.
            db.add_all([
                Appeal(target_kind="post_comment", target_id=901, appellant_kind="citizen", appellant_id=author.id,
                       rationale="a" * 60, created_at=now - timedelta(days=1)),
                Appeal(target_kind="post_comment", target_id=902, appellant_kind="citizen", appellant_id=author.id,
                       rationale="b" * 60, created_at=now - timedelta(days=10)),
                Appeal(target_kind="post_comment", target_id=903, appellant_kind="citizen", appellant_id=author.id,
                       rationale="c" * 60, created_at=now - timedelta(days=20), acted_at=now, decision="denied"),
            ])
            db.commit()
            ids = dict(adm=adm.id, author=author.id, reported=reported.id, plain=plain.id, parent=parent.id)

        at = issue_session_token(ids["adm"])
        admin_h = {"Authorization": f"Bearer {at}", "X-CSRF-Token": compute_csrf_token(at)}
        ct = issue_citizen_token(ids["author"])
        cit_h = {"X-Citizen-Token": ct, "X-CSRF-Token": compute_csrf_token(ct)}

        def get(path, **params):
            c.cookies.clear()
            r = c.get(path, headers=admin_h, params=params or None)
            check(r.status_code == 200, f"{path} {params} {r.status_code} {r.text[:120]}")
            return r.json() if r.status_code == 200 else {}

        # L3: limit and total.
        body = get("/api/admin/reports", limit=2)
        check(len(body.get("items", [])) == 2 and body.get("total") == 7,
              f"2 of 7 open reports, got {len(body.get('items', []))} of {body.get('total')}")
        body = get("/api/admin/reports")
        check(len(body.get("items", [])) == 7 and body.get("total") == 7, "all 7 by default")
        body = get("/api/admin/reports", limit=0)
        check(len(body.get("items", [])) == 1, "a limit below 1 is read as 1")
        body = get("/api/admin/appeals", limit=1)
        check(len(body.get("items", [])) == 1 and body.get("total") == 2, f"appeals limit {body.get('total')}")
        dash = get("/api/admin/dashboard")
        check(dash.get("reports", {}).get("total") == 7 and dash.get("appeals", {}).get("total") == 2,
              "the dashboard carries the totals")

        # L16: oldest pending first, then the decided one.
        order = [a["target_id"] for a in get("/api/admin/appeals", include_acted="true").get("items", [])]
        check(order == [902, 901, 903], f"pending oldest first, then decided, got {order}")

        # L12: deleting comments.
        for cid in (ids["reported"], ids["plain"], ids["parent"]):
            c.cookies.clear()
            r = c.delete(f"/api/pages/comments/{cid}", headers=cit_h)
            check(r.status_code == 204, f"author delete {cid} {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            kept = db.get(PostComment, ids["reported"])
            check(kept is not None and kept.deleted_at is not None and kept.hide_reason is None,
                  "the reported comment is kept as an author delete")
            check(db.query(CommentReport).filter_by(comment_id=ids["reported"]).count() == 1,
                  "its report survives")
            check(db.get(PostComment, ids["plain"]) is None, "an unreported comment is still removed")
        rows = {r["target_id"]: r for r in get("/api/admin/reports").get("items", []) if r["kind"] == "post_comment"}
        row = rows.get(ids["reported"], {})
        check(row.get("target_state") == "author_deleted"
              and row.get("target_preview") == "A reported comment its author deletes.",
              f"the queue still shows the deleted reported comment {row}")
        prow = rows.get(ids["parent"], {})
        check(prow.get("target_preview") == "A reported comment with a reply, then deleted.",
              f"the queue shows the original text, not the tombstone: {prow.get('target_preview')}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("THE LAST SMALL FIXES HOLD.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
