"""Likes and dislikes on bills (2026-10-03).

Run:  cd backend && python3 tests/test_bill_reactions.py   (exit 0 = pass)

Covers routers/bill_reactions.py:
  - anonymous callers read totals and cannot write;
  - a citizen likes, flips to dislike, toggles off; totals follow;
  - with a citizen AND a rep signed in, each identity reacts on its own
    (as_identity), and my_reactions reports a slot per identity, null
    when that identity has not reacted (the comment-like bug fixed the
    same day came from conflating those);
  - a rep and a candidate can react to any bill (no page ownership);
  - federal and Open States keys are accepted, anything else refused;
  - responses are no-store and the routes sit outside /api/bills, which
    is edge-cached;
  - deleting an account removes its bill reactions;
  - the stats reactions total counts them.
"""
import os
import sys
import tempfile

STATE_KEY = "ocd-bill/12345678-90ab-cdef-1234-567890abcdef"
FED_KEY = "119-hr-1234"


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
    import app.routers.stats as stats_router
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, issue_session_token
    from app.auth_candidate import issue_candidate_token
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import BillReaction, CandidateAccount, CitizenAccount, RepAccount
    from app.routers.bill_reactions import normalize_bill_key
    from app.services.account_deletion import hard_delete_account

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            cit = CitizenAccount(email="pat@example.com", password_hash="x", display_name="Pat",
                                 city="Shreveport", state="LA", congressional_district="LA-4", is_active=True)
            rep = RepAccount(official_id="X000001", email="rep@example.com", password_hash="x",
                             display_name="A Rep", is_active=True)
            cand = CandidateAccount(candidate_id="cand-test-1", email="cand@example.com", password_hash="x",
                                    display_name="A Candidate", claim_status="active", is_active=True)
            db.add_all([cit, rep, cand])
            db.commit()
            cit_id, rep_id, cand_id = cit.id, rep.id, cand.id

        ct = issue_citizen_token(cit_id)
        rt = issue_session_token(rep_id)
        kt = issue_candidate_token(cand_id)
        as_citizen = {"X-Citizen-Token": ct, "X-CSRF-Token": compute_csrf_token(ct)}
        as_both = {"X-Citizen-Token": ct, "Authorization": f"Bearer {rt}", "X-CSRF-Token": compute_csrf_token(ct)}
        as_candidate = {"X-Candidate-Token": kt, "X-CSRF-Token": compute_csrf_token(kt)}
        url = "/api/engagement/bills/reactions"

        # Key format.
        check(normalize_bill_key(" 119-HR-1234 ") == FED_KEY, "federal key normalizes")
        check(normalize_bill_key(STATE_KEY.upper().replace("OCD-BILL", "ocd-bill")) == STATE_KEY, "state key normalizes")
        for bad in ("hr-1234", "119-xx-1", "ocd-bill/not-a-uuid", "../etc", ""):
            check(normalize_bill_key(bad) is None, f"refuses {bad!r}")

        # Anonymous.
        c.cookies.clear()
        r = c.get(url, params={"keys": f"{FED_KEY},{STATE_KEY},nonsense"})
        check(r.status_code == 200, f"anon read: {r.status_code}")
        check(r.headers.get("cache-control") == "no-store", f"no-store: {r.headers.get('cache-control')!r}")
        body = r.json()["reactions"]
        check(set(body) == {FED_KEY, STATE_KEY}, f"unsupported keys skipped: {sorted(body)}")
        check(body[FED_KEY]["my_reactions"] == {}, "anon has no identity slots")
        r = c.post(url, json={"bill_key": FED_KEY, "kind": "up"})
        check(r.status_code in (401, 403), f"anon write refused: {r.status_code}")

        # Citizen: like, flip, toggle off.
        c.cookies.clear()
        r = c.post(url, json={"bill_key": FED_KEY, "kind": "up"}, headers=as_citizen)
        check(r.status_code == 200, f"citizen like: {r.status_code} {r.text[:200]}")
        s = r.json()
        check((s["up_count"], s["down_count"], s["my_reactions"]) == (1, 0, {"citizen": "up"}), f"after like: {s}")
        c.cookies.clear()
        s = c.post(url, json={"bill_key": FED_KEY, "kind": "down"}, headers=as_citizen).json()
        check((s["up_count"], s["down_count"]) == (0, 1), f"after flip: {s}")
        c.cookies.clear()
        s = c.post(url, json={"bill_key": FED_KEY, "kind": "down"}, headers=as_citizen).json()
        check((s["up_count"], s["down_count"], s["my_reactions"]) == (0, 0, {"citizen": None}), f"after toggle off: {s}")
        c.cookies.clear()
        r = c.post(url, json={"bill_key": "119-zz-1", "kind": "up"}, headers=as_citizen)
        check(r.status_code == 422, f"bad key refused: {r.status_code}")

        # Citizen + rep in one browser: each identity reacts on its own.
        c.cookies.clear()
        s = c.post(url, json={"bill_key": STATE_KEY, "kind": "up", "as_identity": "rep"}, headers=as_both).json()
        check(s.get("my_reactions") == {"citizen": None, "rep": "up"}, f"rep liked, citizen slot null: {s}")
        c.cookies.clear()
        s = c.post(url, json={"bill_key": STATE_KEY, "kind": "up", "as_identity": "citizen"}, headers=as_both).json()
        check(s.get("up_count") == 2 and s.get("my_reactions") == {"citizen": "up", "rep": "up"},
              f"citizen like adds to the rep's, does not undo it: {s}")
        c.cookies.clear()
        r = c.delete(url, params={"bill_key": STATE_KEY, "as_identity": "rep"}, headers=as_both)
        s = r.json()
        check(r.status_code == 200 and s.get("up_count") == 1 and s.get("my_reactions") == {"citizen": "up", "rep": None},
              f"rep clear leaves the citizen's: {r.status_code} {s}")
        c.cookies.clear()
        r = c.post(url, json={"bill_key": STATE_KEY, "kind": "up", "as_identity": "candidate"}, headers=as_both)
        check(r.status_code == 401, f"acting as an identity not signed in is refused: {r.status_code}")

        # A candidate reacts to any bill.
        c.cookies.clear()
        s = c.post(url, json={"bill_key": FED_KEY, "kind": "up"}, headers=as_candidate).json()
        check(s.get("up_count") == 1 and s.get("my_reactions") == {"candidate": "up"}, f"candidate like: {s}")

        # Batch read as citizen + rep.
        c.cookies.clear()
        body = c.get(url, params=[("keys", FED_KEY), ("keys", STATE_KEY)], headers=as_both).json()["reactions"]
        check(body[STATE_KEY]["my_reaction"] == "up" and body[FED_KEY]["my_reactions"] == {"citizen": None, "rep": None},
              f"batch per-identity state: {body}")

        # Stats count them.
        stats_router._detail_cache.update({"at": 0.0, "payload": None, "failed_at": None})
        detail = c.get("/api/stats/detail").json()
        check(detail.get("reactions") == 2, f"stats reactions include bill reactions: {detail.get('reactions')!r}")

        # Deleting the citizen removes their bill reactions.
        with SessionLocal() as db:
            before = db.query(BillReaction).filter(BillReaction.citizen_id == cit_id).count()
            hard_delete_account(db, "citizen", db.get(CitizenAccount, cit_id))
            after = db.query(BillReaction).filter(BillReaction.citizen_id == cit_id).count()
            check(before == 1 and after == 0, f"account deletion: before={before} after={after}")
            check(db.query(BillReaction).count() == 1, "the candidate's reaction stays")

        # The routes are outside the edge-cached prefixes.
        check(not url.startswith(m._CACHEABLE_PREFIXES), "not under a cacheable prefix")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: bill reactions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
