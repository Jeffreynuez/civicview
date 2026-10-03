"""State and district counts on bill likes (2026-10-03).

Run:  cd backend && python3 tests/test_bill_reaction_scopes.py   (exit 0 = pass)

With ?state=FL&district=FL-17 the bill reaction routes also return
scoped.state and scoped.district: likes and dislikes from citizens whose
state or congressional district was stamped that way when they reacted.
Reps' and candidates' reactions have no geography and count only in the
nationwide totals. The geography is validated: two-letter state, a
"XX-N" district, and a district must sit in the named state.
"""
import os
import sys
import tempfile

KEY = "119-s-2403"


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
    from app.auth import compute_csrf_token, issue_session_token
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, RepAccount

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    url = "/api/engagement/bills/reactions"
    with TestClient(m.app) as c:
        people = {}
        with SessionLocal() as db:
            for name, st, dist in [("a", "FL", "FL-17"), ("b", "FL", "FL-17"), ("c", "FL", "FL-10"), ("d", "LA", "LA-4")]:
                row = CitizenAccount(email=f"{name}@example.com", password_hash="x", display_name=name.upper(),
                                     city="Town", state=st, congressional_district=dist, is_active=True)
                db.add(row)
                db.flush()
                people[name] = row.id
            rep = RepAccount(official_id="X000002", email="rep2@example.com", password_hash="x",
                             display_name="Rep", owner_state="FL", owner_district="FL-17", is_active=True)
            db.add(rep)
            db.commit()
            rep_id = rep.id

        def as_cit(name):
            t = issue_citizen_token(people[name])
            return {"X-Citizen-Token": t, "X-CSRF-Token": compute_csrf_token(t)}

        def post(headers, kind, **geo):
            c.cookies.clear()
            return c.post(url, json={"bill_key": KEY, "kind": kind, **geo}, headers=headers)

        post(as_cit("a"), "up")
        post(as_cit("b"), "down")
        post(as_cit("c"), "up")
        r = post(as_cit("d"), "up", state="LA", district="LA-4")
        s = r.json()
        check(r.status_code == 200 and s["scoped"]["state"] == {"label": "LA", "up_count": 1, "down_count": 0},
              f"POST returns scoped counts for the named geography: {r.status_code} {s}")
        rt = issue_session_token(rep_id)
        post({"Authorization": f"Bearer {rt}", "X-CSRF-Token": compute_csrf_token(rt)}, "up")

        c.cookies.clear()
        body = c.get(url, params={"keys": KEY, "state": "fl", "district": "fl-17"}).json()["reactions"][KEY]
        check((body["up_count"], body["down_count"]) == (4, 1), f"nationwide includes the rep: {body}")
        check(body["scoped"].get("state") == {"label": "FL", "up_count": 2, "down_count": 1},
              f"FL: a up, c up, b down; the rep (FL-17) not counted: {body['scoped']}")
        check(body["scoped"].get("district") == {"label": "FL-17", "up_count": 1, "down_count": 1},
              f"FL-17: a up, b down: {body['scoped']}")

        # A district alone implies its state.
        c.cookies.clear()
        body = c.get(url, params={"keys": KEY, "district": "LA-4"}).json()["reactions"][KEY]
        check(set(body["scoped"]) == {"state", "district"} and body["scoped"]["state"]["label"] == "LA",
              f"district implies state: {body['scoped']}")

        # No geography: no scoped block.
        c.cookies.clear()
        body = c.get(url, params={"keys": KEY}).json()["reactions"][KEY]
        check(body["scoped"] == {}, f"no geography, no scoped counts: {body['scoped']}")

        # Validation.
        for params in ({"keys": KEY, "state": "Florida"}, {"keys": KEY, "district": "FL17"},
                       {"keys": KEY, "state": "LA", "district": "FL-17"}):
            c.cookies.clear()
            r = c.get(url, params=params)
            check(r.status_code == 422, f"refused {params}: {r.status_code}")

        # A flip re-stamps the geography (a moved to LA-4 since liking).
        with SessionLocal() as db:
            row = db.get(CitizenAccount, people["a"])
            row.state, row.congressional_district = "LA", "LA-4"
            db.commit()
        s = post(as_cit("a"), "down", state="LA", district="LA-4").json()
        check(s["scoped"]["district"] == {"label": "LA-4", "up_count": 1, "down_count": 1},
              f"flip re-stamps geography: {s['scoped']}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: bill reaction scopes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
