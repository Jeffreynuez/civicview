# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Candidate-auth router — parallel to app/routers/auth.py (rep) and
app/routers/auth_citizen.py (citizen).

Endpoints:
  POST /api/candidate-auth/login   → verify credentials, issue cl_candidate cookie
  POST /api/candidate-auth/logout  → clear cl_candidate cookie
  GET  /api/candidate-auth/me      → return the logged-in candidate (or 401)

The cookie is independent of the rep `cl_session` and citizen
`cl_citizen` cookies, so a single browser can hold all three at once
— useful during demos and during real testing where the same person
is a rep on one page and a candidate elsewhere.

No demo-signup endpoint by design. Candidates are provisioned by
admins after manual verification (FEC ID / official party
nomination / etc.) — the public surface is the waitlist /
help-build form, not a self-serve account creator. CandidateAccount
rows land with claim_status='pending'; the admin queue flips them
to 'active' before the credentials work for login.
"""
from __future__ import annotations

from datetime import datetime
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auth import compute_csrf_token, verify_password
from app.auth_candidate import (
    clear_candidate_cookie,
    get_optional_candidate_including_deleted,
    issue_candidate_token,
    set_candidate_cookie,
)
from app.db import get_db
from app.models.pages import CandidateAccount
from app.schemas.pages import (
    CandidateLoginRequest,
    CandidateLoginResponse,
    CandidateMeResponse,
    DeleteAccountRequest,
    DeleteAccountResponse,
    PasswordResetConfirmRequest,
    PasswordResetGenericResponse,
    PasswordResetRequestRequest,
)
from app.services import login_attempts


logger = logging.getLogger(__name__)
router = APIRouter()

# Constant-ish-time failure hash for cases where the email doesn't
# exist. Running bcrypt on every path defeats a timing oracle that
# would otherwise let an attacker enumerate registered candidate
# emails by measuring login latency.
_DUMMY_BCRYPT = "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalid"


@router.post("/login", response_model=CandidateLoginResponse)
def login(
    payload: CandidateLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Verify candidate credentials and issue a session.

    Failure modes (mapped to status codes):
      • 401 — email unknown OR password wrong (same message, so an
              attacker can't enumerate registered emails). Also the
              shape returned when the account is currently locked
              (Task #29) — lockout state is hidden from the API to
              avoid the enumeration oracle.
      • 403 — account suspended (credentials WERE correct; admin
              has the account in suspended state).
      • 403 — account in claim_status='pending' (the admin hasn't
              approved this claim yet; we tell the user explicitly
              rather than pretending the credentials are wrong,
              since the password DID verify).

    Lockout: 3 failed-password attempts → escalating window
    (15min → 1hr → 24h). See services/login_attempts.py.
    """
    ip, ua = login_attempts.extract_client_signals(request)
    email = payload.email.strip().lower()
    candidate = db.query(CandidateAccount).filter(CandidateAccount.email == email).first()

    # Lockout gate.
    if candidate is not None and login_attempts.is_locked(candidate):
        verify_password(payload.password, _DUMMY_BCRYPT)
        login_attempts.register_locked_out(
            db, account=candidate, identity_kind="candidate",
            email_attempted=email, ip_address=ip, user_agent=ua,
        )
        db.commit()
        # Lockout transparency (Task #56 revision). See
        # login_attempts.lockout_response_detail() docstring for the
        # security tradeoff vs. the earlier silent-401 design.
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=login_attempts.lockout_response_detail(candidate),
        )

    valid = False
    if candidate is not None and candidate.is_active:
        valid = verify_password(payload.password, candidate.password_hash)
    else:
        # Run bcrypt against the dummy hash so the timing of "unknown
        # email" paths matches the timing of "known email, wrong
        # password" paths. Defeats an enumeration oracle.
        verify_password(payload.password, _DUMMY_BCRYPT)

    if not candidate or not valid or not candidate.is_active:
        if candidate is None:
            login_attempts.register_no_account(
                db, identity_kind="candidate", email_attempted=email,
                ip_address=ip, user_agent=ua,
            )
        elif not valid:
            login_attempts.register_failure(
                db, account=candidate, identity_kind="candidate",
                email_attempted=email, ip_address=ip, user_agent=ua,
            )
        else:
            login_attempts.register_blocked(
                db, account=candidate, identity_kind="candidate",
                email_attempted=email, ip_address=ip, user_agent=ua,
                reason="inactive",
            )
        db.commit()
        # If THIS failed-password attempt just tripped the lockout,
        # surface the 423 instead of the generic 401 so the UI can
        # render the countdown immediately.
        if candidate is not None and login_attempts.is_locked(candidate):
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=login_attempts.lockout_response_detail(candidate),
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if candidate.suspended_at is not None:
        login_attempts.register_blocked(
            db, account=candidate, identity_kind="candidate",
            email_attempted=email, ip_address=ip, user_agent=ua,
            reason="suspended",
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account has been suspended. "
                "Contact civicview@civicview.app if you think this is in error."
            ),
        )

    # Pending claims — credentials are valid but admin hasn't
    # approved the account yet. We branch the message so the user
    # knows what to do (wait for approval / follow up) rather than
    # getting a generic 401 that suggests bad credentials.
    if candidate.claim_status != "active":
        login_attempts.register_blocked(
            db, account=candidate, identity_kind="candidate",
            email_attempted=email, ip_address=ip, user_agent=ua,
            reason="claim_pending",
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Your candidate account is approved but still pending "
                "verification. We'll email you when it's active. "
                "Questions? civicview@civicview.app."
            ),
        )

    # 2FA gate (Task #62 Phase 3). See auth.py for the full rationale.
    if candidate.totp_enabled_at is not None:
        login_attempts.register_two_factor_required(
            db, account=candidate, identity_kind="candidate",
            email_attempted=email, ip_address=ip, user_agent=ua,
        )
        db.commit()
        from app.routers.two_factor import issue_login_challenge
        return CandidateLoginResponse(
            two_factor_required=True,
            challenge_token=issue_login_challenge("candidate", candidate.id),
        )

    # Full sign-in success — reset counters + set cookie.
    login_attempts.register_success(
        db, account=candidate, identity_kind="candidate",
        email_attempted=email, ip_address=ip, user_agent=ua,
    )
    set_candidate_cookie(response, candidate.id)
    candidate.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(candidate)

    # Session-tied CSRF (Task #31). See app/routers/auth.py for the
    # rationale. Same HMAC-of-session-token pattern; the validator in
    # app/middleware/csrf.py accepts X-CSRF-Token from any active
    # identity, so a candidate signed in alongside a citizen can pick
    # either token.
    candidate_tok = issue_candidate_token(candidate.id)
    return CandidateLoginResponse(
        candidate=CandidateMeResponse.model_validate(candidate),
        # Mirror token — same value as the cookie. Used by browsers
        # that block cross-site cookies; the frontend forwards it as
        # X-Candidate-Token on every request after login.
        candidate_token=candidate_tok,
        csrf_token=compute_csrf_token(candidate_tok),
    )


