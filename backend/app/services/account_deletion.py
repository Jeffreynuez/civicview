# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Self-serve account deletion (Task #81).

Single source of truth for the three identity types (citizen, rep,
candidate) — all delete + recover + purge logic lives here so each
auth router stays a thin HTTP shim.

Two delete modes:
  • Soft (archive 30 days) — sets self_deleted_at + purge_after on
    the account row. Login blocked while set; user can recover any
    time before purge_after. Startup purge job hard-deletes the row
    once purge_after elapses.
  • Hard (immediate) — runs the soft → hard path inline: archives
    the verification record (citizens only), drops the row,
    cascade-deletes all owned content.

The VerifiedIdentityArchive table preserves an opaque marker of
prior ID.me verification so a returning citizen doesn't pay the
$1.50 verification fee a second time. The hash uses SESSION_SECRET
as the salt — even if the archive table leaks the email isn't
recoverable to plaintext.

Reps + candidates skip the archive (they don't go through ID.me).
"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timedelta
from typing import Literal, Optional

from sqlalchemy.orm import Session

from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    RepAccount,
    VerifiedIdentityArchive,
)


logger = logging.getLogger(__name__)

# How long a soft-deleted account stays recoverable before the purge
# job hard-deletes it. 30 days matches what we promise on the
# /account/delete page; if you change this, update the copy there too.
SOFT_DELETE_GRACE_DAYS = 30

AccountKind = Literal["citizen", "rep", "candidate"]
AccountRow = CitizenAccount | RepAccount | CandidateAccount


# ── Email hash ───────────────────────────────────────────────────────
def _normalize_email(email: str) -> str:
    """Lowercase + trim. Same normalization the auth routers use for
    email lookups so the archive matches the same address shape."""
    return (email or "").strip().lower()


def hash_email_for_archive(email: str) -> str:
    """One-way sha256 of normalized email + the SESSION_SECRET salt.
    Result is a 64-char hex string. NOT reversible to the original
    email; the salt makes it infeasible to brute-force even with the
    archive table contents.

    SESSION_SECRET MUST be stable across the lifetime of the archive —
    if it changes, every existing archive entry becomes unmatchable
    (returning users would pay for re-verification). The session
    secret is also load-bearing for cookie auth, so it's already
    treated as a do-not-rotate value.
    """
    salt = os.getenv("SESSION_SECRET", "civicview-dev-fallback-secret")
    payload = f"{_normalize_email(email)}|{salt}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def is_email_previously_verified(db: Session, email: str) -> Optional[datetime]:
    """Return the original verified_at timestamp if this email matches
    an archived citizen verification — else None. Used by the citizen
    signup path to skip ID.me + the $1.50 cost on returning users."""
    if not email:
        return None
    row = (
        db.query(VerifiedIdentityArchive)
        .filter(VerifiedIdentityArchive.email_hash == hash_email_for_archive(email))
        .first()
    )
    return row.verified_at if row else None


def _archive_citizen_verification(db: Session, citizen: CitizenAccount) -> None:
    """Write the citizen's verification into the archive iff they're
    actually verified. No-op for unverified citizens (no money paid;
    nothing worth preserving).

    Idempotent on email_hash — if a row already exists for this hash
    (rare; would mean a user deleted, re-signed up, re-verified, then
    deleted again) we leave the existing row alone so we always
    surface the EARLIEST verification date."""
    if not citizen.verified:
        return
    h = hash_email_for_archive(citizen.email)
    existing = (
        db.query(VerifiedIdentityArchive)
        .filter(VerifiedIdentityArchive.email_hash == h)
        .first()
    )
    if existing:
        return
    db.add(VerifiedIdentityArchive(
        email_hash=h,
        # We don't store the actual ID.me verification timestamp on
        # CitizenAccount today — verified is just a boolean. Use
        # created_at as a reasonable proxy for "when ID.me ran".
        verified_at=citizen.created_at or datetime.utcnow(),
    ))


# ── Soft delete (archive 30 days) ────────────────────────────────────
def soft_delete_account(
    db: Session,
    kind: AccountKind,
    account: AccountRow,
) -> datetime:
    """Mark account as soft-deleted. Returns the purge_after timestamp
    so the caller can echo it in the response ('your account will be
    permanently deleted on YYYY-MM-DD')."""
    now = datetime.utcnow()
    account.self_deleted_at = now
    account.purge_after = now + timedelta(days=SOFT_DELETE_GRACE_DAYS)
    db.commit()
    logger.info(
        "Soft-deleted %s account id=%s — purge scheduled for %s",
        kind, account.id, account.purge_after.isoformat(),
    )
    return account.purge_after


