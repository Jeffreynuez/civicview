# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import lifecycle_rosters, page_lifecycle
from app.services.congress_service import CongressService

logger = logging.getLogger(__name__)
router = APIRouter()
service = CongressService()


@router.get("/members")
async def get_members(
    state: str = Query(..., description="Two-letter state code (e.g., FL, TX, CA)"),
    db: Session = Depends(get_db),
):
    """Get all Congress members for a state."""
    state = state.upper()
    if len(state) != 2:
        raise HTTPException(status_code=400, detail="State must be a two-letter code")

    members = await service.get_members_by_state(state)
    # Someone who has left office is nobody's current member, even
    # before the roster catches up (2026-10-15); their seat reads vacant.
    members, gone = lifecycle_rosters.filter_congress_members(members, lifecycle_rosters.departed_ids(db))
    # House districts with nobody seated (0 = an at-large seat), so the
    # map can say a seat is vacant instead of that a member is missing.
    vacant = await service.get_house_vacancies(state, members)
    vacant = lifecycle_rosters.add_house_vacancies(vacant, gone, members)
    return {"state": state, "count": len(members), "members": members,
            "vacant_house_districts": vacant}


@router.get("/members/all")
async def get_all_members(db: Session = Depends(get_db)):
    """Return a lightweight index of all current Congress members (for global search).

    Former members stay findable by search until their page is archived
    (2026-10-15): one who left before the roster caught up keeps their
    entry with former_title set; once archived they are left out. Members
    the roster already dropped come from /api/former/search-index."""
    members = await service.get_all_members()
    archived = page_lifecycle.archived_keys_lower(db)
    departed = lifecycle_rosters.departed_ids(db)
    if archived or departed:
        out = []
        for m in members:
            key = str(m.get("bioguide_id") or "").lower()
            if key in archived:
                continue
            if key in departed:
                block = page_lifecycle.lifecycle_block(db, m.get("bioguide_id")) or {}
                m = {**m, "former_title": block.get("title")}
            out.append(m)
        members = out
    return {"count": len(members), "members": members}


@router.get("/members/{bioguide_id}")
async def get_member_detail(bioguide_id: str, db: Session = Depends(get_db)):
    """Get detailed information for a specific Congress member."""
    member = await service.get_member_detail(bioguide_id)
    if not member:
        raise HTTPException(status_code=404, detail=f"Member {bioguide_id} not found")
    # Former members (2026-10-15): the title, dates and archive state.
    block = page_lifecycle.lifecycle_block(db, bioguide_id)
    if block:
        member = {**member, "lifecycle": block, "former_member": member.get("former_member") or block.get("former")}
    # The detail payload has no `state` (the list endpoint does), so a
    # profile opened from a link knew the district number but not the
    # state, and its Bills tab could not offer state / district likes
    # (2026-10-03). Fill it from the sitting-Congress index; a copy, so
    # the service's cached dict is not changed.
    if isinstance(member, dict) and not member.get("state"):
        from app.services.officials_index import lookup as _geo_lookup
        geo = _geo_lookup(bioguide_id) or {}
        if geo.get("state"):
            member = {**member, "state": geo["state"]}
    return member


@router.get("/members/{bioguide_id}/bills")
async def get_member_bills(
    bioguide_id: str,
    limit: int = Query(10, ge=1, le=50, description="Max items per category (sponsored, cosponsored)"),
):
    """Get a member's most recent sponsored and cosponsored bills."""
    bills = await service.get_member_bills(bioguide_id, limit=limit)
    return {
        "bioguide_id": bioguide_id,
        "sponsored": bills.get("sponsored", []),
        "cosponsored": bills.get("cosponsored", []),
    }


@router.get("/members/{bioguide_id}/contact")
async def get_member_contact(bioguide_id: str):
    """Get contact info for a member: DC + district offices, phones, socials."""
    contact = await service.get_member_contact(bioguide_id)
    if not contact:
        raise HTTPException(status_code=404, detail=f"No contact info for {bioguide_id}")
    return contact


@router.get("/members/{bioguide_id}/votes")
async def get_member_votes(
    bioguide_id: str,
    limit: int = Query(10, ge=1, le=50),
    year: Optional[int] = Query(None, ge=1990, le=2100, description="Full calendar year (e.g. 2024). When set, returns the entire year; limit is ignored."),
    month: Optional[int] = Query(None, ge=1, le=12, description="Calendar month 1-12. Only meaningful when year is also set."),
):
    """Get a member's roll-call votes from the stored official records
    (the Clerk of the House and the U.S. Senate).

    - No year: returns the ``limit`` most recent votes (default 10).
    - Year only: returns every vote cast that calendar year.
    - Year + month: returns votes for that calendar month.

    ``available_years`` lists the years with stored votes for this
    member, newest first (the Votes tab offers only those). Rows include
    the related bill when the vote was on one.
    """
    try:
        votes, years = await asyncio.gather(
            service.get_member_votes(bioguide_id, limit=limit, year=year, month=month),
            service.get_member_vote_years(bioguide_id),
        )
    except Exception:
        logger.exception("stored votes unavailable for %s", bioguide_id)
        raise HTTPException(status_code=503, detail="Votes are temporarily unavailable.")
    return {
        "bioguide_id": bioguide_id,
        "year": year,
        "month": month,
        "count": len(votes),
        "available_years": years,
        "votes": votes,
    }


@router.get("/members/{bioguide_id}/stats")
async def get_member_stats(
    bioguide_id: str,
    party: Optional[str] = Query(None, description="R, D, or I (accepted for compatibility; not needed)"),
):
    """Get aggregate stats for a member: the party-line figure (party-split
    votes in the current Congress, the same method for every member) and
    top issue areas."""
    party_norm = None
    if party:
        p = party.strip().upper()
        if p in ("R", "D", "I"):
            party_norm = p
    try:
        stats = await service.get_member_stats(bioguide_id, party=party_norm)
    except Exception:
        logger.exception("member stats unavailable for %s", bioguide_id)
        raise HTTPException(status_code=503, detail="Voting record temporarily unavailable.")
    return stats


@router.get("/bills/{congress}/{bill_type}/{number}")
async def get_bill_snapshot(congress: int, bill_type: str, number: str):
    """Get a snapshot of a single bill (used by the bill-tracker to detect
    status changes). Bill types: hr, s, hjres, sjres, hconres, sconres, hres, sres.
    """
    snapshot = await service.get_bill_snapshot(congress, bill_type, number)
    if not snapshot:
        raise HTTPException(
            status_code=404,
            detail=f"Bill {bill_type.upper()} {number} ({congress}th Congress) not found",
        )
    return snapshot


@router.get("/committees")
async def get_committees():
    """List all parent committees (House, Senate, Joint) with their subcommittees."""
    committees = await service.get_committees()
    return {"count": len(committees), "committees": committees}


@router.get("/committees/{thomas_id}")
async def get_committee_detail(thomas_id: str):
    """Get a single committee's metadata + member roster.

    `thomas_id` is the community-data identifier — e.g. 'HSAG' for House
    Agriculture, 'HSAG15' for its Forestry subcommittee.
    """
    detail = await service.get_committee_detail(thomas_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Committee {thomas_id} not found")
    return detail
