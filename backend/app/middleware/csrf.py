# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""CSRF middleware (Task #31, Phase 2).

Validates `X-CSRF-Token` on every state-changing request (POST / PUT /
PATCH / DELETE) against the CSRF token derived from any currently-active
session token in the request. Three identity tracks (rep, citizen,
candidate) can coexist in a single browser; the validator accepts the
request if X-CSRF-Token matches the CSRF derived from ANY of them.

Why a middleware instead of a per-route FastAPI dependency:
  • Auto-applies to every state-changing endpoint, including new ones
    that get added without anyone remembering to add the dependency.
  • Fail-safe by default — to opt out, a path has to be added to
    EXEMPT_PATHS explicitly. Forgetting to opt out is a non-issue;
    forgetting to opt in (the dependency pattern) is a security gap
    that's invisible until someone notices.
  • Single place to audit when answering "is this endpoint CSRF-protected?"

Skip rules:
  • Safe methods (GET / HEAD / OPTIONS) — no CSRF needed. HTTP
    conventional: these should not mutate server state.
  • Path is in EXEMPT_PATHS — login endpoints can't validate CSRF
    because the session doesn't exist yet; webhooks come from external
    services with their own signature verification and have no
    session/CSRF to compare against.
  • No active session at all (no cookie, no Bearer-style header) —
    anonymous requests have nothing for an attacker to CSRF-forge in
    the first place.

On mismatch: returns 403 with a stable `code: "csrf_token_mismatch"` in
the body so the frontend can detect this specific failure and refresh
via /api/csrf before retrying (rather than treating it as a generic
permission error).

Related: app/auth.py compute_csrf_token + verify_csrf_match.
"""
from __future__ import annotations

import logging
from typing import List, Optional, Set

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.auth import verify_csrf_match


logger = logging.getLogger(__name__)


# Methods that need CSRF protection. GET/HEAD/OPTIONS are "safe" by HTTP
# convention and don't mutate server state, so no CSRF needed.
UNSAFE_METHODS: Set[str] = {"POST", "PUT", "PATCH", "DELETE"}


# Paths that bypass CSRF. Login endpoints can't validate CSRF — the
# session doesn't exist yet at request time. Webhooks are external
# POSTs with their own signature verification (Stripe HMAC, Postmark
# sender check) and no session/CSRF to compare against. Demo-signup
# is the citizen self-serve account creation; the response sets the
# session cookie, so there's no session at request time.
#
# Add new entries here when introducing any external-POST endpoint
# (OAuth callbacks, future Postmark inbound, third-party integrations).
# Default to NOT exempt — most routes should pass through the CSRF
# check.
EXEMPT_PATHS: Set[str] = {
    "/api/auth/login",
    "/api/citizen-auth/login",
    "/api/citizen-auth/demo-signup",
    "/api/candidate-auth/login",
    "/api/billing/webhook",
    # Future-proof — Postmark inbound hook is on the roadmap.
    "/api/postmark/webhook",
}


# Cookie names per identity track. See app/auth.py (cl_session),
# app/auth_citizen.py (cl_citizen), and app/auth_candidate.py
# (cl_candidate). All three can be set simultaneously in a single
# browser.
COOKIE_NAMES = ("cl_session", "cl_citizen", "cl_candidate")


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Parse `Authorization: Bearer <token>` and return the token.
    Mirrors app/auth._extract_bearer so the middleware doesn't depend
    on a private helper. None when header is missing / malformed."""
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _collect_session_tokens(request: Request) -> List[str]:
    """Pull every active session token from the request.

    A single browser can hold rep + citizen + candidate sessions
    simultaneously — we collect all of them so the validator can
    accept X-CSRF-Token if it matches ANY of the active identities.
    Cookies are the primary; the Bearer / X-Citizen-Token /
    X-Candidate-Token headers are the mobile / cross-site-cookie
    fallback (see the rep + citizen + candidate auth files for the
    full dual-path rationale)."""
    tokens: List[str] = []

    # Cookie path — three independent cookies, one per identity.
    for name in COOKIE_NAMES:
        val = request.cookies.get(name)
        if val:
            tokens.append(val)

    # Bearer header — primary fallback for the rep identity. Mobile
    # browsers (Samsung Internet, Safari/iOS ITP, etc.) block
    # cross-site cookies, so the frontend's API client forwards the
    # session_token here as a backup.
    bearer = _extract_bearer(request.headers.get("authorization"))
    if bearer:
        tokens.append(bearer)

    # Distinct headers for citizen + candidate identities. Avoid
    # colliding with Authorization (only one Bearer per request) when
    # multiple identities are active.
    for name in ("x-citizen-token", "x-candidate-token"):
        val = request.headers.get(name)
        if val:
            tokens.append(val)

    return tokens


class CsrfMiddleware(BaseHTTPMiddleware):
    """Validates X-CSRF-Token against all active session tokens."""

    async def dispatch(self, request: Request, call_next):
        # Safe methods pass straight through.
        method = request.method.upper()
        if method not in UNSAFE_METHODS:
            return await call_next(request)

        # Path exemptions — login endpoints + webhooks (see EXEMPT_PATHS).
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)

        # No-session paths — nothing for an attacker to CSRF-forge.
        # Anonymous POSTs (e.g., waitlist signup, password-reset request,
        # demo-signup before it sets a cookie) hit this branch.
        tokens = _collect_session_tokens(request)
        if not tokens:
            return await call_next(request)

        # Validate. We never log the actual provided token — only a
        # prefix for correlation. The session-token values stay opaque.
        provided = request.headers.get("x-csrf-token") or ""
        if not verify_csrf_match(provided, tokens):
            logger.warning(
                "CSRF validation failed: %s %s (provided_prefix=%r, active_sessions=%d)",
                method,
                request.url.path,
                provided[:8] if provided else "",
                len(tokens),
            )
            return JSONResponse(
                status_code=403,
                content={
                    "detail": (
                        "Missing or invalid CSRF token. "
                        "Refresh /api/csrf and retry."
                    ),
                    "code": "csrf_token_mismatch",
                },
            )

        return await call_next(request)
