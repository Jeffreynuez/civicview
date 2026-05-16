# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Executive-order summary router — surfaces the Federal Register
abstract (frontend already has it) plus an on-demand Haiku
translation cached per document_number.

  POST /api/eos/{document_number}/summary
       Returns the cached AI summary row when present. Used by the
       frontend to know whether to render the Generate button or
       the toggle. Body carries title + abstract so a freshly
       generated translation has full context to draw on.

  POST /api/eos/{document_number}/summary/translate
       Triggers Haiku generation. Cached forever per
       document_number once it succeeds.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import eo_summary_service

logger = logging.getLogger(__name__)
router = APIRouter()


class EoSummaryRequest(BaseModel):
    """All optional except document_number, which the URL path supplies
    and the body echoes for the symmetric translate path. Title +
    abstract are forwarded by the frontend from the EO row data it
    already has on hand, saving the backend a Federal Register
    round-trip on first translation."""
    title: Optional[str] = None
    eo_number: Optional[str] = None
    abstract: Optional[str] = None


class EoSummaryResponse(BaseModel):
    document_number: str
    title: Optional[str] = None
    eo_number: Optional[str] = None
    plain_english: Optional[str] = None
    plain_english_model: Optional[str] = None
    plain_english_generated_at: Optional[str] = None
    has_plain_english: bool = False


def _row_to_response(row, document_number: str) -> EoSummaryResponse:
    """Compose the response from a (possibly None) cache row."""
    if row is None:
        return EoSummaryResponse(
            document_number=document_number, has_plain_english=False,
        )
    return EoSummaryResponse(
        document_number=document_number,
        title=row.title,
        eo_number=row.eo_number,
        plain_english=row.plain_english,
        plain_english_model=row.plain_english_model,
        plain_english_generated_at=(
            row.plain_english_generated_at.isoformat()
            if row.plain_english_generated_at else None
        ),
        has_plain_english=bool(row.plain_english and row.plain_english.strip()),
    )


@router.post("/{document_number}/summary", response_model=EoSummaryResponse)
def get_eo_summary(
    document_number: str,
    payload: EoSummaryRequest,
    db: Session = Depends(get_db),
) -> EoSummaryResponse:
    """Look up the cached AI summary row for this EO. Always returns
    a body — has_plain_english is False when no translation exists
    yet and the frontend should render the Generate button instead
    of the toggle."""
    if not document_number:
        raise HTTPException(status_code=400, detail="document_number required")
    row = eo_summary_service.get_cached_row(db, document_number)
    return _row_to_response(row, document_number)


@router.post("/{document_number}/summary/translate", response_model=EoSummaryResponse)
async def translate_eo_summary(
    document_number: str,
    payload: EoSummaryRequest,
    db: Session = Depends(get_db),
) -> EoSummaryResponse:
    """Generate (or return the cached) Haiku plain-English translation
    of the EO's abstract.

    Cost note: at Haiku rates a typical EO abstract (~200 words input,
    ~300 words output) costs ~$0.0015 per call. Cached forever after
    first translation per document_number, so the second user gets
    it free."""
    if not document_number:
        raise HTTPException(status_code=400, detail="document_number required")

    text, err = await eo_summary_service.generate_plain_english(
        db,
        document_number=document_number,
        title=payload.title,
        eo_number=payload.eo_number,
        abstract=payload.abstract,
    )
    if err == "not_configured":
        raise HTTPException(
            status_code=503, detail="AI is not configured on this deployment."
        )
    if err == "budget_exceeded":
        raise HTTPException(
            status_code=503, detail="Daily AI budget reached. Try again tomorrow."
        )
    if err == "no_source_text":
        raise HTTPException(
            status_code=400,
            detail=(
                "This executive order has no abstract or title to translate. "
                "Federal Register typically publishes abstracts within a day "
                "of signing — try again shortly."
            ),
        )
    if err:
        logger.warning("EO translate failed for %s: %s", document_number, err)
        raise HTTPException(
            status_code=502, detail="Translation failed. Please try again."
        )

    row = eo_summary_service.get_cached_row(db, document_number)
    return _row_to_response(row, document_number)
