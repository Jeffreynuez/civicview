# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Likes and dislikes on bills (2026-10-03).

Mounted at /api/engagement. Deliberately NOT under /api/bills: that
prefix is in main.py's _CACHEABLE_PREFIXES, so a GET there is served
with a public Cache-Control and can sit in Cloudflare's cache, which
would show one viewer's "my reaction" to everyone. These responses are
per-viewer and say Cache-Control: no-store.

Routes:
  GET    /api/engagement/bills/reactions?keys=k1,k2,...
         Totals plus the caller's own reaction for up to 100 bills in
         one request (a rep profile lists dozens of bills). Anonymous
         callers get totals.
  POST   /api/engagement/bills/reactions
         {bill_key, kind: up|down, as_identity?}. Same toggle rules as
         post and comment reactions: the same kind again removes it, the
         other kind flips it.
  DELETE /api/engagement/bills/reactions?bill_key=...&as_identity=...
         Remove the caller's reaction.

Both write routes match the engagement rate limit (30 a minute,
middleware/rate_limit.py: the path ends in /reactions) and the CSRF
middleware, like every other engagement write.

Who may react: any signed-in identity. A bill has no page owner, so a
rep or candidate reacts as themselves on every bill; with several
identities signed in the frontend's Act as picker sends as_identity.
Citizens pass the dormant verification gate (require_verified), which
does nothing until IDME_ENABLED is on, exactly like post reactions.

Bill keys: "{congress}-{type}-{number}" for federal bills (the
frontend's billKey, lowercase) and the Open States id "ocd-bill/<uuid>"
for state bills. Anything else is refused, so the table only ever holds
keys that name a real bill format.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import BillReaction, CandidateAccount, CitizenAccount, RepAccount
from app.services.entitlements import authored_verified_flag, require_verified

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_KEYS = 100

_FEDERAL_KEY = r"\d{2,3}-(?:hr|s|hjres|sjres|hconres|sconres|hres|sres)-\d{1,5}"
_STATE_KEY = r"ocd-bill/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
BILL_KEY_RE = re.compile(rf"^(?:{_FEDERAL_KEY}|{_STATE_KEY})$")


def normalize_bill_key(raw: Optional[str]) -> Optional[str]:
    """Lowercased, trimmed key when it names a supported bill format,
    else None."""
    key = (raw or "").strip().lower()
    return key if BILL_KEY_RE.match(key) else None


class BillReactionRequest(BaseModel):
    bill_key: str = Field(..., min_length=1, max_length=96)
    kind: str = Field(..., pattern=r"^(up|down)$")
    as_identity: Optional[str] = Field(default=None, pattern=r"^(citizen|rep|candidate)$")


class BillReactionSummary(BaseModel):
    bill_key: str
    up_count: int = 0
    down_count: int = 0
    # The highest-precedence signed-in identity's reaction, for callers
    # that only show one state. my_reactions has a slot for EVERY
    # signed-in identity, null when that identity has not reacted.
    my_reaction: Optional[str] = None
    my_reactions: Dict[str, Optional[str]] = Field(default_factory=dict)


class BillReactionsBatch(BaseModel):
    reactions: Dict[str, BillReactionSummary] = Field(default_factory=dict)


def _acting_identity(
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount],
    me_candidate: Optional[CandidateAccount],
    as_identity: Optional[str],
):
    """(citizen, rep, candidate) with exactly one set, or 401.

    With as_identity, that identity acts, and it must be signed in.
    Without it, the usual citizen, then rep, then candidate precedence."""
    if as_identity == "citizen":
        pick = (me_citizen, None, None) if me_citizen is not None else None
    elif as_identity == "rep":
        pick = (None, me_rep, None) if me_rep is not None else None
    elif as_identity == "candidate":
        pick = (None, None, me_candidate) if me_candidate is not None else None
    elif me_citizen is not None:
        pick = (me_citizen, None, None)
    elif me_rep is not None:
        pick = (None, me_rep, None)
    elif me_candidate is not None:
        pick = (None, None, me_candidate)
    else:
        pick = None
    if pick is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to react to bills.",
        )
    return pick


def _own_reaction_query(db: Session, bill_key: str, citizen, rep, candidate):
    q = db.query(BillReaction).filter(BillReaction.bill_key == bill_key)
    if rep is not None:
        return q.filter(BillReaction.author_rep_id == rep.id)
    if candidate is not None:
        return q.filter(BillReaction.author_candidate_id == candidate.id)
    return q.filter(BillReaction.citizen_id == citizen.id)


