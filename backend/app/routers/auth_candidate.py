# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
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

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth import verify_password
from app.auth_candidate import (
    clear_candidate_cookie,
    get_current_candidate,
    issue_candidate_token,
    set_candidate_cookie,
)
from app.db import get_db
from app.models.pages import CandidateAccount
from app.schemas.pages import (
    CandidateLoginRequest,
    CandidateLoginResponse,
    CandidateMeResponse,
)


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
    response: Response,
    db: Session = Depends(get_db),
):
    """Verify candidate credentials and issue a session.

    Failure modes (mapped to status codes):
      • 401 — email unknown OR password wrong (same message, so an
              attacker can't enumerate registered emails).
      • 403 — account suspended (credentials WERE correct; admin
              has the account in suspended state).
      • 403 — account in claim_status='pending' (the admin hasn't
              approved this claim yet; we tell the user explicitly
              rather than pretending the credentials are wrong,
              since the password DID verify).
    """
    email = payload.email.strip().lower()
    candidate = db.query(CandidateAccount).filter(CandidateAccount.email == email).first()

    valid = False
    if candidate is not None and candidate.is_active:
        valid = verify_password(payload.password, candidate.password_hash)
    else:
        # Run bcrypt against the dummy hash so the timing of "unknown
        # email" paths matches the timing of "known email, wrong
        # password" paths. Defeats an enumeration oracle.
        verify_password(payload.password, _DUMMY_BCRYPT)

    if not candidate or not valid or not candidate.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if candidate.suspended_at is not None:
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
        from app.routers.two_factor import issue_login_challenge
        return CandidateLoginResponse(
            two_factor_required=True,
            challenge_token=issue_login_challenge("candidate", candidate.id),
        )

    set_candidate_cookie(response, candidate.id)
    candidate.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(candidate)

    return CandidateLoginResponse(
        candidate=CandidateMeResponse.model_validate(candidate),
        # Mirror token — same value as the cookie. Used by browsers
        # that block cross-site cookies; the frontend forwards it as
        # X-Candidate-Token on every request after login.
        candidate_token=issue_candidate_token(candidate.id),
    )


@router.post("/logout")
def logout(response: Response):
    """Clear the candidate session cookie. Always returns 200 so the
    UI can treat sign-out as never-failing — even if the user had no
    active cookie, the response is a successful no-op."""
    clear_candidate_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=CandidateMeResponse)
def me(candidate: CandidateAccount = Depends(get_current_candidate)):
    """Return the logged-in candidate. 401 if no valid session.

    get_current_candidate also 401s suspended and pending-claim
    accounts (treating them as not-signed-in), so /me only ever
    returns an active candidate."""
    return CandidateMeResponse.model_validate(candidate)
