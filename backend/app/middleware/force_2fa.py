# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Server-side FORCE_2FA_ENABLED enforcement (audit S8).

Until now the switch only produced `needs_2fa_enrollment` on /me and
the frontend drew an overlay. Anything that talked to the API directly
(a script, an old app build, a stolen token) could keep writing as a
rep, candidate or admin who had never enrolled. This middleware makes
the backend refuse those writes too.

Scope, kept deliberately narrow:
  • Inert unless FORCE_2FA_ENABLED is truthy. Then it costs one or two
    primary-key lookups per unsafe request that carries a session.
  • Unsafe methods only. Reads stay open so the app can load and show
    the enrollment overlay.
  • Applies when ANY session on the request belongs to an account that
    requires_2fa_enrollment() says must enroll, which matches the
    overlay: it also covers the whole app, not one identity.
  • The paths a user needs to get out of the state stay open: the 2FA
    endpoints themselves, login, logout, password reset, sign out
    everywhere, and account delete and recover.

Blocked requests get 403 with code "2fa_enrollment_required".
"""
from __future__ import annotations

import logging
import re

from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.middleware.csrf import UNSAFE_METHODS, _collect_session_tokens
from app.services.totp_enforcement import force_2fa_enabled

logger = logging.getLogger(__name__)

_ALLOWED_RE = re.compile(
    r"^/api/("
    r"2fa/.*"
    r"|sessions/.*"
    r"|(auth|citizen-auth|candidate-auth)/(login|logout|delete|recover|password-reset/.*)"
    r"|csrf"
    r")$"
)


def _needs_enrollment(tokens) -> bool:
    from app.auth import read_session_payload
    from app.auth_candidate import read_candidate_payload
    from app.auth_citizen import read_citizen_payload
    from app.db import SessionLocal
    from app.models.pages import CandidateAccount, CitizenAccount, RepAccount
    from app.services.admin_auth import is_admin_email
    from app.services.session_epoch import epoch_of
    from app.services.totp_enforcement import requires_2fa_enrollment

    readers = (
        (read_session_payload, RepAccount, lambda a: "rep"),
        (read_candidate_payload, CandidateAccount, lambda a: "candidate"),
        (read_citizen_payload, CitizenAccount,
         lambda a: "admin" if is_admin_email(getattr(a, "email", None)) else "citizen"),
    )
    db = SessionLocal()
    try:
        for tok in tokens:
            for reader, model, kind_of in readers:
                try:
                    got = reader(tok)
                except Exception:  # noqa: BLE001 - not this token kind
                    got = None
                if not got:
                    continue
                acct_id, se = got
                acct = db.get(model, acct_id)
                if acct is None or not getattr(acct, "is_active", True):
                    continue
                if epoch_of(acct) != se:
                    continue
                if requires_2fa_enrollment(kind_of(acct), acct):
                    return True
        return False
    finally:
        db.close()


class Force2FAMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method.upper() not in UNSAFE_METHODS or not force_2fa_enabled():
            return await call_next(request)
        if _ALLOWED_RE.match(request.url.path):
            return await call_next(request)
        tokens = _collect_session_tokens(request)
        if not tokens:
            return await call_next(request)
        if await run_in_threadpool(_needs_enrollment, tokens):
            logger.info("Blocked %s %s: 2FA enrollment required", request.method, request.url.path)
            return JSONResponse(
                status_code=403,
                content={
                    "detail": "Set up two-factor authentication to continue.",
                    "code": "2fa_enrollment_required",
                },
            )
        return await call_next(request)
