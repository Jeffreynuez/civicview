# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Votes router — per-vote explainer surface.

Two endpoints, paired with the BillSummary pattern:

  POST /api/votes/explain
       Returns the template-based explainer body (free, zero LLM cost)
       PLUS any cached Haiku-generated detailed explanation for the
       same vote_id. Frontend renders the template by default and
       offers a toggle when both exist.

  POST /api/votes/explain/generate
       Triggers Haiku generation of the detailed explainer for this
       vote. Cached forever per vote_id — the first user pays the LLM
       round-trip, everyone after gets it instantly.

Why both endpoints use POST: the request body carries the full vote
payload (with nested bill context). The /generate endpoint also reads
from the DB cache + writes back, so it inherently mutates state.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import vote_explainer_service

logger = logging.getLogger(__name__)
router = APIRouter()


class VoteBillContext(BaseModel):
    """Subset of the GovTrack `bill` payload the explainer needs."""
    display_number: Optional[str] = None
    title: Optional[str] = None
    congress: Optional[int] = None


class VoteExplainRequest(BaseModel):
    """Mirrors the shape of /api/congress/members/{bioguide}/votes rows.
    The frontend should be able to spread the row payload directly.
    Every field is optional — the explainer degrades gracefully when
    the caller has partial data."""
    vote_id: Optional[str] = None
    question: Optional[str] = None
    chamber: Optional[str] = None
    result: Optional[str] = None
    category: Optional[str] = None
    date: Optional[str] = None
    position: Optional[str] = None
    url: Optional[str] = None
    bill: Optional[VoteBillContext] = None


class VoteExplainResponse(BaseModel):
    vote_id: Optional[str] = None
    category: str

    # Template body — always populated.
    what_was_voted: str
    what_yea_means: str
    what_nay_means: str
    outcome_meaning: str
    source: str

    # AI body — populated when a cached Haiku explainer exists for
    # this vote_id, otherwise None. Frontend uses `has_ai` to gate
    # the "Show AI explanation" toggle.
    ai_what_was_voted: Optional[str] = None
    ai_what_yea_means: Optional[str] = None
    ai_what_nay_means: Optional[str] = None
    ai_outcome_meaning: Optional[str] = None
    ai_model: Optional[str] = None
    ai_generated_at: Optional[str] = None
    has_ai: bool = False


def _attach_cached_ai(payload: VoteExplainRequest, body: dict, db: Session) -> dict:
    """If a cached AI explainer exists for this vote_id, splice the
    four ai_* fields into the response body."""
    if not payload.vote_id:
        body["has_ai"] = False
        return body
    cached = vote_explainer_service.get_cached_ai(db, payload.vote_id)
    if cached is None or not cached.ai_what_was_voted:
        body["has_ai"] = False
        return body
    body["ai_what_was_voted"] = cached.ai_what_was_voted
    body["ai_what_yea_means"] = cached.ai_what_yea_means
    body["ai_what_nay_means"] = cached.ai_what_nay_means
    body["ai_outcome_meaning"] = cached.ai_outcome_meaning
    body["ai_model"] = cached.ai_model
    body["ai_generated_at"] = (
        cached.ai_generated_at.isoformat() if cached.ai_generated_at else None
    )
    body["has_ai"] = True
    return body


@router.post("/explain", response_model=VoteExplainResponse)
def explain_vote(
    payload: VoteExplainRequest, db: Session = Depends(get_db),
) -> VoteExplainResponse:
    """Generate a "what was this vote?" explainer for a roll-call vote.

    Template-based body is always present. If a cached Haiku-generated
    explainer exists for this vote_id, the response also carries the
    ai_* fields so the frontend can offer a toggle.
    """
    body = vote_explainer_service.explain_vote(payload.model_dump())
    body = _attach_cached_ai(payload, body, db)
    return VoteExplainResponse(**body)


@router.post("/explain/generate", response_model=VoteExplainResponse)
async def generate_explain(
    payload: VoteExplainRequest, db: Session = Depends(get_db),
) -> VoteExplainResponse:
    """Run Haiku to generate (or return the cached) detailed explanation
    for this vote. Cached forever per vote_id.

    Returns the full response including both template and AI bodies so
    the frontend can overwrite its row state with one payload.
    """
    if not payload.vote_id:
        raise HTTPException(status_code=400, detail="vote_id required for AI generation")

    body, err = await vote_explainer_service.generate_ai_explainer(
        db, payload.model_dump(),
    )
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
    if err == "missing_vote_id":
        raise HTTPException(status_code=400, detail="vote_id required for AI generation")
    if err:
        logger.warning("AI vote explainer failed for vote_id=%s: %s", payload.vote_id, err)
        raise HTTPException(status_code=502, detail="AI explanation failed. Please try again.")

    template_body = vote_explainer_service.explain_vote(payload.model_dump())
    response = {
        **template_body,
        "ai_what_was_voted": body["what_was_voted"],
        "ai_what_yea_means": body["what_yea_means"],
        "ai_what_nay_means": body["what_nay_means"],
        "ai_outcome_meaning": body["outcome_meaning"],
        "has_ai": True,
    }
    # Fill in the cached row's metadata so the frontend can display
    # the "AI-generated" timestamp + model.
    cached = vote_explainer_service.get_cached_ai(db, payload.vote_id)
    if cached:
        response["ai_model"] = cached.ai_model
        response["ai_generated_at"] = (
            cached.ai_generated_at.isoformat() if cached.ai_generated_at else None
        )
    return VoteExplainResponse(**response)