def recover_account(
    db: Session,
    kind: AccountKind,
    account: AccountRow,
) -> None:
    """Reverse a soft delete. Called when a user logs in during the
    grace window and clicks 'Recover account'. No-op if the account
    isn't soft-deleted."""
    if account.self_deleted_at is None:
        return
    account.self_deleted_at = None
    account.purge_after = None
    db.commit()
    logger.info("Recovered %s account id=%s from soft delete", kind, account.id)


def is_soft_deleted(account: AccountRow) -> bool:
    return getattr(account, "self_deleted_at", None) is not None


# ── Rows keyed by (kind, id) with no foreign key ─────────────────────
# These tables serve all three identities, so they point at an account
# with a kind column plus an id column instead of a foreign key, and
# the database cannot cascade the delete for them. Deleting an account
# has to remove them explicitly (audit B3). Deliberately NOT listed:
# appeals (kept as an audit trail, see the Appeal model) and moderation
# verdicts (the safety record for content that was screened).
def _keyed_rows(kind: AccountKind, account_id: int, email: Optional[str]):
    from sqlalchemy import func, or_

    from app.models.pages import (
        DeviceToken,
        FeaturedTracked,
        LoginAttempt,
        Notification,
        PasswordResetToken,
        SavedItem,
        TrackedBill,
        TrackedElection,
        TrackedOfficial,
    )
    specs = []
    for model in (TrackedBill, TrackedOfficial, TrackedElection, FeaturedTracked, SavedItem):
        specs.append((model, [model.tracker_kind == kind, model.tracker_id == account_id]))
    specs.append((Notification, [Notification.recipient_kind == kind, Notification.recipient_id == account_id]))
    specs.append((PasswordResetToken, [
        PasswordResetToken.identity_kind == kind, PasswordResetToken.account_id == account_id,
    ]))
    # Login attempts: the account's own rows, plus failed attempts on the
    # same sign-in form that carry its email address but were never tied
    # to an id. A rep or candidate account sharing the email keeps its
    # own records.
    own_attempt = (LoginAttempt.identity_kind == kind) & (LoginAttempt.identity_id == account_id)
    if email:
        unmatched_same_email = (
            (LoginAttempt.identity_kind == kind)
            & LoginAttempt.identity_id.is_(None)
            & (func.lower(LoginAttempt.email_attempted) == email.strip().lower())
        )
        specs.append((LoginAttempt, [or_(own_attempt, unmatched_same_email)]))
    else:
        specs.append((LoginAttempt, [own_attempt]))
    if kind == "citizen":
        # Push devices are bound to citizens only. Dropping the row is
        # what stops pushes to a deleted user's phone; the app registers
        # the device again, anonymously, the next time it opens.
        specs.append((DeviceToken, [DeviceToken.citizen_id == account_id]))
    return specs


def delete_account_keyed_rows(
    db: Session, kind: AccountKind, account_id: int, email: Optional[str] = None,
) -> dict:
    """Delete every (kind, id)-keyed row that belongs to one account.
    Does not commit. Returns {table: rows_deleted}."""
    counts = {}
    for model, conds in _keyed_rows(kind, account_id, email):
        q = db.query(model)
        for cond in conds:
            q = q.filter(cond)
        n = q.delete(synchronize_session=False)
        if n:
            counts[model.__tablename__] = n
    return counts


def _delete_citizen_authored(db: Session, citizen_id: int) -> dict:
    """Content a citizen created whose foreign key is SET NULL rather
    than CASCADE, so the database would keep it without the author:
    the polls they started (their options, votes and comments go with
    them) and the demographic answers attached to their votes. Their
    votes on other people's polls stay in the totals, unlinked. Found in
    review of audit B3."""
    from app.models.pages import Poll, PollVote, PollVoteDemographic

    counts = {}
    vote_ids = db.query(PollVote.id).filter(PollVote.citizen_id == citizen_id)
    n = (
        db.query(PollVoteDemographic)
        .filter(PollVoteDemographic.poll_vote_id.in_(vote_ids))
        .delete(synchronize_session=False)
    )
    if n:
        counts["poll_vote_demographics"] = n
    polls = (
        db.query(Poll)
        .filter(Poll.author_kind == "citizen", Poll.author_citizen_id == citizen_id)
        .all()
    )
    for p in polls:
        db.delete(p)
    if polls:
        counts["citizen_polls"] = len(polls)
    return counts


# ── Hard delete (immediate) ──────────────────────────────────────────
def hard_delete_account(
    db: Session,
    kind: AccountKind,
    account: AccountRow,
) -> None:
    """Archive verification (citizens only), remove the rows that point
    at the account by (kind, id), then drop the account row. Cascading
    FK relationships on the model handle dependent content (posts,
    polls, comments, etc.)."""
    if kind == "citizen" and isinstance(account, CitizenAccount):
        _archive_citizen_verification(db, account)
    account_id = account.id
    removed = delete_account_keyed_rows(db, kind, account_id, getattr(account, "email", None))
    if kind == "citizen":
        removed.update(_delete_citizen_authored(db, account_id))
    db.delete(account)
    db.commit()
    logger.info("Hard-deleted %s account id=%s; also removed %s", kind, account_id, removed or "nothing else")


