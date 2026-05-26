# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""CSRF token retrieval endpoint (Task #31, Phase 2).

GET /api/csrf returns the current CSRF tokens for any active identity
in the request. Used by the frontend on app boot, after route changes,
or after any session-state change (login / logout / token rotation)
to refresh the in-memory store that powers `X-CSRF-Token` attachment
on non-GET fetches.

Shape:
    {
      "rep_csrf":       "<hex>" | null,
      "citizen_csrf":   "<hex>" | null,
      "candidate_csrf": "<hex>" | null
    }

A null value means "this identity isn't signed in on this request."
Returning per-identity tokens (rather than one combined token) lets
the frontend pick the right CSRF based on which auth header(s) it's
about to send — useful when a single browser holds rep + citizen +
candidate sessions simultaneously and switches between them.

This endpoint is GET-only, so it bypasses the CSRF middleware (safe
methods aren't validated). No auth dependency either — we don't need
to know which user is signed in to compute their CSRF; we just need
their session token, and the cookies / headers carry that. If no
session is present at all, all three fields come back null and the
frontend treats that as "you're anonymous; nothing to protect yet."
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Cookie, Header
from pydantic import BaseModel

from app.auth import compute_csrf_token


router = APIRouter()


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Parse `Authorization: Bearer <token>` and return the token, or
    None if the header is missing / malformed. Mirrors the helper in
    app/auth.py so this router doesn't depend on a private symbol."""
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


class CsrfResponse(BaseModel):
    """Per-identity CSRF tokens for the current request.

    Any field may be None when the corresponding identity isn't
    signed in. The frontend stores all three and attaches the right
    one as `X-CSRF-Token` based on which auth credential(s) the
    request is using."""
    rep_csrf: Optional[str] = None
    citizen_csrf: Optional[str] = None
    candidate_csrf: Optional[str] = None


@router.get("", response_model=CsrfResponse)
@router.get("/", response_model=CsrfResponse)
def get_csrf(
    cl_session: Optional[str] = Cookie(default=None),
    cl_citizen: Optional[str] = Cookie(default=None),
    cl_candidate: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
    x_citizen_token: Optional[str] = Header(default=None, alias="x-citizen-token"),
    x_candidate_token: Optional[str] = Header(default=None, alias="x-candidate-token"),
) -> CsrfResponse:
    """Return CSRF tokens for every active identity in the request.

    Resolution per identity:
      • rep       → cl_session cookie, else Authorization: Bearer
      • citizen   → cl_citizen cookie, else X-Citizen-Token header
      • candidate → cl_candidate cookie, else X-Candidate-Token header

    Cookies are preferred over headers because they're the canonical
    transport in same-site browser sessions; headers are the mobile /
    cross-site-cookie fallback. When both are present they SHOULD be
    the same value (the frontend mirrors them at login time); if they
    diverge, the cookie wins.

    The CSRF is HMAC-SHA256(SESSION_SECRET, session_token), so the same
    session_token always produces the same CSRF — stable across requests
    until the session rotates (logout, expiry, refresh)."""
    # Rep
    rep_token = cl_session or _extract_bearer(authorization)
    rep_csrf = compute_csrf_token(rep_token) if rep_token else None

    # Citizen
    citizen_token = cl_citizen or x_citizen_token
    citizen_csrf = compute_csrf_token(citizen_token) if citizen_token else None

    # Candidate
    candidate_token = cl_candidate or x_candidate_token
    candidate_csrf = compute_csrf_token(candidate_token) if candidate_token else None

    return CsrfResponse(
        rep_csrf=rep_csrf,
        citizen_csrf=citizen_csrf,
        candidate_csrf=candidate_csrf,
    )
