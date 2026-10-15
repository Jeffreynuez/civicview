# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Admin: former officials and candidates (2026-10-15, decision 8).

Jeffrey: "a way to set a person's left-office date or race result, with
a source, and to see the schedule of upcoming archives. Record who set
it and when. No delete buttons."

  GET  /api/admin/transitions                    schedule: every page on the clock
  GET  /api/admin/transitions/page/{page_id}     one page, with its change history
  POST /api/admin/transitions                    set a left-office date or a race result
  POST /api/admin/transitions/run                run the daily job now
  POST /api/admin/transitions/handoff            approve a winner's official page
  GET  /api/admin/transitions/name-reviews       name hand-offs waiting for a decision
  POST /api/admin/transitions/name-reviews/{id}  approve or refuse one, with a source

There is no delete route. A correction is another POST: the row is
updated, and page_transition_log keeps the values before and after,
who changed them and when.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    FormerAccountLink,
    PageTransition,
    PageTransitionLog,
    RepAccount,
)
from app.services import former_links
from app.services import page_lifecycle as pl
from app.services.admin_auth import get_current_admin

logger = logging.getLogger(__name__)
router = APIRouter()

_ROW_FIELDS = ("page_kind", "event", "event_on", "recorded_on", "incumbent", "sworn_in_on",
               "handoff_on", "office_label", "served_from", "served_to", "election_year",
               "linked_page_id", "display_name", "state", "source_url", "source_note")


def _row_dict(row: Optional[PageTransition]) -> dict:
    if row is None:
        return {}
    out = {}
    for f in _ROW_FIELDS + ("origin", "set_by"):
        v = getattr(row, f)
        out[f] = v.isoformat() if isinstance(v, (date, datetime)) else v
    out["successor_ids"] = json.loads(row.successor_ids_json) if row.successor_ids_json else []
    return out


def _schedule_item(t: pl.Transition, row: Optional[PageTransition], today: date) -> dict:
    block = t.as_dict(today)
    block.update({
        "display_name": t.display_name,
        "state": t.state,
        "origin": t.origin,
        "set_by": t.set_by or (f"data: {t.data_ref}" if t.data_ref else None),
        "set_at": t.set_at.isoformat() if t.set_at else None,
        "source_note": t.source_note,
        "pre_archive_notice_on": t.pre_archive_notice_on.isoformat() if t.pre_archive_notice_on else None,
        "notices": None if row is None else {
            "person_left": row.person_left_notice_at.isoformat() if row.person_left_notice_at else None,
            "person_pre_archive": (row.person_pre_archive_notice_at.isoformat()
                                   if row.person_pre_archive_notice_at else None),
            "person_archived": (row.person_archived_notice_at.isoformat()
                                if row.person_archived_notice_at else None),
            "trackers": row.trackers_notice_at.isoformat() if row.trackers_notice_at else None,
            "followers": row.followers_notice_at.isoformat() if row.followers_notice_at else None,
            "tracking_ended": row.tracking_ended_at.isoformat() if row.tracking_ended_at else None,
            "skipped": [s for s in (row.skipped_notices or "").split(",") if s],
        },
    })
    return block


@router.get("")
def schedule(
    stage: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=80),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
):
    """Every page on the clock, soonest next date first: the next
    farewell end or archive for pages still moving, then the archived."""
    today = pl.today_et()
    rows = {r.page_id: r for r in db.query(PageTransition).all()}
    items = []
    needle = (q or "").strip().lower()
    for pid, t in pl.all_transitions(db).items():
        st = t.stage(today)
        if stage and st != stage:
            continue
        if needle and needle not in pid.lower() and needle not in (t.display_name or "").lower():
            continue
        items.append(_schedule_item(t, rows.get(pid), today))

    def next_date(it):
        for k in ("farewell_ends_on", "archive_on"):
            v = it.get(k)
            if v and v >= today.isoformat():
                return (0, v)
        return (1, it.get("archive_on") or "9999")

    items.sort(key=next_date)
    counts = {}
    for it in items:
        counts[it["stage"]] = counts.get(it["stage"], 0) + 1
    return {"today": today.isoformat(), "counts": counts, "count": len(items), "items": items[:limit]}


