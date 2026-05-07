# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Google Civic Information API routes. Fail-open design: if
GOOGLE_CIVIC_API_KEY is unset, endpoints return an `enabled: False`
envelope so the frontend can hide UI rather than show a broken state.
"""
from fastapi import APIRouter, Query
from typing import Optional

from app.services import google_civic_service as svc

router = APIRouter()


@router.get("/status")
async def status():
    """Lightweight probe — lets the frontend decide whether to render
    Google-Civic-dependent UI without making a full voter-info call."""
    return {"enabled": svc.is_enabled()}


@router.get("/voter-info")
async def voter_info(
    address: str = Query(..., description="Street address, e.g. '1600 Pennsylvania Ave NW, Washington, DC'"),
    election_id: Optional[int] = Query(None, alias="election_id",
        description="Google Civic election id. If omitted, the next upcoming election is used."),
    official_only: bool = Query(False, alias="official_only",
        description="Restrict to state-certified elections only."),
):
    """Polling places, early-vote sites, drop-boxes, and contests (with
    candidates) for an address + election.

    Returns `{ enabled: False }` if no API key is configured so the
    frontend can surface a one-click 'connect Google Civic' affordance
    instead of a spinner-forever."""
    if not svc.is_enabled():
        return {"enabled": False}
    data = await svc.fetch_voter_info(
        address=address, election_id=election_id, official_only=official_only,
    )
    return {"enabled": True, "data": data}


@router.get("/elections")
async def elections():
    """List of elections Google is currently tracking."""
    if not svc.is_enabled():
        return {"enabled": False, "data": []}
    return {"enabled": True, "data": await svc.fetch_elections()}


@router.get("/divisions")
async def divisions(
    address: str = Query(..., description="Street address to resolve to OCD-IDs"),
):
    """OCD-IDs for an address. Useful for cross-referencing other datasets."""
    if not svc.is_enabled():
        return {"enabled": False}
    return {"enabled": True, "data": await svc.fetch_divisions(address)}
