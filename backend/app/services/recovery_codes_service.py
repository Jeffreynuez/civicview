# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Recovery-code service — issue, hash, verify, and burn-after-use the
backup codes that let a user authenticate when their authenticator
device is lost.

Design:
  • At 2FA enrollment, the user gets exactly RECOVERY_CODE_COUNT (10)
    fresh codes, displayed ONCE on the enrollment confirmation
    screen. They're instructed to save them somewhere durable
    (password manager / printed copy in a safe).
  • Each code is bcrypt-hashed before storage. We use bcrypt because
    it's already a backend dep for password hashing, and the code
    length (10 chars from a 32-symbol alphabet → ~50 bits of
    entropy) is well within bcrypt's effective range.
  • Each code is single-use. The first time a code verifies
    successfully, we mark it used_at = now() and refuse it on every
    subsequent attempt. The user can regenerate the full set of 10
    at any time (which invalidates ALL previously-issued codes,
    including unused ones).
  • Stored as RecoveryCode rows linked to one of three account types
    via three nullable FKs (citizen_account_id / rep_account_id /
    candidate_account_id) — exactly one is set per row. This matches
    the existing engagement-attribution pattern in pages.py.

Failure modes:
  • If the user uses their last code, the next "regenerate" or
    successful TOTP verification should prompt them to refresh the
    set. We log a warning when <3 unused codes remain so the caller
    can surface a UI nudge.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Literal

import bcrypt
from sqlalchemy.orm import Session

from app.models.pages import RecoveryCode
from app.services.totp_service import generate_recovery_code

logger = logging.getLogger(__name__)


RECOVERY_CODE_COUNT = 10  # codes per regeneration

AccountKind = Literal["citizen", "rep", "candidate"]


def _hash_code(code: str) -> str:
    """bcrypt-hash a plaintext recovery code (uppercased, whitespace
    stripped). Returns the UTF-8 hash string suitable for a TEXT
    column. Cost factor matches the password hashing default."""
    normalized = code.strip().upper().encode("utf-8")
    return bcrypt.hashpw(normalized, bcrypt.gensalt()).decode("utf-8")


def _verify_code_hash(code: str, code_hash: str) -> bool:
    """Constant-time compare a plaintext code against its stored hash."""
    if not code or not code_hash:
        return False
    normalized = code.strip().upper().encode("utf-8")
    try:
        return bcrypt.checkpw(normalized, code_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _account_fk_kwargs(account_kind: AccountKind, account_id: int) -> dict:
    """Build the FK kwargs for whichever of the three account-id columns
    this code belongs to. Exactly one is set; the other two are NULL."""
    if account_kind == "citizen":
        return {"citizen_account_id": account_id}
    if account_kind == "rep":
        return {"rep_account_id": account_id}
    if account_kind == "candidate":
        return {"candidate_account_id": account_id}
    raise ValueError(f"Unknown account_kind: {account_kind!r}")


def _account_filter(query, account_kind: AccountKind, account_id: int):
    """Filter a RecoveryCode query to a single account."""
    if account_kind == "citizen":
        return query.filter(RecoveryCode.citizen_account_id == account_id)
    if account_kind == "rep":
        return query.filter(RecoveryCode.rep_account_id == account_id)
    if account_kind == "candidate":
        return query.filter(RecoveryCode.candidate_account_id == account_id)
    raise ValueError(f"Unknown account_kind: {account_kind!r}")


def generate_codes_for_account(
    db: Session,
    account_kind: AccountKind,
    account_id: int,
) -> List[str]:
    """Wipe any existing codes for this account, generate a fresh batch
    of RECOVERY_CODE_COUNT codes, hash + persist them, and return the
    plaintext codes ONCE to the caller.

    Returns the plaintext list in display order. The caller MUST show
    these to the user immediately (they're never recoverable after
    this call — only the hashes are stored).
    """
    # Wipe all existing codes for this account first. Regeneration is
    # all-or-nothing — partial regeneration could let a user keep a
    # leaked subset of old codes active by only regenerating "some."
    _account_filter(db.query(RecoveryCode), account_kind, account_id).delete(
        synchronize_session=False,
    )

    plaintext_codes: List[str] = []
    for _ in range(RECOVERY_CODE_COUNT):
        plain = generate_recovery_code()
        plaintext_codes.append(plain)
        row = RecoveryCode(
            code_hash=_hash_code(plain),
            **_account_fk_kwargs(account_kind, account_id),
        )
        db.add(row)

    db.commit()
    return plaintext_codes


def consume_code(
    db: Session,
    account_kind: AccountKind,
    account_id: int,
    code: str,
) -> bool:
    """Try to use a recovery code. If it matches an unused row for this
    account, mark it consumed and return True. Otherwise return False
    (and don't update anything).

    Side-effects only run inside the transaction the caller commits.
    We commit internally on success because the "code is now spent"
    update must persist even if the larger login flow later fails
    (otherwise a single code could be used multiple times by retrying).
    """
    if not code:
        return False
    cleaned = code.strip().upper()
    if not cleaned:
        return False

    candidates = (
        _account_filter(db.query(RecoveryCode), account_kind, account_id)
        .filter(RecoveryCode.used_at.is_(None))
        .all()
    )
    for row in candidates:
        if _verify_code_hash(cleaned, row.code_hash):
            row.used_at = datetime.now(timezone.utc)
            db.commit()
            remaining = _unused_count(db, account_kind, account_id)
            if remaining <= 2:
                logger.warning(
                    "Account %s/%d has %d recovery codes left after burn. "
                    "Surface a regenerate nudge in the UI.",
                    account_kind, account_id, remaining,
                )
            return True
    return False


def _unused_count(db: Session, account_kind: AccountKind, account_id: int) -> int:
    return (
        _account_filter(db.query(RecoveryCode), account_kind, account_id)
        .filter(RecoveryCode.used_at.is_(None))
        .count()
    )


def remaining_count(
    db: Session,
    account_kind: AccountKind,
    account_id: int,
) -> int:
    """How many unused recovery codes does this account have? Used by
    the UI to render a "you have N codes left" hint without exposing
    the codes themselves."""
    return _unused_count(db, account_kind, account_id)


def wipe_codes(
    db: Session,
    account_kind: AccountKind,
    account_id: int,
) -> int:
    """Delete all recovery codes for the account. Used by 2FA disable +
    admin-reset flows. Returns the number of rows deleted (mostly for
    logging)."""
    deleted = _account_filter(db.query(RecoveryCode), account_kind, account_id).delete(
        synchronize_session=False,
    )
    db.commit()
    return int(deleted or 0)
