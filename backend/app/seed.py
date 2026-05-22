# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Demo-account seeding for the Pages feature.

Goal:
  • Give investors/reviewers a one-click demo: start the backend and a
    handful of rep accounts are already registered and ready to log in.
  • Idempotent — safe to run on every startup. We look up by email; if
    the account exists we leave it alone (never overwrite a hand-edited
    password in the DB with the seed default).

Source of seed data:
  1. DEMO_ACCOUNTS_JSON env var, if set — a JSON string matching the
     shape of demo_accounts.json. Useful in hosted demos where we don't
     want credentials checked into the image.
  2. Otherwise, backend/demo_accounts.json — the checked-in dev seed.
  3. If neither is available, we log a note and skip seeding.

Shape of the JSON payload:
  {
    "accounts": [
      {
        "official_id": "...",
        "email": "...",
        "password": "...",          # plaintext — hashed before write
        "display_name": "...",
        "role": "..."               # optional
      },
      ...
    ]
  }
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session

from datetime import datetime

from app.auth import hash_password
from app.db import SessionLocal
from app.models.pages import BillSummary, CandidateAccount, CitizenAccount, Poll, RepAccount


logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SEED_PATH = BACKEND_DIR / "demo_accounts.json"
DEFAULT_CITIZEN_SEED_PATH = BACKEND_DIR / "demo_citizen_accounts.json"
DEFAULT_CANDIDATE_SEED_PATH = BACKEND_DIR / "demo_candidate_accounts.json"
# Pre-fetched CRS summaries for the bills users see on day one. Built
# by backend/scripts/seed_bill_summaries.py and committed alongside
# the code so production loads them on first boot — no Congress.gov
# round-trips, no LLM calls.
DEFAULT_BILL_SUMMARIES_PATH = BACKEND_DIR / "app" / "data" / "bill_summaries_seed.json"


def _load_seed_payload() -> Optional[Dict[str, Any]]:
    env_blob = os.getenv("DEMO_ACCOUNTS_JSON")
    if env_blob:
        try:
            return json.loads(env_blob)
        except json.JSONDecodeError as exc:
            logger.error("DEMO_ACCOUNTS_JSON is set but not valid JSON: %s", exc)
            return None

    if DEFAULT_SEED_PATH.exists():
        try:
            with DEFAULT_SEED_PATH.open("r", encoding="utf-8") as fh:
                return json.load(fh)
        except json.JSONDecodeError as exc:
            logger.error("demo_accounts.json is not valid JSON: %s", exc)
            return None

    return None


def _validate_account(entry: Dict[str, Any]) -> bool:
    required = ("official_id", "email", "password", "display_name")
    for k in required:
        if not entry.get(k):
            logger.warning("Skipping demo account — missing field '%s' in: %r", k, entry)
            return False
    return True


