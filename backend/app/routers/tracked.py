# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Tracked-items router.

Per-identity server-side persistence for the user's tracked bills,
officials, and elections — replaces the previous localStorage-singleton
implementation that survived logout/login and leaked one citizen's
tracked state into another's session.

Surface:
  GET    /api/tracked                            → bulk-load all three lists
  GET    /api/tracked/bills                      → list tracked bills
  POST   /api/tracked/bills                      → track a bill (idempotent)
  DELETE /api/tracked/bills/{bill_key}           → untrack a bill
  PATCH  /api/tracked/bills/{bill_key}/prefs     → update notification prefs

  Same five routes for /officials and /elections (12 endpoints total +
  the bulk-load).

Identity resolution:
  Today only citizens use this surface, but the storage schema is
  polymorphic (tracker_kind = 'citizen' | 'rep' | 'candidate') so reps
  and candidates can adopt it later without a model change. We pick
  the active identity in citizen → rep → candidate order — a deliberate
  choice that matches today's product (citizens are the audience for
  My Tracked) without painting us into a corner.

Anonymous callers:
  GET routes return empty payloads (the navbar can poll harmlessly).
  POST / DELETE / PATCH return 401.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    FeaturedTracked,
    RepAccount,
    TrackedBill,
    TrackedElection,
    TrackedOfficial,
)
from app.schemas.pages import (
    FeaturedTrackedMap,
    FeaturedTrackedSet,
    TrackedBillCreate,
    TrackedBillRead,
    TrackedElectionCreate,
    TrackedElectionRead,
    TrackedListResponse,
    TrackedOfficialCreate,
    TrackedOfficialRead,
    TrackedPrefsPatch,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ── Identity resolution ──────────────────────────────────────────────


def _primary_tracker(
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount],
    me_candidate: Optional[CandidateAccount],
) -> Optional[tuple[str, int]]:
    """Pick the (tracker_kind, tracker_id) we'll use for reads + writes.

    Citizen wins over rep wins over candidate — matches today's product
    where only citizens have the My Tracked surface. Returns None for
    fully anonymous callers."""
    if me_citizen is not None:
        return ("citizen", me_citizen.id)
    if me_rep is not None:
        return ("rep", me_rep.id)
    if me_candidate is not None:
        return ("candidate", me_candidate.id)
    return None


def _require_tracker(
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount],
    me_candidate: Optional[CandidateAccount],
) -> tuple[str, int]:
    pair = _primary_tracker(me_citizen, me_rep, me_candidate)
    if pair is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to track items.",
        )
    return pair


# ── JSON helpers ─────────────────────────────────────────────────────


def _loads(s: Optional[str]) -> dict:
    if not s:
        return {}
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _dumps(d: Optional[dict]) -> str:
    return json.dumps(d or {}, ensure_ascii=False)


# ── Row -> response converters ───────────────────────────────────────


def _bill_to_read(row: TrackedBill) -> TrackedBillRead:
    return TrackedBillRead(
        bill_key=row.bill_key,
        snapshot=_loads(row.snapshot_json),
        prefs=_loads(row.prefs_json),
        tracked_at=row.tracked_at,
    )


def _official_to_read(row: TrackedOfficial) -> TrackedOfficialRead:
    return TrackedOfficialRead(
        official_key=row.official_key,
        snapshot=_loads(row.snapshot_json),
        prefs=_loads(row.prefs_json),
        followed_at=row.followed_at,
    )


def _election_to_read(row: TrackedElection) -> TrackedElectionRead:
    return TrackedElectionRead(
        election_key=row.election_key,
        snapshot=_loads(row.snapshot_json),
        prefs=_loads(row.prefs_json),
        tracked_at=row.tracked_at,
    )


# ── Featured (one pinned item per category for the dashboard) ────────


_FEATURED_CATEGORIES = ("representative", "candidate", "bill", "election")


def _featured_map(db: Session, kind: str, tid: int) -> FeaturedTrackedMap:
    rows = (
        db.query(FeaturedTracked)
        .filter(
            FeaturedTracked.tracker_kind == kind,
            FeaturedTracked.tracker_id == tid,
        )
        .all()
    )
    by_cat = {r.category: r.item_key for r in rows}
    return FeaturedTrackedMap(
        representative=by_cat.get("representative"),
        candidate=by_cat.get("candidate"),
        bill=by_cat.get("bill"),
        election=by_cat.get("election"),
    )


# ── Bulk loader (login bootstrap) ────────────────────────────────────