def summarize(
    db: Session,
    keys: List[str],
    me_citizen: Optional[CitizenAccount] = None,
    me_rep: Optional[RepAccount] = None,
    me_candidate: Optional[CandidateAccount] = None,
) -> Dict[str, BillReactionSummary]:
    """Totals and per-identity state for each key, one query."""
    base_slots: Dict[str, Optional[str]] = {}
    if me_citizen is not None:
        base_slots["citizen"] = None
    if me_rep is not None:
        base_slots["rep"] = None
    if me_candidate is not None:
        base_slots["candidate"] = None
    out = {
        k: BillReactionSummary(bill_key=k, my_reactions=dict(base_slots))
        for k in keys
    }
    if not keys:
        return out
    rows = (
        db.query(
            BillReaction.bill_key, BillReaction.kind, BillReaction.citizen_id,
            BillReaction.author_rep_id, BillReaction.author_candidate_id,
        )
        .filter(BillReaction.bill_key.in_(keys))
        .all()
    )
    for bill_key, kind, citizen_id, rep_id, candidate_id in rows:
        s = out.get(bill_key)
        if s is None:
            continue
        if kind == "up":
            s.up_count += 1
        elif kind == "down":
            s.down_count += 1
        if me_citizen is not None and citizen_id == me_citizen.id:
            s.my_reactions["citizen"] = kind
        if me_rep is not None and rep_id == me_rep.id:
            s.my_reactions["rep"] = kind
        if me_candidate is not None and candidate_id == me_candidate.id:
            s.my_reactions["candidate"] = kind
    for s in out.values():
        for slot in ("citizen", "rep", "candidate"):
            if s.my_reactions.get(slot):
                s.my_reaction = s.my_reactions[slot]
                break
    return out


def _parse_keys(keys: List[str]) -> List[str]:
    """Accept keys=a,b,c and repeated keys=a&keys=b. Unsupported keys
    are skipped rather than failing the whole batch; duplicates are
    dropped; at most MAX_KEYS."""
    seen: List[str] = []
    for chunk in keys:
        for raw in (chunk or "").split(","):
            k = normalize_bill_key(raw)
            if k and k not in seen:
                seen.append(k)
    if len(seen) > MAX_KEYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"At most {MAX_KEYS} bills per request.",
        )
    return seen


@router.get("/bills/reactions", response_model=BillReactionsBatch)
def list_bill_reactions(
    response: Response,
    keys: List[str] = Query(default=[]),
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    response.headers["Cache-Control"] = "no-store"
    parsed = _parse_keys(keys)
    return BillReactionsBatch(reactions=summarize(db, parsed, me_citizen, me_rep, me_candidate))


@router.post("/bills/reactions", response_model=BillReactionSummary)
def react_to_bill(
    payload: BillReactionRequest,
    response: Response,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    response.headers["Cache-Control"] = "no-store"
    bill_key = normalize_bill_key(payload.bill_key)
    if bill_key is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown bill.")
    citizen, rep, candidate = _acting_identity(me_citizen, me_rep, me_candidate, payload.as_identity)
    # Dormant gate: a no-op until IDME_ENABLED is on; never applies to
    # reps or candidates (citizen is None on those paths).
    require_verified(citizen, action="react to bills")

    existing = _own_reaction_query(db, bill_key, citizen, rep, candidate).first()
    if existing is not None:
        if existing.kind == payload.kind:
            db.delete(existing)
        else:
            existing.kind = payload.kind
            existing.authored_verified = authored_verified_flag(citizen, rep, candidate)
            if citizen is not None:
                existing.scope_state = citizen.state
                existing.scope_district = citizen.congressional_district
                existing.scope_city = citizen.city
                existing.scope_county = citizen.county
    else:
        db.add(BillReaction(
            bill_key=bill_key,
            citizen_id=citizen.id if citizen is not None else None,
            author_rep_id=rep.id if rep is not None else None,
            author_candidate_id=candidate.id if candidate is not None else None,
            kind=payload.kind,
            authored_verified=authored_verified_flag(citizen, rep, candidate),
            scope_state=citizen.state if citizen is not None else None,
            scope_district=citizen.congressional_district if citizen is not None else None,
            scope_city=citizen.city if citizen is not None else None,
            scope_county=citizen.county if citizen is not None else None,
        ))
    try:
        db.commit()
    except IntegrityError:
        # A double-click raced the first insert onto the unique index.
        # The first one won, which is the state the user asked for.
        db.rollback()
    return summarize(db, [bill_key], me_citizen, me_rep, me_candidate)[bill_key]


@router.delete("/bills/reactions", response_model=BillReactionSummary)
def clear_bill_reaction(
    response: Response,
    bill_key: str = Query(..., min_length=1, max_length=96),
    as_identity: Optional[str] = Query(default=None, pattern=r"^(citizen|rep|candidate)$"),
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    response.headers["Cache-Control"] = "no-store"
    key = normalize_bill_key(bill_key)
    if key is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown bill.")
    citizen, rep, candidate = _acting_identity(me_citizen, me_rep, me_candidate, as_identity)
    existing = _own_reaction_query(db, key, citizen, rep, candidate).first()
    if existing is not None:
        db.delete(existing)
        db.commit()
    return summarize(db, [key], me_citizen, me_rep, me_candidate)[key]