def seed_demo_accounts(db: Optional[Session] = None) -> int:
    """
    Insert any demo accounts that aren't already present.
    Returns the number of newly-created accounts.
    """
    payload = _load_seed_payload()
    if not payload:
        logger.info("No demo-accounts seed source found — skipping seed step.")
        return 0

    accounts: List[Dict[str, Any]] = payload.get("accounts") or []
    if not accounts:
        logger.info("Demo-accounts seed source had no accounts — skipping.")
        return 0

    owns_session = db is None
    db = db or SessionLocal()
    created = 0
    topped_up = 0
    try:
        for entry in accounts:
            if not _validate_account(entry):
                continue

            email = entry["email"].strip().lower()
            official_id = entry["official_id"].strip()

            existing = (
                db.query(RepAccount)
                .filter(
                    (RepAccount.email == email)
                    | (RepAccount.official_id == official_id)
                )
                .first()
            )
            entry_state = (entry.get("owner_state") or "").strip().upper()[:2] or None
            entry_district = (entry.get("owner_district") or None)
            entry_city = (entry.get("owner_city") or None)

            if existing:
                # Top up newly-added scope fields on old rows. We only
                # overwrite when the existing value is NULL so we never
                # stomp on something a human has edited in the DB.
                changed = False
                if entry_state and not existing.owner_state:
                    existing.owner_state = entry_state
                    changed = True
                if entry_district and not existing.owner_district:
                    existing.owner_district = entry_district
                    changed = True
                if entry_city and not existing.owner_city:
                    existing.owner_city = entry_city
                    changed = True
                if changed:
                    topped_up += 1
                continue

            acct = RepAccount(
                official_id=official_id,
                email=email,
                password_hash=hash_password(entry["password"]),
                display_name=entry["display_name"],
                role=entry.get("role"),
                owner_state=entry_state,
                owner_district=entry_district,
                owner_city=entry_city,
                is_active=True,
            )
            db.add(acct)
            created += 1
            # Citizen-polls archive trigger: any in-flight citizen polls
            # on this newly-claimed page move to "Pre-claim discussion"
            # immediately. Local import avoids a circular at module
            # load (services → models → db is already deep-loaded by
            # the time we get here).
            try:
                from app.services.citizen_polls_service import archive_polls_for_claim
                archived_n = archive_polls_for_claim(db, official_id)
                if archived_n:
                    logger.info(
                        "Archived %d citizen polls on newly-claimed page %s",
                        archived_n, official_id,
                    )
            except Exception:
                # Don't let an archive hiccup take down account seeding.
                logger.exception("Citizen-poll archive on claim failed for %s", official_id)

        # Commit whenever anything changed — new inserts OR top-ups on
        # existing rows. Previously the commit was gated on `created>0`,
        # which silently dropped top-up writes when every seed account
        # already existed (the common case after the first run).
        if created or topped_up:
            db.commit()
            logger.info(
                "Rep accounts: seeded %d new, topped up %d existing (scope fields).",
                created, topped_up,
            )
        else:
            logger.info("Demo rep accounts already present and up to date — nothing to seed.")
    except Exception:
        db.rollback()
        logger.exception("Demo-account seeding failed — rolled back.")
        raise
    finally:
        if owns_session:
            db.close()

    return created


# ── Citizen seed ──────────────────────────────────────────────────────
def _load_citizen_seed_payload() -> Optional[Dict[str, Any]]:
    """Parallel to _load_seed_payload but for the citizen-accounts seed.
    Env override: DEMO_CITIZEN_ACCOUNTS_JSON. Default path is
    backend/demo_citizen_accounts.json."""
    env_blob = os.getenv("DEMO_CITIZEN_ACCOUNTS_JSON")
    if env_blob:
        try:
            return json.loads(env_blob)
        except json.JSONDecodeError as exc:
            logger.error("DEMO_CITIZEN_ACCOUNTS_JSON is set but not valid JSON: %s", exc)
            return None

    if DEFAULT_CITIZEN_SEED_PATH.exists():
        try:
            with DEFAULT_CITIZEN_SEED_PATH.open("r", encoding="utf-8") as fh:
                return json.load(fh)
        except json.JSONDecodeError as exc:
            logger.error("demo_citizen_accounts.json is not valid JSON: %s", exc)
            return None

    return None


def _validate_citizen(entry: Dict[str, Any]) -> bool:
    required = ("email", "password", "display_name", "city", "state")
    for k in required:
        if not entry.get(k):
            logger.warning("Skipping demo citizen — missing field '%s' in: %r", k, entry)
            return False
    return True