@router.get("", response_model=TrackedListResponse)
def list_all_tracked(
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Bulk-load all three lists in one round-trip. The frontend calls
    this on login + identity switch to populate the in-memory store
    that replaces the prior localStorage cache."""
    pair = _primary_tracker(me_citizen, me_rep, me_candidate)
    if pair is None:
        return TrackedListResponse()
    kind, tid = pair

    bills = (
        db.query(TrackedBill)
        .filter(TrackedBill.tracker_kind == kind, TrackedBill.tracker_id == tid)
        .order_by(TrackedBill.tracked_at.desc())
        .all()
    )
    officials = (
        db.query(TrackedOfficial)
        .filter(
            TrackedOfficial.tracker_kind == kind,
            TrackedOfficial.tracker_id == tid,
        )
        .order_by(TrackedOfficial.followed_at.desc())
        .all()
    )
    elections = (
        db.query(TrackedElection)
        .filter(
            TrackedElection.tracker_kind == kind,
            TrackedElection.tracker_id == tid,
        )
        .order_by(TrackedElection.tracked_at.desc())
        .all()
    )
    return TrackedListResponse(
        bills=[_bill_to_read(r) for r in bills],
        officials=[_official_to_read(r) for r in officials],
        elections=[_election_to_read(r) for r in elections],
        featured=_featured_map(db, kind, tid),
    )


# ── Featured endpoints ───────────────────────────────────────────────


@router.get("/featured", response_model=FeaturedTrackedMap)
def get_featured(
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    pair = _primary_tracker(me_citizen, me_rep, me_candidate)
    if pair is None:
        return FeaturedTrackedMap()
    kind, tid = pair
    return _featured_map(db, kind, tid)


@router.put("/featured", response_model=FeaturedTrackedMap)
def set_featured(
    body: FeaturedTrackedSet,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Pin (or clear) the one featured item for a category. Upsert
    semantics via the UNIQUE(tracker, category) constraint: we delete the
    prior pick for the category, then insert the new one (key=null just
    clears). item_key is stored verbatim so it matches the frontend store
    key exactly."""
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    cat = (body.category or "").strip().lower()
    if cat not in _FEATURED_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="category must be one of: " + ", ".join(_FEATURED_CATEGORIES),
        )
    key = (body.key or "").strip()
    (
        db.query(FeaturedTracked)
        .filter(
            FeaturedTracked.tracker_kind == kind,
            FeaturedTracked.tracker_id == tid,
            FeaturedTracked.category == cat,
        )
        .delete(synchronize_session=False)
    )
    if key:
        db.add(FeaturedTracked(
            tracker_kind=kind,
            tracker_id=tid,
            category=cat,
            item_key=key[:128],
        ))
    db.commit()
    return _featured_map(db, kind, tid)


# ── Bills ────────────────────────────────────────────────────────────


