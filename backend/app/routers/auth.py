# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth import (
    clear_session_cookie,
    generate_csrf_token,
    get_current_rep,
    get_optional_rep_including_deleted,
    issue_session_token,
    set_session_cookie,
    verify_password,
)
from app.db import get_db
from app.models.pages import RepAccount
from app.schemas.pages import (
    DeleteAccountRequest,
    DeleteAccountResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    PasswordResetConfirmRequest,
    PasswordResetGenericResponse,
    PasswordResetRequestRequest,
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

    # Suspended accounts: distinct from "invalid creds" because the
    # creds ARE valid. Returning the suspension state to the user is
    # the expected pattern (vs. silently failing as 401) — they know
    # something happened and can appeal. The 403 status differentiates
    # from generic auth failure.
    if rep.suspended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account has been suspended. "
                "Contact civicview@civicview.app if you think this is in error."
            ),
        )

    # 2FA gate (Task #62 Phase 3). If this account has 2FA enrolled,
    # pause the login here — DON'T set a cookie or mint a session
    # token yet. Hand back a short-lived challenge token that the
    # client passes to /api/2fa/login-challenge along with the user's
    # 6-digit TOTP / recovery code. This makes a stolen-password
    # attack insufficient on its own — the attacker also needs the
    # second factor to complete the session.
    if rep.totp_enabled_at is not None:
        from app.routers.two_factor import issue_login_challenge
        return LoginResponse(
            two_factor_required=True,
            challenge_token=issue_login_challenge("rep", rep.id),
        )

    set_session_cookie(response, rep.id)
    rep.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(rep)

    return LoginResponse(
        rep=MeResponse.model_validate(rep),
        csrf_token=generate_csrf_token(),
        # Mirror token for cross-site-cookie-restricted environments.
        # Identical to the value set in the cookie — whichever the
        # browser delivers back, the backend accepts.
        session_token=issue_session_token(rep.id),
    )


@router.post("/logout")
def logout(response: Response):
    """Clear the session cookie. Always returns 200 whether or not the
    caller was logged in — this endpoint is safe to call from a stale
    browser tab."""
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(rep: Optional[RepAccount] = Depends(get_optional_rep_including_deleted)):
    """Return the currently-logged-in rep, or 401 if no valid session.

    Uses the _including_deleted variant so soft-deleted accounts still
    see /me during the 30-day grace window — the frontend reads the
    self_deleted_at + purge_after fields to render the recovery
    banner."""
    if rep is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    from app.services.totp_enforcement import requires_2fa_enrollment
    out = MeResponse.model_validate(rep)
    # 2FA Phase 4 — only fire enforcement for active accounts. A
    # soft-deleted user shouldn't be pushed through enrollment; let
    # them recover or finalize the deletion first.
    if rep.self_deleted_at is None:
        out.needs_2fa_enrollment = requires_2fa_enrollment("rep", rep)
    return out


# ── Self-serve account deletion (Task #81) ──────────────────────────
@router.post("/delete", response_model=DeleteAccountResponse)
def delete_account(
    payload: DeleteAccountRequest,
    response: Response,
    db: Session = Depends(get_db),
    rep: Optional[RepAccount] = Depends(get_optional_rep_including_deleted),
):
    """Delete the signed-in rep account.

    confirm_email must match the signed-in account (case-insensitive).
    mode='soft' archives for 30 days (recoverable via /recover);
    mode='hard' deletes immediately and cascades dependent content.

    Hard delete also clears the session cookie so the now-deleted
    session token can't be replayed. Soft delete leaves the cookie
    intact so the user can sign back in to recover within the grace
    window."""
    from app.services.account_deletion import (
        hard_delete_account,
        soft_delete_account,
        verify_email_confirmation,
    )
    if rep is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not verify_email_confirmation(rep, payload.confirm_email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email confirmation doesn't match the signed-in account.",
        )
    if payload.mode == "hard":
        hard_delete_account(db, "rep", rep)
        clear_session_cookie(response)
        return DeleteAccountResponse(mode="hard", purge_after=None)
    # Default + 'soft' path.
    purge_at = soft_delete_account(db, "rep", rep)
    return DeleteAccountResponse(mode="soft", purge_after=purge_at)


@router.post("/recover", response_model=MeResponse)
def recover_account(
    db: Session = Depends(get_db),
    rep: Optional[RepAccount] = Depends(get_optional_rep_including_deleted),
):
    """Recover a soft-deleted rep account within the 30-day grace
    window. Clears self_deleted_at + purge_after. Returns the
    refreshed /me payload so the frontend can drop the recovery banner
    without an extra round-trip."""
    from app.services.account_deletion import recover_account as _recover
    if rep is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if rep.self_deleted_at is None:
        # Already active — no-op return.
        return MeResponse.model_validate(rep)
    _recover(db, "rep", rep)
    db.refresh(rep)
    return MeResponse.model_validate(rep)


# ── Password reset (Task #87) ───────────────────────────────────────
# Both endpoints intentionally return the same {ok: true} shape on
# success + failure paths so a network observer can't distinguish
# "valid email" from "no such email" by response code alone. The
# 'confirm' endpoint is the only one that returns 400 on bad input —
# and only when the password fails basic length validation (a check
# the frontend has already done, so an attacker probing here learns
# nothing about token validity).
@router.post("/password-reset/request", response_model=PasswordResetGenericResponse)
def request_reset(
    payload: PasswordResetRequestRequest,
    db: Session = Depends(get_db),
):
    """Step 1 of the reset flow for rep accounts. Anti-enumeration:
    we ALWAYS return 200/ok regardless of whether the email matches.
    The service helper handles the conditional mint-and-email."""
    from app.services.password_reset import request_password_reset
    request_password_reset(db, "rep", payload.email)
    return PasswordResetGenericResponse(ok=True)


@router.post("/password-reset/confirm", response_model=PasswordResetGenericResponse)
def confirm_reset(
    payload: PasswordResetConfirmRequest,
    db: Session = Depends(get_db),
):
    """Step 2 of the reset flow for rep accounts. Returns 400 on
    invalid/expired token + on too-short passwords so the frontend
    can render specific feedback. Successful confirm triggers a
    courtesy 'your password was changed' email."""
    from app.services.password_reset import confirm_password_reset, ResetConfirmResult
    result = confirm_password_reset(db, "rep", payload.token, payload.new_password)
    if result == ResetConfirmResult.OK:
        return PasswordResetGenericResponse(ok=True)
    if result == ResetConfirmResult.INVALID_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters.",
        )
    # INVALID_TOKEN — generic so we don't tell the attacker which row
    # failed (expired vs. wrong-kind vs. nonexistent all collapse).
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This reset link is invalid or has expired. Request a new one.",
    )
