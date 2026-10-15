# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Former officials and candidates: the account side (2026-10-15).

  GET  /api/former/me                       the former account's dashboard
  POST /api/former/link                     link the signed-in citizen account
  POST /api/former/unlink                   undo the link (stamped, not deleted)
  PUT  /api/former/optins                   name / copies / served_as
  GET  /api/former/citizen-card/{id}        a citizen's public card
  GET  /api/former/search-index             former members of Congress, for search

See services/former_links.py for what carries over and why.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    FormerAccountLink,
    PageTransitionLog,
    Poll,
    PollComment,
    PostComment,
    RepAccount,
)
from app.services import former_links
from app.services import page_lifecycle as pl

logger = logging.getLogger(__name__)
router = APIRouter()


def _require_former(db: Session, me_rep, me_candidate):
    picked = former_links.pick_former_account(db, me_rep, me_candidate)
    if picked is None:
        if me_rep is None and me_candidate is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Sign in with your official or candidate account.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="This account is not a former official's or candidate's account.")
    return picked


def _log(db: Session, page_id: str, action: str, before: dict, after: dict, actor: str) -> None:
    db.add(PageTransitionLog(page_id=page_id, action=action, before_json=json.dumps(before),
                             after_json=json.dumps(after), actor=actor))


@router.get("/me")
def former_me(
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    kind, account, t = _require_former(db, me_rep, me_candidate)
    out = former_links.dashboard(db, kind, account, t)
    out["signed_in_citizen"] = (
        {"id": me_citizen.id, "display_name": me_citizen.display_name} if me_citizen is not None else None
    )
    return out


@router.post("/link")
def link_citizen(
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    """Link the citizen account signed in in this same browser. Being
    signed in to both is the proof that one person controls both."""
    kind, account, t = _require_former(db, me_rep, me_candidate)
    if me_citizen is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Sign in to your citizen account in this browser too, then link it.")
    existing = former_links.active_link(db, kind, account.id)
    if existing is not None:
        if existing.citizen_id == me_citizen.id:
            return former_links.dashboard(db, kind, account, t)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Another citizen account is linked. Unlink it first.")
    link = FormerAccountLink(former_kind=kind, former_id=account.id, citizen_id=me_citizen.id)
    db.add(link)
    _log(db, t.page_id, "link", {}, {"citizen_id": me_citizen.id}, f"{kind}:{account.id}")
    db.commit()
    return former_links.dashboard(db, kind, account, t)


@router.post("/unlink")
def unlink_citizen(
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, account, t = _require_former(db, me_rep, me_candidate)
    link = former_links.active_link(db, kind, account.id)
    if link is None:
        return former_links.dashboard(db, kind, account, t)
    now = datetime.utcnow()
    link.unlinked_at = now
    if link.served_as_on_at is not None and link.served_as_off_at is None:
        link.served_as_off_at = now
    _log(db, t.page_id, "unlink", {"citizen_id": link.citizen_id}, {}, f"{kind}:{account.id}")
    db.commit()
    return former_links.dashboard(db, kind, account, t)


class OptinsRequest(BaseModel):
    name: Optional[bool] = None
    copies: Optional[bool] = None
    served_as: Optional[bool] = None


@router.put("/optins")
def set_optins(
    body: OptinsRequest,
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Each choice is the person's own, made from the former account.
    Turning one off is stamped, never deleted, and logged."""
    kind, account, t = _require_former(db, me_rep, me_candidate)
    link = former_links.active_link(db, kind, account.id)
    if link is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Link your citizen account first.")
    now = datetime.utcnow()
    actor = f"{kind}:{account.id}"
    if body.name is not None:
        before = {"name_on": link.name_on_at is not None and link.name_off_at is None}
        if body.name:
            link.name_on_at = now
            link.name_off_at = None
            former_links.evaluate_name(db, link)
        else:
            link.name_off_at = now
        _log(db, t.page_id, "optin_name", before, {"name_on": bool(body.name)}, actor)
    if body.copies:
        if link.copies_at is None:
            counts = former_links.copy_items(db, link)
            _log(db, t.page_id, "optin_copies", {}, counts, actor)
    if body.served_as is not None:
        if kind != "rep":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="The Served as line is for former officials.")
        before = {"served_as_on": link.served_as_on_at is not None and link.served_as_off_at is None}
        if body.served_as:
            link.served_as_on_at = now
            link.served_as_off_at = None
        else:
            link.served_as_off_at = now
        _log(db, t.page_id, "optin_served_as", before, {"served_as_on": bool(body.served_as)}, actor)
    db.commit()
    return former_links.dashboard(db, kind, account, t)


@router.post("/citizen/served-as/remove")
def citizen_remove_served_as(
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    """The Served as line is removable any time, from the citizen
    account too (the former account may have been closed)."""
    if me_citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in first.")
    now = datetime.utcnow()
    n = 0
    for link in db.query(FormerAccountLink).filter(
            FormerAccountLink.citizen_id == me_citizen.id,
            FormerAccountLink.served_as_on_at.isnot(None),
            FormerAccountLink.served_as_off_at.is_(None)).all():
        link.served_as_off_at = now
        _log(db, f"link:{link.id}", "optin_served_as", {"served_as_on": True}, {"served_as_on": False},
             f"citizen:{me_citizen.id}")
        n += 1
    db.commit()
    return {"ok": True, "removed": n}


@router.get("/citizen/served-as")
def citizen_served_as(
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    if me_citizen is None:
        return {"served_as": None}
    return {"served_as": former_links.served_as_for_citizen(db, me_citizen.id)}


def _has_public_content(db: Session, citizen_id: int) -> bool:
    """Has this citizen's name already appeared publicly (a comment or a
    poll they wrote)? The card shows nothing that is not public today."""
    if db.query(PostComment.id).filter(PostComment.citizen_id == citizen_id,
                                       PostComment.deleted_at.is_(None)).first():
        return True
    if db.query(PollComment.id).filter(PollComment.citizen_id == citizen_id,
                                       PollComment.deleted_at.is_(None)).first():
        return True
    return db.query(Poll.id).filter(Poll.author_citizen_id == citizen_id).first() is not None


@router.get("/citizen-card/{citizen_id}")
def citizen_card(citizen_id: int, db: Session = Depends(get_db)):
    """A citizen's public card: their display name (already public on
    what they wrote) and, when they chose it, the Served as line. Each
    comment already shows the district it was written from; the card
    does not show the account's current state or district, which can
    differ and is not public (Jeffrey, 2026-10-15: "show nothing about
    a citizen that isn't already public today")."""
    citizen = db.get(CitizenAccount, citizen_id)
    if citizen is None or citizen.suspended_at is not None or citizen.self_deleted_at is not None:
        raise HTTPException(status_code=404, detail="Not found")
    served_as = former_links.served_as_for_citizen(db, citizen_id)
    if served_as is None and not _has_public_content(db, citizen_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"citizen_id": citizen_id, "display_name": citizen.display_name, "served_as": served_as}


@router.get("/search-index")
def search_index(db: Session = Depends(get_db)):
    """Former members of Congress the roster no longer lists, findable
    by search with the Former label until their page is archived
    (decision d). Candidates come with /api/candidates."""
    out = []
    today = pl.today_et()
    for t in pl.all_transitions(db).values():
        if t.page_kind != "official" or t.event != "left_office":
            continue
        if not (len(t.page_id) == 7 and t.page_id[0].isalpha() and t.page_id[1:].isdigit()):
            continue  # bioguide ids only: the search box covers Congress
        st = t.stage(today)
        if st not in (pl.FAREWELL, pl.READ_ONLY):
            continue
        out.append({"bioguide_id": t.page_id, "name": t.display_name, "state": t.state,
                    "title": t.title(today), "stage": st})
    return {"count": len(out), "members": out}
