"""Candidates are first-class on the admin page (2026-10-26 admin audit).

Run:  cd backend && python3 tests/test_admin_candidates.py   (exit 0 = pass)

Guards:
  1. A suspended candidate no longer breaks the Suspended list and the
     whole admin dashboard (the row's kind allowed only rep or citizen,
     so one candidate made both answer 500).
  2. The queue names the author of a candidate's post and of comments
     written as a rep or a candidate, so the Suspend button appears.
  3. A suspended candidate can appeal from the sign-in form, and
     granting it lifts the suspension.
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
    os.environ["ADMIN_EMAILS"] = "cand.admin@example.com"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.db import SessionLocal
    from app.models.pages import (
        Appeal, CandidateAccount, CitizenAccount, CommentReport, Post, PostComment, PostReport, RepAccount,
    )

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            adm = RepAccount(email="cand.admin@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Cand Admin", official_id="cand-admin-official",
                             is_active=True, totp_enabled_at=datetime.utcnow())
            rep = RepAccount(email="a.rep@example.com", password_hash="x", display_name="A Rep",
                             official_id="a-rep-official", is_active=True)
            cand = CandidateAccount(candidate_id="fl-cand-test", email="a.candidate@example.com",
                                    password_hash=hash_password("Cand-pass-12345"), display_name="A Candidate",
                                    owner_state="FL", claim_status="active", is_active=True)
            reporter = CitizenAccount(email="reporter@example.com", password_hash="x", display_name="Reporter",
                                      state="FL", city="Orlando", congressional_district="FL-10",
                                      verified=True, verified_method="idme", is_active=True)
            db.add_all([adm, rep, cand, reporter])
            db.flush()
            cpost = Post(official_id="fl-cand-test", author_candidate_id=cand.id, body="A candidate's own post.")
            host = Post(official_id="a-rep-official", author_id=rep.id, body="A rep's post.")
            db.add_all([cpost, host])
            db.flush()
            rep_comment = PostComment(post_id=host.id, author_rep_id=rep.id, citizen_display_name="A Rep",
                                      body="A comment written as the rep.")
            cand_comment = PostComment(post_id=host.id, author_candidate_id=cand.id,
                                       citizen_display_name="A Candidate", body="A comment written as the candidate.")
            db.add_all([rep_comment, cand_comment])
            db.flush()
            db.add_all([
                PostReport(post_id=cpost.id, reporter_citizen_id=reporter.id, reason="spam"),
                CommentReport(comment_id=rep_comment.id, reporter_citizen_id=reporter.id, reason="spam"),
                CommentReport(comment_id=cand_comment.id, reporter_citizen_id=reporter.id, reason="spam"),
            ])
            db.commit()
            ids = dict(adm=adm.id, rep=rep.id, cand=cand.id, cpost=cpost.id,
                       rep_comment=rep_comment.id, cand_comment=cand_comment.id)
        at = issue_session_token(ids["adm"])
        ah = {"Authorization": f"Bearer {at}", "X-CSRF-Token": compute_csrf_token(at)}

        def get(path, **params):
            c.cookies.clear()
            return c.get(path, headers=ah, params=params or None)

        def post(path, json=None, headers=ah):
            c.cookies.clear()
            return c.post(path, headers=headers, json=json)

        # 2. Authors on the queue.
        items = get("/api/admin/reports").json().get("items", [])

        def author_of(kind, target_id):
            row = next((i for i in items if i["kind"] == kind and i["target_id"] == target_id), {})
            return (row.get("target_author_kind"), row.get("target_author_id"), row.get("target_author_name"))

        check(author_of("post", ids["cpost"]) == ("candidate", ids["cand"], "A Candidate"),
              f"candidate post author, got {author_of('post', ids['cpost'])}")
        check(author_of("post_comment", ids["rep_comment"]) == ("rep", ids["rep"], "A Rep"),
              f"rep-written comment author, got {author_of('post_comment', ids['rep_comment'])}")
        check(author_of("post_comment", ids["cand_comment"]) == ("candidate", ids["cand"], "A Candidate"),
              f"candidate-written comment author, got {author_of('post_comment', ids['cand_comment'])}")

        # 1. Suspend the candidate; the lists still load.
        r = post(f"/api/admin/users/candidate/{ids['cand']}/suspend", {"reason": "Spam posts on the page"})
        check(r.status_code == 200, f"suspend candidate {r.status_code} {r.text[:120]}")
        r = get("/api/admin/users/suspended")
        check(r.status_code == 200, f"suspended list with a candidate {r.status_code} {r.text[:120]}")
        kinds = [i.get("kind") for i in (r.json().get("items", []) if r.status_code == 200 else [])]
        check("candidate" in kinds, f"the candidate is listed, got {kinds}")
        r = get("/api/admin/dashboard")
        check(r.status_code == 200, f"dashboard with a suspended candidate {r.status_code} {r.text[:120]}")

        # 3. The candidate appeals from the sign-in form; granting lifts it.
        c.cookies.clear()
        r = c.post("/api/candidate-auth/login", json={"email": "a.candidate@example.com", "password": "Cand-pass-12345"})
        check(r.status_code == 403 and "suspended" in r.text.lower(), f"suspended candidate login {r.status_code}")
        c.cookies.clear()
        r = c.post("/api/appeals/suspension", json={
            "email": "a.candidate@example.com", "password": "Cand-pass-12345",
            "rationale": "These were announcements of my own town halls, not spam. Please look again.",
        })
        check(r.status_code == 200 and "appeal is in" in r.text, f"candidate suspension appeal {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            ap = db.query(Appeal).filter_by(target_kind="suspension_candidate", appellant_id=ids["cand"]).first()
            check(ap is not None and ap.appellant_kind == "candidate", "the appeal is filed for the candidate")
            appeal_id = ap.id if ap else None
        rows = get("/api/admin/appeals").json().get("items", [])
        row = next((i for i in rows if i["id"] == appeal_id), {})
        check(row.get("appellant_name") == "A Candidate" and row.get("target_preview", "").startswith("Suspended"),
              f"the admin queue names the candidate, got {row}")
        r = post(f"/api/admin/appeals/{appeal_id}/grant", {"admin_note": "Reviewed, these were event notices"})
        check(r.status_code == 200 and r.json().get("target_restored") is True, f"grant {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            check(db.get(CandidateAccount, ids["cand"]).suspended_at is None, "granting lifts the suspension")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("CANDIDATES ARE FIRST-CLASS ON THE ADMIN PAGE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
