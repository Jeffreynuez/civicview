# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Bills router — per-bill summary surface.

Two endpoints:

  GET  /api/bills/{congress}/{bill_type}/{number}/summary
       Returns the cached BillSummary row for this bill, fetching the
       CRS summary on first call (and refreshing periodically). Free —
       never invokes the LLM. Public; no auth required.

  POST /api/bills/{congress}/{bill_type}/{number}/summary/translate
       Generates and caches a Haiku plain-English translation of the
       CRS summary. On-demand (user-initiated). Public; no auth.

The /summary GET is the page-load surface; the frontend pings it once
the user expands the "Summary" pill on a bill row. The /translate POST
is the user-initiated upgrade — pressed by the user when the CRS
summary is still too dense.

Class:
    BillSummaryResponse — wire shape consumed by ProfileView's Bills tab
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import bill_summary_service

logger = logging.getLogger(__name__)
router = APIRouter()


class BillSummaryResponse(BaseModel):
    congress: int
    bill_type: str
    number: str
    title: Optional[str] = None
    latest_action: Optional[str] = None

    crs_summary: Optional[str] = None
    crs_fetched_at: Optional[str] = None

    plain_english: Optional[str] = None
    plain_english_model: Optional[str] = None
    plain_english_generated_at: Optional[str] = None

    # Convenience flags so the frontend doesn't need to check for
    # null-or-empty repeatedly.
    has_crs: bool = False
    has_plain_english: bool = False


def _row_to_response(row) -> BillSummaryResponse:
    return BillSummaryResponse(
        congress=row.congress,
        bill_type=row.bill_type,
        number=row.number,
        title=row.title,
        latest_action=row.latest_action,
        crs_summary=row.crs_summary,
        crs_fetched_at=(row.crs_fetched_at.isoformat() if row.crs_fetched_at else None),
        plain_english=row.plain_english,
        plain_english_model=row.plain_english_model,
        plain_english_generated_at=(
            row.plain_english_generated_at.isoformat()
            if row.plain_english_generated_at else None
        ),
        has_crs=bool(row.crs_summary and row.crs_summary.strip()),
        has_plain_english=bool(row.plain_english and row.plain_english.strip()),
    )


@router.get(
    "/{congress}/{bill_type}/{number}/summary",
    response_model=BillSummaryResponse,
)
async def get_summary(
    congress: int,
    bill_type: str,
    number: str,
    title: Optional[str] = None,
    latest_action: Optional[str] = None,
    db: Session = Depends(get_db),
) -> BillSummaryResponse:
    """Get the cached summary for a bill, fetching the CRS body from
    Congress.gov on first call.

    Optional `title` / `latest_action` query params let the calling
    page (the rep's Bills tab) hand over fields it already has,
    saving a round-trip back to Congress.gov for those static values.
    """
    if not congress or not bill_type or not number:
        raise HTTPException(status_code=400, detail="congress / bill_type / number required")
    row = await bill_summary_service.get_or_fetch_summary(
        db, congress, bill_type, number,
        bill_title=title, latest_action=latest_action,
    )
    return _row_to_response(row)


@router.post(
    "/{congress}/{bill_type}/{number}/summary/translate",
    response_model=BillSummaryResponse,
)
async def translate_summary(
    congress: int,
    bill_type: str,
    number: str,
    db: Session = Depends(get_db),
) -> BillSummaryResponse:
    """Generate (or return the cached) Haiku plain-English translation
    of the CRS summary for this bill.

    Cost note: at Haiku rates a typical CRS summary (~300 words input,
    ~250 words output) costs ~$0.0015 per call. Cached forever after
    first translation, so repeat views are free.

    Returns the same shape as GET /summary so the frontend can
    overwrite its cached state with the new row in one go.
    """
    row = bill_summary_service.get_cached_row(db, congress, bill_type, number)
    if row is None:
        # Pull CRS first so we have something to translate.
        row = await bill_summary_service.get_or_fetch_summary(
            db, congress, bill_type, number,
        )

    text, err = await bill_summary_service.generate_plain_english(db, row)
    if err == "not_configured":
        raise HTTPException(
            status_code=503,
            detail="AI is not configured on this deployment.",
        )
    if err == "budget_exceeded":
        raise HTTPException(
            status_code=503,
            detail="Daily AI budget reached. Try again tomorrow.",
        )
    if err == "no_source_text":
        raise HTTPException(
            status_code=400,
            detail=(
                "This bill has no CRS summary or title to translate yet. "
                "Try again once Congress.gov has indexed it."
            ),
        )
    if err:
        logger.warning("Translate failed for %s %s %s: %s", congress, bill_type, number, err)
        raise HTTPException(status_code=502, detail="Translation failed. Please try again.")

    return _row_to_response(row)
