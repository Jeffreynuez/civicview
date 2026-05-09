# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Citizen-poll router — the API surface for the "Subscribed citizens
post polls on unclaimed rep pages" feature.

Endpoints
─────────
Public (anonymous reads allowed):
  GET    /api/pages/{official_id}/citizen-polls
                              → active + archived citizen polls on a page

Authenticated citizen (session cookie):
  POST   /api/pages/{official_id}/citizen-polls
                              → create a citizen poll on an unclaimed page
  POST   /api/citizen-polls/{poll_id}/vote
                              → vote on a citizen poll
  POST   /api/citizen-polls/{poll_id}/close
                              → author closes their own poll
  POST   /api/citizen-polls/{poll_id}/comments
                              → comment on a citizen poll
  GET    /api/citizen-polls/{poll_id}/comments
                              → list comments on a citizen poll
  GET    /api/citizens/me/polls?status=active|archived
                              → caller's own polls for the dashboard

Authenticated citizen OR rep:
  POST   /api/citizen-polls/{poll_id}/report
                              → file a report (one per (poll, reporter))

Authenticated rep (page owner only):
  POST   /api/pages/{official_id}/citizen-polls/dismiss-archive
                              → owner dismisses the "Pre-claim discussion"
                                section on their claimed page

Rules enforced:
  • Posting requires a citizen session. The "Subscribed" gate is a
    UI-level concept today (every citizen account is treated as
    Subscribed for the demo); a future Stripe hook will swap this for
    a real entitlement check.
  • Page must be unclaimed at create time (rep account does not exist
    for that official_id). Once claimed, any in-flight create attempts
    400 with a clear error and the polls already on the page archive.
  • 1 active poll per (citizen, page). Caller closes (or it auto-
    archives) before they can post another there.
  • PER_PAGE_ACTIVE_POLL_CAP active polls per page total. New posts
    above the cap auto-supersede the oldest active poll.
