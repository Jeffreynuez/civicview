"""Account creation rules (2026-10-03).

Run:  cd backend && python3 tests/test_account_creation_rules.py   (exit 0 = pass)

Jeffrey: "no one that creates a demo account should not have a state and
district", "give another option for people to save their generated email
and password ... email them that info if they add their email", and "no
two people can have the same name". Guards:

  1. citizen_geo: one canonical district format ("FL-7", "WY-AL"), every
     old spelling read, seats that don't exist refused.
  2. Demo sign-up requires a state and a real district in it; city is
     optional and stored empty, never "Demo City".
  3. Names: unique across citizens ignoring case, spacing, punctuation
     and accents; a rep's or candidate's name and a sitting official's
     name are refused; the database index stops a direct duplicate.
  4. The location gate: an account without a district gets 409
     location_required on engagement and needs_location on /me, until
     PUT /me/location sets one. Verified accounts keep their state.
  5. The boot repair renames a duplicate (the busier account keeps the
     name), rewrites copied comment names, and fixes district formats.
  6. Sign-in email at sign-up: login email plus a set-password link to
     the contact address, never the password. Forgot password works
     with the contact address and sends there, naming the login email.
  7. Bill likes accept an at-large district; the officials index builds
     "XX-AL" for at-large House seats.
  8. A refused sign-up doesn't use up the per-IP daily cap.
  9. ID.me: the verified address sets the district, and a lookup that
     fails or lands in another state leaves it for the person to choose.
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
    os.environ["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    os.environ.pop("IDME_ENABLED", None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    from app.auth import compute_csrf_token
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import BillReaction, CitizenAccount, Post, PostComment, RepAccount
    from app.services import email_service, rate_limit
    from app.services.citizen_account_repair import repair_citizen_accounts
    from app.services.citizen_geo import house_district, normalize_district
    from app.services.display_names import clean_display_name, name_key

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    # ── 1. district format ──────────────────────────────────────────
    cases = {
        ("FL", "17"): "FL-17", ("fl", "fl-07"): "FL-7", ("FL", "FL-17"): "FL-17",
        ("WY", "1"): "WY-AL", ("WY", "WY-0"): "WY-AL", ("WY", "At-Large"): "WY-AL",
        ("WY", "AL"): "WY-AL", ("DC", "98"): "DC-AL", ("AL", "AL-3"): "AL-3",
        ("FL", "29"): None, ("FL", "0"): None, ("FL", "GA-3"): None, ("AL", "AL"): None,
        ("ZZ", "1"): None, ("FL", ""): None, ("FL", None): None,
    }
    for (st, raw), want in cases.items():
        got = normalize_district(st, raw)
        check(got == want, f"normalize_district({st!r}, {raw!r}) = {got!r}, want {want!r}")
    check(house_district("WY", 0) == "WY-AL" and house_district("FL", 7) == "FL-7",
          "house_district reads the roster's 0 for at-large")

    # ── names: the key ──────────────────────────────────────────────
    check(name_key("Tyron  Bigums.") == name_key("tyron bigums") == name_key("Tyrón-Bigums"),
          "name_key ignores case, spacing, punctuation and accents")
    check(name_key("Tyron Bigums 2") != name_key("Tyron Bigums"), "a number makes a different name")
    for bad in ("", "   ", "!!!"):
        try:
            clean_display_name(bad)
            failures.append(f"clean_display_name accepted {bad!r}")
        except ValueError:
            pass
    check(clean_display_name("  Pat   Q  Citizen ") == "Pat Q Citizen", "inner spaces collapse")

    # ── ID.me: district from the verified address ───────────────────
    from types import SimpleNamespace
    from app.routers import identity_verification as iv
    from app.services.geocode_service import GeocodeService

    attrs = SimpleNamespace(address_line1="1 Main St", address_city="Orlando", address_state="FL",
                            address_zip="32801")
    real = GeocodeService.congressional_district_for_street_address

    async def fl10(self, address):
        return ("FL", "FL-10")

    async def ga(self, address):
        return ("GA", "GA-5")

    async def boom(self, address):
        raise RuntimeError("census down")

    try:
        GeocodeService.congressional_district_for_street_address = fl10
        check(iv._district_from_verified_address(attrs) == "FL-10", "ID.me address sets the district")
        GeocodeService.congressional_district_for_street_address = ga
        check(iv._district_from_verified_address(attrs) is None, "a district in another state is not used")
        GeocodeService.congressional_district_for_street_address = boom
        logging.disable(logging.CRITICAL)  # the expected traceback
        check(iv._district_from_verified_address(attrs) is None, "a failed lookup leaves it for the person to choose")
        logging.disable(logging.WARNING)
        check(iv._district_from_verified_address(SimpleNamespace(
            address_line1=None, address_city="Orlando", address_state="FL", address_zip=None)) is None,
            "no street address, no lookup")
    finally:
        GeocodeService.congressional_district_for_street_address = real

    sent = []

    class Capture(email_service.EmailService):
        def send(self, *, to, subject, text_body, html_body=None, reply_to=None):
            sent.append({"to": to, "subject": subject, "body": text_body})
            return True

    email_service._EMAIL_SINGLETON = Capture()

    url = "/api/citizen-auth/demo-signup"
    with TestClient(m.app) as c:
        def signup(**body):
            rate_limit.reset_all()
            c.cookies.clear()
            payload = {"display_name": "Someone", "state": "FL", "congressional_district": "17"}
            payload.update(body)
            return c.post(url, json=payload)

        def headers_for(cid):
            t = issue_citizen_token(cid)
            return {"X-Citizen-Token": t, "X-CSRF-Token": compute_csrf_token(t)}

        # ── 2. state and district required ──────────────────────────
        r = signup(display_name="No State", state=None)
        check(r.status_code == 422, f"no state refused: {r.status_code} {r.text}")
        r = signup(display_name="No District", congressional_district=None)
        check(r.status_code == 422, f"no district refused: {r.status_code} {r.text}")
        r = signup(display_name="Bad District", congressional_district="29")
        check(r.status_code == 422 and "isn't a congressional district" in r.text,
              f"FL-29 refused: {r.status_code} {r.text}")
        r = signup(display_name="Wrong State", congressional_district="GA-3")
        check(r.status_code == 422, f"district in another state refused: {r.status_code}")

        r = signup(display_name="Pat Citizen", congressional_district="FL-07")
        body = r.json()
        check(r.status_code == 201, f"valid sign-up: {r.status_code} {r.text}")
        check(body["citizen"]["congressional_district"] == "FL-7", f"stored canonical: {body['citizen']}")
        check(body["citizen"]["city"] == "", f"city empty, not 'Demo City': {body['citizen']['city']!r}")
        check(body["citizen"]["needs_location"] is False, "a new account has its location")
        check(body["signin_email_sent"] is False and not sent, "no email unless asked for")
        pat_id = body["citizen"]["id"]

        r = signup(display_name="Wyoming Person", state="WY", congressional_district="AL", city="Casper")
        check(r.status_code == 201 and r.json()["citizen"]["congressional_district"] == "WY-AL",
              f"at-large stored as WY-AL: {r.status_code} {r.text}")
        r = signup(display_name="Wyoming Two", state="WY", congressional_district="1")
        check(r.status_code == 201 and r.json()["citizen"]["congressional_district"] == "WY-AL",
              f"the old form's '1' still means at-large: {r.text}")

        # ── 3. names ────────────────────────────────────────────────
        for dup in ("pat citizen", "Pat  Citizen.", "PAT-CITIZEN", "Pát Citizen"):
            r = signup(display_name=dup)
            check(r.status_code == 409 and "already taken" in r.text, f"{dup!r} is taken: {r.status_code} {r.text}")
        r = signup(display_name="Pat Citizen 2")
        check(r.status_code == 201, f"'Pat Citizen 2' is free: {r.status_code} {r.text}")

        with SessionLocal() as db:
            db.add(RepAccount(official_id="X000009", email="rep9@example.com", password_hash="x",
                              display_name="Rep Nine Person", owner_state="FL", owner_district="FL-9",
                              is_active=True))
            db.commit()
        r = signup(display_name="rep nine person")
        check(r.status_code == 409, f"a rep's name is taken: {r.status_code} {r.text}")

        for official in ("Ron DeSantis", "rick scott", "JD Vance"):
            r = signup(display_name=official)
            check(r.status_code == 409 and "sitting official" in r.text,
                  f"official's name {official!r} refused: {r.status_code} {r.text}")
        r = signup(display_name="Ron DeSantis Fan")
        check(r.status_code == 201, f"a name containing an official's is fine: {r.status_code}")

        # The per-IP cap (5 a day) counts accounts made, not refusals.
        rate_limit.reset_all()
        c.cookies.clear()
        for _ in range(6):
            c.post(url, json={"display_name": "Pat Citizen", "state": "FL", "congressional_district": "17"})
        made = []
        for i in range(6):
            c.cookies.clear()
            made.append(c.post(url, json={"display_name": f"Cap Test {i}", "state": "FL",
                                          "congressional_district": "17"}).status_code)
        check(made == [201] * 5 + [429], f"refusals don't use up the cap, which still holds: {made}")

        with SessionLocal() as db:
            db.add(CitizenAccount(email="direct@example.com", password_hash="x", display_name="PAT citizen",
                                  city="", state="FL", congressional_district="FL-1", is_active=True))
            try:
                db.commit()
                failures.append("the unique index let a duplicate name in")
            except IntegrityError:
                db.rollback()

        # ── 4. location gate ────────────────────────────────────────
        with SessionLocal() as db:
            row = CitizenAccount(email="nowhere@example.com", password_hash="x", display_name="No Where",
                                 city="", state="CO", congressional_district=None, is_active=True)
            db.add(row)
            db.commit()
            nowhere = row.id
        h = headers_for(nowhere)
        c.cookies.clear()
        me = c.get("/api/citizen-auth/me", headers=h).json()
        check(me["needs_location"] is True, f"/me says needs_location: {me}")
        c.cookies.clear()
        r = c.post("/api/engagement/bills/reactions", json={"bill_key": "119-s-2403", "kind": "up"}, headers=h)
        check(r.status_code == 409 and r.json()["detail"]["code"] == "location_required",
              f"engagement held until a district is set: {r.status_code} {r.text}")
        c.cookies.clear()
        r = c.put("/api/citizen-auth/me/location", json={"state": "CO", "congressional_district": "11"}, headers=h)
        check(r.status_code == 422, f"CO-11 doesn't exist: {r.status_code}")
        c.cookies.clear()
        r = c.put("/api/citizen-auth/me/location",
                  json={"state": "CO", "congressional_district": "CO-8", "city": "Denver"}, headers=h)
        check(r.status_code == 200 and r.json()["congressional_district"] == "CO-8"
              and r.json()["needs_location"] is False and r.json()["city"] == "Denver",
              f"location set: {r.status_code} {r.text}")
        c.cookies.clear()
        r = c.post("/api/engagement/bills/reactions", json={"bill_key": "119-s-2403", "kind": "up"}, headers=h)
        check(r.status_code == 200, f"engagement allowed after: {r.status_code} {r.text}")

        # A demo account can move state; the old address details go.
        with SessionLocal() as db:
            row = db.get(CitizenAccount, nowhere)
            row.county, row.zip_code = "Denver", "80202"
            db.commit()
        c.cookies.clear()
        r = c.put("/api/citizen-auth/me/location", json={"state": "WY", "congressional_district": "AL"}, headers=h)
        j = r.json()
        check(r.status_code == 200 and j["state"] == "WY" and j["congressional_district"] == "WY-AL"
              and j["county"] is None and j["zip_code"] is None and j["city"] == "",
              f"moving state clears the old address: {r.status_code} {j}")

        # A verified account keeps its state but can choose its district.
        with SessionLocal() as db:
            row = CitizenAccount(email="verified@example.com", password_hash="x", display_name="Vera Fied",
                                 city="Miami", state="FL", congressional_district=None, verified=True,
                                 verified_method="id.me", is_active=True)
            db.add(row)
            db.commit()
            vid = row.id
        hv = headers_for(vid)
        c.cookies.clear()
        r = c.put("/api/citizen-auth/me/location", json={"state": "GA", "congressional_district": "3"}, headers=hv)
        check(r.status_code == 409, f"verified account can't change state: {r.status_code} {r.text}")
        c.cookies.clear()
        r = c.put("/api/citizen-auth/me/location", json={"congressional_district": "27"}, headers=hv)
        check(r.status_code == 200 and r.json()["congressional_district"] == "FL-27",
              f"verified account picks a district in its state: {r.status_code} {r.text}")

        # ── 7. at-large district on bill likes ──────────────────────
        # (The like above was stamped CO-8; rows keep their stamp. A new
        # like from the moved account counts under WY-AL.)
        c.cookies.clear()
        c.post("/api/engagement/bills/reactions", json={"bill_key": "119-hr-5", "kind": "up"}, headers=h)
        c.cookies.clear()
        r = c.get("/api/engagement/bills/reactions", params={"keys": "119-hr-5,119-s-2403", "district": "WY-AL"})
        rx = r.json().get("reactions", {}) if r.status_code == 200 else {}
        check(rx.get("119-hr-5", {}).get("scoped", {}).get("district", {}).get("up_count") == 1
              and rx.get("119-s-2403", {}).get("scoped", {}).get("district", {}).get("up_count") == 0,
              f"bill likes count WY-AL from the new district only: {r.status_code} {r.text}")

        # ── 6. sign-in email and forgot password ────────────────────
        sent.clear()
        r = signup(display_name="Mail Me", contact_email="Mail.Me@Example.com", send_signin_email=True)
        b = r.json()
        check(r.status_code == 201 and b["signin_email_sent"] is True, f"sign-in email sent: {r.status_code} {r.text}")
        check(len(sent) == 1 and sent[0]["to"] == "mail.me@example.com", f"to the contact address: {sent}")
        mail = sent[0]["body"] if sent else ""
        check(b["email"] in mail, "the email names the generated sign-in email")
        check(b["password"] not in mail, "the email never carries the password")
        token = mail.split("token=")[1].split()[0] if "token=" in mail else ""
        c.cookies.clear()
        r = c.post("/api/citizen-auth/password-reset/confirm", json={"token": token, "new_password": "New-pass-123!"})
        check(r.status_code == 200, f"the link sets a new password: {r.status_code} {r.text}")
        check(sent[-1]["to"] == "mail.me@example.com", f"the 'password changed' email reaches the contact address: {sent[-1]['to']}")
        c.cookies.clear()
        r = c.post("/api/citizen-auth/login", json={"email": b["email"], "password": "New-pass-123!"})
        check(r.status_code == 200, f"signs in with the new password: {r.status_code}")

        r = signup(display_name="Bad Mail", contact_email="not-an-email", send_signin_email=True)
        check(r.status_code == 422, f"asked for email with a bad address: {r.status_code}")
        sent.clear()
        r = signup(display_name="No Mail", send_signin_email=True)
        check(r.status_code == 201 and r.json()["signin_email_sent"] is False and not sent,
              "ticking the box without an address sends nothing")

        rate_limit.reset_all()
        sent.clear()
        c.cookies.clear()
        c.post("/api/citizen-auth/password-reset/request", json={"email": "MAIL.ME@example.com"})
        check(len(sent) == 1 and sent[0]["to"] == "mail.me@example.com" and b["email"] in sent[0]["body"],
              f"forgot password by contact address: {sent}")
        rate_limit.reset_all()
        sent.clear()
        c.cookies.clear()
        c.post("/api/citizen-auth/password-reset/request", json={"email": b["email"]})
        check(len(sent) == 1 and sent[0]["to"] == "mail.me@example.com",
              f"forgot password by the generated login goes to the contact address: {sent}")
        rate_limit.reset_all()
        sent.clear()
        c.cookies.clear()
        pat_login = None
        with SessionLocal() as db:
            pat_login = db.get(CitizenAccount, pat_id).email
        c.post("/api/citizen-auth/password-reset/request", json={"email": pat_login})
        check(not sent, f"a demo account with no contact address gets nothing (nowhere to send): {sent}")

        # ── 5. boot repair ──────────────────────────────────────────
        with SessionLocal() as db:
            # Rows as they were before the rules: inserted, then given
            # their old values with raw SQL (no ORM hook, no name_key).
            old = [
                ("old1@example.com", "Tyron Bigums", "FL", "FL-12"),
                ("old2@example.com", "tyron bigums", "FL", "FL-07"),
                ("old3@example.com", "Wyo Old", "WY", "WY-1"),
                ("old4@example.com", "Bad Seat", "FL", "FL-99"),
            ]
            for i, (email, _n, st, _d) in enumerate(old):
                db.add(CitizenAccount(email=email, password_hash="x", display_name=f"Placeholder {i}",
                                      city="", state=st, is_active=True))
            db.commit()
            for email, name, _s, dist in old:
                db.execute(text(
                    "UPDATE citizen_accounts SET display_name = :n, congressional_district = :d, "
                    "name_key = NULL WHERE email = :e"
                ), {"e": email, "n": name, "d": dist})
            db.commit()
            ids = {e: i for e, i in db.execute(text(
                "SELECT email, id FROM citizen_accounts WHERE email LIKE 'old%'")).all()}
            # The second Tyron is the busier one (two likes against the
            # first one's single comment): it keeps the name.
            db.add(BillReaction(bill_key="119-hr-1", citizen_id=ids["old2@example.com"], kind="up"))
            db.add(BillReaction(bill_key="119-hr-2", citizen_id=ids["old2@example.com"], kind="up"))
            post = Post(official_id="X000009", body="a post")
            db.add(post)
            db.flush()
            db.add(PostComment(post_id=post.id, citizen_id=ids["old1@example.com"],
                               citizen_display_name="Tyron Bigums", body="hello"))
            db.commit()
        report = repair_citizen_accounts()
        with SessionLocal() as db:
            rows = {r.email: r for r in db.query(CitizenAccount).filter(CitizenAccount.email.like("old%")).all()}
            check(rows["old2@example.com"].display_name == "tyron bigums", "the busier account keeps the name")
            check(rows["old1@example.com"].display_name == "Tyron Bigums 2",
                  f"the other becomes 'Tyron Bigums 2': {rows['old1@example.com'].display_name!r}")
            check(rows["old2@example.com"].congressional_district == "FL-7", "FL-07 -> FL-7")
            check(rows["old3@example.com"].congressional_district == "WY-AL", "WY-1 -> WY-AL")
            check(rows["old4@example.com"].congressional_district is None, "a seat that doesn't exist is cleared")
            check(all(r.name_key for r in rows.values()), "every key filled")
            copied = db.query(PostComment.citizen_display_name).filter(
                PostComment.citizen_id == ids["old1@example.com"]).scalar()
            check(copied == "Tyron Bigums 2", f"the comment's copied name follows the rename: {copied!r}")
            check(len({r.name_key for r in db.query(CitizenAccount).all()}) == db.query(CitizenAccount).count(),
                  "no two keys equal")
        again = repair_citizen_accounts()
        check(not again["renamed"] and again["keys_filled"] == 0 and again["districts_fixed"] == 0,
              f"the repair is idempotent: {again}")
        check(len(report["renamed"]) == 1, f"one rename reported: {report}")

    email_service.reset_email_service_for_tests()
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: account creation rules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
