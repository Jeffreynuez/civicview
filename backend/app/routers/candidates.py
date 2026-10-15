# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import page_lifecycle
from app.services.elections_service import ElectionsService

router = APIRouter()
service = ElectionsService()


@router.get("/{candidate_id}")
async def get_candidate(candidate_id: str, db: Session = Depends(get_db)):
    payload = service.get_candidate(candidate_id)
    if not payload:
        raise HTTPException(
            status_code=404,
            detail=f"No candidate with id '{candidate_id}'.",
        )
    # Former candidates and winners (2026-10-15): title, dates, links.
    block = page_lifecycle.lifecycle_block(db, candidate_id)
    if block:
        payload = {**payload, "lifecycle": block}
    return payload


@router.get("")
async def list_candidates(db: Session = Depends(get_db)):
    """Every candidate, for search. A campaign that ended stays findable
    with its "Former candidate" title until the page is archived; then
    it leaves search (2026-10-15)."""
    out = []
    for c in service.list_candidates():
        block = page_lifecycle.lifecycle_block(db, c.get("id"))
        if block is None:
            out.append(c)
        elif not block.get("archived"):
            out.append({**c, "lifecycle": {k: block.get(k) for k in ("stage", "former", "title", "archive_on")}})
    return {"count": len(out), "candidates": out}
