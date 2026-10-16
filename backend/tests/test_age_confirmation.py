"""Citizen sign-up requires "I'm 18 or older" (2026-10-16).

Run:  cd backend && python3 tests/test_age_confirmation.py   (exit 0 = pass)

CivicView is for adults 18 and older (Terms section 1, /child-safety),
but nothing at sign-up asked. Now:
1. Boot adds the nullable citizen_accounts.age_confirmed_at column to a
   database created before it existed; the accounts already there keep
   NULL and still sign in.
2. POST /api/citizen-auth/demo-signup without age_confirmed, or with it
   false, is refused (422) and creates nothing.
3. With age_confirmed true the account is created and age_confirmed_at
   holds the time of the sign-up.
4. Refusals don't use up the per-connection sign-up limit.
"""
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    # A database from before the column: create the schema, then drop
    # the column and add an existing account without it.
    from app.auth import hash_password
    from app.db import Base, SessionLocal, engine
    from app.models.pages import CitizenAccount

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        db.add(CitizenAccount(email="earlier@example.com", password_hash=hash_password("pw-12345678"),
                              display_name="Earlier Citizen", city="", state="FL",
                              congressional_district="FL-10", is_active=True))
        db.commit()
    engine.dispose()
    con = sqlite3.connect(db_file.name)
    con.execute("ALTER TABLE citizen_accounts DROP COLUMN age_confirmed_at")
    con.commit()
    cols = [r[1] for r in con.execute("PRAGMA table_info(citizen_accounts)")]
    con.close()
    check("age_confirmed_at" not in cols, "fixture: the old schema should lack the column")

    import app.main as m
    from fastapi.testclient import TestClient
    from app.services import rate_limit

    with TestClient(m.app) as c:
        # 1. boot added the column; the earlier account is untouched
        con = sqlite3.connect(db_file.name)
        cols = [r[1] for r in con.execute("PRAGMA table_info(citizen_accounts)")]
        con.close()
        check("age_confirmed_at" in cols, "boot auto-migrate should add age_confirmed_at")
        with SessionLocal() as db:
            earlier = db.query(CitizenAccount).filter_by(email="earlier@example.com").one()
            check(earlier.age_confirmed_at is None, "an existing account is left as it is")
        c.cookies.clear()
        r = c.post("/api/citizen-auth/login", json={"email": "earlier@example.com", "password": "pw-12345678"})
        check(r.status_code == 200, f"an existing account still signs in: {r.status_code}")

        base = {"display_name": "Avery Adult", "state": "FL", "congressional_district": "FL-10"}

        def count():
            with SessionLocal() as db:
                return db.query(CitizenAccount).count()

        before = count()

        # 2. refused without the box, or with it unticked
        rate_limit.reset_all()
        for label, extra in (("missing", {}), ("false", {"age_confirmed": False})):
            c.cookies.clear()
            r = c.post("/api/citizen-auth/demo-signup", json={**base, **extra})
            check(r.status_code == 422, f"{label}: expected 422, got {r.status_code}")
            check("18 or older" in r.text, f"{label}: the message should say why: {r.text[:200]}")
        check(count() == before, "a refused sign-up creates no account")

        # 4. refusals don't use up the limit (5 per connection per day)
        for _ in range(6):
            c.cookies.clear()
            c.post("/api/citizen-auth/demo-signup", json=base)

        # 3. accepted with the box ticked, and the time is stored
        start = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=5)
        c.cookies.clear()
        r = c.post("/api/citizen-auth/demo-signup", json={**base, "age_confirmed": True})
        check(r.status_code == 201, f"confirmed sign-up: {r.status_code} {r.text[:200]}")
        if r.status_code == 201:
            cid = r.json()["citizen"]["id"]
            with SessionLocal() as db:
                row = db.get(CitizenAccount, cid)
                at = row.age_confirmed_at
                check(at is not None and start <= at <= start + timedelta(minutes=2),
                      f"age_confirmed_at should be the sign-up time, got {at!r}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: sign-up requires the 18-or-older confirmation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
