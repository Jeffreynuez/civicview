"""Only a real verification is ever called verified (2026-10-16).

Run:  cd backend && python3 tests/test_verified_badge_honest.py   (exit 0 = pass)

Before: the citizen dashboard showed "Verified citizen" for every
account, demo accounts included, and several places read the raw
`verified` flag, which a demo grant or an operator account seeded with
"verified": true also carries:
- comments and votes were stamped authored_verified from that flag, so
  such an account's comments had no Unverified label;
- a citizen poll's author summary said verified;
- Account & settings, the location card and ID.me's start and callback
  treated the account as verified ("You're already verified.", "Your
  state comes from your identity verification").

Now the server's rule, services/verified_identity.is_verified_person
(verified by a real method: 'id.me' or 'id.me-archive'), decides all of
them, /me carries it as `verified_person` for the frontend, and the boot
backfill clears authored_verified on rows such accounts already wrote.
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
    for name in ("IDME_ENABLED", "IDME_CLIENT_ID", "IDME_CLIENT_SECRET", "IDME_REDIRECT_URI"):
        os.environ.pop(name, None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import (
        CitizenAccount, Poll, PollComment, PollOption, Post, PostComment, RepAccount,
    )
    from app.services.authored_verified_backfill import backfill_authored_verified
    from app.services.entitlements import authored_verified_flag

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    accounts = {
        # name: (verified, verified_method, is a verified person)
        "demo": (False, "demo", False),
        "olddemo": (False, None, False),
        "handflag": (True, None, False),      # operator account, flag set by hand
        "demoflag": (True, "demo", False),
        "idme": (True, "id.me", True),
        "archive": (True, "id.me-archive", True),
    }
    ids = {}
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            for i, (key, (verified, method, _)) in enumerate(accounts.items()):
                a = CitizenAccount(
                    email=f"{key}@example.com", password_hash=hash_password("pw-12345678"),
                    display_name=f"Badge Test {key}", city="", state="FL",
                    congressional_district="FL-10", verified=verified, verified_method=method,
                    is_active=True, is_subscribed=True,
                )
                db.add(a)
                db.flush()
                ids[key] = a.id
            db.commit()

        def headers(key):
            t = issue_citizen_token(ids[key])
            return {"X-Citizen-Token": t, "X-CSRF-Token": compute_csrf_token(t)}

        # 1. /me carries the server's rule
        for key, (_, _, person) in accounts.items():
            c.cookies.clear()
            me = c.get("/api/citizen-auth/me", headers=headers(key)).json()
            check(me.get("verified_person") is person,
                  f"{key}: verified_person {me.get('verified_person')!r}, want {person}")

        # 2. the stamp on comments, votes and likes
        with SessionLocal() as db:
            for key, (_, _, person) in accounts.items():
                got = authored_verified_flag(citizen=db.get(CitizenAccount, ids[key]))
                check(got is person, f"{key}: authored_verified_flag {got}, want {person}")

        # 3. end to end: a hand-flagged account's poll and comment read
        #    as unverified; an ID.me account's comment as verified
        with SessionLocal() as db:
            poll = Poll(post_id=None, question="Badge honesty?", author_kind="citizen",
                        author_citizen_id=ids["handflag"], target_official_id="badge-test-page",
                        default_visibility_scope="country", presentation_mode="full")
            db.add(poll)
            db.flush()
            db.add(PollOption(poll_id=poll.id, text="Yes", sort_order=0))
            db.commit()
            poll_id = poll.id
        c.cookies.clear()
        listing = c.get("/api/pages/badge-test-page/citizen-polls").json()
        authors = [p["author"] for p in listing.get("active", [])]
        check(authors and authors[0].get("verified") is False,
              f"hand-flagged poll author should read unverified: {authors}")
        for key, want in (("handflag", False), ("idme", True)):
            c.cookies.clear()
            r = c.post(f"/api/citizen-polls/{poll_id}/comments", json={"body": f"Comment by {key}"},
                       headers=headers(key))
            check(r.status_code == 201, f"{key} comment: {r.status_code} {r.text[:160]}")
            if r.status_code == 201:
                check(r.json().get("authored_verified") is want,
                      f"{key} comment authored_verified {r.json().get('authored_verified')!r}, want {want}")

        # 4. the boot backfill clears what such accounts already wrote,
        #    leaves real verifications and page owners alone, converges
        with SessionLocal() as db:
            rep = RepAccount(email="owner@example.com", password_hash="x", display_name="Owner Example",
                             official_id="badge-test-rep", is_active=True)
            db.add(rep)
            db.flush()
            post = Post(official_id="badge-test-rep", author_id=rep.id, body="A post")
            db.add(post)
            db.flush()
            rows = {
                "handflag": PostComment(post_id=post.id, citizen_id=ids["handflag"], body="old",
                                        citizen_display_name="Badge Test handflag", authored_verified=True),
                "demoflag": PollComment(poll_id=poll_id, citizen_id=ids["demoflag"], body="old",
                                        citizen_display_name="Badge Test demoflag", authored_verified=True),
                "idme": PostComment(post_id=post.id, citizen_id=ids["idme"], body="old",
                                    citizen_display_name="Badge Test idme", authored_verified=True),
                "rep": PostComment(post_id=post.id, author_rep_id=rep.id, body="old",
                                   citizen_display_name="Owner Example", authored_verified=True),
            }
            db.add_all(rows.values())
            db.commit()
            row_ids = {k: (type(v), v.id) for k, v in rows.items()}
        first = backfill_authored_verified()
        check(sum(first.values()) >= 2, f"backfill should clear the two unearned rows: {first}")
        with SessionLocal() as db:
            for key, want in (("handflag", False), ("demoflag", False), ("idme", True), ("rep", True)):
                model, rid = row_ids[key]
                got = db.get(model, rid).authored_verified
                check(got is want, f"backfill: {key} row authored_verified {got}, want {want}")
        second = backfill_authored_verified()
        check(sum(second.values()) == 0, f"backfill should converge: {second}")

        # 5. location: only a real verification fixes the state
        for key, want in (("handflag", 200), ("idme", 409)):
            c.cookies.clear()
            r = c.put("/api/citizen-auth/me/location", headers=headers(key),
                      json={"state": "VT", "congressional_district": "AL"})
            check(r.status_code == want, f"{key} location change: {r.status_code}, want {want}")

        # 6. ID.me: a hand-set flag is not "already verified"
        for key, already in (("handflag", False), ("idme", True)):
            c.cookies.clear()
            r = c.post("/api/identity-verification/start", headers=headers(key))
            said_already = r.status_code == 409 and "already verified" in r.text
            check(said_already is already, f"{key} ID.me start: {r.status_code} {r.text[:120]}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: only a real verification is called verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
