# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Public read endpoints for optional poll demographic forms.

  GET /api/polls/demographics/catalog   — the full standardized catalog
       (Standard + Sensitive tiers) for the poll-composer picker.
  GET /api/polls/{poll_id}/demographics  — the questions a given poll attached
       (catalog-resolved), so the voter form + results explorer know what to
       render. Returns metadata only — never individual answers.

The aggregate results breakdown (with min-cell suppression) is added here in
the next step (GET /api/polls/{poll_id}/results/breakdown).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import Poll
from app.services import demographics_catalog, poll_demographics

router = APIRouter()


@router.get("/demographics/catalog")
def get_demographics_catalog() -> dict:
    """The standardized question catalog for the creator picker."""
    return {
        "version": demographics_catalog.CATALOG_VERSION,
        "questions": demographics_catalog.serialize_catalog(),
    }


@router.get("/{poll_id}/demographics")
def get_poll_demographics(poll_id: int, db: Session = Depends(get_db)) -> dict:
    """The demographic questions attached to a poll (metadata only)."""
    if db.get(Poll, poll_id) is None:
        raise HTTPException(status_code=404, detail="Poll not found")
    questions = poll_demographics.questions_payload(db, poll_id)
    return {"poll_id": poll_id, "has_form": bool(questions), "questions": questions}
