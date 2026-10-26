"""People are told about a hide or a suspension, and every author can appeal (2026-10-26 admin audit, M10).

Run:  cd backend && python3 tests/test_moderation_notices_appeals.py   (exit 0 = pass)

Guards:
  1. An admin Hide and an auto-hide each leave the author a bell notice
     (a rep's or candidate's names their own page); Keep hidden on
     something already hidden sends nothing new.
  2. A new suspension emails the owner the reason and how to appeal; a
     reason update on the same suspension sends nothing.
  3. Reps and candidates see their own hidden posts and comments and can
     appeal them; ?as= keeps a two-identity browser's lists apart; nobody
     else can appeal them.
  4. One appeal per suspension: a second appeal of the same suspension is
     refused, a later suspension can be appealed, and granting an old
     appeal does not lift a newer suspension.
  5. A suspension from before the admin History keeps its appeal: a
     second one is still refused.
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
    os.environ["ADMIN_EMAILS"] = "notice.admin@example.com"
    os.environ["REPORT_AUTO_HIDE_THRESHOLD"] = "5"
    # Emails go to a capture function below, never the network.
    os.environ["RESEND_API_KEY"] = "test-key-not-real"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.auth_candidate import issue_candidate_token
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import (
        Appeal, CandidateAccount, CitizenAccount, CommentReport, Notification, Post, PostComment,
        PostReport, RepAccount,
    )
    from app.routers import appeals as appeals_router
    from app.services import notifications as email_mod
    from app.services.moderation import record_report

    sent = []

    def fake_send(*, to, subject, html_body, text_body=None):
        sent.append({"to": to, "subject": subject, "text": text_body or ""})
        return True

    email_mod.notification_send = fake_send

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            adm = RepAccount(email="notice.admin@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Notice Admin", official_id="notice-admin-official",
                             is_active=True, totp_enabled_at=datetime.utcnow())
            rep = RepAccount(email="n.rep@example.com", password_hash="x", display_name="N Rep",
                             official_id="n-rep-official", is_active=True)
            cand = CandidateAccount(candidate_id="fl-cand-notice", email="n.candidate@example.com",
                                    password_hash="x", display_name="N Candidate",
                                    owner_state="FL", claim_status="active", is_active=True)
            author = CitizenAccount(email="n.citizen@example.com", password_hash=hash_password("Cit-pass-12345"),
                                    display_name="N Citizen", state="FL", city="Orlando",
                                    congressional_district="FL-10", verified=True, verified_method="idme",
                                    is_active=True)
            db.add_all([adm, rep, cand, author])
            db.flush()
            host = Post(official_id="n-rep-official", author_id=rep.id, body="The rep's own post.")
            cpost = Post(official_id="fl-cand-notice", author_candidate_id=cand.id, body="A candidate post to hide.")
            db.add_all([host, cpost])
            db.flush()
            rep_comment = PostComment(post_id=host.id, author_rep_id=rep.id, citizen_display_name="N Rep",
                                      body="A comment the rep wrote as the rep.")
            cit_comment = PostComment(post_id=host.id, citizen_id=author.id, citizen_display_name="N Citizen",
                                      body="A citizen comment the community reports.")
            db.add_all([rep_comment, cit_comment])
            db.flush()
            reporter = CitizenAccount(email="n.reporter@example.com", password_hash="x", display_name="Reporter",
                                      state="FL", city="Orlando", congressional_district="FL-10",
                                      verified=True, verified_method="idme", is_active=True)
            db.add(reporter)
            db.flush()
            r_cpost = PostReport(post_id=cpost.id, reporter_citizen_id=reporter.id, reason="spam")
            r_rep = CommentReport(comment_id=rep_comment.id, reporter_citizen_id=reporter.id, reason="spam")
            db.add_all([r_cpost, r_rep])
            db.commit()
            ids = dict(adm=adm.id, rep=rep.id, cand=cand.id, author=author.id, cpost=cpost.id,
                       rep_comment=rep_comment.id, cit_comment=cit_comment.id,
                       r_cpost=r_cpost.id, r_rep=r_rep.id)

        at = issue_session_token(ids["adm"])
        admin_h = {"Authorization": f"Bearer {at}", "X-CSRF-Token": compute_csrf_token(at)}
        rt = issue_session_token(ids["rep"])
        rep_h = {"Authorization": f"Bearer {rt}", "X-CSRF-Token": compute_csrf_token(rt)}
        kt = issue_candidate_token(ids["cand"])
        cand_h = {"X-Candidate-Token": kt, "X-CSRF-Token": compute_csrf_token(kt)}
        ct = issue_citizen_token(ids["author"])
        cit_h = {"X-Citizen-Token": ct, "X-CSRF-Token": compute_csrf_token(ct)}
        both_h = {"X-Citizen-Token": ct, "Authorization": f"Bearer {rt}", "X-CSRF-Token": compute_csrf_token(ct)}

        def call(method, path, headers, json=None, params=None):
            c.cookies.clear()
            return c.request(method, path, headers=headers, json=json, params=params)

        def notices(kind, account_id):
            with SessionLocal() as db:
                return [n for n in db.query(Notification).filter_by(recipient_kind=kind, recipient_id=account_id,
                                                                    kind="moderation_hidden").all()]

        # 1a. Admin Hide of a candidate post: a notice naming their page.
        r = call("POST", f"/api/admin/reports/post/{ids['r_cpost']}/hide", admin_h, {"reason": "Spam links"})
        check(r.status_code == 200, f"hide candidate post {r.status_code} {r.text[:120]}")
        ns = notices("candidate", ids["cand"])
        check(len(ns) == 1, f"one notice for the candidate, got {len(ns)}")
        if ns:
            import json as _json
            p = _json.loads(ns[0].payload_json)
            check(p.get("target_kind") == "post" and p.get("target_id") == ids["cpost"]
                  and p.get("hide_reason") == "admin_hidden" and p.get("page_id") == "fl-cand-notice",
                  f"candidate notice payload {p}")
            check("reason" not in p and "reporter" not in str(p), f"notice names no reporter or admin reason {p}")

        # 1b. Keep hidden on content already hidden: nothing new.
        with SessionLocal() as db:
            again = PostReport(post_id=ids["cpost"], reporter_citizen_id=ids["author"], reason="spam")
            db.add(again)
            db.commit()
            again_id = again.id
        r = call("POST", f"/api/admin/reports/post/{again_id}/hide", admin_h, {"reason": "Still spam"})
        check(r.status_code == 200, f"keep hidden {r.status_code}")
        check(len(notices("candidate", ids["cand"])) == 1, "Keep hidden sends no second notice")

        # 1c. Hide a comment the rep wrote as the rep: the rep is told.
        r = call("POST", f"/api/admin/reports/post_comment/{ids['r_rep']}/hide", admin_h, {"reason": "Insults"})
        check(r.status_code == 200, f"hide rep comment {r.status_code}")
        check(len(notices("rep", ids["rep"])) == 1, "one notice for the rep")

        # 1d. Auto-hide after five trusted reports: the citizen author is told.
        for i in range(5):
            with SessionLocal() as db:
                cz = CitizenAccount(email=f"trusted{i}@example.com", password_hash="x", display_name=f"T{i}",
                                    state="FL", city="Orlando", congressional_district="FL-10",
                                    verified=True, verified_method="idme", is_active=True)
                db.add(cz)
                db.flush()
                db.add(CommentReport(comment_id=ids["cit_comment"], reporter_citizen_id=cz.id, reason="spam"))
                record_report(db, db.get(PostComment, ids["cit_comment"]), kind="post_comment")
                db.commit()
        ns = notices("citizen", ids["author"])
        check(len(ns) == 1 and '"auto_hidden"' in (ns[0].payload_json if ns else ""),
              f"one auto-hide notice for the citizen, got {[n.payload_json for n in ns]}")

        # 3a. The candidate's own list shows the post, with Appeal.
        r = call("GET", "/api/me/hidden-content", cand_h, params={"as": "candidate"})
        items = r.json().get("items", []) if r.status_code == 200 else []
        check(r.status_code == 200 and [(i["target_kind"], i["target_id"], i["appealable"]) for i in items]
              == [("post", ids["cpost"], True)], f"candidate hidden list {r.status_code} {items}")

        # 3b. Two identities on one browser: each list is its own.
        r = call("GET", "/api/me/hidden-content", both_h, params={"as": "rep"})
        rep_items = [(i["target_kind"], i["target_id"]) for i in r.json().get("items", [])]
        check(rep_items == [("post_comment", ids["rep_comment"])], f"rep list {rep_items}")
        r = call("GET", "/api/me/hidden-content", both_h, params={"as": "citizen"})
        cit_items = [(i["target_kind"], i["target_id"]) for i in r.json().get("items", [])]
        check(cit_items == [("post_comment", ids["cit_comment"])], f"citizen list {cit_items}")
        r = call("GET", "/api/me/hidden-content", rep_h)
        check([(i["target_kind"], i["target_id"]) for i in r.json().get("items", [])]
              == [("post_comment", ids["rep_comment"])], "a rep-only session needs no ?as=")
        r = call("GET", "/api/me/hidden-content", cit_h, params={"as": "rep"})
        check(r.status_code == 401, f"?as= a session the request lacks is refused, got {r.status_code}")

        # 3c. Appeals: the author may, others may not.
        rationale = "This was a scheduling notice for a public town hall, not spam. Please look again."
        r = call("POST", "/api/appeals", cit_h, {"target_kind": "post", "target_id": ids["cpost"], "rationale": rationale})
        check(r.status_code == 403, f"a citizen can't appeal a candidate's post, got {r.status_code}")
        r = call("POST", "/api/appeals", cand_h, {"target_kind": "post", "target_id": ids["cpost"], "rationale": rationale})
        check(r.status_code == 201 and r.json().get("appellant_kind") == "candidate",
              f"candidate appeals own post {r.status_code} {r.text[:160]}")
        r = call("POST", "/api/appeals", both_h,
                 {"target_kind": "post_comment", "target_id": ids["rep_comment"], "rationale": rationale})
        check(r.status_code == 201 and r.json().get("appellant_kind") == "rep",
              f"rep appeals own comment from a two-identity browser {r.status_code} {r.text[:160]}")
        r = call("GET", "/api/me/appeals", both_h, params={"as": "citizen"})
        check(r.status_code == 200 and r.json().get("items") == [], f"the citizen's appeals list is its own {r.text[:120]}")

        # 2. Suspension email, once per suspension.
        sent.clear()
        r = call("POST", f"/api/admin/users/citizen/{ids['author']}/suspend", admin_h,
                 {"reason": "Repeated spam after warnings"})
        check(r.status_code == 200, f"suspend {r.status_code} {r.text[:120]}")
        mails = [s for s in sent if s["to"] == "n.citizen@example.com"]
        check(len(mails) == 1, f"one suspension email, got {len(mails)}")
        if mails:
            check("suspended" in mails[0]["subject"].lower(), f"subject {mails[0]['subject']}")
            check("Repeated spam after warnings" in mails[0]["text"], "the email carries the reason")
            check("Citizen login" in mails[0]["text"] and "30 days" in mails[0]["text"], "the email says how to appeal")
            check("\u2014" not in mails[0]["text"] and "\u2013" not in mails[0]["text"], "no dashes in the email")
        r = call("POST", f"/api/admin/users/citizen/{ids['author']}/suspend", admin_h, {"reason": "Updated reason"})
        check(len([s for s in sent if s["to"] == "n.citizen@example.com"]) == 1, "a reason update sends nothing")

        # 4. One appeal per suspension.
        def suspension_appeal():
            appeals_router._suspension_appeal_log.clear()
            c.cookies.clear()
            return c.post("/api/appeals/suspension", json={
                "email": "n.citizen@example.com", "password": "Cit-pass-12345", "rationale": rationale})

        r = suspension_appeal()
        check(r.status_code == 200 and "appeal is in" in r.text, f"first suspension appeal {r.text[:120]}")
        r = suspension_appeal()
        check("already on file" in r.text, f"same suspension, second appeal refused: {r.text[:120]}")
        with SessionLocal() as db:
            first = db.query(Appeal).filter_by(target_kind="suspension_citizen", appellant_id=ids["author"]).all()
            check(len(first) == 1 and first[0].target_id < 0, f"keyed to the suspension, got {[a.target_id for a in first]}")
            first_id = first[0].id if first else None
        rows = call("GET", "/api/admin/appeals", admin_h).json().get("items", [])
        row = next((i for i in rows if i["id"] == first_id), {})
        check(row.get("target_preview") == "Suspended: Repeated spam after warnings",
              f"admin row shows the reason the suspension started with, got {row.get('target_preview')}")
        call("POST", f"/api/admin/users/citizen/{ids['author']}/unsuspend", admin_h, {"reason": "Lifting to test"})
        r = call("POST", f"/api/admin/users/citizen/{ids['author']}/suspend", admin_h, {"reason": "Spam again"})
        check(len([s for s in sent if s["to"] == "n.citizen@example.com"]) == 2, "a new suspension emails again")
        r = suspension_appeal()
        check(r.status_code == 200 and "appeal is in" in r.text, f"new suspension can be appealed: {r.text[:120]}")
        with SessionLocal() as db:
            count = db.query(Appeal).filter_by(target_kind="suspension_citizen", appellant_id=ids["author"]).count()
            check(count == 2, f"two suspension appeals on file, got {count}")
        r = call("POST", f"/api/admin/appeals/{first_id}/grant", admin_h, {"admin_note": "Old one"})
        check(r.status_code == 200 and r.json().get("target_restored") is False,
              f"granting the old appeal restores nothing {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, ids["author"]).suspended_at is not None,
                  "the newer suspension stays after the old appeal is granted")
            newer = (db.query(Appeal).filter_by(target_kind="suspension_citizen", appellant_id=ids["author"])
                     .filter(Appeal.acted_at.is_(None)).first())
            newer_id = newer.id if newer else None
        r = call("POST", f"/api/admin/appeals/{newer_id}/grant", admin_h, {"admin_note": "Reviewed"})
        check(r.status_code == 200 and r.json().get("target_restored") is True, f"granting the current one lifts it {r.text[:120]}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, ids["author"]).suspended_at is None, "the account is no longer suspended")

        # 5. A suspension older than the History (an account with no
        # suspend row in it): its appeal used the account id, and still
        # counts as that suspension's one appeal.
        with SessionLocal() as db:
            old = CitizenAccount(email="legacy@example.com", password_hash=hash_password("Old-pass-12345"),
                                 display_name="Legacy", state="FL", city="Orlando",
                                 congressional_district="FL-10", verified=True, verified_method="idme",
                                 is_active=True, suspended_at=datetime.utcnow() - timedelta(days=2),
                                 suspended_reason="Old-style suspension")
            db.add(old)
            db.flush()
            db.add(Appeal(target_kind="suspension_citizen", target_id=old.id, appellant_kind="citizen",
                          appellant_id=old.id, rationale="x" * 60))
            db.commit()
            old_id = old.id
        appeals_router._suspension_appeal_log.clear()
        c.cookies.clear()
        r = c.post("/api/appeals/suspension", json={
            "email": "legacy@example.com", "password": "Old-pass-12345", "rationale": rationale})
        check("already on file" in r.text, f"the old-style suspension keeps its one appeal: {r.text[:120]}")
        with SessionLocal() as db:
            check(db.query(Appeal).filter_by(appellant_id=old_id, target_kind="suspension_citizen").count() == 1,
                  "no second appeal row for the old-style suspension")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("PEOPLE ARE TOLD, AND EVERY AUTHOR CAN APPEAL.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
