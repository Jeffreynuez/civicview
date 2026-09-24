# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Engagement write rate limiting (Task #101).

Centralized in middleware (mirroring the CSRF middleware's design) so
new engagement endpoints are covered by default instead of each
remembering to opt in. Applies ONLY to unsafe methods whose path
matches the engagement patterns below — reads and everything else
pass straight through.

Two buckets, keyed by the caller's first active session token (the
same token collection the CSRF middleware uses), falling back to
client IP for anonymous callers (those requests 401 downstream anyway,
but the limiter still blunts credential-less spray):

  • ENGAGE — comments, reactions, votes, reports:
      30 hits / 60s. A human power-user clicking through a feed stays
      far under this; a script hammering reactions trips it instantly.
  • CREATE — poll + post creation:
      10 hits / 10 min. Nobody legitimately creates more than a poll
      a minute, sustained.

A third bucket, AI, covers the routes that spend the daily AI budget
(40 hits / 10 min, any method, anonymous callers keyed by IP). See
_AI_RE below.

429 responses carry code='rate_limited' + Retry-After, matching the
CSRF middleware's JSON error shape.
"""
from __future__ import annotations

import logging
import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.middleware.csrf import UNSAFE_METHODS, _collect_session_tokens
from app.services.rate_limit import check_rate_limit
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Engagement interactions — POST/PUT/PATCH/DELETE on these shapes.
# Covers: post + comment + poll + poll-comment reactions, post and
# citizen-poll comments (create/edit/delete), rep-poll + citizen-poll
# votes, every report endpoint.
_ENGAGE_RE = re.compile(
    r"^/api/.+/(reactions|comments|vote|reports?)(/\d+)?$"
)

# Content creation — standalone + page-bound citizen polls, rep posts,
# rep polls.
_CREATE_RE = re.compile(
    r"^/api/(citizen-polls|pages/[^/]+/(citizen-polls|posts|polls))$"
)

# Routes that spend the shared daily AI budget. Unlike the engagement
# routes these are open to anonymous callers, so the bucket is the
# signed-in account when there is one and the Cloudflare-verified
# client IP otherwise. Matched for every method: summarize-post is a
# GET. (audit S4)
_AI_RE = re.compile(
    r"^/api/(ai/(filter-items|filter-comments|filter-polls|summarize-post/[^/]+)"
    r"|eos/[^/]+/summary/translate"
    r"|votes/explain/generate"
    r"|bills/\d+/[^/]+/[^/]+/summary/translate"
    r"|state-officials/[^/]+/legislator-issues)$"
)

# Password reset requests send an email each time. Per caller (IP for
# anonymous visitors); the service adds a silent per-address cap on
# top so one inbox cannot be flooded from many IPs. (audit S8)
_RESET_RE = re.compile(
    r"^/api/(auth|citizen-auth|candidate-auth)/password-reset/request$"
)

# The waitlist form is anonymous and each new address can trigger a
# Brevo email. (audit S9)
_WAITLIST_RE = re.compile(r"^/api/waitlist/?$")

ENGAGE_LIMIT, ENGAGE_WINDOW = 30, 60.0
CREATE_LIMIT, CREATE_WINDOW = 10, 600.0
AI_LIMIT, AI_WINDOW = 40, 600.0
RESET_LIMIT, RESET_WINDOW = 5, 3600.0
WAITLIST_LIMIT, WAITLIST_WINDOW = 5, 3600.0


def _caller_key(request: Request) -> str:
    """Bucket by the ACCOUNT behind the request, not by a raw token.

    The previous version keyed on the first token it found without
    checking it, so a junk Bearer header (collected before the real
    X-Citizen-Token) got a brand-new bucket on every request and the
    limit never fired. Only a token whose signature verifies names an
    account; anything else falls back to the caller's IP.
    """
    from app.auth import read_session_token
    from app.auth_candidate import read_candidate_token
    from app.auth_citizen import read_citizen_token
    from app.services.client_ip import client_ip

    readers = (("rep", read_session_token), ("cit", read_citizen_token), ("cand", read_candidate_token))
    for tok in _collect_session_tokens(request):
        for kind, reader in readers:
            try:
                ident = reader(tok)
            except Exception:  # noqa: BLE001 - any bad token just means "not this kind"
                ident = None
            if ident:
                return f"{kind}:{ident}"
    return "ip:" + client_ip(request)


class EngagementRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        scope = None
        limit = window = None
        if request.method.upper() == "OPTIONS":
            return await call_next(request)
        if _AI_RE.match(path):
            scope, limit, window = "ai", AI_LIMIT, AI_WINDOW
        elif request.method.upper() not in UNSAFE_METHODS:
            return await call_next(request)
        elif _RESET_RE.match(path):
            scope, limit, window = "reset", RESET_LIMIT, RESET_WINDOW
        elif _WAITLIST_RE.match(path):
            scope, limit, window = "waitlist", WAITLIST_LIMIT, WAITLIST_WINDOW
        elif _CREATE_RE.match(path):
            scope, limit, window = "create", CREATE_LIMIT, CREATE_WINDOW
        elif _ENGAGE_RE.match(path):
            scope, limit, window = "engage", ENGAGE_LIMIT, ENGAGE_WINDOW
        if scope is None:
            return await call_next(request)
        try:
            check_rate_limit(
                scope,
                _caller_key(request),
                limit,
                window,
                detail=(
                    "You\u2019re creating content too quickly \u2014 wait a few "
                    "minutes and try again."
                    if scope == "create"
                    else "Too many AI requests in a short time. Wait a few minutes and try again."
                    if scope == "ai"
                    else "Too many password reset requests. Try again in an hour."
                    if scope == "reset"
                    else "Too many signups from this connection. Try again in an hour."
                    if scope == "waitlist"
                    else "You\u2019re doing that too fast \u2014 wait a moment and try again."
                ),
            )
        except HTTPException as exc:
            logger.warning(
                "rate limited: %s %s (scope=%s)", request.method, path, scope
            )
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail, "code": "rate_limited"},
                headers=exc.headers or {},
            )
        return await call_next(request)