@router.get("/page/{page_id}")
def page_detail(page_id: str, db: Session = Depends(get_db), actor: dict = Depends(get_current_admin)):
    t = pl.get_transition(db, page_id)
    row = db.query(PageTransition).filter(PageTransition.page_id == page_id).first()
    log = (db.query(PageTransitionLog).filter(PageTransitionLog.page_id == page_id)
           .order_by(PageTransitionLog.at.desc()).limit(100).all())
    return {
        "page_id": page_id,
        "transition": _schedule_item(t, row, pl.today_et()) if t else None,
        "history": [{
            "action": e.action, "actor": e.actor, "at": e.at.isoformat() if e.at else None,
            "before": json.loads(e.before_json) if e.before_json else None,
            "after": json.loads(e.after_json) if e.after_json else None,
        } for e in log],
    }


class TransitionSet(BaseModel):
    page_id: str = Field(..., min_length=1, max_length=64)
    page_kind: str = Field(..., pattern=r"^(official|candidate)$")
    event: str = Field(..., pattern=r"^(left_office|lost_primary|lost_general|withdrew|won)$")
    # The day it happened, from the official source below.
    event_on: date
    source_url: str = Field(..., min_length=8, max_length=500)
    source_note: Optional[str] = Field(default=None, max_length=1000)
    incumbent: bool = False
    sworn_in_on: Optional[date] = None
    office_label: Optional[str] = Field(default=None, max_length=255)
    served_from: Optional[str] = Field(default=None, max_length=8)
    served_to: Optional[str] = Field(default=None, max_length=8)
    election_year: Optional[str] = Field(default=None, max_length=8)
    successor_ids: Optional[List[str]] = None
    linked_page_id: Optional[str] = Field(default=None, max_length=64)
    display_name: Optional[str] = Field(default=None, max_length=255)
    state: Optional[str] = Field(default=None, max_length=2)


@router.post("")
def set_transition(body: TransitionSet, db: Session = Depends(get_db), actor: dict = Depends(get_current_admin)):
    """Set (or correct) when a person left office, or a race's result,
    with the official source. The data files' values fill anything left
    blank. Admin entries win over the data."""
    if body.event == "left_office" and body.page_kind != "official":
        raise HTTPException(status_code=400, detail="Leaving office is for an official's page.")
    if body.event != "left_office" and body.page_kind != "candidate":
        raise HTTPException(status_code=400, detail="A race result is for a candidate's page.")
    if not body.source_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="The source must be an https link to an official source.")
    if body.event == "won" and body.incumbent and not body.linked_page_id:
        raise HTTPException(status_code=400,
                            detail="A re-elected incumbent needs the official page id (the Follow in office link).")
    if body.sworn_in_on and body.event != "won":
        raise HTTPException(status_code=400, detail="A swearing-in date is only for a winner.")

    base = pl.registry.get(body.page_id)
    row = db.query(PageTransition).filter(PageTransition.page_id == body.page_id).first()
    before = _row_dict(row)
    if row is None:
        row = PageTransition(page_id=body.page_id)
        db.add(row)
    row.origin = "admin"
    row.page_kind = body.page_kind
    row.event = body.event
    row.event_on = body.event_on
    row.recorded_on = base.recorded_on if base else None
    row.incumbent = bool(body.incumbent)
    row.sworn_in_on = body.sworn_in_on
    row.office_label = body.office_label or (base.office_label if base else None) or row.office_label
    row.served_from = body.served_from or (base.served_from if base else None)
    row.served_to = body.served_to or (base.served_to if base else None)
    row.election_year = body.election_year or (base.election_year if base else None)
    succ = body.successor_ids if body.successor_ids is not None else (base.successor_ids if base else [])
    row.successor_ids_json = json.dumps([s for s in succ if s])
    if body.event == "won":
        row.linked_page_id = body.linked_page_id or row.linked_page_id
    else:
        # A correction away from a win drops the win's official-page
        # link and hand-off date (the log keeps the earlier entry).
        row.linked_page_id = body.linked_page_id
        row.handoff_on = None
    row.display_name = body.display_name or (base.display_name if base else None) or row.display_name
    row.state = (body.state or (base.state if base else None) or "").upper()[:2] or None
    row.source_url = body.source_url
    row.source_note = body.source_note
    row.set_by = actor.get("email")
    row.set_at = datetime.utcnow()
    if not row.office_label:
        raise HTTPException(status_code=400, detail="Give the office (for example \"State Senator, Ohio District 1\").")
    db.add(PageTransitionLog(page_id=body.page_id, action="set", before_json=json.dumps(before),
                             after_json=json.dumps(_row_dict(row)), actor=actor.get("email")))
    db.commit()
    pl.invalidate_cache()
    logger.info("admin %s:%s set transition for %s: %s on %s", actor.get("kind"), actor.get("id"), body.page_id,
                body.event, body.event_on.isoformat())
    t = pl.get_transition(db, body.page_id)
    return _schedule_item(t, row, pl.today_et())