def seed_demo_citizens(db: Optional[Session] = None) -> int:
    """
    Insert any seeded citizen accounts that aren't already present.
    Idempotent — matches on email, so running twice is a no-op.

    Two use cases share this path:
      • Demo / test citizens — verified=False (default). Used to be a
        committed list of 60 names; that's now retired and the
        committed seed file is empty. Operators can re-add demo
        citizens via the DEMO_CITIZEN_ACCOUNTS_JSON env var if
        desired for local testing.
      • Operator-seeded "real" accounts — verified=True. An entry
        with "verified": true in its JSON gets a verified account
        on the next boot, which together with ADMIN_EMAILS lets the
        operator create themselves an admin login without waiting
        for the Phase-2 ID.me-backed signup flow. Example JSON:
          {"citizens":[{
            "email": "civicview@civicview.app",
            "password": "...",
            "display_name": "CivicView Admin",
            "city": "Internal", "state": "FL",
            "verified": true
          }]}

    Returns the number of newly-created accounts.
    """
    payload = _load_citizen_seed_payload()
    if not payload:
        logger.info("No citizen-accounts seed source found — skipping citizen seed step.")
        return 0

    citizens: List[Dict[str, Any]] = payload.get("citizens") or []
    if not citizens:
        logger.info("Citizen-accounts seed source had no citizens — skipping.")
        return 0

    owns_session = db is None
    db = db or SessionLocal()
    created = 0
    topped_up = 0
    try:
        for entry in citizens:
            if not _validate_citizen(entry):
                continue

            email = entry["email"].strip().lower()
            # `verified` defaults to False (demo seed); operator-seeded
            # accounts set "verified": true to mark themselves as
            # non-demo. We coerce explicitly so a stray string in the
            # JSON ("true" instead of bool true) isn't silently
            # interpreted as truthy.
            is_verified = entry.get("verified") is True

            existing = (
                db.query(CitizenAccount)
                .filter(CitizenAccount.email == email)
                .first()
            )
            if existing:
                # Top-up path. The seed is idempotent on email, but
                # we WANT to flip verified=True on a row that was
                # previously seeded under an older code path that
                # ignored "verified". Top-ups never DOWNGRADE — we
                # don't flip True→False just because the operator
                # took the flag off, since that would be confusing
                # if the user already became admin and we then
                # silently revoked. Operator can DELETE the row in
                # the DB if they want to fully reset.
                if is_verified and not existing.verified:
                    existing.verified = True
                    topped_up += 1
                    logger.info(
                        "Topped up VERIFIED on existing citizen %s — "
                        "previously seeded as unverified.",
                        email,
                    )
                continue

            acct = CitizenAccount(
                email=email,
                password_hash=hash_password(entry["password"]),
                display_name=entry["display_name"].strip(),
                address_line1=(entry.get("address_line1") or None),
                city=entry["city"].strip(),
                county=(entry.get("county") or None),
                state=entry["state"].strip().upper()[:2],
                zip_code=(entry.get("zip_code") or None),
                congressional_district=(entry.get("congressional_district") or None),
                verified=is_verified,
                is_active=True,
            )
            db.add(acct)
            created += 1
            if is_verified:
                logger.info(
                    "Seeded VERIFIED citizen %s (display_name=%r). "
                    "If this email is in ADMIN_EMAILS, the account is now admin.",
                    email, acct.display_name,
                )

        if created or topped_up:
            db.commit()
            logger.info(
                "Citizen seed: %d new, %d topped up (verified flag).",
                created, topped_up,
            )
        else:
            logger.info("Demo citizen accounts already present — nothing to seed.")
    except Exception:
        db.rollback()
        logger.exception("Citizen-account seeding failed — rolled back.")
        raise
    finally:
        if owns_session:
            db.close()

    return created


