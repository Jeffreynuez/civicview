# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

from fastapi import APIRouter, HTTPException, Query
from app.services.state_officials_service import StateOfficialsService
from app.services import state_live

router = APIRouter()
service = StateOfficialsService()


@router.get("/{state_code}")
async def get_state_officials(state_code: str):
    """Return the curated state-level officials (governor, cabinet, state
    senate + state house leadership and sample members) for a state.

    Returns 404 if that state hasn't been seeded yet."""
    payload = service.get_state_officials(state_code)
    if not payload:
        raise HTTPException(
            status_code=404,
            detail=f"No state-officials data seeded for {state_code.upper()}.",
        )
    return payload


@router.get("/{state_code}/governor")
async def get_governor(state_code: str):
    gov = service.get_governor(state_code)
    if not gov:
        raise HTTPException(
            status_code=404,
            detail=f"No governor data seeded for {state_code.upper()}.",
        )
    return gov


# ── Person lookup + live-data proxies ────────────────────────────────
@router.get("/{state_code}/person/{person_id}")
async def get_state_person(state_code: str, person_id: str):
    """Return any state-level official (governor / cabinet / legislator /
    justice / judge) by their seed id, decorated with `role_type`."""
    person = service.find_person_by_id(state_code, person_id)
    if not person:
        raise HTTPException(
            status_code=404,
            detail=f"No state official '{person_id}' found under {state_code.upper()}.",
        )
    return person


@router.get("/{state_code}/legislator-bills")
async def get_state_legislator_bills(
    state_code: str,
    name: str = Query(..., description="Legislator full name, e.g. 'Don Gaetz'"),
    chamber: str = Query("", description="'senate' or 'house'"),
    district: str = Query("", description="Stringified district number"),
    limit: int = Query(15, ge=1, le=50),
):
    bills = await state_live.fetch_state_legislator_bills(
        state_code=state_code, name=name,
        chamber=chamber or None, district=district or None, limit=limit,
    )
    return {"state": state_code.upper(), "name": name, "count": len(bills), "bills": bills}


@router.get("/{state_code}/legislator-votes")
async def get_state_legislator_votes(
    state_code: str,
    name: str = Query(..., description="Legislator full name"),
    chamber: str = Query("", description="'senate' or 'house'"),
    district: str = Query("", description="Stringified district number"),
    limit: int = Query(15, ge=1, le=50),
):
    votes = await state_live.fetch_state_legislator_votes(
        state_code=state_code, name=name,
        chamber=chamber or None, district=district or None, limit=limit,
    )
    return {"state": state_code.upper(), "name": name, "count": len(votes), "votes": votes}


@router.get("/{state_code}/governor-actions")
async def get_governor_actions(
    state_code: str,
    type: str = Query("signed", description="'signed' or 'vetoed'"),
    limit: int = Query(15, ge=1, le=50),
):
    """Recent bills signed or vetoed by the state's governor."""
    actions = await state_live.fetch_governor_actions(
        state_code=state_code, action_type=type, limit=limit,
    )
    return {"state": state_code.upper(), "type": type, "count": len(actions), "bills": actions}


@router.get("/{state_code}/court-cases")
async def get_state_court_cases(
    state_code: str,
    justice_name: str = Query("", description="Surname filter, e.g. 'Muniz'"),
    limit: int = Query(15, ge=1, le=50),
):
    """Most recent state-supreme-court opinion clusters (CourtListener)."""
    cases = await state_live.fetch_state_supreme_court_cases(
        state_code=state_code,
        justice_name=justice_name or None,
        limit=limit,
    )
    return {"state": state_code.upper(), "count": len(cases), "cases": cases}
