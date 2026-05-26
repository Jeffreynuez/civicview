# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Login attempt logging + lockout service (Task #29).

Every login attempt across all three identity types (rep, candidate,
citizen) flows through this module. Two responsibilities:

  1. Audit trail — every attempt (success, failure, locked-out,
     suspended, etc.) is persisted to the `login_attempts` table
     with IP + user agent + identity reference. Used for incident
     response, enumeration-attack detection, and (later) a
     user-facing "recent sign-in activity" view.

  2. Account-level lockout — after N consecutive failed password
     attempts, the account is locked for an escalating window
     (15min → 1hr → 24h). The lockout is per-account, not per-IP,
     so a distributed attack across many emails has to grind each
     account to lockout independently. Per-IP throttling is a
     future Phase 2 add — it needs Redis-style counters and we'd
     rather ship this layer first.

Threshold tuning (set by Jeffrey on 2026-05-26):
  • Reps + candidates = 3 attempts. These are elevated-trust
    identities — they post on official pages and engage with
    verified attribution, so the threat surface is bigger.
  • Citizens = 5 attempts. Industry standard for general users;
    forgiving of typos without inviting brute force.

What counts toward the lockout counter:
  • ONLY password-attempt failures. A correct password followed
    by a "suspended" or "pending claim" branch does NOT reset the
    counter (we don't want stolen credentials to reset lockout
    progress just by hitting a blocked account), and does NOT
    increment it (the password was right; we're not measuring
    that).
  • 2FA code retries are tracked separately by the 2FA flow.
    Locking a rep out after 3 fat-fingered 6-digit codes would
    be punitive without adding security (the code already
    expires).

Anti-enumeration:
  • Lockout response is the SAME generic 401 as a wrong password,
    so an attacker can't probe lockout state to enumerate accounts.
  • The lockout-alert email is the compensating UX path for legit
    users who hit the wall and don't understand why.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Literal, Optional, Union

from sqlalchemy.orm import Session

from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    LoginAttempt,
    RepAccount,
)


logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# Identity types + thresholds
# ─────────────────────────────────────────────────────────────────────
IdentityKind = Literal["rep", "candidate", "citizen"]

# Max consecutive failed password attempts before lockout fires.
MAX_ATTEMPTS = {
    "rep": 3,
    "candidate": 3,
    "citizen": 5,
}

# Escalating lockout schedule. The "consecutive" counter increments
# every time a lockout fires WITHOUT a successful sign-in in between,
# so a persistent attacker gets progressively longer windows.
_LOCKOUT_DURATIONS = [
    timedelta(minutes=15),
    timedelta(hours=1),
    timedelta(hours=24),
]


AccountRow = Union[RepAccount, CandidateAccount, CitizenAccount]


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _now() -> datetime:
    """Centralized clock so tests can monkeypatch this one symbol
    instead of patching datetime module-wide."""
    return datetime.utcnow()


def _lockout_duration(consecutive_count: int) -> timedelta:
    """Pick the escalating window:
       1st lockout       → 15 min
       2nd consecutive   → 1 hour
       3rd and beyond    → 24 hours
    """
    if consecutive_count <= 1:
        return _LOCKOUT_DURATIONS[0]
    if consecutive_count == 2:
        return _LOCKOUT_DURATIONS[1]
    return _LOCKOUT_DURATIONS[2]


def is_locked(account: AccountRow) -> bool:
    """True iff the account is currently within an active lockout
    window. Callers check this BEFORE attempting password verification
    so we don't burn bcrypt cycles on locked accounts."""
    if account.locked_until is None:
        return False
    return account.locked_until > _now()


# ─────────────────────────────────────────────────────────────────────
# Audit-row writer
# ─────────────────────────────────────────────────────────────────────
def record_attempt(
    db: Session,
    *,
    identity_kind: IdentityKind,
    identity_id: Optional[int],
    email_attempted: str,
    ip_address: Optional[str],
    user_agent: Optional[str],
    success: bool,
    fail_reason: Optional[str],
) -> None:
    """Persist one row to `login_attempts`. All callers go through
    here so the audit trail is uniform. IP + user agent are truncated
    defensively in case a client sends an oversized header."""
    row = LoginAttempt(
        identity_kind=identity_kind,
        identity_id=identity_id,
        email_attempted=email_attempted[:255] if email_attempted else "",
        ip_address=(ip_address or "")[:45] or None,
        user_agent=(user_agent or "")[:512] or None,
        success=success,
        fail_reason=fail_reason,
        occurred_at=_now(),
    )
    db.add(row)


# ─────────────────────────────────────────────────────────────────────
# Outcome registrars — one per branch of the login state machine
# ─────────────────────────────────────────────────────────────────────
def register_no_account(
    db: Session,
    *,
    identity_kind: IdentityKind,
    email_attempted: str,
    ip_address: Optional[str],
    user_agent: Optional[str],
) -> None:
    """The supplied email didn't match any account. Logged so we can
    detect enumeration sweeps from a single IP."""
    record_attempt(
        db,
        identity_kind=identity_kind,
        identity_id=None,
        email_attempted=email_attempted,
        ip_address=ip_address,
        user_agent=user_agent,
        success=False,
        fail_reason="no_account",
    )