@router.get("/bills", response_model=list[TrackedBillRead])
def list_tracked_bills(
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    pair = _primary_tracker(me_citizen, me_rep, me_candidate)
    if pair is None:
        return []
    kind, tid = pair
    rows = (
        db.query(TrackedBill)
        .filter(TrackedBill.tracker_kind == kind, TrackedBill.tracker_id == tid)
        .order_by(TrackedBill.tracked_at.desc())
        .all()
    )
    return [_bill_to_read(r) for r in rows]


@router.post("/bills", response_model=TrackedBillRead)
def track_bill(
    body: TrackedBillCreate,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Idempotent — re-tracking an already-tracked bill refreshes the
    snapshot + preserves existing prefs. The frontend treats this as a
    write-through: it calls POST whenever the user clicks Track, and
    server-side de-dupes on (tracker_kind, tracker_id, bill_key)."""
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = body.bill_key.strip().lower()
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bill_key is required.",
        )

    existing = (
        db.query(TrackedBill)
        .filter(
            TrackedBill.tracker_kind == kind,
            TrackedBill.tracker_id == tid,
            TrackedBill.bill_key == key,
        )
        .one_or_none()
    )
    if existing is None:
        row = TrackedBill(
            tracker_kind=kind,
            tracker_id=tid,
            bill_key=key,
            snapshot_json=_dumps(body.snapshot),
            prefs_json=_dumps(body.prefs or {}),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _bill_to_read(row)

    # Re-track: refresh snapshot, preserve prefs unless caller passed new ones.
    existing.snapshot_json = _dumps(body.snapshot)
    if body.prefs is not None:
        existing.prefs_json = _dumps(body.prefs)
    db.commit()
    db.refresh(existing)
    return _bill_to_read(existing)


@router.delete("/bills/{bill_key}")
def untrack_bill(
    bill_key: str,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = bill_key.strip().lower()
    deleted = (
        db.query(TrackedBill)
        .filter(
            TrackedBill.tracker_kind == kind,
            TrackedBill.tracker_id == tid,
            TrackedBill.bill_key == key,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "deleted": int(deleted or 0)}


@router.patch("/bills/{bill_key}/prefs", response_model=TrackedBillRead)
def patch_bill_prefs(
    bill_key: str,
    body: TrackedPrefsPatch,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Merge-patch — body.prefs keys overwrite, others stay. Mirrors
    the frontend setBillPrefs() shape."""
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = bill_key.strip().lower()
    row = (
        db.query(TrackedBill)
        .filter(
            TrackedBill.tracker_kind == kind,
            TrackedBill.tracker_id == tid,
            TrackedBill.bill_key == key,
        )
        .one_or_none()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bill is not tracked.",
        )
    merged = {**_loads(row.prefs_json), **(body.prefs or {})}
    row.prefs_json = _dumps(merged)
    db.commit()
    db.refresh(row)
    return _bill_to_read(row)


# ── Officials ────────────────────────────────────────────────────────


@router.get("/officials", response_model=list[TrackedOfficialRead])
def list_tracked_officials(
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    pair = _primary_tracker(me_citizen, me_rep, me_candidate)
    if pair is None:
        return []
    kind, tid = pair
    rows = (
        db.query(TrackedOfficial)
        .filter(
            TrackedOfficial.tracker_kind == kind,
            TrackedOfficial.tracker_id == tid,
        )
        .order_by(TrackedOfficial.followed_at.desc())
        .all()
    )
    return [_official_to_read(r) for r in rows]


@router.post("/officials", response_model=TrackedOfficialRead)
def track_official(
    body: TrackedOfficialCreate,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = body.official_key.strip().lower()
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="official_key is required.",
        )

    existing = (
        db.query(TrackedOfficial)
        .filter(
            TrackedOfficial.tracker_kind == kind,
            TrackedOfficial.tracker_id == tid,
            TrackedOfficial.official_key == key,
        )
        .one_or_none()
    )
    if existing is None:
        row = TrackedOfficial(
            tracker_kind=kind,
            tracker_id=tid,
            official_key=key,
            snapshot_json=_dumps(body.snapshot),
            prefs_json=_dumps(body.prefs or {}),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _official_to_read(row)

    existing.snapshot_json = _dumps(body.snapshot)
    if body.prefs is not None:
        existing.prefs_json = _dumps(body.prefs)
    db.commit()
    db.refresh(existing)
    return _official_to_read(existing)


@router.delete("/officials/{official_key}")
def untrack_official(
    official_key: str,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = official_key.strip().lower()
    deleted = (
        db.query(TrackedOfficial)
        .filter(
            TrackedOfficial.tracker_kind == kind,
            TrackedOfficial.tracker_id == tid,
            TrackedOfficial.official_key == key,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "deleted": int(deleted or 0)}


@router.patch("/officials/{official_key}/prefs", response_model=TrackedOfficialRead)
def patch_official_prefs(
    official_key: str,
    body: TrackedPrefsPatch,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = official_key.strip().lower()
    row = (
        db.query(TrackedOfficial)
        .filter(
            TrackedOfficial.tracker_kind == kind,
            TrackedOfficial.tracker_id == tid,
            TrackedOfficial.official_key == key,
        )
        .one_or_none()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Official is not tracked.",
        )
    merged = {**_loads(row.prefs_json), **(body.prefs or {})}
    row.prefs_json = _dumps(merged)
    db.commit()
    db.refresh(row)
    return _official_to_read(row)


# ── Elections ────────────────────────────────────────────────────────


@router.get("/elections", response_model=list[TrackedElectionRead])
def list_tracked_elections(
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    pair = _primary_tracker(me_citizen, me_rep, me_candidate)
    if pair is None:
        return []
    kind, tid = pair
    rows = (
        db.query(TrackedElection)
        .filter(
            TrackedElection.tracker_kind == kind,
            TrackedElection.tracker_id == tid,
        )
        .order_by(TrackedElection.tracked_at.desc())
        .all()
    )
    return [_election_to_read(r) for r in rows]


@router.post("/elections", response_model=TrackedElectionRead)
def track_election(
    body: TrackedElectionCreate,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = body.election_key.strip().lower()
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="election_key is required.",
        )

    existing = (
        db.query(TrackedElection)
        .filter(
            TrackedElection.tracker_kind == kind,
            TrackedElection.tracker_id == tid,
            TrackedElection.election_key == key,
        )
        .one_or_none()
    )
    if existing is None:
        row = TrackedElection(
            tracker_kind=kind,
            tracker_id=tid,
            election_key=key,
            snapshot_json=_dumps(body.snapshot),
            prefs_json=_dumps(body.prefs or {}),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return _election_to_read(row)

    existing.snapshot_json = _dumps(body.snapshot)
    if body.prefs is not None:
        existing.prefs_json = _dumps(body.prefs)
    db.commit()
    db.refresh(existing)
    return _election_to_read(existing)


@router.delete("/elections/{election_key}")
def untrack_election(
    election_key: str,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = election_key.strip().lower()
    deleted = (
        db.query(TrackedElection)
        .filter(
            TrackedElection.tracker_kind == kind,
            TrackedElection.tracker_id == tid,
            TrackedElection.election_key == key,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "deleted": int(deleted or 0)}


@router.patch("/elections/{election_key}/prefs", response_model=TrackedElectionRead)
def patch_election_prefs(
    election_key: str,
    body: TrackedPrefsPatch,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, tid = _require_tracker(me_citizen, me_rep, me_candidate)
    key = election_key.strip().lower()
    row = (
        db.query(TrackedElection)
        .filter(
            TrackedElection.tracker_kind == kind,
            TrackedElection.tracker_id == tid,
            TrackedElection.election_key == key,
        )
        .one_or_none()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Election is not tracked.",
        )
    merged = {**_loads(row.prefs_json), **(body.prefs or {})}
    row.prefs_json = _dumps(merged)
    db.commit()
    db.refresh(row)
    return _election_to_read(row)