# ── Demo subscription backfill (Task #88 hotfix) ─────────────────────
# Demo citizens created BEFORE the is_subscribed column existed have
# is_subscribed=false (auto-migrate's default backfill). Real billing
# isn't live yet, so the intent is for every demo account to have the
# same "full engagement features" grant the post-Task-#88 demo signups
# get. This pass flips the flag for existing demo rows so a citizen
# who created an account two days ago has the same experience as one
# who signs up today.
#
# Scope is narrow on purpose: only rows whose email ends with
# "@demo-citizens.civicview.app" (the synthetic domain the demo-signup
# endpoint mints) AND whose stripe_subscription_id is NULL (so we
# never overwrite a real paid subscription if one ever lands on that
# domain). The is_subscribed flip is also gated on "not already True"
# so the function is a true no-op on stable state — safe to call
# every boot.
#
# REMOVE this function once real Stripe billing goes live + the
# demo-grant in auth_citizen.demo_signup is removed.
def backfill_demo_citizen_subscriptions(db: Optional[Session] = None) -> int:
    """Flip is_subscribed=True + subscription_status='demo' on any
    existing demo citizen rows that don't yet have the grant.
    Returns the number of rows updated."""
    from app.models.pages import CitizenAccount

    owns_session = db is None
    db = db or SessionLocal()
    try:
        # Pre-filter in SQL so we don't pull every demo row into Python
        # memory. The trailing-LIKE on the synthetic domain is the
        # narrowest filter we can write without parsing emails.
        rows = (
            db.query(CitizenAccount)
            .filter(
                CitizenAccount.email.like("%@demo-citizens.civicview.app"),
                CitizenAccount.stripe_subscription_id.is_(None),
            )
            .filter(
                # OR — touch any row that doesn't already have the
                # demo-grant state, so a partial backfill resumes
                # cleanly if a previous boot got interrupted mid-pass.
                (CitizenAccount.is_subscribed.is_(False))
                | (CitizenAccount.subscription_status != "demo"),
            )
            .all()
        )
        if not rows:
            logger.info(
                "Demo subscription backfill: no existing rows need updating.",
            )
            return 0
        for row in rows:
            row.is_subscribed = True
            row.subscription_status = "demo"
        db.commit()
        logger.info(
            "Demo subscription backfill: flipped is_subscribed=True + "
            "subscription_status='demo' on %d existing demo citizen row(s).",
            len(rows),
        )
        return len(rows)
    except Exception:
        db.rollback()
        logger.exception(
            "Demo subscription backfill failed — rolled back. Non-fatal; "
            "next boot will retry.",
        )
        return 0
    finally:
        if owns_session:
            db.close()


# ── Candidate seed ────────────────────────────────────────────────────
def _load_candidate_seed_payload() -> Optional[Dict[str, Any]]:
    """Parallel to _load_seed_payload but for the candidate-accounts seed.
    Env override: DEMO_CANDIDATE_ACCOUNTS_JSON. Default path is
    backend/demo_candidate_accounts.json."""
    env_blob = os.getenv("DEMO_CANDIDATE_ACCOUNTS_JSON")
    if env_blob:
        try:
            return json.loads(env_blob)
        except json.JSONDecodeError as exc:
            logger.error("DEMO_CANDIDATE_ACCOUNTS_JSON is set but not valid JSON: %s", exc)
            return None

    if DEFAULT_CANDIDATE_SEED_PATH.exists():
        try:
            with DEFAULT_CANDIDATE_SEED_PATH.open("r", encoding="utf-8") as fh:
                return json.load(fh)
        except json.JSONDecodeError as exc:
            logger.error("demo_candidate_accounts.json is not valid JSON: %s", exc)
            return None

    return None


def _validate_candidate(entry: Dict[str, Any]) -> bool:
    required = ("candidate_id", "email", "password", "display_name")
    for k in required:
        if not entry.get(k):
            logger.warning("Skipping demo candidate — missing field '%s' in: %r", k, entry)
            return False
    return True


