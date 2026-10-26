"""Shared setup for the former officials and candidates tests (2026-10-15).

Not a test itself (the suite collects test_*.py only). Each test script
calls bootstrap() before importing the app, so every run gets its own
throwaway SQLite database, then uses these helpers to make accounts,
sign them in and set dates through the admin Transitions API.
"""
import os
import sys
import tempfile
from datetime import timedelta

ADMIN_EMAIL = "transitions-admin@example.org"


def bootstrap() -> None:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    os.environ["ADMIN_EMAILS"] = ADMIN_EMAIL
    for key in ("CONGRESS_API_KEY", "POSTMARK_API_TOKEN", "IDME_ENABLED", "FORCE_2FA_ENABLED"):
        os.environ.pop(key, None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)


class Checks:
    def __init__(self):
        self.failures = []

    def __call__(self, name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
        if not cond:
            self.failures.append(name)

    def exit_code(self) -> int:
        if self.failures:
            print(f"\nFAILED ({len(self.failures)}): " + ", ".join(self.failures))
            return 1
        print("\nALL PASSED")
        return 0


def days(n: int):
    """A date n days from today (Eastern time), as the app counts days."""
    from app.services.page_lifecycle import today_et
    return today_et() + timedelta(days=n)


def make_rep(db, official_id, name, email, *, role="State Senator", state="FL", district=None):
    from app.auth import hash_password
    from app.models.pages import RepAccount
    rep = RepAccount(official_id=official_id, email=email, password_hash=hash_password("pw-12345678"),
                     display_name=name, role=role, owner_state=state, owner_district=district,
                     is_active=True)
    db.add(rep)
    db.commit()
    db.refresh(rep)
    return rep


def make_candidate(db, candidate_id, name, email, *, state="FL"):
    from app.auth import hash_password
    from app.models.pages import CandidateAccount
    cand = CandidateAccount(candidate_id=candidate_id, email=email, password_hash=hash_password("pw-12345678"),
                            display_name=name, owner_state=state, claim_status="active", is_active=True)
    db.add(cand)
    db.commit()
    db.refresh(cand)
    return cand


def make_citizen(db, name, email, *, state="FL", district="FL-10", city="Orlando"):
    from app.models.pages import CitizenAccount
    cit = CitizenAccount(email=email, password_hash="x", display_name=name, city=city, state=state,
                         congressional_district=district, is_active=True)
    db.add(cit)
    db.commit()
    db.refresh(cit)
    return cit


def rep_headers(rep) -> dict:
    from app.auth import compute_csrf_token, issue_session_token
    tok = issue_session_token(rep.id, rep.session_epoch or 0)
    return {"Authorization": f"Bearer {tok}", "X-CSRF-Token": compute_csrf_token(tok)}


def candidate_headers(cand) -> dict:
    from app.auth import compute_csrf_token
    from app.auth_candidate import issue_candidate_token
    tok = issue_candidate_token(cand.id, cand.session_epoch or 0)
    return {"X-Candidate-Token": tok, "X-CSRF-Token": compute_csrf_token(tok)}


def citizen_headers(cit) -> dict:
    from app.auth import compute_csrf_token
    from app.auth_citizen import issue_citizen_token
    tok = issue_citizen_token(cit.id, cit.session_epoch or 0)
    return {"X-Citizen-Token": tok, "X-CSRF-Token": compute_csrf_token(tok)}


def both(primary: dict, other: dict) -> dict:
    """Two identities signed in at once (the CSRF token of the first)."""
    out = dict(other)
    out.update(primary)
    return out


def admin_headers(db) -> dict:
    """An admin: a rep account whose email is on ADMIN_EMAILS."""
    from app.models.pages import RepAccount
    admin = db.query(RepAccount).filter(RepAccount.email == ADMIN_EMAIL).first()
    if admin is None:
        from datetime import datetime
        admin = make_rep(db, "test-admin-page", "Transitions Admin", ADMIN_EMAIL, role="Admin")
        # Admin endpoints need 2FA enrolled on the admin account (2026-10-26).
        admin.totp_enabled_at = datetime.utcnow()
        db.commit()
    return rep_headers(admin)


def set_transition(client, db, **body) -> dict:
    """Set a date or result through the admin Transitions API."""
    body.setdefault("source_url", "https://www.flsenate.gov/test-source")
    for k in ("event_on", "sworn_in_on"):
        if body.get(k) is not None and not isinstance(body[k], str):
            body[k] = body[k].isoformat()
    r = client.post("/api/admin/transitions", json=body, headers=admin_headers(db))
    assert r.status_code == 200, f"set_transition {body.get('page_id')}: {r.status_code} {r.text}"
    return r.json()