def purge_orphaned_account_rows(db: Optional[Session] = None) -> dict:
    """One sweep, safe to run at every boot: remove (kind, id)-keyed
    rows whose account no longer exists. Cleans up after deletions made
    before hard_delete_account removed these rows itself (audit B3)."""
    from app.db import SessionLocal

    owns = db is None
    db = db or SessionLocal()
    totals: dict = {}
    try:
        from app.models.pages import (
            DeviceToken, FeaturedTracked, LoginAttempt, Notification,
            PasswordResetToken, SavedItem, TrackedBill, TrackedElection, TrackedOfficial,
        )
        accounts = {"citizen": CitizenAccount, "rep": RepAccount, "candidate": CandidateAccount}
        pairs = [(m, m.tracker_kind, m.tracker_id) for m in
                 (TrackedBill, TrackedOfficial, TrackedElection, FeaturedTracked, SavedItem)]
        pairs += [
            (Notification, Notification.recipient_kind, Notification.recipient_id),
            (PasswordResetToken, PasswordResetToken.identity_kind, PasswordResetToken.account_id),
            (LoginAttempt, LoginAttempt.identity_kind, LoginAttempt.identity_id),
        ]
        for model, kind_col, id_col in pairs:
            for kind, acct in accounts.items():
                n = (
                    db.query(model)
                    .filter(kind_col == kind, id_col.isnot(None), ~id_col.in_(db.query(acct.id)))
                    .delete(synchronize_session=False)
                )
                if n:
                    totals[f"{model.__tablename__}:{kind}"] = n
        n = (
            db.query(DeviceToken)
            .filter(DeviceToken.citizen_id.isnot(None), ~DeviceToken.citizen_id.in_(db.query(CitizenAccount.id)))
            .delete(synchronize_session=False)
        )
        if n:
            totals["device_tokens:citizen"] = n
        db.commit()
        if totals:
            logger.info("Orphaned account rows removed: %s", totals)
    except Exception:
        db.rollback()
        logger.exception("Orphaned account row sweep failed; will retry next boot")
    finally:
        if owns:
            db.close()
    return totals


# ── Purge job (called on backend startup) ────────────────────────────
def purge_expired_accounts(db: Optional[Session] = None) -> dict:
    """Walk all three account tables for rows whose purge_after has
    elapsed and hard-delete them. Designed to run at backend startup;
    in production this should also be triggered daily via Render
    Cron Jobs or similar, but a startup-only invocation is acceptable
    for now (the backend restarts at least daily on free + paid
    plans).

    Returns a count dict for the log line.
    """
    from app.db import SessionLocal

    owns_session = db is None
    db = db or SessionLocal()
    now = datetime.utcnow()
    counts = {"citizen": 0, "rep": 0, "candidate": 0}
    try:
        for kind, model in (
            ("citizen", CitizenAccount),
            ("rep", RepAccount),
            ("candidate", CandidateAccount),
        ):
            expired = (
                db.query(model)
                .filter(model.purge_after.isnot(None))
                .filter(model.purge_after <= now)
                .all()
            )
            for acct in expired:
                # Same archive-then-delete path the hard delete uses
                # so a soft-deleted citizen's verification still
                # survives the eventual purge.
                hard_delete_account(db, kind, acct)
                counts[kind] += 1
        if any(counts.values()):
            logger.info(
                "Account purge: removed %d citizen / %d rep / %d candidate row(s)",
                counts["citizen"], counts["rep"], counts["candidate"],
            )
    except Exception:
        if owns_session:
            db.rollback()
        logger.exception("Account purge failed; rolling back")
        return counts
    finally:
        if owns_session:
            db.close()
    return counts


# ── Confirmation helper ──────────────────────────────────────────────
def verify_email_confirmation(account: AccountRow, typed_email: str) -> bool:
    """Used by every delete endpoint to validate the user typed their
    own email correctly. Defends against accidental clicks + auto-fill
    mistakes. Case-insensitive; trims whitespace."""
    return _normalize_email(typed_email) == _normalize_email(account.email)


def verify_password_confirmation(account: AccountRow, password) -> bool:
    """Deleting an account requires the account password (audit S7).
    The typed email only guards against a slip of the finger; the
    password guards against someone holding a borrowed or stolen
    session. Demo citizen accounts are the exception: their password
    was generated and shown once at signup, and a demo account holds
    nothing that would outlast it."""
    from app.auth import verify_password
    from app.services.digest_service import is_demo_email
    if is_demo_email(getattr(account, "email", "") or ""):
        return True
    if not password or not getattr(account, "password_hash", None):
        return False
    return verify_password(password, account.password_hash)
