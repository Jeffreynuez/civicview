"""
Events router — serves the merged feed of curated (events.json) +
rep-created (DB) events. The two sources use compatible shapes so the
frontend doesn't need to care where any given event came from.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import RepEvent
from app.services.events_service import EventsService

router = APIRouter()
events_service = EventsService()


def _rep_event_to_dict(evt: RepEvent) -> dict:
    """Shape a DB-backed RepEvent like a curated events.json entry so
    the frontend can render both with the same component. `_source:
    rep` lets the UI surface the rep-authored badge if desired."""
    return {
        "id": f"rep-event-{evt.id}",
        "title": evt.title,
        "type": "Rep Event",
        "date": evt.start_at,
        "end_date": evt.end_at,
        "location": evt.location or "",
        "virtual": False,
        "rsvp_url": evt.url,
        "description": evt.description or "",
        "_source": "rep",
        "official_id": evt.official_id,
    }


def _filter_upcoming_rep_events(events: list[dict]) -> list[dict]:
    """Mirror EventsService._filter_upcoming so DB events get the same
    past-cutoff treatment as curated ones."""
    now = datetime.now()
    keep: list[dict] = []
    for e in events:
        try:
            dt = datetime.fromisoformat((e.get("date") or "").replace("Z", ""))
        except (ValueError, TypeError):
            keep.append(e)  # keep un-parseable so it's at least visible
            continue
        if dt >= now:
            keep.append(e)
    return keep


def _fetch_rep_events(
    db: Session,
    *,
    official_id: Optional[str] = None,
) -> list[dict]:
    q = db.query(RepEvent).filter(RepEvent.deleted_at.is_(None))
    if official_id:
        q = q.filter(RepEvent.official_id == official_id)
    rows = q.all()
    return _filter_upcoming_rep_events([_rep_event_to_dict(r) for r in rows])


@router.get("/upcoming")
async def get_upcoming_events(
    bioguide_id: str = Query(..., description="Member bioguide ID (e.g. R000595)"),
    db: Session = Depends(get_db),
):
    """Return upcoming public events for a specific member — curated
    events.json entries plus any rep-created events whose
    `official_id` matches the bioguide_id."""
    curated = events_service.get_member_events(bioguide_id)
    # Tag curated events with official_id for frontend symmetry.
    curated = [{**e, "official_id": bioguide_id, "_source": e.get("_source", "curated")} for e in curated]

    rep_events = _fetch_rep_events(db, official_id=bioguide_id)

    merged = curated + rep_events
    merged.sort(key=lambda e: e.get("date") or "")

    return {
        "bioguide_id": bioguide_id,
        "count": len(merged),
        "events": merged,
    }


@router.get("/all")
async def get_all_upcoming_events(db: Session = Depends(get_db)):
    """Return all upcoming public events across curated + rep-created
    sources, sorted by date ascending."""
    curated = events_service.get_all_upcoming_events()
    # Existing service adds bioguide_id; mirror to official_id for parity.
    curated = [
        {**e, "official_id": e.get("official_id") or e.get("bioguide_id"), "_source": e.get("_source", "curated")}
        for e in curated
    ]

    rep_events = _fetch_rep_events(db)

    merged = curated + rep_events
    merged.sort(key=lambda e: e.get("date") or "")

    return {
        "count": len(merged),
        "events": merged,
    }
