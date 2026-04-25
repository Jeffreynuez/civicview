from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from app.services.congress_service import CongressService

router = APIRouter()
service = CongressService()


@router.get("/members")
async def get_members(
    state: str = Query(..., description="Two-letter state code (e.g., FL, TX, CA)")
):
    """Get all Congress members for a state."""
    state = state.upper()
    if len(state) != 2:
        raise HTTPException(status_code=400, detail="State must be a two-letter code")

    members = await service.get_members_by_state(state)
    return {"state": state, "count": len(members), "members": members}


@router.get("/members/all")
async def get_all_members():
    """Return a lightweight index of all current Congress members (for global search)."""
    members = await service.get_all_members()
    return {"count": len(members), "members": members}


@router.get("/members/{bioguide_id}")
async def get_member_detail(bioguide_id: str):
    """Get detailed information for a specific Congress member."""
    member = await service.get_member_detail(bioguide_id)
    if not member:
        raise HTTPException(status_code=404, detail=f"Member {bioguide_id} not found")
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
    """Get a member's roll-call votes.

    - No year: returns the ``limit`` most recent votes (default 10).
    - Year only: returns every vote cast that calendar year.
    - Year + month: returns votes for that calendar month.

    Results include the underlying related bill when GovTrack reports one.
    """
    votes = await service.get_member_votes(
        bioguide_id,
        limit=limit,
        year=year,
        month=month,
    )
    return {
        "bioguide_id": bioguide_id,
        "year": year,
        "month": month,
        "count": len(votes),
        "votes": votes,
    }


@router.get("/members/{bioguide_id}/stats")
async def get_member_stats(
    bioguide_id: str,
    party: Optional[str] = Query(None, description="R, D, or I (accelerates party-line computation)"),
):
    """Get aggregate stats for a member: party-line voting % + top issue areas."""
    party_norm = None
    if party:
        p = party.strip().upper()
        if p in ("R", "D", "I"):
            party_norm = p
    stats = await service.get_member_stats(bioguide_id, party=party_norm)
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
