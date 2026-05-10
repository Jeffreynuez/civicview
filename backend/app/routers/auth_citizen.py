# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Citizen-auth router — parallel to app/routers/auth.py.

Endpoints:
  POST /api/citizen-auth/login   → verify credentials, issue cl_citizen cookie
  POST /api/citizen-auth/logout  → clear cl_citizen cookie
  GET  /api/citizen-auth/me      → return the logged-in citizen (or 401)

The cookie is independent of the rep `cl_session` cookie, so a single
browser can hold both at once. This is deliberate for the demo: the
same reviewer can post as Byron Donalds in one tab and engage as
Citizen Jane Doe in another without juggling logins.
"""
from __future__ import annotations

from datetime import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth import verify_password
from app.auth_citizen import (
    clear_citizen_cookie,
    get_current_citizen,
    issue_citizen_token,
    set_citizen_cookie,
)
from app.db import get_db
from app.models.pages import CitizenAccount
from app.schemas.pages import (
    CitizenLoginRequest,
    CitizenLoginResponse,
    CitizenMeResponse,
)


logger = logging.getLogger(__name__)
router = APIRouter()

# Constant-ish-time failure hash for cases where the email doesn't exist.
# Running bcrypt on every path blunts a timing oracle that could otherwise
# enumerate registered emails.
_DUMMY_BCRYPT = "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalid"


@router.post("/login", response_model=CitizenLoginResponse)
def login(
    payload: CitizenLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()
    citizen = db.query(CitizenAccount).filter(CitizenAccount.email == email).first()

    valid = False
    if citizen is not None and citizen.is_active:
        valid = verify_password(payload.password, citizen.password_hash)
    else:
        verify_password(payload.password, _DUMMY_BCRYPT)

    if not citizen or not valid or not citizen.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    set_citizen_cookie(response, citizen.id)
    citizen.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(citizen)

    return CitizenLoginResponse(
        citizen=CitizenMeResponse.model_validate(citizen),
        # Mirror token for cross-site-cookie-restricted environments.
        # Identical to the value set in the cookie.
        citizen_token=issue_citizen_token(citizen.id),
    )


@router.post("/logout")
def logout(response: Response):
    """Clear the citizen session cookie. Always returns 200."""
    clear_citizen_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=CitizenMeResponse)
def me(citizen: CitizenAccount = Depends(get_current_citizen)):
    return CitizenMeResponse.model_validate(citizen)