def seed_demo_candidates(db: Optional[Session] = None) -> int:
    """
    Insert any seeded candidate accounts that aren't already present.
    Mirrors seed_demo_accounts() (rep) and seed_demo_citizens() —
    idempotent on (candidate_id, email), so re-runs are no-ops.

    Used primarily for local testing of the candidate-side login + 2FA
    flow. Production candidate accounts are provisioned via the admin
    queue after manual verification (see admin.py), NOT this seed file.

    Notable defaults:
      • claim_status defaults to 'pending' to match the production
        provisioning path; the demo entry sets it to 'active' so the
        login endpoint accepts the credentials without an admin flip.
      • owner_state is upper-cased + truncated to 2 chars to match the
        column constraint, mirroring the rep + citizen seeders.

    Returns the number of newly-created accounts.
    """
    payload = _load_candidate_seed_payload()
    if not payload:
        logger.info("No candidate-accounts seed source found — skipping candidate seed step.")
        return 0

    candidates: List[Dict[str, Any]] = payload.get("candidates") or []
    if not candidates:
        logger.info("Candidate-accounts seed source had no candidates — skipping.")
        return 0

    owns_session = db is None
    db = db or SessionLocal()
    created = 0
    repointed = 0
    try:
        for entry in candidates:
            if not _validate_candidate(entry):
                continue

            email = entry["email"].strip().lower()
            candidate_id = entry["candidate_id"].strip()

            existing = (
                db.query(CandidateAccount)
                .filter(
                    (CandidateAccount.email == email)
                    | (CandidateAccount.candidate_id == candidate_id)
                )
                .first()
            )
            if existing:
                # Idempotent — leave hand-edited rows alone (especially
                # password hashes the operator may have rotated). One
                # exception: if the email matches but the seed wants a
                # different candidate_id than what's on the row, repoint
                # the row to the new id. This catches the case where an
                # earlier seed used a temp candidate_id (Claire Voyant
                # / fl-cand-test-claire-voyant) and a later seed
                # canonicalized it (CivicView Test Candidate /
                # test-civicview-internal-candidate) — without this
                # top-up the email lookup would 'find' the old row and
                # the new candidate_id would never reach the DB, leaving
                # the candidate page unable to claim ownership.
                if (
                    existing.email == email
                    and existing.candidate_id != candidate_id
                ):
                    logger.info(
                        "Re-pointing candidate_id %s → %s for existing seed email %s",
                        existing.candidate_id, candidate_id, email,
                    )
                    existing.candidate_id = candidate_id
                    repointed += 1
                continue

            owner_state = (entry.get("owner_state") or "").strip().upper()[:2] or None
            owner_district = entry.get("owner_district") or None
            owner_city = entry.get("owner_city") or None
            claim_status = (entry.get("claim_status") or "pending").strip().lower()
            if claim_status not in {"pending", "active"}:
                logger.warning(
                    "Candidate seed for %s has unknown claim_status=%r — coercing to 'pending'.",
                    candidate_id, claim_status,
                )
                claim_status = "pending"

            acct = CandidateAccount(
                candidate_id=candidate_id,
                email=email,
                password_hash=hash_password(entry["password"]),
                display_name=entry["display_name"].strip(),
                owner_state=owner_state,
                owner_district=owner_district,
                owner_city=owner_city,
                claim_status=claim_status,
                is_active=True,
            )
            db.add(acct)
            created += 1
            logger.info(
                "Seeded candidate account %s (email=%s, claim_status=%s).",
                candidate_id, email, claim_status,
            )

        if created or repointed:
            db.commit()
            logger.info(
                "Candidate seed: %d new candidate account(s) inserted, %d re-pointed.",
                created, repointed,
            )
        else:
            logger.info("Demo candidate accounts already present — nothing to seed.")
    except Exception:
        db.rollback()
        logger.exception("Candidate-account seeding failed — rolled back.")
        raise
    finally:
        if owns_session:
            db.close()

    return created


# ── Pre-launch fresh-start cleanup ───────────────────────────────────
# Email domain of the retired Phase 1.5 seeded citizen accounts. The
# wipe targets this domain exclusively so self-serve demo accounts
# (which use @demo-citizens.civicview.app) are preserved across runs.
_SEEDED_CITIZEN_EMAIL_DOMAIN = "@example.invalid"