@router.post("/run")
def run_now(db: Session = Depends(get_db), actor: dict = Depends(get_current_admin)):
    from app.services.page_lifecycle_job import run_page_lifecycle
    summary = run_page_lifecycle(db)
    logger.info("admin %s:%s ran the page lifecycle job: %s", actor.get("kind"), actor.get("id"), summary)
    return summary


class HandoffRequest(BaseModel):
    campaign_page_id: str = Field(..., min_length=1, max_length=64)
    official_page_id: str = Field(..., min_length=1, max_length=64)
    role: Optional[str] = Field(default=None, max_length=255)


def _role_from_label(label: str) -> str:
    """"Governor of Florida" -> "Governor"; "U.S. House, Florida
    District 7" -> "U.S. Representative"."""
    elect = pl.elect_title(label)
    return re.sub(r"-elect\b.*$", "", elect).strip() or label


@router.post("/handoff")
def approve_handoff(body: HandoffRequest, db: Session = Depends(get_db),
                    actor: dict = Depends(get_current_admin)):
    """A winner who has been sworn in gets the official page (decision
    6). Their identity was already checked as a candidate, so the rep
    account is made from the candidate account (same sign-in email and
    password; 2FA is set up again at first sign-in). The campaign page
    is archived today, linked both ways, and its followers get one
    "Follow in office" notice. Nothing moves: the campaign's posts stay
    on the campaign page."""
    from app.services.citizen_polls_service import archive_polls_for_claim
    from app.services.officials_index import owner_scope_fallback
    from app.services.page_lifecycle_job import end_tracking, notify_followers_to_follow

    t = pl.get_transition(db, body.campaign_page_id)
    if t is None or t.event != "won" or t.incumbent:
        raise HTTPException(status_code=400, detail="Record the win first (a non-incumbent winner).")
    today = pl.today_et()
    if not t.sworn_in_on or today < t.sworn_in_on:
        raise HTTPException(status_code=400, detail="The hand-off opens on the swearing-in date.")
    cand = db.query(CandidateAccount).filter(CandidateAccount.candidate_id == body.campaign_page_id).first()
    if cand is None or cand.claim_status != "active" or cand.closed_at is not None:
        raise HTTPException(status_code=400, detail="The campaign page has no active candidate account.")
    if db.query(RepAccount).filter(RepAccount.official_id == body.official_page_id).first():
        raise HTTPException(status_code=409, detail="That official page already has an account.")
    if db.query(RepAccount).filter(RepAccount.email == cand.email).first():
        raise HTTPException(status_code=409, detail="A rep account already uses this email.")

    state, district = owner_scope_fallback(body.official_page_id)
    rep = RepAccount(
        official_id=body.official_page_id,
        email=cand.email,
        password_hash=cand.password_hash,
        display_name=cand.display_name,
        role=body.role or _role_from_label(t.office_label),
        owner_state=state or cand.owner_state,
        owner_district=district if district is not None else cand.owner_district,
        owner_city=cand.owner_city,
        is_active=True,
    )
    db.add(rep)
    db.flush()
    archive_polls_for_claim(db, body.official_page_id)

    row = db.query(PageTransition).filter(PageTransition.page_id == body.campaign_page_id).first()
    before = _row_dict(row)
    row.origin = "admin"
    row.handoff_on = today
    row.linked_page_id = body.official_page_id
    row.set_by = actor.get("email")
    row.set_at = datetime.utcnow()
    db.flush()
    pl.invalidate_cache()
    t = pl.get_transition(db, body.campaign_page_id)
    sent = 0
    if row.followers_notice_at is None:
        sent = notify_followers_to_follow(db, t, official_page_id=body.official_page_id,
                                          name=cand.display_name, reelected=False, today=today)
        row.followers_notice_at = datetime.utcnow()
    ended = end_tracking(db, body.campaign_page_id)
    row.tracking_ended_at = datetime.utcnow()
    db.add(PageTransitionLog(page_id=body.campaign_page_id, action="handoff", before_json=json.dumps(before),
                             after_json=json.dumps({**_row_dict(row), "rep_account_id": rep.id}),
                             actor=actor.get("email")))
    db.commit()
    pl.invalidate_cache()
    logger.info("admin %s:%s approved the hand-off %s -> %s", actor.get("kind"), actor.get("id"),
                body.campaign_page_id, body.official_page_id)
    return {"ok": True, "rep_account_id": rep.id, "followers_notified": sent, "tracking_ended": ended}


