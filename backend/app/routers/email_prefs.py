# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Email settings and one-click unsubscribe (2026-10-16).

  POST /api/email/unsubscribe/{token}       one-click (RFC 8058): turns
                                            off the one email type the
                                            signed token names
  GET  /api/email/unsubscribe/{token}       never unsubscribes (link
                                            scanners open links); sends
                                            the browser to the
                                            civicview.app/unsubscribe page
  GET  /api/email/unsubscribe/{token}/info  what the token turns off, for
                                            that page
  GET  /api/email/page-changes              "Email me when a page I track
  PUT  /api/email/page-changes                changes" for a signed-in
                                            citizen, rep or candidate

See services/email_unsubscribe.py for the token. The unsubscribe POST
is exempt from CSRF (middleware/csrf.py EXEMPT_PREFIXES): the token is
the authority and can only turn one email off.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import CandidateAccount, CitizenAccount, RepAccount
from app.services import email_unsubscribe as eu

router = APIRouter()

_NO_STORE = {"Cache-Control": "no-store"}


@router.post("/unsubscribe/{token}")
def one_click_unsubscribe(token: str, db: Session = Depends(get_db)):
    result = eu.unsubscribe(db, token)
    if result is None:
        return JSONResponse(status_code=404, content={"detail": "This unsubscribe link is not valid."},
                            headers=_NO_STORE)
    return JSONResponse(content={"ok": True, **result}, headers=_NO_STORE)


@router.get("/unsubscribe/{token}/info")
def unsubscribe_info(token: str, db: Session = Depends(get_db)):
    info = eu.describe(db, token)
    if info is None:
        return JSONResponse(status_code=404, content={"detail": "This unsubscribe link is not valid."},
                            headers=_NO_STORE)
    return JSONResponse(content=info, headers=_NO_STORE)


@router.get("/unsubscribe/{token}")
def unsubscribe_page_redirect(token: str):
    """A GET never turns anything off: it opens the page that asks. The
    address is rebuilt from the verified token, never copied from the
    request; a link that does not verify opens the page with no token,
    which says the link is not valid."""
    data = eu.read_token(token)
    if data is None:
        target = f"{eu.app_url()}/unsubscribe"
    else:
        target = eu.page_url(eu.make_token(data["k"], data["i"], data["t"]))
    return RedirectResponse(target, status_code=303, headers=_NO_STORE)


def _identity(identity: Optional[str], citizen, rep, candidate):
    """The signed-in account the setting is for (citizen first, as
    everywhere), or 401."""
    pairs = (("citizen", citizen), ("rep", rep), ("candidate", candidate))
    for kind, acct in pairs:
        if acct is not None and identity in (None, "", kind):
            return kind, acct
    raise HTTPException(status_code=401, detail="Sign in to change your email settings.")


def _state(kind: str, acct) -> dict:
    from app.services.digest_service import is_demo_email
    email = getattr(acct, "email", None) or ""
    return {
        "identity": kind,
        "enabled": acct.page_change_email_off_at is None,
        # A demo account's sign-in address receives no mail.
        "email_available": bool(email) and not is_demo_email(email) and not email.endswith("@closed.invalid"),
    }


@router.get("/page-changes")
def get_page_change_email(
    identity: Optional[str] = Query(default=None, max_length=16),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    rep: Optional[RepAccount] = Depends(get_optional_rep),
    candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, acct = _identity(identity, citizen, rep, candidate)
    return _state(kind, acct)


class PageChangeEmailIn(BaseModel):
    enabled: bool
    identity: Optional[str] = None


@router.put("/page-changes")
def put_page_change_email(
    body: PageChangeEmailIn,
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    rep: Optional[RepAccount] = Depends(get_optional_rep),
    candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, acct = _identity(body.identity, citizen, rep, candidate)
    acct = db.merge(acct)
    acct.page_change_email_off_at = None if body.enabled else (acct.page_change_email_off_at or datetime.utcnow())
    db.commit()
    return _state(kind, acct)
