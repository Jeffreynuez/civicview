"""Rep seed fills missing state / district (2026-10-03).

Run:  cd backend && python3 tests/test_seed_scope_fallback.py   (exit 0 = pass)

Production seeds rep accounts from the DEMO_ACCOUNTS_JSON env var, and
that copy of the Test Rep had no owner_state / owner_district. The
State and District filter chips (composer, owner rail, viewer rail)
only render when the owner has those fields, so they never appeared.

Now the seed fills a missing scope field from backend/demo_accounts.json
(matched by official_id or email), then from the curated officials
index for a real official's page. It only ever writes NULL columns, and
the index only offers a congressional district ("TX-7"), never a state
legislative district number.
"""
import json
import os
import sys
import tempfile


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    # The env copy, like production's: credentials, no scope fields.
    os.environ["DEMO_ACCOUNTS_JSON"] = json.dumps({"accounts": [{
        "official_id": "test-civicview-internal",
        "email": "real-test-rep@example.com",
        "password": "env-password-123",
        "display_name": "CivicView Test Rep",
        "role": "Test Account",
    }]})
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import RepAccount
    from app.seed import seed_demo_accounts
    from app.services import officials_index

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        # Boot ran the seed: the row was created from the env copy and
        # took its scope fields from demo_accounts.json.
        with SessionLocal() as db:
            rep = db.query(RepAccount).filter_by(official_id="test-civicview-internal").one()
            check(rep.owner_state == "FL", f"boot seed state: {rep.owner_state!r}")
            check(rep.owner_district == "FL-17", f"boot seed district: {rep.owner_district!r}")
            check(rep.owner_city is None, f"no junk city chip: {rep.owner_city!r}")
            check(rep.email == "real-test-rep@example.com", "credentials come from the env copy")

            # The production case: the row already exists with NULLs.
            rep.owner_state = None
            rep.owner_district = None
            db.commit()
        seed_demo_accounts()
        with SessionLocal() as db:
            rep = db.query(RepAccount).filter_by(official_id="test-civicview-internal").one()
            check(rep.owner_state == "FL" and rep.owner_district == "FL-17",
                  f"top-up of an existing NULL row: {rep.owner_state!r} {rep.owner_district!r}")

        # The page payload now offers the chips.
        payload = c.get("/api/pages/test-civicview-internal").json()
        check(payload.get("allowed_engagement_scopes") == ["country", "state", "district"],
              f"page scopes: {payload.get('allowed_engagement_scopes')!r}")
        check(payload.get("engagement_scope_labels", {}).get("district") == "FL-17",
              f"district label: {payload.get('engagement_scope_labels')!r}")

        # A value somebody set is never overwritten.
        with SessionLocal() as db:
            rep = db.query(RepAccount).filter_by(official_id="test-civicview-internal").one()
            rep.owner_district = "FL-10"
            db.commit()
        seed_demo_accounts()
        with SessionLocal() as db:
            rep = db.query(RepAccount).filter_by(official_id="test-civicview-internal").one()
            check(rep.owner_district == "FL-10", f"hand-set district kept: {rep.owner_district!r}")

        # Officials-index fallback, with a controlled index (no network).
        officials_index._INDEX.clear()
        officials_index._INDEX.update({
            "X000001": {"state": "TX", "district": "TX-7", "city": None},
            "X000002": {"state": "OH", "district": None, "city": None},
            "ocd-person/state-leg": {"state": "FL", "district": "12", "city": None},
        })
        officials_index._LOADED = True
        check(officials_index.owner_scope_fallback("X000001") == ("TX", "TX-7"), "house seat")
        check(officials_index.owner_scope_fallback("X000002") == ("OH", None), "senate seat")
        check(officials_index.owner_scope_fallback("ocd-person/state-leg") == ("FL", None),
              "a state legislative district number is not a congressional district")
        check(officials_index.owner_scope_fallback("not-in-index") == (None, None), "unknown id")

        os.environ["DEMO_ACCOUNTS_JSON"] = json.dumps({"accounts": [
            {"official_id": "X000001", "email": "house@example.com", "password": "pw-house-123",
             "display_name": "House Member"},
            {"official_id": "ocd-person/state-leg", "email": "leg@example.com", "password": "pw-leg-123",
             "display_name": "State Legislator"},
        ]})
        seed_demo_accounts()
        with SessionLocal() as db:
            house = db.query(RepAccount).filter_by(official_id="X000001").one()
            check((house.owner_state, house.owner_district) == ("TX", "TX-7"),
                  f"real House rep from the index: {house.owner_state!r} {house.owner_district!r}")
            leg = db.query(RepAccount).filter_by(official_id="ocd-person/state-leg").one()
            check((leg.owner_state, leg.owner_district) == ("FL", None),
                  f"state legislator gets state only: {leg.owner_state!r} {leg.owner_district!r}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: seed scope fallback")
    return 0


if __name__ == "__main__":
    sys.exit(main())
