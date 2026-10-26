"""Admin access needs 2FA, and Reset 2FA has guards (2026-10-26 admin audit).

Run:  cd backend && python3 tests/test_admin_2fa.py   (exit 0 = pass)

Guards four fixes:
  1. An admin account without 2FA gets 403 from every admin endpoint
     except /api/admin/whoami, which answers with needs_2fa_enrollment
     so the app can show the enrollment overlay. FORCE_2FA_ENABLED is
     off here on purpose: the admin rule does not depend on it.
  2. ADMIN_2FA_REQUIRED=false turns the rule off (local development and
     emergencies only).
  3. The 2FA endpoints take ?as=citizen|rep|candidate, so an admin who
     is a citizen account but also has a rep session open enrolls the
     admin account, not the rep.
  4. Reset 2FA needs a reason and refuses admin accounts.
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
    os.environ.pop("FORCE_2FA_ENABLED", None)
    os.environ.pop("ADMIN_2FA_REQUIRED", None)
    os.environ["ADMIN_EMAILS"] = "admin.citizen@example.com,admin.rep@example.com"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, RepAccount

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            admin = CitizenAccount(email="admin.citizen@example.com", password_hash=hash_password("pw-12345678"),
                                   display_name="Operator", state="FL", city="Orlando",
                                   congressional_district="FL-10", verified=True, is_active=True)
            other_rep = RepAccount(email="someone.rep@example.com", password_hash=hash_password("pw-12345678"),
                                   display_name="Some Rep", official_id="some-rep-official", is_active=True)
            admin_rep = RepAccount(email="admin.rep@example.com", password_hash=hash_password("pw-12345678"),
                                   display_name="Second Admin", official_id="second-admin-official",
                                   is_active=True, totp_enabled_at=datetime.utcnow())
            plain = CitizenAccount(email="plain@example.com", password_hash="x", display_name="Plain",
                                   state="FL", city="Orlando", congressional_district="FL-10",
                                   verified=True, is_active=True, totp_enabled_at=datetime.utcnow(),
                                   totp_secret_encrypted="not-a-real-secret")
            db.add_all([admin, other_rep, admin_rep, plain])
            db.commit()
            admin_id, other_rep_id, admin_rep_id, plain_id = admin.id, other_rep.id, admin_rep.id, plain.id

        ct = issue_citizen_token(admin_id)
        admin_h = {"X-Citizen-Token": ct, "X-CSRF-Token": compute_csrf_token(ct)}

        def get(path, h):
            c.cookies.clear()
            return c.get(path, headers=h)

        def post(path, h, json=None):
            c.cookies.clear()
            return c.post(path, headers=h, json=json)

        # 1. No 2FA: whoami answers, everything else refuses.
        r = get("/api/admin/whoami", admin_h)
        check(r.status_code == 200, f"whoami must answer an unenrolled admin, got {r.status_code}")
        check(r.json().get("needs_2fa_enrollment") is True, f"whoami must say 2FA is needed, got {r.text[:120]}")
        check(r.json().get("kind") == "citizen", "whoami names the admin account kind")
        r = get("/api/admin/reports", admin_h)
        check(r.status_code == 403, f"reports must refuse an unenrolled admin, got {r.status_code}")
        check("two-factor" in r.text, f"the refusal says why, got {r.text[:120]}")
        r = post(f"/api/admin/users/rep/{other_rep_id}/suspend", admin_h, {"reason": "test"})
        check(r.status_code == 403, f"suspend must refuse an unenrolled admin, got {r.status_code}")
        with SessionLocal() as db:
            check(db.get(RepAccount, other_rep_id).suspended_at is None, "nothing was suspended")

        # 2. The off switch.
        os.environ["ADMIN_2FA_REQUIRED"] = "false"
        r = get("/api/admin/reports", admin_h)
        check(r.status_code == 200, f"ADMIN_2FA_REQUIRED=false lets an unenrolled admin in, got {r.status_code}")
        os.environ.pop("ADMIN_2FA_REQUIRED", None)

        # 3. ?as= picks the account when a rep session is open too.
        rt = issue_session_token(other_rep_id)
        both_h = {"X-Citizen-Token": ct, "Authorization": f"Bearer {rt}", "X-CSRF-Token": compute_csrf_token(ct)}
        r = post("/api/2fa/enroll/start", both_h)
        check(r.status_code == 200 and "Citizen" not in r.json().get("label", ""),
              f"without ?as enrollment goes to the rep session, got {r.text[:120]}")
        r = post("/api/2fa/enroll/start?as=citizen", both_h)
        check(r.status_code == 200 and "Citizen" in r.json().get("label", ""),
              f"?as=citizen enrolls the admin citizen account, got {r.text[:120]}")
        with SessionLocal() as db:
            db.get(CitizenAccount, admin_id).totp_enabled_at = datetime.utcnow()
            db.commit()
        r = get("/api/2fa/status", both_h)
        check(r.status_code == 200 and r.json().get("enabled") is False,
              f"without ?as the rep session wins (unchanged), got {r.text[:120]}")
        r = get("/api/2fa/status?as=citizen", both_h)
        check(r.status_code == 200 and r.json().get("enabled") is True,
              f"?as=citizen reads the admin citizen account, got {r.text[:120]}")
        r = get("/api/2fa/status?as=candidate", both_h)
        check(r.status_code == 401, f"?as= a session the request lacks is refused, got {r.status_code}")

        # 1b. With 2FA on the admin account, admin opens up.
        r = get("/api/admin/whoami", admin_h)
        check(r.json().get("needs_2fa_enrollment") is False, "enrolled admin no longer needs 2FA")
        r = get("/api/admin/reports", admin_h)
        check(r.status_code == 200, f"enrolled admin reads reports, got {r.status_code}")

        # 4. Reset 2FA: reason required, admins refused.
        r = post(f"/api/admin/accounts/citizen/{plain_id}/reset-2fa", admin_h)
        check(r.status_code == 422, f"reset without a reason is refused, got {r.status_code}")
        r = post(f"/api/admin/accounts/citizen/{plain_id}/reset-2fa", admin_h, {"reason": "  "})
        check(r.status_code == 422, f"a blank reason is refused, got {r.status_code}")
        r = post(f"/api/admin/accounts/rep/{admin_rep_id}/reset-2fa", admin_h,
                 {"reason": "Lost phone, confirmed by video call"})
        check(r.status_code == 400, f"resetting a fellow admin is refused, got {r.status_code}")
        with SessionLocal() as db:
            check(db.get(RepAccount, admin_rep_id).totp_enabled_at is not None, "the admin's 2FA is untouched")
        r = post(f"/api/admin/accounts/citizen/{admin_id}/reset-2fa", admin_h,
                 {"reason": "Resetting my own account"})
        check(r.status_code == 400, f"resetting your own admin account is refused, got {r.status_code}")
        r = post(f"/api/admin/accounts/citizen/{plain_id}/reset-2fa", admin_h,
                 {"reason": "Lost phone, confirmed by video call"})
        check(r.status_code == 200, f"reset with a reason works, got {r.status_code} {r.text[:120]}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, plain_id).totp_enabled_at is None, "the citizen's 2FA was reset")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ADMIN ACCESS NEEDS 2FA, AND RESET 2FA HAS ITS GUARDS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
