# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Cross-account isolation test for the tracked-items surface.

The fix this guards: tracked bills / officials / elections used to live
in browser localStorage under singleton keys, so logging out of citizen
A and into citizen B kept A's items visible on B's "My Tracked" navbar
badge. The server-side rewrite moved the data into Postgres keyed per-
identity (tracker_kind, tracker_id). This test exercises the rewritten
endpoints end-to-end and asserts that no row from citizen A leaks into
citizen B's responses under any combination of GET / POST / DELETE /
PATCH calls.

How to run (no pytest needed — plain script):

    cd backend
    python3 tests/test_tracked_cross_account.py

The test spins up the FastAPI app against a throwaway SQLite file and
uses TestClient for in-process HTTP — no port collisions, no leftover
state. Exit code 0 = all 8 phases passed; non-zero = an assertion
fired (the message tells you which phase + what it expected).

Phases:
  1. Citizen A signs up + tracks 2 bills, 1 official, 1 election.
  2. Citizen B signs up fresh; B's /api/tracked must be empty.
  3. A returns; A's bills must still be there (persistence).
  4. B tracks her own bill; A's view must not change (isolation).
  5. Anonymous GET returns empty payload (no leak to signed-out).
  6. Anonymous POST returns 401.
  7. A untracks one bill; the other remains.
  8. A patches prefs on her bill; B patching the same bill returns 404
     (existence not leaked across tenants).
"""
import os
import sys
import tempfile


def _bootstrap_env():
    """Throwaway SQLite DB per run + minimal env so app.main imports
    cleanly without needing real secrets."""
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")


def main() -> int:
    _bootstrap_env()
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from fastapi.testclient import TestClient
    import app.main as m

    with TestClient(m.app) as c:
        def reset_cookies():
            c.cookies.clear()

        def demo_signup(name: str):
            """Sign up a fresh demo citizen, return (citizen_token, citizen_id).
            Cookies cleared before the call so each signup starts from
            a clean session — keeps the test honest about what the
            backend resolves identity from."""
            reset_cookies()
            r = c.post("/api/citizen-auth/demo-signup", json={
                "display_name": name,
                "state": "FL",
                "congressional_district": "FL-19",
                "city": "Naples",
            })
            assert r.status_code == 201, f"demo-signup {name}: {r.status_code} {r.text}"
            body = r.json()
            return body["citizen_token"], body["citizen"]["id"]

        def hdrs(tok):
            return {"X-Citizen-Token": tok}

        # ── PHASE 1 ─────────────────────────────────────────────────
        tokA, idA = demo_signup("Cross Account A")
        reset_cookies()
        for k, snap in [
            ("119-hr-1234", {"title": "A's first bill"}),
            ("119-s-5678", {"title": "A's second bill"}),
        ]:
            assert c.post(
                "/api/tracked/bills",
                headers=hdrs(tokA),
                json={"bill_key": k, "snapshot": snap},
            ).status_code == 200, f"track bill {k}"
        assert c.post(
            "/api/tracked/officials",
            headers=hdrs(tokA),
            json={"official_key": "rubio-marco", "snapshot": {"name": "Marco Rubio"}},
        ).status_code == 200
        assert c.post(
            "/api/tracked/elections",
            headers=hdrs(tokA),
            json={"election_key": "fl-senate-2026", "snapshot": {"name": "FL Senate 2026"}},
        ).status_code == 200
        reset_cookies()
        a1 = c.get("/api/tracked", headers=hdrs(tokA)).json()
        assert len(a1["bills"]) == 2
        assert len(a1["officials"]) == 1
        assert len(a1["elections"]) == 1
        a_keys = sorted(b["bill_key"] for b in a1["bills"])
        print(f"[A id={idA}] tracked: bills={a_keys}, officials=1, elections=1")

        # ── PHASE 2 ─────────────────────────────────────────────────
        tokB, idB = demo_signup("Cross Account B")
        assert idB != idA
        reset_cookies()
        b1 = c.get("/api/tracked", headers=hdrs(tokB)).json()
        assert b1 == {"bills": [], "officials": [], "elections": []}, (
            f"BUG — B's payload should be empty, got: {b1}"
        )
        print(f"[B id={idB}] empty payload — no leak from A")

        # ── PHASE 3 ─────────────────────────────────────────────────
        reset_cookies()
        a2 = c.get("/api/tracked", headers=hdrs(tokA)).json()
        assert len(a2["bills"]) == 2, f"A's bills should persist, got {len(a2['bills'])}"
        print(f"[A re-check] {len(a2['bills'])} bills — persistence OK")

        # ── PHASE 4 ─────────────────────────────────────────────────
        reset_cookies()
        assert c.post(
            "/api/tracked/bills",
            headers=hdrs(tokB),
            json={"bill_key": "119-hr-9999", "snapshot": {"title": "B's only bill"}},
        ).status_code == 200
        reset_cookies()
        b2 = c.get("/api/tracked", headers=hdrs(tokB)).json()
        assert [x["bill_key"] for x in b2["bills"]] == ["119-hr-9999"], (
            f"B should only see her own bill, got {b2['bills']}"
        )
        reset_cookies()
        a3 = c.get("/api/tracked", headers=hdrs(tokA)).json()
        a_keys2 = sorted(x["bill_key"] for x in a3["bills"])
        assert a_keys2 == a_keys, f"A bills mutated: was {a_keys}, now {a_keys2}"
        print(f"[isolation] A's bills unchanged after B tracks: {a_keys2}")

        # ── PHASE 5 ─────────────────────────────────────────────────
        reset_cookies()
        anon = c.get("/api/tracked").json()
        assert anon == {"bills": [], "officials": [], "elections": []}
        print("[anon] empty payload")

        # ── PHASE 6 ─────────────────────────────────────────────────
        r = c.post("/api/tracked/bills", json={"bill_key": "anon-fail", "snapshot": {}})
        assert r.status_code == 401, f"anon write must 401, got {r.status_code}"
        print("[anon] write rejected 401")

        # ── PHASE 7 ─────────────────────────────────────────────────
        reset_cookies()
        r = c.delete("/api/tracked/bills/119-hr-1234", headers=hdrs(tokA))
        assert r.status_code == 200
        assert r.json()["deleted"] == 1
        reset_cookies()
        a4 = c.get("/api/tracked", headers=hdrs(tokA)).json()
        assert len(a4["bills"]) == 1
        assert a4["bills"][0]["bill_key"] == "119-s-5678"
        print("[untrack] 119-hr-1234 removed; 119-s-5678 remains")

        # ── PHASE 8 ─────────────────────────────────────────────────
        reset_cookies()
        r = c.patch(
            "/api/tracked/bills/119-s-5678/prefs",
            headers=hdrs(tokA),
            json={"prefs": {"on_vote_scheduled": True, "on_signed": False}},
        )
        assert r.status_code == 200
        prefs = r.json()["prefs"]
        assert prefs["on_vote_scheduled"] is True
        assert prefs["on_signed"] is False
        reset_cookies()
        # B trying to patch A's bill must NOT succeed and must NOT leak
        # the row's existence — 404 (not 403, which would imply "found
        # but forbidden").
        r = c.patch(
            "/api/tracked/bills/119-s-5678/prefs",
            headers=hdrs(tokB),
            json={"prefs": {"on_signed": True}},
        )
        assert r.status_code == 404, (
            f"B patching A's prefs should 404 (no existence leak), got {r.status_code}"
        )
        print("[isolation] B patching A's prefs → 404 (no cross-tenant write)")

    print("\nALL ASSERTIONS PASSED — cross-account isolation verified end-to-end.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
