"""Waitlist abuse guards (audit S9).

Run:  cd backend && python3 tests/test_waitlist_guards.py   (exit 0 = pass)

1. An existing row's note is never overwritten; a new note is a new row.
2. Brevo hears about an address only once, however many CTAs it uses.
3. 5 signups per caller per hour, then 429.
4. With BREVO_DOI_TEMPLATE_ID set, the Brevo call is the double
   opt-in endpoint with the template and redirect URL.
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

    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import CitizenWaitlist
    from app.routers import waitlist as waitlist_router
    from app.services import brevo_service

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    synced = []
    waitlist_router.sync_waitlist_contact = lambda email, *a, **k: synced.append(email)

    with TestClient(m.app) as c:
        def post(**body):
            c.cookies.clear()
            return c.post("/api/waitlist", json={"email": "someone@example.com", **body})

        r = post(clicked_from="comment")
        check(r.status_code == 200 and r.json()["already_subscribed"] is False, f"first signup {r.status_code} {r.text}")
        r = post(clicked_from="comment")
        check(r.json().get("already_subscribed") is True, "repeat signup should report already_subscribed")
        post(clicked_from="claim", note="Claim details from the real requester")
        post(clicked_from="claim", note="Overwrite attempt")
        db = SessionLocal()
        notes = sorted(r.note or "" for r in db.query(CitizenWaitlist).filter_by(email="someone@example.com"))
        db.close()
        check("Claim details from the real requester" in notes, "original claim note must survive")
        check("Overwrite attempt" in notes, "second note should be its own row")
        check(synced == ["someone@example.com"], f"Brevo should be called once per address, got {synced}")

        r = post(clicked_from="subscribe")
        check(r.status_code == 200, f"5th signup should pass, got {r.status_code}")
        r = post(clicked_from="footer")
        check(r.status_code == 429, f"6th signup in the hour should 429, got {r.status_code}")

    # DOI branch
    calls = []

    class Resp:
        status_code = 201
        text = ""

    brevo_service.httpx.post = lambda url, json=None, headers=None, timeout=None: (calls.append((url, json)), Resp())[1]
    os.environ.update({"BREVO_API_KEY": "k", "BREVO_WAITLIST_LIST_ID": "7", "BREVO_DOI_TEMPLATE_ID": "42"})
    ok = brevo_service.sync_waitlist_contact("doi@example.com", "FL", "comment")
    check(ok, "DOI sync should report success on 201")
    url, payload = calls[-1]
    check(url.endswith("/contacts/doubleOptinConfirmation"), f"DOI url wrong: {url}")
    check(payload.get("templateId") == 42 and payload.get("includeListIds") == [7]
          and payload.get("redirectionUrl"), f"DOI payload wrong: {payload}")
    os.environ.pop("BREVO_DOI_TEMPLATE_ID")
    brevo_service.sync_waitlist_contact("plain@example.com")
    check(calls[-1][0].endswith("/v3/contacts") and calls[-1][1].get("listIds") == [7],
          f"without DOI the plain contact call should be used: {calls[-1]}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("WAITLIST GUARDS HOLD.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