def register_locked_out(
    db: Session,
    *,
    account: AccountRow,
    identity_kind: IdentityKind,
    email_attempted: str,
    ip_address: Optional[str],
    user_agent: Optional[str],
) -> None:
    """Account is already inside its lockout window — record the
    attempt but DON'T increment the counter (already maxed; nothing
    to bump). The router will return the same generic 401 as a wrong
    password to avoid leaking lockout state."""
    record_attempt(
        db,
        identity_kind=identity_kind,
        identity_id=account.id,
        email_attempted=email_attempted,
        ip_address=ip_address,
        user_agent=user_agent,
        success=False,
        fail_reason="locked_out",
    )


def register_failure(
    db: Session,
    *,
    account: AccountRow,
    identity_kind: IdentityKind,
    email_attempted: str,
    ip_address: Optional[str],
    user_agent: Optional[str],
) -> bool:
    """Wrong password on a known account. Increments the per-window
    counter; when threshold is hit, applies the escalating lockout
    and best-effort fires the security-alert email.

    Returns True iff THIS call triggered a fresh lockout (caller can
    log or surface that signal if useful).
    """
    threshold = MAX_ATTEMPTS[identity_kind]
    account.failed_login_count = (account.failed_login_count or 0) + 1
    triggered_lockout = False

    if account.failed_login_count >= threshold:
        account.consecutive_lockout_count = (
            (account.consecutive_lockout_count or 0) + 1
        )
        duration = _lockout_duration(account.consecutive_lockout_count)
        account.locked_until = _now() + duration
        # Reset the per-window counter so the next set of attempts
        # (once the window expires) starts at 0. consecutive_lockout_count
        # keeps climbing until a successful sign-in resets it.
        account.failed_login_count = 0
        triggered_lockout = True

        # Best-effort security alert email — never let an email
        # failure block the lockout itself.
        try:
            from app.services.email_service import send_lockout_alert_email
            send_lockout_alert_email(
                to_email=account.email,
                identity_kind=identity_kind,
                ip_address=ip_address,
                lockout_minutes=int(duration.total_seconds() / 60),
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "send_lockout_alert_email failed for %s account id=%s",
                identity_kind, account.id,
            )

    record_attempt(
        db,
        identity_kind=identity_kind,
        identity_id=account.id,
        email_attempted=email_attempted,
        ip_address=ip_address,
        user_agent=user_agent,
        success=False,
        fail_reason="bad_password",
    )
    return triggered_lockout


def register_blocked(
    db: Session,
    *,
    account: AccountRow,
    identity_kind: IdentityKind,
    email_attempted: str,
    ip_address: Optional[str],
    user_agent: Optional[str],
    reason: str,
) -> None:
    """Password was correct but the account is blocked from completing
    sign-in (suspended, claim_pending, self_deleted, inactive, etc.).
    Counter is NOT reset — we don't want stolen-credentials attackers
    resetting their lockout progress just by hitting a blocked
    account. Counter is NOT incremented either — the password was
    right; that's not what we're measuring."""
    record_attempt(
        db,
        identity_kind=identity_kind,
        identity_id=account.id,
        email_attempted=email_attempted,
        ip_address=ip_address,
        user_agent=user_agent,
        success=False,
        fail_reason=reason,
    )


def register_two_factor_required(
    db: Session,
    *,
    account: AccountRow,
    identity_kind: IdentityKind,
    email_attempted: str,
    ip_address: Optional[str],
    user_agent: Optional[str],
) -> None:
    """Password was correct but 2FA is required. Counter is NOT reset
    yet — full sign-in isn't complete until the 2FA challenge passes.
    The 2FA flow is responsible for calling register_success once
    the second factor verifies."""
    record_attempt(
        db,
        identity_kind=identity_kind,
        identity_id=account.id,
        email_attempted=email_attempted,
        ip_address=ip_address,
        user_agent=user_agent,
        success=False,
        fail_reason="2fa_required",
    )


def register_success(
    db: Session,
    *,
    account: AccountRow,
    identity_kind: IdentityKind,
    email_attempted: str,
    ip_address: Optional[str],
    user_agent: Optional[str],
) -> None:
    """Full sign-in succeeded — clear counters + lockout state."""
    account.failed_login_count = 0
    account.locked_until = None
    account.consecutive_lockout_count = 0
    record_attempt(
        db,
        identity_kind=identity_kind,
        identity_id=account.id,
        email_attempted=email_attempted,
        ip_address=ip_address,
        user_agent=user_agent,
        success=True,
        fail_reason=None,
    )


def reset_counters(account: AccountRow) -> None:
    """Called from password-reset/confirm. Clears lockout state and
    counters so a legit user who successfully reset their password
    isn't blocked by stale state. Doesn't write an audit row — the
    password-reset endpoint owns its own audit logging (separately
    from login attempts)."""
    account.failed_login_count = 0
    account.locked_until = None
    account.consecutive_lockout_count = 0


# ─────────────────────────────────────────────────────────────────────
# Request-side helpers
# ─────────────────────────────────────────────────────────────────────
def extract_client_signals(request) -> tuple[Optional[str], Optional[str]]:
    """Pull IP + user agent from a FastAPI Request. Centralized so
    every login endpoint resolves them the same way.

    IP resolution prefers X-Forwarded-For (Render + Vercel both
    populate this), falls back to request.client.host. We take only
    the FIRST address in the X-F-F chain since that's the original
    client; downstream hops are infra we control.
    """
    ip: Optional[str] = None
    fwd = request.headers.get("x-forwarded-for") if request else None
    if fwd:
        # X-F-F is a comma-separated chain; first entry is the
        # original client per RFC 7239 conventions.
        ip = fwd.split(",")[0].strip() or None
    if not ip and request and request.client:
        ip = request.client.host

    ua = None
    if request:
        ua = request.headers.get("user-agent")
    return ip, ua
