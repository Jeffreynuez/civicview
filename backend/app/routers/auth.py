# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Auth router for the Pages feature.

Endpoints:
  POST /api/auth/login     → verify credentials, issue session cookie
  POST /api/auth/logout    → clear session cookie
  GET  /api/auth/me        → return the logged-in rep (or 401)

Note: the session cookie is httpOnly + SameSite=Lax, so the frontend
can't read it. That's intentional — it's set and cleared by these
endpoints only. `csrf_token` is returned in the login response body
for the frontend to stash in memory and echo back on mutating calls
(Phase 2 will upgrade this to per-session tokens).
"""
from __future__ import annotations

from datetime import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth import (
    clear_session_cookie,
    generate_csrf_token,
    get_current_rep,
    set_session_cookie,
    verify_password,
)
from app.db import get_db
from app.models.pages import RepAccount
from app.schemas.pages import (
    LoginRequest,
    LoginResponse,
    MeResponse,
)


logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """Exchange email + password for a session cookie."""
    email = payload.email.strip().lower()
    rep = db.query(RepAccount).filter(RepAccount.email == email).first()

    # Constant-ish-time failure: even when the account is missing we
    # still run bcrypt once to blunt a timing oracle. `verify_password`
    # on a bogus hash takes the same ballpark as a real check.
    valid = False
    if rep is not None and rep.is_active:
        valid = verify_password(payload.password, rep.password_hash)
    else:
        # Dummy bcrypt check — ignored result.
        verify_password(payload.password, "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalid")

    if not rep or not valid or not rep.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    set_session_cookie(response, rep.id)
    rep.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(rep)

    return LoginResponse(
        rep=MeResponse.model_validate(rep),
        csrf_token=generate_csrf_token(),
    )


@router.post("/logout")
def logout(response: Response):
    """Clear the session cookie. Always returns 200 whether or not the
    caller was logged in — this endpoint is safe to call from a stale
    browser tab."""
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(rep: RepAccount = Depends(get_current_rep)):
    """Return the currently-logged-in rep, or 401 if no valid session."""
    return MeResponse.model_validate(rep)
