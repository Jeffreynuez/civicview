# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from app.services.elections_service import ElectionsService

router = APIRouter()
service = ElectionsService()


@router.get("/{state_code}")
async def get_elections(state_code: str):
    """Return the curated elections payload for a state with candidate
    references resolved into full candidate records."""
    payload = service.get_elections(state_code)
    if not payload:
        raise HTTPException(
            status_code=404,
            detail=f"No elections data seeded for {state_code.upper()}.",
        )
    return payload


@router.get("/{state_code}/ballot")
async def get_personalized_ballot(
    state_code: str,
    county_fips: Optional[str] = Query(None, alias="county_fips"),
    county_name: Optional[str] = Query(None, alias="county_name"),
    congressional_district: Optional[str] = Query(None, alias="congressional_district"),
    state_senate_district: Optional[str] = Query(None, alias="state_senate_district"),
    state_house_district: Optional[str] = Query(None, alias="state_house_district"),
    city_slug: Optional[str] = Query(None, alias="city_slug"),
):
    """Build a ballot tailored to a voter's geography. All query parameters
    are optional — the service includes whatever matches. Statewide races
    and measures are always included if the state is seeded."""
    payload = service.get_personalized_ballot(
        state_code=state_code,
        county_fips=county_fips,
        county_name=county_name,
        congressional_district=congressional_district,
        state_senate_district=state_senate_district,
        state_house_district=state_house_district,
        city_slug=city_slug,
    )
    if not payload:
        raise HTTPException(
            status_code=404,
            detail=f"No elections data seeded for {state_code.upper()}.",
        )
    return payload
