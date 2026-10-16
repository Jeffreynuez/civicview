# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Backfill for the `authored_verified` snapshot column (demo-sunset PRD
§D2, increment 4).

WHY A BACKFILL AT ALL, GIVEN THE COLUMN DEFAULTS TO FALSE
One of the cases the column encodes is wrong at False:

  1. Rep- and candidate-authored rows. Page owners are vetted at claim
     time — a stronger check than ID.me — so their engagement has always
     been verified engagement. Every such row written before this column
     existed would otherwise read "Unverified" forever, which is the
     opposite of true and would show a rep's own comment on their own
     page with an Unverified pill.
  2. (Removed 2026-09-24, audit B4.) This pass used to also flip old
     citizen rows to verified whenever their author verified LATER. Run
     at every boot, that rewrites history: speech written while the
     author was unverified must stay labeled unverified. Every citizen
     row records its own truth at write time, and no citizen has been
     verified by a real method yet, so nothing was ever relabeled by it.

  3. (2026-10-16) The reverse correction. Citizen rows were stamped from
     the raw `verified` flag, so an account whose flag was set by hand
     (an operator account seeded with "verified": true) wrote True with
     no ID.me check behind it, and its comments showed no Unverified
     label. Stamping now follows is_verified_person, and this pass sets
     False on citizen rows still marked True whose author is flagged
     verified without a real method (verified_method empty or 'demo').
     A real ID.me verification is never touched, so this never takes a
     label away from anyone who earned it.
Anonymous legacy poll votes (no identity column set) stay False, which is
correct — nobody attested to those.

WHY BULK UPDATE AND NOT A ROW LOOP
These tables are the highest-cardinality tables in the schema. Loading
them into Python to set one boolean would be an out-of-memory risk at the
exact moment of a deploy. Each statement below is a single indexed UPDATE
with a `authored_verified = false` guard, so re-running is cheap and the
pass is idempotent — it converges and then does nothing.

Runs at every boot from main.py, alongside the other convergent
maintenance passes (purge_expired_accounts, backfill_demo_citizen_
subscriptions). Failure is non-fatal and logged: a stale badge is not
worth refusing to start the API over.
"""
from __future__ import annotations

import logging
from typing import Dict, Optional

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.pages import (
    BillReaction,
    CitizenAccount,
    CommentReaction,
    PollComment,
    PollCommentReaction,
    PollReaction,
    PollVote,
    PostComment,
    PostReaction,
)

logger = logging.getLogger(__name__)

# Every table carrying the snapshot column. Keep this list in sync with
# the models — a table added here without the column raises loudly on the
# first boot rather than silently skipping, which is the failure mode we
# want (a missed table means permanently mislabeled history).
_TABLES = (
    PostReaction,
    PollReaction,
    CommentReaction,
    PollCommentReaction,
    PostComment,
    PollComment,
    PollVote,
)


# Case 3 covers bill likes too, which never needed case 1 (a rep's or a
# candidate's bill like is stamped True when it is written).
_CITIZEN_TABLES = _TABLES + (BillReaction,)


def _flagged_without_verification():
    """Citizens whose verified flag is set without a real method."""
    method = func.lower(func.coalesce(CitizenAccount.verified_method, ""))
    return select(CitizenAccount.id).where(
        CitizenAccount.verified.is_(True),
        method.in_(("", "demo")),
    )


def backfill_authored_verified(db: Optional[Session] = None) -> Dict[str, int]:
    """Stamp authored_verified=True on rep- and candidate-authored rows,
    and clear it on citizen rows whose author was never verified by a
    real method (case 3). Returns {table_name: rows_updated}; all-zero
    once converged."""
    owns_session = db is None
    db = db or SessionLocal()
    updated: Dict[str, int] = {}
    try:
        for model in _TABLES:
            name = model.__tablename__
            count = 0
            # Case 1 — page owners. True by claim-time vetting.
            count += (
                db.execute(
                    update(model)
                    .where(
                        model.authored_verified.is_(False),
                        (model.author_rep_id.isnot(None))
                        | (model.author_candidate_id.isnot(None)),
                    )
                    .values(authored_verified=True)
                    .execution_options(synchronize_session=False)
                ).rowcount
                or 0
            )
            updated[name] = count
        unearned = _flagged_without_verification()
        for model in _CITIZEN_TABLES:
            name = model.__tablename__
            # Case 3: no Unverified label was shown for these.
            updated[name] = updated.get(name, 0) + (
                db.execute(
                    update(model)
                    .where(
                        model.authored_verified.is_(True),
                        model.citizen_id.in_(unearned),
                        # Never a row case 1 stamps, or each boot would
                        # flip it back and forth.
                        model.author_rep_id.is_(None),
                        model.author_candidate_id.is_(None),
                    )
                    .values(authored_verified=False)
                    .execution_options(synchronize_session=False)
                ).rowcount
                or 0
            )
        db.commit()
        total = sum(updated.values())
        if total:
            logger.info(
                "authored_verified backfill: updated %d row(s) across %d table(s): %s",
                total,
                len([k for k, v in updated.items() if v]),
                {k: v for k, v in updated.items() if v},
            )
        else:
            logger.info("authored_verified backfill: already converged, no rows updated.")
        return updated
    except Exception:
        db.rollback()
        logger.exception(
            "authored_verified backfill failed — rolled back. Non-fatal; the "
            "next boot retries. Badges may under-report verification until then.",
        )
        return {}
    finally:
        if owns_session:
            db.close()
