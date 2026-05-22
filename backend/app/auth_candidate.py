# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Candidate-auth primitives — parallel to app/auth.py (rep) and
app/auth_citizen.py (citizen).

Why a separate module:
  • Candidate sessions get their own cookie + token salt so they
    can't be confused with rep sessions even though the two roles
    have similar capabilities (post on a page, attach polls, run
    events). A leaked rep cookie can't be replayed as a candidate
    cookie or vice versa.
  • The page-ownership semantics differ slightly: a rep owns the
    page whose official_id matches their RepAccount.official_id;
    a candidate owns the page whose candidate_id matches their
    CandidateAccount.candidate_id (different id spaces). Routes
    that resolve the engaging actor's "do they own this page?"
    must check both.

Three identity cookies can coexist in the same browser at once
(cl_session for rep, cl_citizen for citizen, cl_candidate for
candidate). That's deliberate for testing — the same browser can
hold all three roles simultaneously during a demo without
juggling logouts.

Password hashing (bcrypt) is shared with app/auth.py.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from sqlalchemy.orm import Session

from app.auth import hash_password, verify_password  # noqa: F401 — re-exported
from app.db import get_db
from app.models.pages import CandidateAccount


logger = logging.getLogger(__name__)

CANDIDATE_COOKIE_NAME = "cl_candidate"
CANDIDATE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14  # 14 days, parity with the other two

_SECRET = os.getenv("SESSION_SECRET") or "civiclens-dev-secret-DO-NOT-USE-IN-PROD"
# Distinct salt — rep / citizen / candidate tokens can never be
# confused with each other even if an attacker swaps cookie values.
_serializer = URLSafeTimedSerializer(_SECRET, salt="cl-candidate-v1")


# ── Token plumbing ────────────────────────────────────────────────────
def issue_candidate_token(candidate_id: int) -> str:
    return _serializer.dumps({"candidate_id": candidate_id})


def read_candidate_token(token: str) -> Optional[int]:
    try:
        payload = _serializer.loads(token, max_age=CANDIDATE_SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(payload, dict):
        return None
    cid = payload.get("candidate_id")
    return int(cid) if isinstance(cid, int) else None


def set_candidate_cookie(response: Response, candidate_id: int) -> None:
    # See app/auth.py for the rationale on COOKIE_SAMESITE +
    # COOKIE_SECURE — env-var-driven so cross-origin auth works in
    # production while local dev keeps SameSite=Lax over plain http.
    samesite = os.getenv("COOKIE_SAMESITE", "lax").lower()
    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    response.set_cookie(
        key=CANDIDATE_COOKIE_NAME,
        value=issue_candidate_token(candidate_id),
        max_age=CANDIDATE_SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite=samesite,
        secure=secure,
        path="/",
    )


def clear_candidate_cookie(response: Response) -> None:
    # See app/auth.py::clear_session_cookie — same SameSite+Secure
    # matching requirement applies so the deletion cookie actually
    # overwrites the original in cross-origin production. Without
    # this, Sign out silently leaves the original cookie in place.
    samesite = os.getenv("COOKIE_SAMESITE", "lax").lower()
    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    response.delete_cookie(
        key=CANDIDATE_COOKIE_NAME,
        path="/",
        samesite=samesite,
        secure=secure,
    )


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Parse `Authorization: Bearer <token>` — used as a fallback when
    cookies aren't available (mobile browsers blocking cross-site
    cookies). The candidate path uses its own X-Candidate-Token
    header alongside, so a browser carrying rep + citizen + candidate
    tokens can present all three without collision."""
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


# ── FastAPI dependencies ──────────────────────────────────────────────
def _resolve_candidate_from_session(
    cl_candidate: Optional[str],
    x_candidate_token: Optional[str],
    authorization: Optional[str],
    db: Session,
    *,
    allow_self_deleted: bool = False,
) -> Optional[CandidateAccount]:
    """Shared candidate resolver — see app/auth.py _resolve_rep_from_session
    for the rationale. allow_self_deleted=True lets /me and /recover
    see soft-deleted accounts during the 30-day grace window."""
    token = cl_candidate or x_candidate_token or _extract_bearer(authorization)
    if not token:
        return None
    cid = read_candidate_token(token)
    if cid is None:
        return None
    candidate = db.get(CandidateAccount, cid)
    if candidate is None or not candidate.is_active:
        return None
    if candidate.suspended_at is not None:
        return None
    if candidate.claim_status != "active":
        return None
    if not allow_self_deleted and candidate.self_deleted_at is not None:
        return None
    return candidate


def get_optional_candidate(
    cl_candidate: Optional[str] = Cookie(default=None, alias=CANDIDATE_COOKIE_NAME),
    x_candidate_token: Optional[str] = Header(default=None, alias="X-Candidate-Token"),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[CandidateAccount]:
    """Returns the logged-in CandidateAccount or None. Use for endpoints
    that behave differently when a candidate is signed in but don't
    *require* auth.

    Reads the candidate token from (in order):
      1. The httpOnly `cl_candidate` cookie (default everywhere it works).
      2. An `X-Candidate-Token: <token>` header — used by the frontend
         alongside the rep + citizen tokens when a browser carries
         multiple identities.
      3. `Authorization: Bearer <token>` — last-resort fallback for
         single-identity sessions.

    Refuses suspended, pending-claim, AND soft-deleted accounts (Task
    #81). For /me + /recover paths that need to see soft-deleted
    accounts, use get_optional_candidate_including_deleted instead.
    """
    return _resolve_candidate_from_session(
        cl_candidate, x_candidate_token, authorization, db,
    )


def get_optional_candidate_including_deleted(
    cl_candidate: Optional[str] = Cookie(default=None, alias=CANDIDATE_COOKIE_NAME),
    x_candidate_token: Optional[str] = Header(default=None, alias="X-Candidate-Token"),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[CandidateAccount]:
    """Variant that permits soft-deleted candidates — see /me + /recover."""
    return _resolve_candidate_from_session(
        cl_candidate, x_candidate_token, authorization, db, allow_self_deleted=True,
    )


def get_current_candidate(
    candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
) -> CandidateAccount:
    """Require an authenticated, active candidate. Returns the
    CandidateAccount or raises 401."""
    if candidate is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Candidate sign-in required",
        )
    return candidate
