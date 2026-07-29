# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Backfill for the `authored_verified` snapshot column (demo-sunset PRD
§D2, increment 4).

WHY A BACKFILL AT ALL, GIVEN THE COLUMN DEFAULTS TO FALSE
Two of the three cases the column encodes are wrong at False:

  1. Rep- and candidate-authored rows. Page owners are vetted at claim
     time — a stronger check than ID.me — so their engagement has always
     been verified engagement. Every such row written before this column
     existed would otherwise read "Unverified" forever, which is the
     opposite of true and would show a rep's own comment on their own
     page with an Unverified pill.
  2. Citizen rows whose author is already verified. Zero rows today, but
     the ordering matters: if ID.me ever ships before this pass runs, the
     window between the two produces rows that are permanently mislabeled
     with no way to tell them apart afterwards.

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

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.pages import (
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


def backfill_authored_verified(db: Optional[Session] = None) -> Dict[str, int]:
    """Stamp authored_verified=True on rows whose author was verified at
    write time. Returns {table_name: rows_updated}; all-zero once
    converged."""
    owns_session = db is None
    db = db or SessionLocal()
    updated: Dict[str, int] = {}
    try:
        verified_citizen_ids = (
            db.query(CitizenAccount.id)
            .filter(CitizenAccount.verified.is_(True))
            .scalar_subquery()
        )
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
            # Case 2 — citizens who are verified NOW. This is the one
            # place a "current state" read is correct: before this column
            # existed there was no per-row record to consult, so the
            # author's present flag is the best available evidence of
            # what they were. Every row written from now on records its
            # own truth and never consults this path again.
            count += (
                db.execute(
                    update(model)
                    .where(
                        model.authored_verified.is_(False),
                        model.citizen_id.isnot(None),
                        model.citizen_id.in_(verified_citizen_ids),
                    )
                    .values(authored_verified=True)
                    .execution_options(synchronize_session=False)
                ).rowcount
                or 0
            )
            updated[name] = count
        db.commit()
        total = sum(updated.values())
        if total:
            logger.info(
                "authored_verified backfill: stamped %d row(s) across %d table(s): %s",
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