@router.post("/logout")
def logout(response: Response):
    """Clear the candidate session cookie. Always returns 200 so the
    UI can treat sign-out as never-failing — even if the user had no
    active cookie, the response is a successful no-op."""
    clear_candidate_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=CandidateMeResponse)
def me(candidate: Optional[CandidateAccount] = Depends(get_optional_candidate_including_deleted)):
    """Return the logged-in candidate. 401 if no valid session.

    Uses the _including_deleted variant so soft-deleted candidates can
    still see their own /me during the 30-day grace window. Suspended
    + pending-claim accounts remain blocked at the dep level."""
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    from app.services.totp_enforcement import requires_2fa_enrollment
    out = CandidateMeResponse.model_validate(candidate)
    if candidate.self_deleted_at is None:
        out.needs_2fa_enrollment = requires_2fa_enrollment("candidate", candidate)
    return out


# ── Self-serve account deletion (Task #81) ──────────────────────────
@router.post("/delete", response_model=DeleteAccountResponse)
def delete_account(
    payload: DeleteAccountRequest,
    response: Response,
    db: Session = Depends(get_db),
    candidate: Optional[CandidateAccount] = Depends(get_optional_candidate_including_deleted),
):
    """Delete the signed-in candidate account. See app/routers/auth.py
    delete_account for the rep equivalent (same shape, same modes).

    Cascade behavior: candidate-authored posts, polls, events, comments
    are all removed via the SQLAlchemy delete-orphan cascade on the
    candidate row."""
    from app.services.account_deletion import (
        hard_delete_account,
        soft_delete_account,
        verify_email_confirmation,
    )
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not verify_email_confirmation(candidate, payload.confirm_email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email confirmation doesn't match the signed-in account.",
        )
    if payload.mode == "hard":
        hard_delete_account(db, "candidate", candidate)
        clear_candidate_cookie(response)
        return DeleteAccountResponse(mode="hard", purge_after=None)
    purge_at = soft_delete_account(db, "candidate", candidate)
    return DeleteAccountResponse(mode="soft", purge_after=purge_at)


@router.post("/recover", response_model=CandidateMeResponse)
def recover_account(
    db: Session = Depends(get_db),
    candidate: Optional[CandidateAccount] = Depends(get_optional_candidate_including_deleted),
):
    """Recover a soft-deleted candidate account."""
    from app.services.account_deletion import recover_account as _recover
    if candidate is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if candidate.self_deleted_at is None:
        return CandidateMeResponse.model_validate(candidate)
    _recover(db, "candidate", candidate)
    db.refresh(candidate)
    return CandidateMeResponse.model_validate(candidate)


# ── Password reset (Task #87) ───────────────────────────────────────
# See app/routers/auth.py for the shared design + rationale; this is
# the candidate-identity surface for the same flow.
@router.post("/password-reset/request", response_model=PasswordResetGenericResponse)
def request_reset(
    payload: PasswordResetRequestRequest,
    db: Session = Depends(get_db),
):
    """Step 1: mint + email a candidate reset token if the email
    matches a CandidateAccount row. Anti-enumeration: 200 either way."""
    from app.services.password_reset import request_password_reset
    request_password_reset(db, "candidate", payload.email)
    return PasswordResetGenericResponse(ok=True)


@router.post("/password-reset/confirm", response_model=PasswordResetGenericResponse)
def confirm_reset(
    payload: PasswordResetConfirmRequest,
    db: Session = Depends(get_db),
):
    """Step 2: validate the token + write the new bcrypt password
    hash + send the confirmation email."""
    from app.services.password_reset import confirm_password_reset, ResetConfirmResult
    result = confirm_password_reset(db, "candidate", payload.token, payload.new_password)
    if result == ResetConfirmResult.OK:
        return PasswordResetGenericResponse(ok=True)
    if result == ResetConfirmResult.INVALID_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters.",
        )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This reset link is invalid or has expired. Request a new one.",
    )
