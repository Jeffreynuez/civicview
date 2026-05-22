# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

from fastapi import APIRouter, HTTPException
from app.services.local_officials_service import LocalOfficialsService

router = APIRouter()
service = LocalOfficialsService()


@router.get("/{state_code}")
async def list_cities(state_code: str):
    """Return a light index of every city with seeded local officials in this state."""
    cities = service.list_cities(state_code)
    return {
        "state": state_code.upper(),
        "count": len(cities),
        "cities": cities,
    }


@router.get("/{state_code}/{city_slug}")
async def get_local_officials(state_code: str, city_slug: str):
    payload = service.get_local_officials(state_code, city_slug)
    if not payload:
        raise HTTPException(
            status_code=404,
            detail=f"No local-officials data seeded for {state_code.upper()}/{city_slug}.",
        )
    return payload
