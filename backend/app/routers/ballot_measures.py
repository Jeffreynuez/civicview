# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Ballot measure plain-English explanations (2026-10-24).

  GET  /api/ballot-measures/{measure_id}/plain-english
       The saved explanation, or plain_english: null when there isn't one
       for the measure's current official text. Never calls the model.
  POST /api/ballot-measures/{measure_id}/plain-english/generate
       Writes it with Claude Sonnet from the official text when there isn't
       one, then returns it. In the AI rate limit; spends the daily AI budget.

The measure is looked up in the curated elections data by its id; a caller
can't supply the text that gets explained.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.routers.elections import service as elections_service
from app.services import ballot_measure_service

logger = logging.getLogger(__name__)
router = APIRouter()


class MeasureExplanationResponse(BaseModel):
    measure_id: str
    plain_english: Optional[str] = None
    model: Optional[str] = None
    generated_at: Optional[str] = None


def _measure_or_404(measure_id: str) -> dict:
    measure = elections_service.get_measure(measure_id)
    if measure is None:
        raise HTTPException(status_code=404, detail="No ballot measure with that id.")
    return measure


def _response(measure_id: str, row) -> MeasureExplanationResponse:
    if row is None:
        return MeasureExplanationResponse(measure_id=measure_id)
    return MeasureExplanationResponse(
        measure_id=measure_id,
        plain_english=row.plain_english,
        model=row.plain_english_model,
        generated_at=row.generated_at.isoformat() if row.generated_at else None,
    )


@router.get("/{measure_id}/plain-english", response_model=MeasureExplanationResponse)
def get_plain_english(measure_id: str, db: Session = Depends(get_db)) -> MeasureExplanationResponse:
    measure = _measure_or_404(measure_id)
    return _response(measure_id, ballot_measure_service.cached(db, measure))


@router.post("/{measure_id}/plain-english/generate", response_model=MeasureExplanationResponse)
async def generate_plain_english(measure_id: str, db: Session = Depends(get_db)) -> MeasureExplanationResponse:
    measure = _measure_or_404(measure_id)
    row, err = await ballot_measure_service.generate(db, measure)
    if err == "not_configured":
        raise HTTPException(status_code=503, detail="AI is not configured on this deployment.")
    if err == "budget_exceeded":
        raise HTTPException(status_code=503, detail="Daily AI budget reached. Try again tomorrow.")
    if err == "no_source_text":
        raise HTTPException(status_code=400, detail="This measure has no official text to explain yet.")
    if err or row is None:
        logger.warning("Ballot measure explanation failed for %s: %s", measure_id, err)
        raise HTTPException(status_code=502, detail="The explanation couldn't be written. Please try again.")
    return _response(measure_id, row)
