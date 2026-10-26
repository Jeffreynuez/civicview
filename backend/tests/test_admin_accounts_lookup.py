"""Admin Accounts tab: look up an account by email and reset its 2FA (2026-10-26 admin audit, L14 and L15).

Run:  cd backend && python3 tests/test_admin_accounts_lookup.py   (exit 0 = pass)

Guards:
  1. GET /api/admin/accounts?email= finds the citizen, rep and candidate
     accounts with that exact address, any capitalization, and nothing
     for part of an address.
  2. Each row says whether 2FA is on, whether it's an admin, and its
     state, and carries no secret, hash or recovery code.
  3. Only admins can look up.
  4. The row's kind and id are what Reset 2FA takes: after a reset the
     lookup shows 2FA off.
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
    os.environ["ADMIN_EMAILS"] = "lookup.admin@example.com"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.db import SessionLocal
    from app.models.pages import CandidateAccount, CitizenAccount, RepAccount

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    now = datetime.utcnow()
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            adm = RepAccount(email="lookup.admin@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Lookup Admin", official_id="lookup-admin-official",
                             is_active=True, totp_enabled_at=now)
            other = RepAccount(email="plain.rep@example.com", password_hash="x", display_name="Plain Rep",
                               official_id="plain-rep-official", is_active=True)
            rep = RepAccount(email="shared@example.com", password_hash="x", display_name="Shared Rep",
                             official_id="shared-rep-official", is_active=True, totp_enabled_at=now,
                             totp_secret_encrypted="not-a-real-secret")
            cit = CitizenAccount(email="shared@example.com", password_hash="x", display_name="Shared Citizen",
                                 state="FL", city="Orlando", congressional_district="FL-10",
                                 verified=False, verified_method="demo", is_active=True, suspended_at=now)
            cand = CandidateAccount(candidate_id="fl-cand-shared", email="shared@example.com", password_hash="x",
                                    display_name="Shared Candidate", owner_state="FL", claim_status="active",
                                    is_active=True)
            db.add_all([adm, other, rep, cit, cand])
            db.commit()
            ids = dict(adm=adm.id, other=other.id, rep=rep.id, cit=cit.id, cand=cand.id)

        at = issue_session_token(ids["adm"])
        admin_h = {"Authorization": f"Bearer {at}", "X-CSRF-Token": compute_csrf_token(at)}
        ot = issue_session_token(ids["other"])
        other_h = {"Authorization": f"Bearer {ot}", "X-CSRF-Token": compute_csrf_token(ot)}

        def lookup(email, headers=admin_h):
            c.cookies.clear()
            return c.get("/api/admin/accounts", headers=headers, params={"email": email})

        # 1. Exact address, any capitalization; not part of one.
        r = lookup("  Shared@Example.COM ")
        items = r.json().get("items", []) if r.status_code == 200 else []
        check(r.status_code == 200 and sorted(i["kind"] for i in items) == ["candidate", "citizen", "rep"],
              f"three accounts share the address {r.status_code} {items}")
        r = lookup("shared@example")
        check(r.status_code == 200 and r.json().get("items") == [], f"part of an address finds nothing {r.text[:120]}")

        # 2. The row's facts, and no secrets.
        by = {i["kind"]: i for i in items}
        check(by.get("rep", {}).get("twofa_enabled") is True and by.get("rep", {}).get("page_id") == "shared-rep-official",
              f"rep row {by.get('rep')}")
        check(by.get("citizen", {}).get("suspended") is True and by.get("citizen", {}).get("demo") is True
              and by.get("citizen", {}).get("twofa_enabled") is False, f"citizen row {by.get('citizen')}")
        check(by.get("candidate", {}).get("page_id") == "fl-cand-shared", f"candidate row {by.get('candidate')}")
        text = str(items).lower()
        check(all(word not in text for word in ("password", "hash", "secret", "recovery", "not-a-real-secret")),
              "no secrets in the rows")
        r = lookup("lookup.admin@example.com")
        check(r.json().get("items", [{}])[0].get("is_admin") is True, "the admin row says admin")

        # 3. Admins only.
        r = lookup("shared@example.com", headers=other_h)
        check(r.status_code in (401, 403), f"non-admin refused, got {r.status_code}")
        c.cookies.clear()
        r = c.get("/api/admin/accounts", params={"email": "shared@example.com"})
        check(r.status_code in (401, 403), f"signed out refused, got {r.status_code}")

        # 4. Reset by the row's kind and id; the lookup shows it off.
        c.cookies.clear()
        r = c.post(f"/api/admin/accounts/rep/{by['rep']['id']}/reset-2fa", headers=admin_h,
                   json={"reason": "Lost phone; wrote from the account address"})
        check(r.status_code == 200 and r.json().get("had_2fa") is True, f"reset {r.status_code} {r.text[:120]}")
        rep_row = next((i for i in lookup("shared@example.com").json().get("items", []) if i["kind"] == "rep"), {})
        check(rep_row.get("twofa_enabled") is False, f"2FA shows off after the reset {rep_row}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ACCOUNT LOOKUP WORKS AND STAYS NARROW.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