def wipe_rep_demo_data(db: Optional[Session] = None) -> Dict[str, int]:
    """One-shot wipe of all rep-side demo content + standalone citizen
    polls + retired seeded citizen accounts. Triggered by the
    CIVICVIEW_WIPE_REP_DEMO env var on backend startup so it runs
    exactly once per intentional opt-in (don't leave the flag set in
    normal operation).

    What it deletes:
      • Every RepAccount row. This cascades through the existing
        ON DELETE CASCADE FKs to also remove every Post, RepEvent,
        PostImage, PostReaction, PostComment, and rep-authored Poll
        (which in turn cascades to its options + votes + comments +
        reports). After this runs, no rep page in the app is claimed.
      • Every standalone citizen Poll (author_kind='citizen'). These
        also cascade to options + votes + comments + reports.
      • Every CitizenAccount whose email ends in
        @example.invalid — the retired Phase 1.5 fixed seed
        list (Elena Park, Maria Hernandez, et al.). Self-serve demo
        accounts (which use @demo-citizens.civicview.app) and any
        future verified accounts are NOT touched.

    Why this exists:
      The original Phase 1 seeded a small set of rep accounts under
      real politicians' names + photos so reviewers could exercise
      the rep-side posting UI. That created an impersonation risk
      (screenshots of admin-authored posts circulating under real
      reps' identities) we decided was too high. Phase 1.5 separately
      seeded a 60-account citizen list to exercise the engagement
      loop; that was retired in favor of self-serve demo signup so
      every reviewer has their own identity instead of sharing a
      pool of 60. The fresh-start wipes both demo sets, the seed
      files are now empty, and the app's engagement is driven
      entirely by citizen-led polls on unclaimed pages until
      verified rep accounts ship.

    Returns: { rep_accounts: N, citizen_polls: M, citizen_accounts: K }
    — counts of rows deleted, useful for the startup log line.
    """
    owns_session = db is None
    db = db or SessionLocal()
    deleted = {"rep_accounts": 0, "citizen_polls": 0, "citizen_accounts": 0}
    try:
        # Delete citizen polls first so their FK references (which
        # don't cascade from rep accounts) are tidied up regardless
        # of order. Each delete cascades its own children.
        citizen_polls = db.query(Poll).filter(Poll.author_kind == "citizen").all()
        for p in citizen_polls:
            db.delete(p)
        deleted["citizen_polls"] = len(citizen_polls)

        rep_accounts = db.query(RepAccount).all()
        for r in rep_accounts:
            db.delete(r)
        deleted["rep_accounts"] = len(rep_accounts)

        # Seeded citizen accounts only — matched by the retired email
        # domain. Self-serve demo accounts use @demo-citizens.civicview.app
        # and survive the wipe, so any visitor mid-session keeps their
        # account intact. SQLAlchemy's LIKE escape rules: '%' wildcards,
        # case-insensitive via lower() on the column to handle any
        # accidentally uppercased rows.
        seeded_citizens = (
            db.query(CitizenAccount)
            .filter(CitizenAccount.email.ilike(f"%{_SEEDED_CITIZEN_EMAIL_DOMAIN}"))
            .all()
        )
        for c in seeded_citizens:
            db.delete(c)
        deleted["citizen_accounts"] = len(seeded_citizens)

        db.commit()
        logger.warning(
            "Fresh-start wipe complete: removed %d rep account(s), %d citizen poll(s), "
            "and %d seeded citizen account(s). Unset CIVICVIEW_WIPE_REP_DEMO before "
            "the next boot so this doesn't run again.",
            deleted["rep_accounts"], deleted["citizen_polls"], deleted["citizen_accounts"],
        )
    except Exception:
        db.rollback()
        logger.exception("Fresh-start wipe failed — rolled back.")
        raise
    finally:
        if owns_session:
            db.close()
    return deleted