@router.get("/name-reviews")
def name_reviews(db: Session = Depends(get_db), actor: dict = Depends(get_current_admin)):
    """Name hand-offs where the ID.me legal name and the official's name
    agree on the last name but not the first (a nickname), waiting for a
    decision with a source."""
    from app.services.idme_service import decrypt_legal_name
    out = []
    for link in db.query(FormerAccountLink).filter(FormerAccountLink.name_status == "review",
                                                   FormerAccountLink.unlinked_at.is_(None)).all():
        former = former_links.former_account(db, link)
        citizen = db.get(CitizenAccount, link.citizen_id)
        out.append({
            "link_id": link.id,
            "former_kind": link.former_kind,
            "former_name": former.display_name if former else None,
            "page_id": former_links.page_id_of(link.former_kind, former),
            "citizen_id": link.citizen_id,
            "legal_name": decrypt_legal_name(citizen.verified_legal_name_encrypted or "") if citizen else None,
        })
    return {"items": out}


class NameDecision(BaseModel):
    decision: str = Field(..., pattern=r"^(approve|refuse)$")
    source_url: str = Field(..., min_length=8, max_length=500)


@router.post("/name-reviews/{link_id}")
def decide_name(link_id: int, body: NameDecision, db: Session = Depends(get_db),
                actor: dict = Depends(get_current_admin)):
    if not body.source_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="The source must be an https link.")
    link = db.get(FormerAccountLink, link_id)
    if link is None or link.name_status != "review":
        raise HTTPException(status_code=404, detail="No name review with that id.")
    citizen = db.get(CitizenAccount, link.citizen_id)
    if citizen is None or not citizen.verified or citizen.verified_method != "id.me":
        raise HTTPException(status_code=400, detail="The citizen account must be verified through ID.me first.")
    former = former_links.former_account(db, link)
    link.name_status = "approved" if body.decision == "approve" else "refused"
    link.name_review_source = body.source_url
    link.name_reviewed_by = actor.get("email")
    link.name_reviewed_at = datetime.utcnow()
    applied = False
    if link.name_status == "approved" and former is not None:
        applied = former_links.apply_name(db, link, citizen, former)
    page_id = former_links.page_id_of(link.former_kind, former) or f"link:{link.id}"
    db.add(PageTransitionLog(page_id=page_id, action="name_review", before_json=json.dumps({"status": "review"}),
                             after_json=json.dumps({"status": link.name_status, "source": body.source_url,
                                                    "applied": applied}),
                             actor=actor.get("email")))
    db.commit()
    return {"ok": True, "status": link.name_status, "applied": applied}