"""
from __future__ import annotations

from datetime import datetime
import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.auth import get_optional_rep
from app.auth_citizen import get_current_citizen, get_optional_citizen
from app.db import get_db
from app.models.pages import (
    CitizenAccount,
    Poll,
    PollComment,
    PollOption,
    PollReport,
    PollVote,
    RepAccount,
)
from app.schemas.pages import (
    PER_PAGE_ACTIVE_POLL_CAP,
    POLL_ARCHIVE_REASONS,
    POLL_REPORT_REASONS,
    PRESENTATION_MODES,
    CitizenPollCreate,
    CitizenPollListMineResponse,
    CitizenPollListResponse,
    CitizenPollRead,
    PollCommentCreate,
    PollCommentRead,
    PollReportCreate,
    PollReportStatus,
    PollVoteRequest,
)
from app.services.citizen_polls_service import (
    active_poll_count_for_page,
    archive_poll,
    citizen_has_active_poll_on_page,
    list_citizen_polls_for_citizen,
    list_citizen_polls_for_page,
    maybe_supersede_oldest_active_poll,
    serialize_citizen_poll,
)
from app.services.officials_index import (
    allowed_scopes_for_official,
    lookup as lookup_official_geography,
    scope_labels_for_official,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────
def _page_is_claimed(db: Session, official_id: str) -> bool:
    """True if a RepAccount exists for this official_id and is
    active. Mirrors the `claimed = owner is not None` check the
    main pages router uses."""
    return bool(
        db.query(RepAccount.id)
        .filter(
            RepAccount.official_id == official_id,
            RepAccount.is_active.is_(True),
        )
        .first()
    )


def _load_owner(db: Session, official_id: str) -> Optional[RepAccount]:
    """Return the page owner, if any."""
    return (
        db.query(RepAccount)
        .filter(
            RepAccount.official_id == official_id,
            RepAccount.is_active.is_(True),
        )
        .first()
    )


def _caller_role(
    citizen: Optional[CitizenAccount],
    owner: Optional[RepAccount],
    me_rep: Optional[RepAccount],
) -> Optional[str]:
    """Which UX path applies to this caller on this page."""
    if me_rep is not None and owner is not None and me_rep.id == owner.id:
        return "rep_owner"
    if citizen is not None:
        # Subscribed-tier check is a stub — every citizen account is
        # treated as Subscribed in the demo. Wire to a real entitlement
        # service when payments ship.
        return "subscribed"
    return None


def _get_poll_or_404(db: Session, poll_id: int) -> Poll:
    poll = (
        db.query(Poll)
        .options(selectinload(Poll.options).selectinload(PollOption.votes))
        .filter(Poll.id == poll_id, Poll.author_kind == "citizen")
        .first()
    )
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")
    return poll


# ── List + create on a specific page ──────────────────────────────────
SCOPE_VALUES = ("country", "state", "district", "city")


@router.get(
    "/pages/{official_id}/citizen-polls",
    response_model=CitizenPollListResponse,
)
def list_citizen_polls_on_page(
    official_id: str,
    scope: Optional[str] = Query(
        default=None,
        description="Geographic scope to filter vote counts by. One of country/state/district/city. Defaults to country.",
    ),
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
):
    """
    Public read of the citizen-led discussion on a page. Active polls
    always render to anyone (including unauth visitors); the archived
    set is gated to page owners since "Pre-claim discussion" is a
    rep-only UX affordance once the page is claimed.

    Scope filter: when `scope` is set to state/district/city, vote
    counts roll up only over citizens whose denormalized geography
    matches the page's office context. The page's allowed scopes
    come from the curated officials index — federal Senate pages
    get country+state, House pages get country+state+district,
    Cabinet/SCOTUS pages get country only.
    """
    owner = _load_owner(db, official_id)
    is_owner = bool(owner and me_rep and me_rep.id == owner.id)

    # Resolve the page's geographic context. For claimed pages we
    # prefer the RepAccount's own owner_state/owner_district so the
    # owner can edit those without re-deploying. For unclaimed pages
    # we fall back to the curated officials index.
    if owner is not None:
        geo = {
            "state": owner.owner_state,
            "district": owner.owner_district,
            "city": owner.owner_city,
        }
        allowed = ["country"]
        if owner.owner_state:    allowed.append("state")
        if owner.owner_district: allowed.append("district")
        if owner.owner_city:     allowed.append("city")
        labels = {"country": "United States"}
        if owner.owner_state:    labels["state"] = owner.owner_state
        if owner.owner_district: labels["district"] = owner.owner_district
        if owner.owner_city:     labels["city"] = owner.owner_city
    else:
        geo = lookup_official_geography(official_id) or {}
        allowed = allowed_scopes_for_official(official_id)
        labels = scope_labels_for_official(official_id)

    # Validate the requested scope — fall back to country on anything
    # we don't understand or don't support for this office.
    active_scope = scope if scope in allowed else "country"

    active_polls = list_citizen_polls_for_page(db, official_id, active=True)
    archived_polls = (
        list_citizen_polls_for_page(db, official_id, active=False)
        if is_owner
        else []
    )
    if is_owner:
        archived_polls = [p for p in archived_polls if p.dismissed_by_owner_at is None]

    return CitizenPollListResponse(
        official_id=official_id,
        page_claimed=owner is not None,
        caller_role=_caller_role(citizen, owner, me_rep),
        active_count=len(active_polls),
        active_cap=PER_PAGE_ACTIVE_POLL_CAP,
        caller_has_active_poll=(
            citizen_has_active_poll_on_page(db, citizen.id, official_id)
            if citizen is not None else False
        ),
        allowed_scopes=allowed,
        scope_labels=labels,
        active_scope=active_scope,
        active=[
            serialize_citizen_poll(
                db, p, citizen, me_rep,
                active_scope=active_scope, allowed_scopes=allowed,
                scope_labels=labels, geo=geo,
            )
            for p in active_polls
        ],
        archived=[
            serialize_citizen_poll(
                db, p, citizen, me_rep,
                active_scope=active_scope, allowed_scopes=allowed,
                scope_labels=labels, geo=geo,
            )
            for p in archived_polls
        ],
    )


@router.post(
    "/pages/{official_id}/citizen-polls",
    response_model=CitizenPollRead,
    status_code=status.HTTP_201_CREATED,
)
def create_citizen_poll(
    official_id: str,
    payload: CitizenPollCreate,
    db: Session = Depends(get_db),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """
    Create a citizen poll on an unclaimed rep page.

    Validation order matters: claim check first (cheapest, also the
    rule that overrides everything else), then per-citizen rate limit,
    then the per-page cap (handled silently by superseding the oldest
    active poll).
    """
    if _page_is_claimed(db, official_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This page has been claimed by its rep. Citizens can't post polls here anymore.",
        )

    if citizen_has_active_poll_on_page(db, citizen.id, official_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active poll on this page. Close it before posting another.",
        )

    poll_payload = payload.poll
    presentation = (poll_payload.presentation_mode or "full").lower()
    if presentation not in PRESENTATION_MODES:
        presentation = "full"
    # `reveal_after_close` only makes sense paired with closes_at —
    # otherwise counts would stay hidden forever.
    if presentation == "reveal_after_close" and poll_payload.closes_at is None:
        presentation = "full"

    # Auto-supersede if we're at the cap. Done before the new INSERT so
    # cap+1 never temporarily exists.
    maybe_supersede_oldest_active_poll(db, official_id)

    poll = Poll(
        post_id=None,
        question=poll_payload.question,
        closes_at=poll_payload.closes_at,
        # Citizen polls have no rep "owner geography", so the visibility
        # scope is always 'country'. We set it explicitly rather than
        # accept the payload's value.
        default_visibility_scope="country",
        presentation_mode=presentation,
        author_kind="citizen",
        author_citizen_id=citizen.id,
        target_official_id=official_id,
        created_at=datetime.utcnow(),
    )
    db.add(poll)
    db.flush()  # populates poll.id for the option FKs

    for sort_order, opt in enumerate(poll_payload.options):
        db.add(PollOption(
            poll_id=poll.id,
            text=opt.text,
            sort_order=sort_order,
        ))
    db.commit()
    db.refresh(poll)
    for o in poll.options:
        db.refresh(o)

    return serialize_citizen_poll(db, poll, citizen, None)


# ── Vote / close / report on a citizen poll ───────────────────────────
@router.post("/citizen-polls/{poll_id}/vote", response_model=CitizenPollRead)
def vote_on_citizen_poll(
    poll_id: int,
    payload: PollVoteRequest,
    db: Session = Depends(get_db),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """Cast (or switch) a vote on a citizen poll. Mirrors the rep-poll
    voting endpoint's logic: lookup by citizen_id, switch the option
    on existing rows, never spawn duplicates."""
    poll = _get_poll_or_404(db, poll_id)
    if poll.archived_at is not None:
        raise HTTPException(status_code=400, detail="This poll has been archived.")
    if poll.closes_at is not None and datetime.utcnow() >= poll.closes_at:
        raise HTTPException(status_code=400, detail="This poll is closed.")

    option = db.get(PollOption, payload.option_id)
    if not option or option.poll_id != poll.id:
        raise HTTPException(status_code=400, detail="Invalid option for this poll")

    existing = (
        db.query(PollVote)
        .filter(PollVote.poll_id == poll.id, PollVote.citizen_id == citizen.id)
        .first()
    )
    if existing:
        existing.option_id = option.id
        existing.scope_state = citizen.state
        existing.scope_district = citizen.congressional_district
        existing.scope_city = citizen.city
        existing.scope_county = citizen.county
    else:
        db.add(PollVote(
            poll_id=poll.id,
            option_id=option.id,
            voter_token=None,
            citizen_id=citizen.id,
            scope_state=citizen.state,
            scope_district=citizen.congressional_district,
            scope_city=citizen.city,
            scope_county=citizen.county,
        ))

    db.commit()
    db.refresh(poll)
    for opt in poll.options:
        db.refresh(opt)

    return serialize_citizen_poll(db, poll, citizen, None)


@router.post("/citizen-polls/{poll_id}/close", response_model=CitizenPollRead)
def close_citizen_poll(
    poll_id: int,
    db: Session = Depends(get_db),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """The poll's author closes it themselves. Used to free up their
    'one active per page' slot before posting a new one."""
    poll = _get_poll_or_404(db, poll_id)
    if poll.author_citizen_id != citizen.id:
        raise HTTPException(status_code=403, detail="Only the poll author can close this poll.")
    if poll.archived_at is not None:
        # Idempotent — already closed.
        return serialize_citizen_poll(db, poll, citizen, None)
    archive_poll(db, poll, reason="citizen_closed")
    return serialize_citizen_poll(db, poll, citizen, None)


@router.post("/citizen-polls/{poll_id}/report", response_model=PollReportStatus)
def report_citizen_poll(
    poll_id: int,
    payload: PollReportCreate,
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
):
    """File a moderation report. Either a citizen or a rep can report;
    we require *some* identity so the admin queue can follow up."""
    if citizen is None and me_rep is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to report a poll.",
        )

    if payload.reason not in POLL_REPORT_REASONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown report reason: {payload.reason}",
        )

    poll = _get_poll_or_404(db, poll_id)

    # Dedupe: the unique indexes guarantee one row per (poll, reporter).
    # We pre-check so we can return already_reported=True without an
    # exception on the unique-constraint violation.
    existing_q = db.query(PollReport.id).filter(PollReport.poll_id == poll.id)
    if citizen is not None:
        existing_q = existing_q.filter(PollReport.reporter_citizen_id == citizen.id)
    else:
        existing_q = existing_q.filter(PollReport.reporter_rep_id == me_rep.id)
    if existing_q.first():
        return PollReportStatus(ok=True, already_reported=True)

    db.add(PollReport(
        poll_id=poll.id,
        reporter_citizen_id=citizen.id if citizen else None,
        reporter_rep_id=me_rep.id if me_rep else None,
        reason=payload.reason,
        detail=payload.detail,
    ))
    poll.report_count = (poll.report_count or 0) + 1
    db.commit()
    return PollReportStatus(ok=True, already_reported=False)


# ── Comments on a citizen poll ────────────────────────────────────────
@router.get(
    "/citizen-polls/{poll_id}/comments",
    response_model=List[PollCommentRead],
)
def list_citizen_poll_comments(
    poll_id: int,
    db: Session = Depends(get_db),
):
    """Public list — no auth needed. Soft-deleted rows are filtered
    out at the SQL layer."""
    # Lightweight existence check so 404s differ from "no comments yet".
    if not db.query(Poll.id).filter(
        Poll.id == poll_id, Poll.author_kind == "citizen",
    ).first():
        raise HTTPException(status_code=404, detail="Poll not found")

    rows = (
        db.query(PollComment)
        .filter(PollComment.poll_id == poll_id, PollComment.deleted_at.is_(None))
        .order_by(PollComment.created_at.desc())
        .limit(200)
        .all()
    )
    return [PollCommentRead.model_validate(c) for c in rows]


@router.post(
    "/citizen-polls/{poll_id}/comments",
    response_model=PollCommentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_citizen_poll_comment(
    poll_id: int,
    payload: PollCommentCreate,
    db: Session = Depends(get_db),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """Citizen-gated. Comments allowed on both active and archived
    polls — the archived 'Pre-claim discussion' surface stays read+
    write for citizens, with a banner clarifying the rep hasn't
    claimed-into-and-then-deleted the conversation."""
    poll = (
        db.query(Poll)
        .filter(Poll.id == poll_id, Poll.author_kind == "citizen")
        .first()
    )
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")

    comment = PollComment(
        poll_id=poll.id,
        citizen_id=citizen.id,
        citizen_display_name=citizen.display_name,
        body=payload.body,
        scope_state=citizen.state,
        scope_district=citizen.congressional_district,
        scope_city=citizen.city,
        scope_county=citizen.county,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return PollCommentRead.model_validate(comment)


# ── Owner: dismiss the archive ────────────────────────────────────────
@router.post("/pages/{official_id}/citizen-polls/dismiss-archive")
def dismiss_pre_claim_archive(
    official_id: str,
    db: Session = Depends(get_db),
    me_rep: RepAccount = Depends(get_optional_rep),
):
    """A rep who's just claimed a previously-unclaimed page can hide
    the 'Pre-claim discussion' section from their own page view. The
    polls themselves remain in citizens' dashboards — this only
    affects what the rep sees on their own page."""
    if me_rep is None:
        raise HTTPException(status_code=401, detail="Sign in.")
    if me_rep.official_id != official_id:
        raise HTTPException(status_code=403, detail="Not the owner of this page.")

    archived = list_citizen_polls_for_page(db, official_id, active=False)
    now = datetime.utcnow()
    for poll in archived:
        if poll.dismissed_by_owner_at is None:
            poll.dismissed_by_owner_at = now
    db.commit()
    return {"ok": True, "dismissed": len(archived)}


# ── Citizen dashboard "My polls" tab ──────────────────────────────────
@router.get(
    "/citizens/me/polls",
    response_model=CitizenPollListMineResponse,
)
def list_my_polls(
    status_filter: Literal["active", "archived", "all"] = Query(
        "all", alias="status",
    ),
    db: Session = Depends(get_db),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """Power the dashboard 'My polls' tab. Returns active and archived
    sets so the filter pills can render without an extra round-trip."""
    active_rows = (
        list_citizen_polls_for_citizen(db, citizen.id, active=True)
        if status_filter in ("active", "all") else []
    )
    archived_rows = (
        list_citizen_polls_for_citizen(db, citizen.id, active=False)
        if status_filter in ("archived", "all") else []
    )
    return CitizenPollListMineResponse(
        active=[serialize_citizen_poll(db, p, citizen, None) for p in active_rows],
        archived=[serialize_citizen_poll(db, p, citizen, None) for p in archived_rows],
    )