def seed_bill_summaries(db: Optional[Session] = None) -> int:
    """Idempotent loader for the pre-fetched CRS bill-summary cache.

    Reads backend/app/data/bill_summaries_seed.json (built by
    scripts/seed_bill_summaries.py) and inserts any (congress,
    bill_type, number) triples not already present in the DB.

    The point: production starts with hundreds of CRS summaries
    already cached, so users see instant bill-summary expansions
    on day one without any Congress.gov round-trips. Subsequent
    CRS refreshes happen on the regular freshness-check path in
    bill_summary_service.

    Returns the count of newly-inserted rows. Re-running with no
    new entries returns 0; re-running on a fresh DB inserts all of
    them. Never overwrites existing rows — if an admin manually
    refreshed a summary or a user has already triggered a Haiku
    translation on a bill, we leave that row alone.
    """
    if not DEFAULT_BILL_SUMMARIES_PATH.exists():
        logger.info(
            "No bill-summaries seed at %s — skipping (run scripts/seed_bill_summaries.py to build one).",
            DEFAULT_BILL_SUMMARIES_PATH,
        )
        return 0
    try:
        with DEFAULT_BILL_SUMMARIES_PATH.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("bill_summaries_seed.json could not be read: %s", exc)
        return 0
    items = payload.get("items") or []
    if not items:
        logger.info("Bill-summaries seed file had no items — skipping.")
        return 0

    owns_session = db is None
    db = db or SessionLocal()
    inserted = 0
    try:
        # Pull existing triples in one query so we don't N+1 on inserts.
        existing = {
            (r.congress, r.bill_type, r.number)
            for r in db.query(
                BillSummary.congress, BillSummary.bill_type, BillSummary.number,
            ).all()
        }
        now = datetime.utcnow()
        for entry in items:
            try:
                congress = int(entry["congress"])
                bill_type = str(entry["bill_type"]).upper()
                number = str(entry["number"])
            except (KeyError, ValueError, TypeError):
                continue
            key = (congress, bill_type, number)
            if key in existing:
                continue
            row = BillSummary(
                congress=congress,
                bill_type=bill_type,
                number=number,
                title=entry.get("title"),
                latest_action=entry.get("latest_action"),
                crs_summary=entry.get("crs_summary"),
                # Stamp crs_fetched_at so the freshness check doesn't
                # immediately re-fetch every seeded row on first user
                # request. A user-triggered refresh after the
                # _CRS_REFRESH_AFTER window will still update the row.
                crs_fetched_at=now if entry.get("crs_summary") else None,
            )
            db.add(row)
            inserted += 1
        if inserted:
            db.commit()
            logger.info(
                "Seeded %d new bill summaries (%d in seed file, %d already in DB).",
                inserted, len(items), len(existing),
            )
        else:
            logger.info(
                "Bill-summaries seed already current — %d rows on disk match %d DB rows.",
                len(items), len(existing),
            )
    except Exception:
        if owns_session:
            db.rollback()
        logger.exception("seed_bill_summaries failed; rolling back.")
        return 0
    finally:
        if owns_session:
            db.close()
    return inserted


def maybe_run_fresh_start_wipe() -> None:
    """Lifespan-startup hook: runs wipe_rep_demo_data() iff the
    CIVICVIEW_WIPE_REP_DEMO env var is truthy. Designed to be called
    from main.py's startup sequence. Idempotent in the sense that
    re-running on an already-empty DB is a cheap no-op (the queries
    return 0 rows).
    """
    flag = (os.getenv("CIVICVIEW_WIPE_REP_DEMO") or "").strip().lower()
    if flag not in {"1", "true", "yes"}:
        return
    logger.warning(
        "CIVICVIEW_WIPE_REP_DEMO is set — wiping rep accounts + citizen polls.",
    )
    try:
        wipe_rep_demo_data()
    except Exception:
        # The lifespan already wraps init in try/except, but be
        # defensive — a failure here shouldn't take the whole API
        # down on the user's deploy.
        logger.exception("Fresh-start wipe raised; continuing startup.")
