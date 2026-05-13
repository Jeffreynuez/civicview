# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
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

from app.auth import hash_password
from app.db import SessionLocal
from app.models.pages import CitizenAccount, Poll, RepAccount


logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SEED_PATH = BACKEND_DIR / "demo_accounts.json"
DEFAULT_CITIZEN_SEED_PATH = BACKEND_DIR / "demo_citizen_accounts.json"


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
    Insert any demo citizen accounts that aren't already present.
    Idempotent — matches on email, so running twice is a no-op.

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
    try:
        for entry in citizens:
            if not _validate_citizen(entry):
                continue

            email = entry["email"].strip().lower()

            existing = (
                db.query(CitizenAccount)
                .filter(CitizenAccount.email == email)
                .first()
            )
            if existing:
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
                verified=False,   # demo seeds are never verified
                is_active=True,
            )
            db.add(acct)
            created += 1

        if created:
            db.commit()
            logger.info(
                "Seeded %d demo citizen account(s). Log in with any email from demo_citizen_accounts.json.",
                created,
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
