"""Sessions can be revoked, and deleting an account needs the password
(audit S7).

Run:  cd backend && python3 tests/test_session_revocation.py   (exit 0 = pass)

1. "Sign out everywhere" kills every token of the account, from every
   device, and a fresh login works afterwards.
2. A completed password reset kills every existing token.
3. Tokens minted before the epoch existed (no "se" key) still work
   for an account that was never revoked, so the deploy signs nobody
   out.
4. Delete needs the current password (403 without it or with a wrong
   one); demo citizen accounts are exempt.
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
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)
    from datetime import datetime, timedelta, timezone

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password
    from app.auth_citizen import _serializer as citizen_serializer
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, PasswordResetToken
    from app.services.password_reset import _hash_token

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        def hdrs(tok):
            return {"X-Citizen-Token": tok, "X-CSRF-Token": compute_csrf_token(tok)}

        def me_ok(tok):
            c.cookies.clear()
            return c.get("/api/citizen-auth/me", headers={"X-Citizen-Token": tok}).status_code == 200

        def login(email, pw):
            c.cookies.clear()
            r = c.post("/api/citizen-auth/login", json={"email": email, "password": pw})
            assert r.status_code == 200, f"login {r.status_code} {r.text[:160]}"
            return r.json()["citizen_token"]

        db = SessionLocal()
        real = CitizenAccount(
            email="real.person@example.com",
            password_hash=hash_password("correct horse 1"),
            display_name="Real Person", city="Orlando", state="FL",
            congressional_district="FL-10", is_active=True, verified=False,
        )
        db.add(real)
        db.commit()
        real_id = real.id
        db.close()

        # 3. legacy token shape still accepted at epoch 0
        legacy = citizen_serializer.dumps({"citizen_id": real_id})
        check(me_ok(legacy), "legacy token without 'se' should still work")

        # 1. sign out everywhere
        t1 = login("real.person@example.com", "correct horse 1")
        t2 = login("real.person@example.com", "correct horse 1")
        check(me_ok(t1) and me_ok(t2), "two fresh sessions should both work")
        c.cookies.clear()
        r = c.post("/api/sessions/sign-out-everywhere", headers=hdrs(t1))
        check(r.status_code == 200 and r.json().get("kind") == "citizen",
              f"sign-out-everywhere -> {r.status_code} {r.text[:120]}")
        check(not me_ok(t1), "token 1 should be dead after sign-out-everywhere")
        check(not me_ok(t2), "token 2 (other device) should be dead too")
        check(not me_ok(legacy), "legacy token should be dead after the bump")
        t3 = login("real.person@example.com", "correct horse 1")
        check(me_ok(t3), "a new login after sign-out-everywhere should work")

        # 2. password reset
        db = SessionLocal()
        db.add(PasswordResetToken(
            token_hash=_hash_token("raw-reset-token"), identity_kind="citizen",
            account_id=real_id, expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1),
        ))
        db.commit()
        db.close()
        c.cookies.clear()
        r = c.post("/api/citizen-auth/password-reset/confirm",
                   json={"token": "raw-reset-token", "new_password": "brand new pass 2"})
        check(r.status_code == 200, f"reset confirm -> {r.status_code} {r.text[:120]}")
        check(not me_ok(t3), "session from before the reset should be dead")
        t4 = login("real.person@example.com", "brand new pass 2")
        check(me_ok(t4), "login with the new password should work")

        # 4. delete needs the password
        body = {"confirm_email": "real.person@example.com", "mode": "soft"}
        c.cookies.clear()
        r = c.post("/api/citizen-auth/delete", json=body, headers=hdrs(t4))
        check(r.status_code == 403, f"delete without password should 403, got {r.status_code}")
        c.cookies.clear()
        r = c.post("/api/citizen-auth/delete", json={**body, "password": "wrong"}, headers=hdrs(t4))
        check(r.status_code == 403, f"delete with wrong password should 403, got {r.status_code}")
        c.cookies.clear()
        r = c.post("/api/citizen-auth/delete", json={**body, "password": "brand new pass 2"}, headers=hdrs(t4))
        check(r.status_code == 200, f"delete with password should pass, got {r.status_code} {r.text[:120]}")

        c.cookies.clear()
        r = c.post("/api/citizen-auth/demo-signup", json={
            "display_name": "Demo Deleter", "state": "FL",
            "congressional_district": "FL-10", "city": "Orlando",
        })
        assert r.status_code == 201, r.text
        demo = r.json()
        c.cookies.clear()
        r = c.post("/api/citizen-auth/delete",
                   json={"confirm_email": demo["email"], "mode": "hard"},
                   headers=hdrs(demo["citizen_token"]))
        check(r.status_code == 200, f"demo delete without password should pass, got {r.status_code} {r.text[:120]}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("SESSIONS REVOCABLE; DELETE NEEDS THE PASSWORD.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
