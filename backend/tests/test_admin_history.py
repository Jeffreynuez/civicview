"""Every admin action is saved to the History, with a reason where one is required.

Run:  cd backend && python3 tests/test_admin_history.py   (exit 0 = pass)

Guards the 2026-10-26 fix for admin audit finding M5. Before it, most
admin actions left only an app log line: unsuspend wiped the suspension
reason, Dismiss and Hide looked the same, and Unlock and Unhide stored
nothing. Now:
  1. Hide (and Keep hidden), suspend, unlock and an appeal denial need a
     reason of at least 3 characters; Dismiss, Unhide and unsuspend take
     an optional one.
  2. Each action writes one admin_actions row: who, what, which item or
     account, why, when.
  3. GET /api/admin/actions lists them newest first, filters by target,
     pages with before_id, and is admin only.
  4. Unsuspend keeps the old suspension reason in the History.
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
    os.environ["REPORT_AUTO_HIDE_THRESHOLD"] = "5"
    os.environ["ADMIN_EMAILS"] = "history.admin@example.com"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import (
        AdminAction, Appeal, CitizenAccount, CommentReport, Post, PostComment, PostReport, RepAccount,
    )
    from app.services.moderation import record_report

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    oid = "history-official"
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            adm = RepAccount(email="history.admin@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="History Admin", official_id="history-admin-official",
                             is_active=True, totp_enabled_at=datetime.utcnow())
            db.add(adm)
            db.commit()
            adm_id = adm.id
        at = issue_session_token(adm_id)
        ah = {"Authorization": f"Bearer {at}", "X-CSRF-Token": compute_csrf_token(at)}

        def post(path, json=None, h=ah):
            c.cookies.clear()
            return c.post(path, headers=h, json=json)

        def history(**params):
            c.cookies.clear()
            r = c.get("/api/admin/actions", headers=ah, params=params)
            check(r.status_code == 200, f"history {r.status_code} {r.text[:120]}")
            return r.json()

        def latest():
            items = history(limit=1)["items"]
            return items[0] if items else {}

        n = [0]

        def citizen(method="idme", **extra):
            n[0] += 1
            with SessionLocal() as db:
                cz = CitizenAccount(email=f"h{n[0]}@example.com", password_hash="x", display_name=f"Person {n[0]}",
                                    state="FL", city="Orlando", congressional_district="FL-10",
                                    verified=(method != "demo"), verified_method=method, is_active=True, **extra)
                db.add(cz)
                db.commit()
                return cz.id

        def report_post(post_id, reporter):
            with SessionLocal() as db:
                db.add(PostReport(post_id=post_id, reporter_citizen_id=reporter, reason="spam"))
                record_report(db, db.get(Post, post_id), kind="post")
                db.commit()

        def open_report_id(post_id):
            with SessionLocal() as db:
                r = db.query(PostReport).filter_by(post_id=post_id, acted_at=None).first()
                return r.id if r else None

        # 1. Hide needs a reason; with one, the History has the row.
        with SessionLocal() as db:
            p = Post(official_id=oid, body="A post that gets hidden with a reason.")
            db.add(p)
            db.commit()
            hide_id = p.id
        report_post(hide_id, citizen())
        rid = open_report_id(hide_id)
        r = post(f"/api/admin/reports/post/{rid}/hide")
        check(r.status_code == 422, f"hide without a reason is refused, got {r.status_code}")
        r = post(f"/api/admin/reports/post/{rid}/hide", {"reason": "  ok "})
        check(r.status_code == 422, f"a 2-character reason is refused, got {r.status_code}")
        with SessionLocal() as db:
            check(db.get(Post, hide_id).deleted_at is None, "a refused hide changes nothing")
        r = post(f"/api/admin/reports/post/{rid}/hide", {"reason": "Spam link, confirmed"})
        check(r.status_code == 200, f"hide with a reason {r.status_code} {r.text[:120]}")
        row = latest()
        check(row.get("action") == "content_hide" and row.get("reason") == "Spam link, confirmed"
              and row.get("actor_email") == "history.admin@example.com"
              and row.get("target_kind") == "post" and row.get("target_id") == str(hide_id)
              and "hidden with a reason" in (row.get("target_label") or "")
              and (row.get("details") or {}).get("reports_closed") == 1,
              f"content_hide row has who, what, which, why: {row}")

        # Keep hidden on auto-hidden content is its own action.
        with SessionLocal() as db:
            p = Post(official_id=oid, body="Auto-hidden, then kept hidden.")
            db.add(p)
            db.commit()
            keep_id = p.id
        for _ in range(5):
            report_post(keep_id, citizen())
        rid = open_report_id(keep_id)
        r = post(f"/api/admin/reports/post/{rid}/hide", {"reason": "Harassment, keeping it down"})
        check(r.status_code == 200 and latest().get("action") == "content_keep_hidden",
              f"Keep hidden is recorded as content_keep_hidden, got {latest()}")

        # Unhide takes an optional reason.
        r = post(f"/api/admin/targets/post/{keep_id}/unhide")
        check(r.status_code == 200 and latest().get("action") == "content_unhide" and latest().get("reason") is None,
              f"unhide without a reason is recorded, got {r.status_code} {latest()}")

        # Dismiss takes an optional reason.
        with SessionLocal() as db:
            p = Post(official_id=oid, body="A post whose report is dismissed.")
            db.add(p)
            db.commit()
            dis_id = p.id
        report_post(dis_id, citizen())
        rid = open_report_id(dis_id)
        r = post(f"/api/admin/reports/post/{rid}/dismiss", {"reason": "Not spam, a real question"})
        check(r.status_code == 200 and latest().get("action") == "report_dismiss"
              and latest().get("reason") == "Not spam, a real question"
              and (latest().get("details") or {}).get("report_id") == rid,
              f"dismiss is recorded with its report id, got {latest()}")
        before = len(history(limit=500)["items"])
        r = post(f"/api/admin/reports/post/{rid}/dismiss")
        check(r.status_code == 200 and len(history(limit=500)["items"]) == before,
              "dismissing an already-resolved report adds nothing")

        # 2. Suspend needs a reason; unsuspend keeps it in the History.
        target = citizen()
        r = post(f"/api/admin/users/citizen/{target}/suspend", {"reason": ""})
        check(r.status_code == 422, f"suspend without a reason is refused, got {r.status_code}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, target).suspended_at is None, "a refused suspend changes nothing")
        r = post(f"/api/admin/users/citizen/{target}/suspend", {"reason": "Repeated threats in comments"})
        check(r.status_code == 200 and latest().get("action") == "user_suspend"
              and latest().get("reason") == "Repeated threats in comments"
              and latest().get("target_label") == f"Person {n[0]}",
              f"suspend is recorded, got {latest()}")
        r = post(f"/api/admin/users/citizen/{target}/unsuspend", {"reason": "Appeal by email, reviewed"})
        row = latest()
        check(r.status_code == 200 and row.get("action") == "user_unsuspend"
              and (row.get("details") or {}).get("suspended_reason") == "Repeated threats in comments",
              f"unsuspend keeps the old reason in the History, got {row}")

        # 3. Unlock needs a reason.
        locked = citizen(locked_until=datetime.utcnow() + timedelta(hours=1), failed_login_count=5)
        r = post("/api/admin/lockout/unlock", {"identity_kind": "citizen", "account_id": locked})
        check(r.status_code == 422, f"unlock without a reason is refused, got {r.status_code}")
        r = post("/api/admin/lockout/unlock", {"identity_kind": "citizen", "account_id": locked,
                                                "reason": "Owner confirmed by phone"})
        check(r.status_code == 200 and latest().get("action") == "lockout_unlock",
              f"unlock is recorded, got {r.status_code} {latest()}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, locked).locked_until is None, "the account is unlocked")

        # 4. Appeals: a denial needs a note; both are recorded.
        author = citizen()
        with SessionLocal() as db:
            host = Post(official_id=oid, body="Host post.")
            db.add(host)
            db.flush()
            c1 = PostComment(post_id=host.id, citizen_id=author, citizen_display_name="A", body="First hidden comment.",
                             deleted_at=datetime.utcnow(), hide_reason="admin_hidden")
            c2 = PostComment(post_id=host.id, citizen_id=author, citizen_display_name="A", body="Second hidden comment.",
                             deleted_at=datetime.utcnow(), hide_reason="admin_hidden")
            db.add_all([c1, c2])
            db.flush()
            a1 = Appeal(target_kind="post_comment", target_id=c1.id, appellant_kind="citizen",
                        appellant_id=author, rationale="x" * 60)
            a2 = Appeal(target_kind="post_comment", target_id=c2.id, appellant_kind="citizen",
                        appellant_id=author, rationale="y" * 60)
            db.add_all([a1, a2])
            db.commit()
            a1_id, a2_id = a1.id, a2.id
        r = post(f"/api/admin/appeals/{a1_id}/deny", {"admin_note": None})
        check(r.status_code == 422, f"a denial without a note is refused, got {r.status_code}")
        with SessionLocal() as db:
            check(db.get(Appeal, a1_id).acted_at is None, "a refused denial leaves the appeal pending")
        r = post(f"/api/admin/appeals/{a1_id}/deny", {"admin_note": "The comment names a private person"})
        check(r.status_code == 200 and latest().get("action") == "appeal_deny", f"denial recorded, got {latest()}")
        r = post(f"/api/admin/appeals/{a2_id}/grant", {"admin_note": None})
        check(r.status_code == 200 and latest().get("action") == "appeal_grant", f"grant recorded, got {latest()}")
        c.cookies.clear()
        items = c.get("/api/admin/appeals", headers=ah, params={"include_acted": "true"}).json().get("items", [])
        check(all(i.get("admin_email") == "history.admin@example.com" for i in items if i.get("acted_at")),
              "decided appeals say who decided them")

        # 5. Reset 2FA is recorded with its reason.
        enrolled = citizen(totp_enabled_at=datetime.utcnow())
        r = post(f"/api/admin/accounts/citizen/{enrolled}/reset-2fa", {"reason": "Lost phone, confirmed by video"})
        check(r.status_code == 200 and latest().get("action") == "twofa_reset"
              and latest().get("reason") == "Lost phone, confirmed by video", f"2FA reset recorded, got {latest()}")

        # 6. Running the election reminders is recorded.
        r = post("/api/admin/election-reminders/run")
        check(r.status_code == 200 and latest().get("action") == "election_reminders_run",
              f"election reminders run recorded, got {r.status_code} {latest()}")

        # 7. The list: newest first, filters, paging, admin only.
        everything = history(limit=500)["items"]
        ids = [i["id"] for i in everything]
        check(ids == sorted(ids, reverse=True), "newest first")
        one = history(target_kind="post", target_id=str(keep_id))["items"]
        check([i["action"] for i in one] == ["content_unhide", "content_keep_hidden"],
              f"one item's history, got {[i['action'] for i in one]}")
        page1 = history(limit=3)
        page2 = history(limit=3, before_id=page1["items"][-1]["id"])
        check(page1["has_more"] is True and page2["items"] and page2["items"][0]["id"] < page1["items"][-1]["id"],
              "paging with before_id")
        nt = issue_citizen_token(citizen())
        c.cookies.clear()
        r = c.get("/api/admin/actions", headers={"X-Citizen-Token": nt})
        check(r.status_code == 403, f"a non-admin can't read the history, got {r.status_code}")
        with SessionLocal() as db:
            check(db.query(AdminAction).count() == len(everything), "the API returns every row")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("EVERY ADMIN ACTION IS IN THE HISTORY.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
