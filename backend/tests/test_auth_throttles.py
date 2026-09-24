"""Auth throttling (audit S8).

Run:  cd backend && python3 tests/test_auth_throttles.py   (exit 0 = pass)

1. 2FA code checks: 10 attempts per account per 15 minutes, then 429.
   A six-digit guess never reaches the bcrypt recovery-code check;
   a recovery-shaped code does.
2. Password reset requests: 5 per caller per hour at the HTTP layer,
   and at most 3 emails per account per hour whoever asks.
3. FORCE_2FA_ENABLED is enforced by the backend: an unenrolled rep's
   writes get 403 2fa_enrollment_required, 2FA enrollment itself
   stays open, and nothing is blocked with the switch off.
"""
import os
import sys
import tempfile


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ.pop("FORCE_2FA_ENABLED", None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)
    from datetime import datetime, timezone

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, RepAccount
    from app.services import password_reset, recovery_codes_service, totp_service

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        db = SessionLocal()
        cit = CitizenAccount(
            email="twofa.user@example.com", password_hash=hash_password("pw-12345678"),
            display_name="Two FA", city="Orlando", state="FL",
            congressional_district="FL-10", is_active=True, verified=False,
            totp_secret_encrypted=totp_service.encrypt_secret(totp_service.generate_secret()),
            totp_enabled_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        rep = RepAccount(
            email="rep.unenrolled@example.com", password_hash=hash_password("pw-12345678"),
            display_name="Rep Unenrolled", official_id="test-rep-2fa", is_active=True,
        )
        db.add_all([cit, rep])
        db.commit()
        db.close()

        def login(path, email, key):
            c.cookies.clear()
            r = c.post(path, json={"email": email, "password": "pw-12345678"})
            assert r.status_code == 200, f"{path} {r.status_code} {r.text[:200]}"
            return r.json()

        # 1. 2FA attempts. The citizen has 2FA, so login pauses for a
        # challenge; use a signed-in session via the token helper instead.
        from app.auth_citizen import issue_citizen_token
        db = SessionLocal()
        cid = db.query(CitizenAccount).filter_by(email="twofa.user@example.com").one().id
        db.close()
        ctok = issue_citizen_token(cid)
        h = {"X-Citizen-Token": ctok, "X-CSRF-Token": compute_csrf_token(ctok)}

        calls = []
        real_consume = recovery_codes_service.consume_code

        def counting_consume(*a, **kw):
            calls.append(a[-1])
            return real_consume(*a, **kw)

        recovery_codes_service.consume_code = counting_consume
        c.cookies.clear()
        r = c.post("/api/2fa/verify", json={"code": "000000"}, headers=h)
        check(r.status_code == 400, f"wrong TOTP should 400, got {r.status_code}")
        check(calls == [], "a six-digit guess must not reach the recovery-code check")
        r = c.post("/api/2fa/verify", json={"code": "ABCDE-FGHJK"}, headers=h)
        check(calls == ["ABCDE-FGHJK"], "a recovery-shaped code should be checked")
        codes = [c.post("/api/2fa/verify", json={"code": "000000"}, headers=h).status_code for _ in range(8)]
        check(all(x == 400 for x in codes), f"attempts 3 to 10 should 400, got {codes}")
        r = c.post("/api/2fa/verify", json={"code": "000000"}, headers=h)
        check(r.status_code == 429, f"11th attempt should 429, got {r.status_code}")
        recovery_codes_service.consume_code = real_consume

        # 2. password reset caps
        sent = []

        class FakeEmail:
            def send(self, **kw):
                sent.append(kw.get("to"))
                return True

        password_reset.get_email_service = lambda: FakeEmail()
        statuses = []
        for _ in range(6):
            c.cookies.clear()
            statuses.append(c.post("/api/citizen-auth/password-reset/request",
                                   json={"email": "twofa.user@example.com"}).status_code)
        check(statuses[:5] == [200] * 5 and statuses[5] == 429,
              f"reset requests should be 5x200 then 429, got {statuses}")
        check(len(sent) == 3, f"only 3 reset emails per account per hour, sent {len(sent)}")

        # 3. force 2FA on the server
        data = login("/api/auth/login", "rep.unenrolled@example.com", "session_token")
        rtok = data["session_token"]
        rh = {"Authorization": f"Bearer {rtok}", "X-CSRF-Token": compute_csrf_token(rtok)}
        body = {"bill_key": "119-hr-1", "snapshot": {"title": "x"}}
        c.cookies.clear()
        r = c.post("/api/tracked/bills", json=body, headers=rh)
        check(r.status_code != 403 or "2fa_enrollment_required" not in r.text,
              "with the switch off nothing should be blocked")
        os.environ["FORCE_2FA_ENABLED"] = "true"
        c.cookies.clear()
        r = c.post("/api/tracked/bills", json=body, headers=rh)
        check(r.status_code == 403 and r.json().get("code") == "2fa_enrollment_required",
              f"unenrolled rep write should be blocked, got {r.status_code} {r.text[:120]}")
        c.cookies.clear()
        r = c.post("/api/2fa/enroll/start", headers=rh)
        check(r.status_code == 200, f"enrollment must stay open, got {r.status_code} {r.text[:120]}")
        os.environ.pop("FORCE_2FA_ENABLED", None)

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("AUTH THROTTLES AND 2FA ENFORCEMENT HOLD.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
