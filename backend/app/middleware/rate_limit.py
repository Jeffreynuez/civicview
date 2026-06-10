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

ENGAGE_LIMIT, ENGAGE_WINDOW = 30, 60.0
CREATE_LIMIT, CREATE_WINDOW = 10, 600.0


def _caller_key(request: Request) -> str:
    tokens = _collect_session_tokens(request)
    if tokens:
        # Truncated token is plenty for bucketing and keeps full
        # session tokens out of limiter memory.
        return "tok:" + tokens[0][:32]
    client = request.client.host if request.client else "unknown"
    return "ip:" + (request.headers.get("x-forwarded-for", client).split(",")[0].strip() or client)


class EngagementRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method.upper() not in UNSAFE_METHODS:
            return await call_next(request)
        path = request.url.path
        scope = None
        limit = window = None
        if _CREATE_RE.match(path):
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
