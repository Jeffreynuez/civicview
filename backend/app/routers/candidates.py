# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

from fastapi import APIRouter, HTTPException
from app.services.elections_service import ElectionsService

router = APIRouter()
service = ElectionsService()


@router.get("/{candidate_id}")
async def get_candidate(candidate_id: str):
    payload = service.get_candidate(candidate_id)
    if not payload:
        raise HTTPException(
            status_code=404,
            detail=f"No candidate with id '{candidate_id}'.",
        )
    return payload


@router.get("")
async def list_candidates():
    return {
        "count": len(service.list_candidates()),
        "candidates": service.list_candidates(),
    }
