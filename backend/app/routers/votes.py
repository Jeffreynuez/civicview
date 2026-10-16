# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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

When the vote_id is a stored official roll call (2026-10-16), the
question, result, category, date, chamber and bill come from the stored
record, not from the request body: a profile row and the /bills page
then describe the same vote identically and share one cached AI
explanation, and a doctored body cannot change what is explained.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import roll_call_store, vote_explainer_service
from app.services.admin_auth import get_current_admin
from app.services.official_votes_service import (
    get_service,
    parse_vote_id,
    current_congress_session,
)

logger = logging.getLogger(__name__)
router = APIRouter()
admin_router = APIRouter()


class VoteBillContext(BaseModel):
    """Subset of a vote row's `bill` the explainer needs."""
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


def _canonical(payload: VoteExplainRequest, db: Session) -> VoteExplainRequest:
    """The request with the stored official record's fields in place of the
    caller's, when the vote_id is a stored roll call. The member's own
    position (not part of the explanation) is kept from the request."""
    if not payload.vote_id:
        return payload
    try:
        stored = roll_call_store.vote_context(db, payload.vote_id)
    except Exception:
        logger.exception("stored vote lookup failed for %s", payload.vote_id)
        stored = None
    if not stored:
        return payload
    bill = stored.get("bill")
    return payload.model_copy(update={
        "question": stored["question"],
        "chamber": stored["chamber"],
        "result": stored["result"],
        "category": stored["category"],
        "date": stored["date"],
        "url": stored["url"],
        "bill": VoteBillContext(
            display_number=bill["display_number"], title=bill.get("title"), congress=bill.get("congress"),
        ) if bill else None,
    })


def _attach_cached_ai(payload: VoteExplainRequest, body: dict, db: Session) -> dict:
    """If a cached AI explainer exists for this vote_id, splice the
    four ai_* fields into the response body."""
    if not payload.vote_id:
        body["has_ai"] = False
        return body
    cached = vote_explainer_service.cached_ai_for(db, payload.model_dump())
    if cached is None:
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
    payload = _canonical(payload, db)
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
    payload = _canonical(payload, db)

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


# ---------------------------------------------------------------------------
# Federal Bills & Votes — chamber-wide recent list + per-vote seat-chart data
# (Phase A; see docs/bills-feature-prd.md + docs/bills-data-spike.md).
#
# Official source of truth: House Clerk + Senate LIS roll-call XML, with
# Congress.gov's house-vote list to enumerate the House (and a Clerk probe
# without it). Read-only + unauthenticated: this is public civic data and
# carries no engagement gate.
# ---------------------------------------------------------------------------

# The congress and session default to the ones sitting at request time
# (services/congress_calendar.py), so the new Congress is picked up at
# noon on January 3 without a restart.


class RecentVoteItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    vote_id: str
    chamber: str
    rollcall: int
    date: Optional[str] = None
    issue: Optional[str] = None
    question: Optional[str] = None
    kind: Optional[str] = None
    result: Optional[str] = None
    title: Optional[str] = None
    tally: Optional[dict] = None


class RecentVotesResponse(BaseModel):
    chamber: str
    congress: int
    session: int
    votes: list[RecentVoteItem]


class VoteMemberItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    bioguide_id: Optional[str] = None
    name: Optional[str] = None
    state: Optional[str] = None
    party: Optional[str] = None
    position: str


class VoteMembersResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    vote_id: str
    chamber: str
    congress: int
    rollcall: int
    question: Optional[str] = None
    result: Optional[str] = None
    date: Optional[str] = None
    totals: dict
    by_party: dict
    members: list[VoteMemberItem]


@router.get("/recent", response_model=RecentVotesResponse)
async def recent_votes(
    chamber: str = Query(..., pattern="^(house|senate)$"),
    limit: int = Query(20, ge=1, le=100),
    congress: Optional[int] = Query(None, ge=1, le=300),
    session: Optional[int] = Query(None, ge=1, le=2),
) -> RecentVotesResponse:
    """Most recent in-scope (passage + nomination) roll-call votes for a
    chamber, newest first. The current session: Senate from the official
    vote_menu, House from Congress.gov's house-vote list (or a Clerk probe).
    A past session inside the stored window: stored votes only, so a
    request can never make CivicView crawl the official sites. Anything
    outside the window: 404."""
    from app.services.roll_call_sync import in_window

    if congress is None or session is None:
        cur_congress, cur_session = current_congress_session()
        congress = cur_congress if congress is None else congress
        session = cur_session if session is None else session
    if not in_window(congress, session):
        raise HTTPException(status_code=404, detail="No votes on record for that session.")
    rows = await get_service().get_recent(chamber, congress, session, limit)
    return RecentVotesResponse(
        chamber=chamber, congress=congress, session=session, votes=rows
    )


@router.get("/{vote_id}/members", response_model=VoteMembersResponse)
async def vote_members(vote_id: str) -> VoteMembersResponse:
    """Every member's position on a single roll-call: the seat-chart
    backbone. Read from the stored roll call when there is one, otherwise
    fetched once and stored, but only inside the stored window and for a
    session not yet found complete; otherwise 404 without any request to
    the official site. House: legislator name-id = bioguide (direct).
    Senate: lis_member_id -> bioguide via the legislators crosswalk."""
    try:
        parse_vote_id(vote_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed vote_id.")
    svc = get_service()
    data = await svc.get_vote_members(vote_id)
    if data is None:
        if not await svc.fetch_allowed(vote_id):
            raise HTTPException(status_code=404, detail="No such roll call on record.")
        raise HTTPException(status_code=502, detail="Couldn't load this vote.")
    return VoteMembersResponse(**data)


# ---------------------------------------------------------------------------
# Admin: what the roll-call sync has stored and done (2026-10-16).
# GET /api/admin/roll-calls
# ---------------------------------------------------------------------------
@admin_router.get("")
def roll_call_status(
    db: Session = Depends(get_db), _admin: dict = Depends(get_current_admin),
) -> dict:
    """Stored counts per chamber and session, each session's sync state
    (official count, stored count, last check, complete), the votes
    added in the last 24 hours, and the most recent pass in this process."""
    from sqlalchemy import select

    from app.models.pages import RollCallSyncState
    from app.services import roll_call_sync

    states = [
        {
            "chamber": "house" if r.chamber == "h" else "senate",
            "congress": r.congress,
            "session": r.session,
            "official_count": r.official_count,
            "stored_count": r.stored_count,
            "checked_at": r.checked_at.isoformat() if r.checked_at else None,
            "complete": r.completed_at is not None,
            "last_error": r.last_error,
        }
        for r in db.execute(select(RollCallSyncState).order_by(
            RollCallSyncState.congress.desc(), RollCallSyncState.session.desc(),
            RollCallSyncState.chamber)).scalars()
    ]
    return {
        "enabled": roll_call_sync.sync_enabled(),
        "congresses_kept": roll_call_sync.backfill_congresses(),
        "last_pass_in_this_process": dict(roll_call_sync.LAST_PASS) or None,
        "sessions": states,
        **roll_call_store.summary(db),
    }
