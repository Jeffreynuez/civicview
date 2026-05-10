# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Authentication primitives for the Pages feature.

Strategy:
  • Passwords hashed with bcrypt — called directly (no passlib wrapper).
    passlib 1.7.4 has an unresolved compatibility bug with bcrypt>=5 and
    no new release; dropping it keeps us on a supported path across
    Python 3.10 – 3.14.
  • Session carried in an httpOnly, SameSite=Lax cookie whose value is a
    signed + timed token. Signing uses itsdangerous so a leaked cookie
    can't be forged or indefinitely reused.
  • `get_current_rep` is a FastAPI dependency — pass it to any route
    that requires an authenticated representative.

Secrets:
  • SESSION_SECRET (required in production) — random 32+ byte string.
    A dev default is used if unset so `uvicorn --reload` just works.
"""
from __future__ import annotations

import os
import secrets
import logging
from typing import Optional

import bcrypt
from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import RepAccount


logger = logging.getLogger(__name__)

SESSION_COOKIE_NAME = "cl_session"
# 14 day session window. Re-issued on every request via refresh_cookie().
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14

_SECRET = os.getenv("SESSION_SECRET")
if not _SECRET:
    # Dev-only fallback. Logged loudly so it can't slip into prod unnoticed.
    _SECRET = "civiclens-dev-secret-DO-NOT-USE-IN-PROD"
    logger.warning("SESSION_SECRET not set — using dev fallback. Set a real value in .env for production.")

_serializer = URLSafeTimedSerializer(_SECRET, salt="cl-session-v1")


# ── Password hashing ──────────────────────────────────────────────────
# bcrypt only hashes the first 72 bytes of the password. Rather than
# silently letting 73-byte inputs collide with 72-byte inputs (or letting
# bcrypt 5 raise), we truncate explicitly at both hash and verify time so
# the behavior is deterministic and consistent across bcrypt 4.x and 5.x.
_BCRYPT_MAX_BYTES = 72


def _encode_truncate(plain: str) -> bytes:
    return plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_encode_truncate(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_encode_truncate(plain), hashed.encode("utf-8"))
    except Exception:
        return False


# ── Session cookies ───────────────────────────────────────────────────
def issue_session_token(rep_id: int) -> str:
    """Return a signed token embedding the rep id."""
    return _serializer.dumps({"rep_id": rep_id})


def read_session_token(token: str) -> Optional[int]:
    """Return rep_id if the token is valid and unexpired, else None."""
    try:
        payload = _serializer.loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except SignatureExpired:
        return None
    except BadSignature:
        return None
    if not isinstance(payload, dict):
        return None
    rid = payload.get("rep_id")
    return int(rid) if isinstance(rid, int) else None


def set_session_cookie(response: Response, rep_id: int) -> None:
    token = issue_session_token(rep_id)
    # Cookie attributes:
    #   COOKIE_SAMESITE   — "lax" (default, dev) or "none" (prod cross-
    #                       origin). When the frontend lives at
    #                       civicview.app and the backend at
    #                       civicview-api.onrender.com, browsers refuse
    #                       to attach the cookie unless SameSite=None.
    #                       SameSite=None REQUIRES Secure=True.
    #   COOKIE_SECURE     — "true" in any HTTPS deployment, false locally.
    #                       Setting Secure=True over plain http: makes the
    #                       browser silently drop the cookie.
    samesite = os.getenv("COOKIE_SAMESITE", "lax").lower()
    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite=samesite,
        secure=secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Parse `Authorization: Bearer <token>` and return the token, or
    None if the header is missing / malformed. Used as a fallback when
    the session cookie isn't available — most notably on mobile
    browsers (Samsung Internet, Safari/iOS ITP, etc.) that block
    cross-site cookies by default. The frontend's API client stores
    the token returned in the login response and forwards it on every
    request, so cookie-restricted environments still get auth."""
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
def get_optional_rep(
    cl_session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[RepAccount]:
    """Returns the logged-in RepAccount or None. Use this when a route
    behaves differently for logged-in vs. anonymous callers but doesn't
    *require* auth (e.g., a page read endpoint that hides composer UI
    from anonymous callers but still returns posts).

    Reads the session token from EITHER the httpOnly cookie OR the
    `Authorization: Bearer <token>` header. The header path is the
    fallback for browsers (mobile in particular) that block
    cross-site cookies; the cookie path stays the default everywhere
    cookies work."""
    token = cl_session or _extract_bearer(authorization)
    if not token:
        return None
    rep_id = read_session_token(token)
    if rep_id is None:
        return None
    rep = db.get(RepAccount, rep_id)
    if rep is None or not rep.is_active:
        return None
    return rep


def get_current_rep(
    rep: Optional[RepAccount] = Depends(get_optional_rep),
) -> RepAccount:
    """Use this to *require* an authenticated rep. Returns the rep or
    raises 401."""
    if rep is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return rep


# ── CSRF-lite ─────────────────────────────────────────────────────────
def generate_csrf_token() -> str:
    """Returned on login; the frontend echoes it back via `X-CSRF-Token`
    on unsafe methods. Phase 2 replaces this with per-session tokens."""
    return secrets.token_urlsafe(32)
