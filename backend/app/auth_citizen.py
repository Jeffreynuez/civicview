# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Citizen-auth primitives — parallel to app/auth.py.

Why a separate module:
  • Rep sessions and citizen sessions use different cookies so both
    identities can live in the same browser at once (useful during
    demos: you're signed in as Rep. Donalds in one tab and as Citizen
    Jane Doe in another, engaging with the post you just wrote).
  • The salt on the signed-token serializer is distinct from rep
    sessions, so a rep cookie can't be replayed as a citizen cookie
    (and vice-versa) even if an attacker exfiltrated one.

Password hashing (bcrypt) is shared with app/auth.py — we import the
helpers rather than reimplementing them.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Response, status
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from sqlalchemy.orm import Session

from app.auth import hash_password, verify_password  # noqa: F401 — re-exported for seed
from app.db import get_db
from app.models.pages import CitizenAccount


logger = logging.getLogger(__name__)

CITIZEN_COOKIE_NAME = "cl_citizen"
CITIZEN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14  # 14 days, matches rep sessions

_SECRET = os.getenv("SESSION_SECRET") or "civiclens-dev-secret-DO-NOT-USE-IN-PROD"
# Distinct salt from rep sessions so the two token families can't be
# confused even if an attacker copies a cookie across.
_serializer = URLSafeTimedSerializer(_SECRET, salt="cl-citizen-v1")


# ── Token plumbing ────────────────────────────────────────────────────
def issue_citizen_token(citizen_id: int) -> str:
    return _serializer.dumps({"citizen_id": citizen_id})


def read_citizen_token(token: str) -> Optional[int]:
    try:
        payload = _serializer.loads(token, max_age=CITIZEN_SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(payload, dict):
        return None
    cid = payload.get("citizen_id")
    return int(cid) if isinstance(cid, int) else None


def set_citizen_cookie(response: Response, citizen_id: int) -> None:
    response.set_cookie(
        key=CITIZEN_COOKIE_NAME,
        value=issue_citizen_token(citizen_id),
        max_age=CITIZEN_SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        path="/",
    )


def clear_citizen_cookie(response: Response) -> None:
    response.delete_cookie(key=CITIZEN_COOKIE_NAME, path="/")


# ── FastAPI dependencies ──────────────────────────────────────────────
def get_optional_citizen(
    cl_citizen: Optional[str] = Cookie(default=None, alias=CITIZEN_COOKIE_NAME),
    db: Session = Depends(get_db),
) -> Optional[CitizenAccount]:
    """Returns the logged-in CitizenAccount or None. Use for endpoints
    that behave differently for authenticated citizens but don't
    *require* auth — e.g. a page-payload read that returns richer
    geography-resolved engagement metadata when the caller's identity
    is known."""
    if not cl_citizen:
        return None
    cid = read_citizen_token(cl_citizen)
    if cid is None:
        return None
    citizen = db.get(CitizenAccount, cid)
    if citizen is None or not citizen.is_active:
        return None
    return citizen


def get_current_citizen(
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> CitizenAccount:
    """Require an authenticated citizen. Returns the CitizenAccount or
    raises 401. Use on engagement endpoints (like, dislike, comment,
    poll-vote) that must be gated to known identities."""
    if citizen is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Citizen sign-in required",
        )
    return citizen
