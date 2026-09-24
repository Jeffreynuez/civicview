"""2FA writes need the CSRF token, and succeed with it.

Run:  cd backend && python3 tests/test_two_factor_csrf.py   (exit 0 = pass)

Documents the contract the frontend fix for audit finding B1 relies on:
a signed-in POST to /api/2fa/* without X-CSRF-Token is rejected with 403
csrf_token_mismatch, and the same request with the token succeeds.
lib/twoFactorApi.js used to send no token, so enrollment never worked.
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
    logging.disable(logging.INFO)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token

    failures = []
    with TestClient(m.app) as c:
        r = c.post("/api/citizen-auth/demo-signup", json={
            "display_name": "Two Factor Tester", "city": "Orlando", "state": "FL",
            "congressional_district": "FL-10",
        })
        if r.status_code not in (200, 201):
            print("FAIL: demo signup", r.status_code, r.text[:200])
            return 1
        tok = r.json()["citizen_token"]
        c.cookies.clear()
        base = {"X-Citizen-Token": tok}

        r = c.post("/api/2fa/enroll/start", headers=base)
        if not (r.status_code == 403 and "csrf" in r.text.lower()):
            failures.append(f"no CSRF token should be 403 csrf, got {r.status_code} {r.text[:120]}")

        r = c.post("/api/2fa/enroll/start", headers={**base, "X-CSRF-Token": compute_csrf_token(tok)})
        if r.status_code != 200 or not r.json().get("provisioning_uri"):
            failures.append(f"with CSRF token enroll/start should succeed, got {r.status_code} {r.text[:160]}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("2FA CSRF CONTRACT HOLDS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
