# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Public stats router (Task #70).

Powers the "CivicView Stats" tile cluster in the National Officials
panel hero. Returns a small bundle of structural facts (how many
Senators / Representatives / SCOTUS Justices the US Congress + court
contain) alongside CivicView-side activity counts (reps who have
claimed their Page, verified citizens, demo accounts created).

The three structural counts (100 / 435 / 9) are baked in here rather
than counted from the federal_officials data because:

  1. They are constitutional / statutory facts about US government,
     not CivicView state. They don't change when our data layer
     reseeds or when a Senator dies and the seat sits vacant.
  2. The visitor reads them as "the surface area of the country this
     app covers," not "current head-count of body X." Showing 99 or
     434 during a vacancy would be confusing, not informative.

The activity counts come from live `COUNT()` over the relevant
identity tables. Cheap (each table is at most low-thousands of rows
at launch) and cache-able later if traffic warrants. No filters or
parameters — this endpoint always returns the same shape.

Demo accounts:
  - `demo_accounts_created` counts CitizenAccount rows where
    verified=False. Pre-ID.me launch every signup is unverified, so
    this is effectively "total signups." Once ID.me ships we plan to
    drop this tile from the hero and surface it on the expanded
    /stats page instead (Task #71).
  - `verified_citizens` counts the verified=True rows. Today this
    will return 0 until ID.me goes live — that's fine, the tile
    still renders and gives the visitor an honest signal of "we
    don't yet have verified citizens" rather than a fake number.

Reps joined:
  - Counts RepAccount rows where is_active=True. Seeded demo accounts
    are also rows in this table, so the count includes them — this
    matches the user-visible reality (a visitor looking at the panel
    sees those demo Pages and would expect them counted).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import CitizenAccount, RepAccount


logger = logging.getLogger(__name__)
router = APIRouter()


class StatsSummary(BaseModel):
    """Public stats bundle for the hero tile cluster."""

    # Structural / aspirational coverage facts — constants.
    senators: int
    representatives: int
    scotus_justices: int

    # CivicView-side activity counts — live.
    reps_joined: int
    verified_citizens: int
    demo_accounts_created: int


@router.get("/summary", response_model=StatsSummary)
def stats_summary(db: Session = Depends(get_db)) -> StatsSummary:
    """Return the small bundle of stats rendered on the home hero."""
    try:
        reps_joined = (
            db.query(func.count(RepAccount.id))
            .filter(RepAccount.is_active.is_(True))
            .scalar()
            or 0
        )
    except Exception:
        logger.exception("stats_summary: reps_joined count failed; returning 0")
        reps_joined = 0

    try:
        verified_citizens = (
            db.query(func.count(CitizenAccount.id))
            .filter(CitizenAccount.verified.is_(True))
            .scalar()
            or 0
        )
    except Exception:
        logger.exception("stats_summary: verified_citizens count failed; returning 0")
        verified_citizens = 0

    try:
        demo_accounts_created = (
            db.query(func.count(CitizenAccount.id))
            .filter(CitizenAccount.verified.is_(False))
            .scalar()
            or 0
        )
    except Exception:
        logger.exception(
            "stats_summary: demo_accounts_created count failed; returning 0"
        )
        demo_accounts_created = 0

    return StatsSummary(
        senators=100,
        representatives=435,
        scotus_justices=9,
        reps_joined=int(reps_joined),
        verified_citizens=int(verified_citizens),
        demo_accounts_created=int(demo_accounts_created),
    )
