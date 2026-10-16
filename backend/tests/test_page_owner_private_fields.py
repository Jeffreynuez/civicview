"""The public page payload carries no sign-in time (2026-10-16).

Run:  cd backend && python3 tests/test_page_owner_private_fields.py   (exit 0 = pass)

Before: GET /api/pages/{official_id} returned the owner's last_login_at
inside `owner`, so anyone could see when a representative or candidate
last signed in.

Now `owner` holds only the id, display name and role, for anonymous
visitors and for the owner alike, on rep and candidate pages. The
sign-in time is still recorded on the account.
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
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import hash_password, issue_session_token
    from app.db import SessionLocal
    from app.models.pages import CandidateAccount, RepAccount

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    seen = datetime(2026, 10, 1, 12, 30, 0)
    rep_oid = "private-fields-rep"
    cand_oid = "private-fields-candidate"
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            rep = RepAccount(email="rep@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Rep Example", role="U.S. Representative",
                             official_id=rep_oid, is_active=True, last_login_at=seen)
            cand = CandidateAccount(email="cand@example.com", password_hash=hash_password("pw-12345678"),
                                    display_name="Candidate Example", candidate_id=cand_oid,
                                    claim_status="active", is_active=True, last_login_at=seen)
            db.add_all([rep, cand])
            db.commit()
            rep_id = rep.id

        def owner_of(oid, headers=None):
            c.cookies.clear()
            r = c.get(f"/api/pages/{oid}", headers=headers or {})
            check(r.status_code == 200, f"{oid}: status {r.status_code}")
            return r.json(), r.text

        for oid in (rep_oid, cand_oid):
            body, raw = owner_of(oid)
            owner = body.get("owner") or {}
            check(body.get("claimed") is True, f"{oid}: page should read as claimed")
            check(set(owner) == {"id", "display_name", "role"},
                  f"{oid}: public owner fields should be id, display_name, role; got {sorted(owner)}")
            check("last_login" not in raw, f"{oid}: no sign-in time anywhere in the public payload")
            check(seen.isoformat()[:16] not in raw, f"{oid}: the sign-in timestamp leaked")

        # The owner's own view of the page payload carries no sign-in
        # time either: it is the same public schema.
        tok = issue_session_token(rep_id)
        body, raw = owner_of(rep_oid, {"Authorization": f"Bearer {tok}"})
        check(body.get("is_owner") is True, "rep should be recognized as the owner")
        check("last_login" not in raw, "owner view should not carry last_login_at")

        # Still recorded on the account.
        with SessionLocal() as db:
            check(db.get(RepAccount, rep_id).last_login_at == seen, "sign-in time should stay on the account")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: page payload has no sign-in time")
    return 0


if __name__ == "__main__":
    sys.exit(main())
