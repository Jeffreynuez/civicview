# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Password reset service (Task #87).

Shared logic for all three identity types (citizen, rep, candidate).
Each auth router delegates to the helpers here so the token
generation + email send + token verification + password update flow
stays in one place.

Token security model:
  • Raw token: 32 bytes from secrets.token_urlsafe() → 43-char
    URL-safe string.
  • Stored as sha256(raw + SESSION_SECRET) so a DB leak doesn't
    expose valid tokens — an attacker would need both the DB row AND
    the SESSION_SECRET env var.
  • Single-use: row deleted on successful password change.
  • 1-hour expiry.
  • Tied to (identity_kind, account_id) so the confirm endpoint
    can't accidentally route a citizen's token to a rep account.

Anti-enumeration: the request endpoint ALWAYS returns 200 (success
shape) whether or not the email matches an account. Otherwise an
attacker can probe for registered emails by watching response
codes. The email only goes out if a match exists.
"""
from __future__ import annotations

import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Literal, Optional

from sqlalchemy.orm import Session

from app.auth import hash_password
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    PasswordResetToken,
    RepAccount,
)
from app.services.email_service import (
    get_email_service,
    render_password_reset_confirmation_email,
    render_password_reset_email,
)


logger = logging.getLogger(__name__)

IdentityKind = Literal["citizen", "rep", "candidate"]

# Token lives 1 hour. Long enough that users can read the email +
# click the link without a panic, short enough that a leaked link
# (e.g., user forwarded the email by accident) doesn't stay valid
# overnight.
TOKEN_TTL = timedelta(hours=1)


def _hash_token(raw_token: str) -> str:
    """sha256(raw + SESSION_SECRET). Matches the pattern used by the
    verified-identity archive (services/account_deletion.py)."""
    salt = os.getenv("SESSION_SECRET", "civicview-dev-fallback-secret")
    return hashlib.sha256(f"{raw_token}|{salt}".encode("utf-8")).hexdigest()


def _account_for_kind(
    db: Session, kind: IdentityKind, email: str,
) -> Optional[object]:
    """Look up the account row by email + identity kind. Returns None
    if not found. Email match is case-insensitive (matches the
    normalization the auth routers use at signup)."""
    norm_email = (email or "").strip().lower()
    if not norm_email:
        return None
    if kind == "citizen":
        return (
            db.query(CitizenAccount)
            .filter(CitizenAccount.email == norm_email)
            .first()
        )
    if kind == "rep":
        return (
            db.query(RepAccount)
            .filter(RepAccount.email == norm_email)
            .first()
        )
    if kind == "candidate":
        return (
            db.query(CandidateAccount)
            .filter(CandidateAccount.email == norm_email)
            .first()
        )
    return None


def _build_reset_url(raw_token: str, identity_kind: IdentityKind) -> str:
    """Compose the password-reset confirmation URL the email links to.
    Base origin defaults to https://civicview.app for prod; override
    with PASSWORD_RESET_URL_BASE in dev (e.g. http://localhost:3000)."""
    base = (os.getenv("PASSWORD_RESET_URL_BASE") or "https://civicview.app").rstrip("/")
    return f"{base}/password-reset?kind={identity_kind}&token={raw_token}"


# ─────────────────────────────────────────────────────────────────────
# Request — step 1 of the reset flow
# ─────────────────────────────────────────────────────────────────────
def request_password_reset(
    db: Session,
    identity_kind: IdentityKind,
    email: str,
) -> None:
    """Step 1: user typed an email + chose an identity. Look up the
    matching account; if found, mint a token + send the email.

    Returns nothing — never raises, never reveals whether the email
    matched. The caller's HTTP response is always 200 regardless of
    whether an email actually went out. This blunts the enumeration
    oracle that would otherwise leak which emails are registered."""
    account = _account_for_kind(db, identity_kind, email)
    if account is None:
        # No-op — don't leak that the email doesn't match.
        logger.info(
            "Password reset requested for %s email that doesn't match an account (kind=%s)",
            email, identity_kind,
        )
        return

    # Mint a fresh raw token + store its hash. We delete any prior
    # outstanding token for this (kind, account_id) tuple so a user
    # who requests twice doesn't accumulate orphan rows + so an
    # attacker can't farm tokens.
    db.query(PasswordResetToken).filter(
        PasswordResetToken.identity_kind == identity_kind,
        PasswordResetToken.account_id == account.id,
    ).delete()

    raw_token = secrets.token_urlsafe(32)
    row = PasswordResetToken(
        token_hash=_hash_token(raw_token),
        identity_kind=identity_kind,
        account_id=account.id,
        expires_at=datetime.utcnow() + TOKEN_TTL,
    )
    db.add(row)
    db.commit()

    # Send the email. Failure is logged but doesn't abort — the token
    # is in the DB; if the email service is temporarily down the user
    # can re-request.
    reset_url = _build_reset_url(raw_token, identity_kind)
    subject, body = render_password_reset_email(
        display_name=getattr(account, "display_name", None) or "",
        identity_kind=identity_kind,
        reset_url=reset_url,
        expires_in_hours=int(TOKEN_TTL.total_seconds() // 3600) or 1,
    )
    ok = get_email_service().send(
        to=account.email,
        subject=subject,
        text_body=body,
    )
    if not ok:
        logger.warning(
            "Password reset token minted for %s account id=%s but email send failed",
            identity_kind, account.id,
        )


# ─────────────────────────────────────────────────────────────────────
# Confirm — step 2 of the reset flow
# ─────────────────────────────────────────────────────────────────────
class ResetConfirmResult:
    """Returned by confirm_password_reset. Three possible outcomes
    so the caller (HTTP endpoint) can pick the right status code +
    response message."""
    OK = "ok"
    INVALID_TOKEN = "invalid_token"        # token doesn't exist, expired, or wrong kind
    INVALID_PASSWORD = "invalid_password"  # too short / empty


def confirm_password_reset(
    db: Session,
    identity_kind: IdentityKind,
    raw_token: str,
    new_password: str,
) -> str:
    """Step 2: user clicked the email link + entered a new password.
    Validate the token, update the password hash, delete the token
    (single-use). Returns one of the ResetConfirmResult constants.

    On success, also sends a confirmation email so the user has an
    audit trail if their email account is compromised + the attacker
    used the reset flow to take over."""
    # Trim minimal protection — empty / very short passwords get
    # rejected before we touch the DB.
    if not new_password or len(new_password) < 8:
        return ResetConfirmResult.INVALID_PASSWORD

    token_hash = _hash_token(raw_token or "")
    row = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == token_hash)
        .first()
    )
    if row is None:
        return ResetConfirmResult.INVALID_TOKEN
    if row.identity_kind != identity_kind:
        # Token is real but for a different identity type. Don't
        # leak which one — same response as expired.
        return ResetConfirmResult.INVALID_TOKEN
    if row.expires_at < datetime.utcnow():
        # Clean up the expired row while we're here.
        db.delete(row)
        db.commit()
        return ResetConfirmResult.INVALID_TOKEN

    # Look up the account row by (kind, id) — fail closed if it's
    # gone (account deleted between request + confirm).
    model_for_kind = {
        "citizen": CitizenAccount,
        "rep": RepAccount,
        "candidate": CandidateAccount,
    }[identity_kind]
    account = db.get(model_for_kind, row.account_id)
    if account is None:
        db.delete(row)
        db.commit()
        return ResetConfirmResult.INVALID_TOKEN

    # Hash the new password + update. Delete the token row so it
    # can't be replayed.
    account.password_hash = hash_password(new_password)
    db.delete(row)
    db.commit()
    logger.info(
        "Password reset completed for %s account id=%s",
        identity_kind, account.id,
    )

    # Confirmation email — best-effort, don't fail the request if
    # email is down.
    subject, body = render_password_reset_confirmation_email(
        display_name=getattr(account, "display_name", None) or "",
        identity_kind=identity_kind,
    )
    try:
        get_email_service().send(to=account.email, subject=subject, text_body=body)
    except Exception:
        logger.exception("Password change confirmation email failed (kind=%s)", identity_kind)

    return ResetConfirmResult.OK


# ─────────────────────────────────────────────────────────────────────
# Purge — cron-style cleanup of expired tokens
# ─────────────────────────────────────────────────────────────────────
def purge_expired_password_reset_tokens(db: Optional[Session] = None) -> int:
    """Delete expired token rows. Called from main.py's lifespan
    startup so the table doesn't accumulate orphans. Returns the
    count deleted."""
    from app.db import SessionLocal

    owns_session = db is None
    db = db or SessionLocal()
    try:
        now = datetime.utcnow()
        n = (
            db.query(PasswordResetToken)
            .filter(PasswordResetToken.expires_at < now)
            .delete()
        )
        if n:
            db.commit()
            logger.info("Purged %d expired password-reset token(s)", n)
        return n
    except Exception:
        db.rollback()
        logger.exception("Password reset token purge failed")
        return 0
    finally:
        if owns_session:
            db.close()
