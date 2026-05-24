# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_current_citizen, get_optional_citizen
from app.db import get_db
from pydantic import BaseModel, Field
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    Poll,
    PollComment,
    PollCommentReaction,
    PollCommentReport,
    PollOption,
    PollReaction,
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
    ReactionRequest,
    ReactionSummary,
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
    bg_tasks: BackgroundTasks,
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

    # Aggregate cap across ALL rep pages. The per-page cap of 1 above
    # plus this 20-across-all-pages ceiling means a single citizen
    # can't carpet 30 pages with simultaneous polls.
    from app.schemas.pages import TOTAL_REP_PAGE_POLL_CAP_PER_CITIZEN
    from app.services.citizen_polls_service import citizen_active_rep_page_poll_count
    if citizen_active_rep_page_poll_count(db, citizen.id) >= TOTAL_REP_PAGE_POLL_CAP_PER_CITIZEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"You already have {TOTAL_REP_PAGE_POLL_CAP_PER_CITIZEN} active polls "
                "across rep pages — the per-citizen ceiling. Close some before "
                "starting more."
            ),
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

    # Kick off AI classification in the background — same pattern as
    # comment classification. No-op if AI isn't configured.
    from app.services.poll_classifier import classify_poll
    bg_tasks.add_task(classify_poll, poll.id)

    return serialize_citizen_poll(db, poll, citizen, None)


# ── Standalone citizen poll (no target rep page) ─────────────────────
@router.post(
    "/citizen-polls",
    response_model=CitizenPollRead,
    status_code=status.HTTP_201_CREATED,
)
def create_standalone_poll(
    payload: CitizenPollCreate,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """Create a citizen poll that isn't tied to any specific rep page.

    Powers the 'Start a poll' affordance on /polls — useful for
    federal-policy questions, cross-jurisdictional issues, or any
    civic topic that spans all reps. The poll appears in the global
    /polls feed tagged 'Standalone' instead of carrying a rep-page
    tag.

    Per-citizen cap of 1 (STANDALONE_POLL_CAP_PER_CITIZEN). Tight
    because standalone polls compete for attention in the global
    feed and we don't want a single citizen dominating the surface.
    Once their standalone poll closes / archives, they can post
    another.

    The 20-rep-page-poll-total cap is INDEPENDENT of this — a
    citizen can have 1 standalone AND up to 20 rep-page polls
    active simultaneously.

    TODO (Phase 2 / ID.me): add a `verified=True` AND
    `subscribed=True` gate. Today every active CitizenAccount can
    create (gated by get_current_citizen which already filters out
    suspended accounts). Demo accounts have access by design.
    """
    from app.schemas.pages import STANDALONE_POLL_CAP_PER_CITIZEN
    from app.services.citizen_polls_service import (
        citizen_active_standalone_poll_count,
    )
    if citizen_active_standalone_poll_count(db, citizen.id) >= STANDALONE_POLL_CAP_PER_CITIZEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "You already have an active standalone poll. Close it "
                "before starting another."
            ),
        )

    poll_payload = payload.poll
    presentation = (poll_payload.presentation_mode or "full").lower()
    if presentation not in PRESENTATION_MODES:
        presentation = "full"
    if presentation == "reveal_after_close" and poll_payload.closes_at is None:
        presentation = "full"

    poll = Poll(
        post_id=None,
        question=poll_payload.question,
        closes_at=poll_payload.closes_at,
        default_visibility_scope="country",  # standalone polls have no rep geography
        presentation_mode=presentation,
        author_kind="citizen",
        author_citizen_id=citizen.id,
        target_official_id=None,  # ← what makes this standalone
        created_at=datetime.utcnow(),
    )
    db.add(poll)
    db.flush()

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

    # Classification kicks off in the background — same as per-page
    # poll creation. The /polls feed picks up the tags once they land.
    from app.services.poll_classifier import classify_poll
    bg_tasks.add_task(classify_poll, poll.id)

    return serialize_citizen_poll(db, poll, citizen, None)


# ── Vote / close / report on a citizen poll ───────────────────────────
@router.post("/citizen-polls/{poll_id}/vote", response_model=CitizenPollRead)
def vote_on_citizen_poll(
    poll_id: int,
    payload: PollVoteRequest,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Cast (or switch) a vote on a citizen poll. Phase 2 + 4c self-
    engagement: accepts a citizen session OR the rep / candidate
    that owns the target page (so a newly-claimed page's owner can
    engage with the pre-claim citizen polls on their page).

    Mirrors the rep-poll voting endpoint: lookup by author identity,
    switch the option on existing rows, never spawn duplicates.
    Citizen self-vote on their own citizen poll is permitted — the
    backend has no author guard. The frontend renders an 'Author'
    badge so the engagement stays transparent.
    """
    poll = _get_poll_or_404(db, poll_id)
    if poll.archived_at is not None:
        raise HTTPException(status_code=400, detail="This poll has been archived.")
    if poll.closes_at is not None and datetime.utcnow() >= poll.closes_at:
        raise HTTPException(status_code=400, detail="This poll is closed.")

    option = db.get(PollOption, payload.option_id)
    if not option or option.poll_id != poll.id:
        raise HTTPException(status_code=400, detail="Invalid option for this poll")

    # Phase 6 multi-identity: honor the IdentityPicker's explicit
    # choice for the ACT, but DON'T overwrite the originals — the
    # response serializer below needs every signed-in identity so
    # voter_choices reports all of them, not just the acting one.
    acting_citizen, acting_rep, acting_candidate = me_citizen, me_rep, me_candidate
    if payload.as_identity == "citizen":
        acting_rep = acting_candidate = None
    elif payload.as_identity == "rep":
        acting_citizen = acting_candidate = None
    elif payload.as_identity == "candidate":
        acting_citizen = acting_rep = None

    # Identity resolution — any signed-in identity can vote on a
    # citizen poll. The previous rep-on-own-page / candidate-on-own-
    # page rule made sense in the rep-page dashboard context but not
    # on the /polls grassroots feed where reps + candidates engage
    # across the whole surface. The IdentityPicker's `as_identity`
    # explicitly chooses which identity acts when multiple are signed
    # in; without it, rep → candidate → citizen precedence applies.
    # Mirrors react_to_citizen_poll (PR #7).
    rep = candidate = citizen = None
    if acting_rep is not None:
        rep = acting_rep
    elif acting_candidate is not None:
        candidate = acting_candidate
    elif acting_citizen is not None:
        citizen = acting_citizen
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to vote on this poll.",
        )

    q = db.query(PollVote).filter(PollVote.poll_id == poll.id)
    if rep is not None:
        q = q.filter(PollVote.author_rep_id == rep.id)
    elif candidate is not None:
        q = q.filter(PollVote.author_candidate_id == candidate.id)
    else:
        q = q.filter(PollVote.citizen_id == citizen.id)
    existing = q.first()

    if existing:
        existing.option_id = option.id
        if citizen is not None:
            existing.scope_state = citizen.state
            existing.scope_district = citizen.congressional_district
            existing.scope_city = citizen.city
            existing.scope_county = citizen.county
    else:
        db.add(PollVote(
            poll_id=poll.id,
            option_id=option.id,
            voter_token=None,
            citizen_id=citizen.id if citizen is not None else None,
            author_rep_id=rep.id if rep is not None else None,
            author_candidate_id=candidate.id if candidate is not None else None,
            scope_state=citizen.state if citizen is not None else None,
            scope_district=citizen.congressional_district if citizen is not None else None,
            scope_city=citizen.city if citizen is not None else None,
            scope_county=citizen.county if citizen is not None else None,
        ))

    db.commit()
    db.refresh(poll)
    for opt in poll.options:
        db.refresh(opt)

    # Phase 6: pass the ORIGINAL identities so voter_choices reports
    # every signed-in identity's vote state, not just the one that
    # fired this click. citizen / rep / candidate above are the
    # acting tuple; me_* are the originals from the request deps.
    return serialize_citizen_poll(
        db, poll, me_citizen, me_rep, me_candidate=me_candidate,
    )


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
    bg_tasks: BackgroundTasks,
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
    # record_report() increments report_count AND auto-archives if
    # the threshold is crossed (Poll uses archived_at + reason=
    # 'reported' for its hide path rather than deleted_at).
    from app.services.moderation import record_report
    record_report(db, poll, kind="poll")
    db.commit()

    # Notify admins. Context page differs by author kind: citizen-
    # authored polls live on target_official_id; rep-authored polls
    # live on the post's official_id.
    if poll.author_kind == "citizen":
        ctx_official = poll.target_official_id
    else:
        from app.models.pages import Post as _Post
        parent_post = db.get(_Post, poll.post_id) if poll.post_id else None
        ctx_official = parent_post.official_id if parent_post else None
    reporter_name = (
        citizen.display_name if citizen is not None
        else (me_rep.display_name if me_rep is not None else "(unknown)")
    )
    from app.services.notifications import notify_new_report
    bg_tasks.add_task(
        notify_new_report,
        kind="poll",
        target_id=poll.id,
        reason=payload.reason,
        detail=payload.detail,
        reporter_name=reporter_name,
        target_preview=(poll.question or "")[:200],
        context_official_id=ctx_official,
    )
    return PollReportStatus(ok=True, already_reported=False)


# ── Comments on a citizen poll ────────────────────────────────────────
@router.get(
    "/citizen-polls/{poll_id}/comments",
    response_model=List[PollCommentRead],
)
def list_citizen_poll_comments(
    poll_id: int,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Public list — no auth needed for reads, but the response is
    identity-aware: when the caller is signed in, each comment
    surfaces their per-identity reaction state (up_count, down_count,
    my_reaction, my_reactions) so the CommentsThread IdentityPicker
    can stamp ✓ Liked / ✓ Disliked correctly.
    Soft-deleted rows are filtered out at the SQL layer.
    """
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

    # Batch-load per-comment reactions in one query keyed by the
    # comment ids in this page (caps at 200 per the limit above).
    comment_ids = [c.id for c in rows]
    rxns_by_comment: dict = {}
    if comment_ids:
        for r in (
            db.query(PollCommentReaction)
            .filter(PollCommentReaction.poll_comment_id.in_(comment_ids))
            .all()
        ):
            rxns_by_comment.setdefault(int(r.poll_comment_id), []).append(r)

    def _serialize(c: PollComment) -> PollCommentRead:
        rxns = rxns_by_comment.get(int(c.id), [])
        up = down = 0
        mine: Optional[str] = None
        per_identity: dict = {}
        if me_citizen is not None:
            per_identity["citizen"] = None
        if me_rep is not None:
            per_identity["rep"] = None
        if me_candidate is not None:
            per_identity["candidate"] = None
        for r in rxns:
            if r.kind == "up":
                up += 1
            elif r.kind == "down":
                down += 1
            if me_citizen is not None and r.citizen_id == me_citizen.id:
                mine = r.kind
                per_identity["citizen"] = r.kind
            if me_rep is not None and r.author_rep_id == me_rep.id:
                mine = r.kind
                per_identity["rep"] = r.kind
            if me_candidate is not None and r.author_candidate_id == me_candidate.id:
                mine = r.kind
                per_identity["candidate"] = r.kind
        if c.author_rep_id is not None:
            author_kind = "rep"
        elif c.author_candidate_id is not None:
            author_kind = "candidate"
        else:
            author_kind = "citizen"
        return PollCommentRead(
            id=c.id,
            poll_id=c.poll_id,
            parent_comment_id=c.parent_comment_id,
            citizen_id=c.citizen_id,
            author_rep_id=c.author_rep_id,
            author_candidate_id=c.author_candidate_id,
            author_kind=author_kind,
            citizen_display_name=c.citizen_display_name,
            body=c.body,
            created_at=c.created_at,
            scope_state=c.scope_state,
            scope_district=c.scope_district,
            scope_city=c.scope_city,
            up_count=up,
            down_count=down,
            my_reaction=mine,
            my_reactions=per_identity,
            ai_sentiment=c.ai_sentiment,
            ai_tones=c.ai_tones,
            ai_intensity=c.ai_intensity,
            ai_topic=c.ai_topic,
            ai_classified_at=c.ai_classified_at,
        )

    return [_serialize(c) for c in rows]


@router.post(
    "/citizen-polls/{poll_id}/comments",
    response_model=PollCommentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_citizen_poll_comment(
    poll_id: int,
    payload: PollCommentCreate,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Create a top-level comment or a reply on a citizen poll.

    Phase 2 + 4c self-engagement: accepts a citizen session OR the
    rep / candidate that owns the target page (so a newly-claimed
    page's owner can chime in on the pre-claim citizen-poll thread).

    Phase 3 reply threading: when payload.parent_comment_id is set,
    enforces the two-party rule — only the poll's creator (the
    original citizen author, or the page-owning rep/candidate on
    archived citizen polls) and the parent top-level comment's
    author may reply. Replies-to-replies are rejected (400).

    Comments allowed on both active and archived polls — the
    archived 'Pre-claim discussion' surface stays read+write so
    the conversation can continue once the rep/candidate arrives.
    """
    poll = (
        db.query(Poll)
        .filter(Poll.id == poll_id, Poll.author_kind == "citizen")
        .first()
    )
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")

    # Phase 6 multi-identity: honor the explicit as_identity choice
    # for the ACT, but keep the originals intact for response shape.
    # PollComment response only carries the author identity, not
    # multi-identity state, so the practical impact here is smaller
    # than for vote endpoints — but the pattern is consistent with
    # the rest of Phase 6.
    acting_citizen, acting_rep, acting_candidate = me_citizen, me_rep, me_candidate
    if payload.as_identity == "citizen":
        acting_rep = acting_candidate = None
    elif payload.as_identity == "rep":
        acting_citizen = acting_candidate = None
    elif payload.as_identity == "candidate":
        acting_citizen = acting_rep = None

    # Identity resolution — same triple-priority as the citizen-poll
    # vote endpoint above. Citizen poll knows its
    # target_official_id; rep / candidate wins only if they own
    # that page.
    rep = candidate = citizen = None
    if acting_rep is not None and acting_rep.official_id == poll.target_official_id:
        rep = acting_rep
    elif acting_candidate is not None and acting_candidate.candidate_id == poll.target_official_id:
        candidate = acting_candidate
    elif acting_citizen is not None:
        citizen = acting_citizen
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to comment on this poll.",
        )

    # Reply-path validation (Phase 3). The "post creator" for a
    # citizen poll is the original citizen author; the page-owning
    # rep OR candidate also counts as a creator-equivalent voice
    # on their own page (parity with rep/candidate posts).
    parent_id = payload.parent_comment_id
    if parent_id is not None:
        parent = db.get(PollComment, parent_id)
        if parent is None or parent.deleted_at is not None or parent.poll_id != poll.id:
            raise HTTPException(
                status_code=404,
                detail="Parent comment not found on this poll.",
            )
        if parent.parent_comment_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Replies can only target top-level comments, not other replies.",
            )
        # Two-party rule:
        #   (a) the citizen author of the poll itself
        #   (b) the page-owning rep OR candidate
        #   (c) the parent top-level comment's original author
        is_poll_creator = (
            citizen is not None
            and poll.author_citizen_id is not None
            and citizen.id == poll.author_citizen_id
        )
        is_page_owner = (rep is not None) or (candidate is not None)
        is_parent_author = (
            (citizen is not None
                and parent.citizen_id is not None
                and parent.citizen_id == citizen.id)
            or (rep is not None
                and parent.author_rep_id is not None
                and parent.author_rep_id == rep.id)
            or (candidate is not None
                and getattr(parent, "author_candidate_id", None) is not None
                and parent.author_candidate_id == candidate.id)
        )
        if not (is_poll_creator or is_page_owner or is_parent_author):
            raise HTTPException(
                status_code=403,
                detail=(
                    "Only the poll's creator and the original commenter "
                    "can reply in this thread."
                ),
            )

    if rep is not None:
        display_name = rep.display_name
    elif candidate is not None:
        display_name = candidate.display_name
    else:
        display_name = citizen.display_name
    comment = PollComment(
        poll_id=poll.id,
        parent_comment_id=parent_id,
        citizen_id=citizen.id if citizen is not None else None,
        author_rep_id=rep.id if rep is not None else None,
        author_candidate_id=candidate.id if candidate is not None else None,
        citizen_display_name=display_name,
        body=payload.body,
        scope_state=citizen.state if citizen is not None else None,
        scope_district=citizen.congressional_district if citizen is not None else None,
        scope_city=citizen.city if citizen is not None else None,
        scope_county=citizen.county if citizen is not None else None,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    # AI classification fires after commit — same pattern as
    # create_comment on a rep post. No-op if AI isn't configured.
    from app.services.comment_classifier import classify_poll_comment
    bg_tasks.add_task(classify_poll_comment, comment.id)
    # Hand-build the response so author_kind reflects the triple-
    # identity shape; model_validate alone wouldn't set the
    # discriminator on a fresh row.
    if comment.author_rep_id is not None:
        author_kind = "rep"
    elif getattr(comment, "author_candidate_id", None) is not None:
        author_kind = "candidate"
    else:
        author_kind = "citizen"
    return PollCommentRead(
        id=comment.id,
        poll_id=comment.poll_id,
        parent_comment_id=comment.parent_comment_id,
        citizen_id=comment.citizen_id,
        author_rep_id=comment.author_rep_id,
        author_candidate_id=getattr(comment, "author_candidate_id", None),
        author_kind=author_kind,
        citizen_display_name=comment.citizen_display_name,
        body=comment.body,
        created_at=comment.created_at,
        scope_state=comment.scope_state,
        scope_district=comment.scope_district,
        scope_city=comment.scope_city,
    )


# ── Poll-comment delete + report (parity with rep-post comments) ─────
@router.delete(
    "/citizen-polls/comments/{comment_id}",
    status_code=204,
)
def delete_poll_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Soft-delete a poll comment. Author-only — matches the
    PostComment rule. Page owners (once a rep/candidate claims the
    page) use Report instead; admins act on aggregated reports.

    Phase 2 + 4c self-engagement: 'author' now covers citizen, rep,
    OR candidate — whichever identity authored the comment may
    delete it.
    """
    comment = db.get(PollComment, comment_id)
    if not comment or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")
    is_author_citizen = (
        me_citizen is not None
        and comment.citizen_id is not None
        and comment.citizen_id == me_citizen.id
    )
    is_author_rep = (
        me_rep is not None
        and getattr(comment, "author_rep_id", None) is not None
        and comment.author_rep_id == me_rep.id
    )
    is_author_candidate = (
        me_candidate is not None
        and getattr(comment, "author_candidate_id", None) is not None
        and comment.author_candidate_id == me_candidate.id
    )
    if not (is_author_citizen or is_author_rep or is_author_candidate):
        raise HTTPException(
            status_code=403,
            detail="Only the comment author may delete it. Use Report instead.",
        )
    comment.deleted_at = datetime.utcnow()
    db.commit()
    return


class _PollCommentReportPayload(BaseModel):
    reason: str = Field(..., min_length=1, max_length=64)
    detail: Optional[str] = Field(default=None, max_length=1000)


class _PollCommentReportStatus(BaseModel):
    ok: bool = True
    already_reported: bool = False


@router.post(
    "/citizen-polls/comments/{comment_id}/reports",
    response_model=_PollCommentReportStatus,
)
def report_poll_comment(
    comment_id: int,
    payload: _PollCommentReportPayload,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> _PollCommentReportStatus:
    """Mirror of /api/pages/comments/{id}/reports for poll comments.
    Sign-in required (401 anon), self-report disallowed (400),
    duplicates idempotent (returns already_reported=true).
    """
    if me is None and me_citizen is None:
        raise HTTPException(status_code=401, detail="Sign in to report content.")
    comment = db.get(PollComment, comment_id)
    if not comment or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")
    if me_citizen is not None and comment.citizen_id == me_citizen.id:
        raise HTTPException(
            status_code=400,
            detail="You can't report your own comment. Delete it if you regret it.",
        )

    q = db.query(PollCommentReport).filter(PollCommentReport.poll_comment_id == comment.id)
    if me_citizen is not None:
        q = q.filter(PollCommentReport.reporter_citizen_id == me_citizen.id)
    else:
        q = q.filter(PollCommentReport.reporter_rep_id == me.id)
    if q.first() is not None:
        return _PollCommentReportStatus(ok=True, already_reported=True)

    db.add(
        PollCommentReport(
            poll_comment_id=comment.id,
            reporter_citizen_id=me_citizen.id if me_citizen is not None else None,
            reporter_rep_id=me.id if me is not None else None,
            reason=payload.reason.strip(),
            detail=(payload.detail or "").strip() or None,
        )
    )
    from app.services.moderation import record_report
    record_report(db, comment, kind="poll_comment")
    db.commit()

    # Resolve the hosting page via the parent poll (citizen → target_
    # official_id; rep → post.official_id) so the email's "view in
    # context" link lands on the right rep page.
    parent_poll = db.get(Poll, comment.poll_id) if comment.poll_id else None
    ctx_official: Optional[str] = None
    if parent_poll is not None:
        if parent_poll.author_kind == "citizen":
            ctx_official = parent_poll.target_official_id
        elif parent_poll.post_id:
            from app.models.pages import Post as _Post
            parent_post = db.get(_Post, parent_poll.post_id)
            if parent_post is not None:
                ctx_official = parent_post.official_id
    reporter_name = (
        me_citizen.display_name if me_citizen is not None
        else (me.display_name if me is not None else "(unknown)")
    )
    from app.services.notifications import notify_new_report
    bg_tasks.add_task(
        notify_new_report,
        kind="poll_comment",
        target_id=comment.id,
        reason=payload.reason.strip(),
        detail=(payload.detail or "").strip() or None,
        reporter_name=reporter_name,
        target_preview=(comment.body or "")[:200],
        context_official_id=ctx_official,
    )
    return _PollCommentReportStatus(ok=True, already_reported=False)


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


# ── Reactions on citizen polls (Phase 6 — parity with PostReaction) ──
def _reaction_summary_for_citizen_poll(
    poll: Poll,
    db: Session,
    me_citizen: Optional[CitizenAccount] = None,
    me_rep: Optional[RepAccount] = None,
    me_candidate: Optional[CandidateAccount] = None,
) -> ReactionSummary:
    """Aggregate a citizen poll's reactions into the same shape
    PostCard / FeedCard consume on the post side. Mirrors
    _reaction_summary_for_post in pages.py exactly, swapping
    PostReaction for PollReaction.

    Per-identity slots are populated only for identities the caller is
    signed in to — this powers the IdentityPicker's ✓ markers
    ("✓ Liked" / "✓ Disliked").
    """
    per_identity: dict = {}
    if me_citizen is not None:
        per_identity["citizen"] = None
    if me_rep is not None:
        per_identity["rep"] = None
    if me_candidate is not None:
        per_identity["candidate"] = None

    rows = (
        db.query(PollReaction)
        .filter(PollReaction.poll_id == poll.id)
        .all()
    )
    up = down = 0
    mine: Optional[str] = None
    for r in rows:
        if me_citizen is not None and r.citizen_id == me_citizen.id:
            mine = r.kind
            per_identity["citizen"] = r.kind
        if me_rep is not None and r.author_rep_id == me_rep.id:
            mine = r.kind
            per_identity["rep"] = r.kind
        if me_candidate is not None and r.author_candidate_id == me_candidate.id:
            mine = r.kind
            per_identity["candidate"] = r.kind
        if r.kind == "up":
            up += 1
        elif r.kind == "down":
            down += 1
    return ReactionSummary(
        up_count=up, down_count=down,
        my_reaction=mine, my_reactions=per_identity,
    )


def _apply_as_identity_filter_poll(
    *,
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount],
    me_candidate: Optional[CandidateAccount],
    as_identity: Optional[str],
):
    """Mirror pages.py's _apply_as_identity_filter — narrow which
    identity ACTS based on the picker's explicit choice. Returns
    (acting_citizen, acting_rep, acting_candidate). When as_identity
    is None, returns all three so the existing precedence applies.
    Returns all-None when the caller asked to act as an identity
    they aren't signed in to (route raises 401 below).
    """
    if not as_identity:
        return me_citizen, me_rep, me_candidate
    if as_identity == "citizen" and me_citizen is not None:
        return me_citizen, None, None
    if as_identity == "rep" and me_rep is not None:
        return None, me_rep, None
    if as_identity == "candidate" and me_candidate is not None:
        return None, None, me_candidate
    return None, None, None


@router.post(
    "/citizen-polls/{poll_id}/reactions",
    response_model=ReactionSummary,
    summary="Add / flip / remove a reaction on a citizen poll",
)
def react_to_citizen_poll(
    poll_id: int,
    payload: ReactionRequest,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Create, flip, or toggle-off the caller's reaction on a citizen
    poll (page-tied or standalone). Three behaviors mirror PostReaction:

      • First call with kind='up'   → insert 'up'.
      • kind='down' while 'up' active → flip to 'down'.
      • kind='up' while 'up' active   → remove (toggle off).
    """
    poll = db.query(Poll).filter(Poll.id == poll_id).first()
    if poll is None or poll.author_kind != "citizen":
        raise HTTPException(status_code=404, detail="Poll not found")

    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter_poll(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=payload.as_identity,
    )

    # Engagement requires SOME signed-in identity. Unlike rep posts
    # (where the rep-on-own-page path narrows further), every signed-
    # in viewer can react to a citizen poll on /polls — the surface
    # is the public grassroots feed.
    if acting_citizen is None and acting_rep is None and acting_candidate is None:
        raise HTTPException(status_code=401, detail="Sign in to react")

    # Dedupe lookup keyed on the acting identity — matches the same
    # (poll, identity) unique indexes defined on PollReaction.
    q = db.query(PollReaction).filter(PollReaction.poll_id == poll.id)
    if acting_rep is not None:
        q = q.filter(PollReaction.author_rep_id == acting_rep.id)
    elif acting_candidate is not None:
        q = q.filter(PollReaction.author_candidate_id == acting_candidate.id)
    else:
        q = q.filter(PollReaction.citizen_id == acting_citizen.id)
    existing = q.first()

    if existing:
        if existing.kind == payload.kind:
            db.delete(existing)
        else:
            existing.kind = payload.kind
            if acting_citizen is not None:
                existing.scope_state = acting_citizen.state
                existing.scope_district = acting_citizen.congressional_district
                existing.scope_city = acting_citizen.city
                existing.scope_county = acting_citizen.county
    else:
        db.add(PollReaction(
            poll_id=poll.id,
            citizen_id=acting_citizen.id if acting_citizen is not None else None,
            author_rep_id=acting_rep.id if acting_rep is not None else None,
            author_candidate_id=acting_candidate.id if acting_candidate is not None else None,
            kind=payload.kind,
            scope_state=acting_citizen.state if acting_citizen is not None else None,
            scope_district=acting_citizen.congressional_district if acting_citizen is not None else None,
            scope_city=acting_citizen.city if acting_citizen is not None else None,
            scope_county=acting_citizen.county if acting_citizen is not None else None,
        ))

    db.commit()
    db.refresh(poll)
    # Return summary keyed off the ORIGINAL identities so my_reactions
    # populates every slot the caller is signed in to (matches the
    # rep-side react_to_post contract).
    return _reaction_summary_for_citizen_poll(
        poll, db,
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )


@router.delete(
    "/citizen-polls/{poll_id}/reactions",
    response_model=ReactionSummary,
    summary="Clear the caller's reaction on a citizen poll",
)
def clear_citizen_poll_reaction(
    poll_id: int,
    as_identity: Optional[str] = None,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Clear the caller's reaction. `as_identity` query param narrows
    to the picker's exact chosen identity (mirrors the post-side
    clear_reaction)."""
    poll = db.query(Poll).filter(Poll.id == poll_id).first()
    if poll is None or poll.author_kind != "citizen":
        raise HTTPException(status_code=404, detail="Poll not found")

    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter_poll(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=as_identity,
    )
    if acting_citizen is None and acting_rep is None and acting_candidate is None:
        raise HTTPException(status_code=401, detail="Sign in to react")

    q = db.query(PollReaction).filter(PollReaction.poll_id == poll.id)
    if acting_rep is not None:
        q = q.filter(PollReaction.author_rep_id == acting_rep.id)
    elif acting_candidate is not None:
        q = q.filter(PollReaction.author_candidate_id == acting_candidate.id)
    else:
        q = q.filter(PollReaction.citizen_id == acting_citizen.id)
    existing = q.first()
    if existing:
        db.delete(existing)
        db.commit()
        db.refresh(poll)
    return _reaction_summary_for_citizen_poll(
        poll, db,
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )


# ── Reactions on PollComments (parity with /api/pages/comments/.../reactions) ─
def _reaction_summary_for_poll_comment(
    poll_comment: PollComment,
    db: Session,
    me_citizen: Optional[CitizenAccount] = None,
    me_rep: Optional[RepAccount] = None,
    me_candidate: Optional[CandidateAccount] = None,
) -> ReactionSummary:
    """Aggregate a poll-comment's reactions into the ReactionSummary
    shape CommentsThread + FeedCard consume. Mirrors
    _reaction_summary_for_post but reads from PollCommentReaction.
    Per-identity slots only populate for identities the caller is
    signed in to.
    """
    per_identity: dict = {}
    if me_citizen is not None:
        per_identity["citizen"] = None
    if me_rep is not None:
        per_identity["rep"] = None
    if me_candidate is not None:
        per_identity["candidate"] = None

    rows = (
        db.query(PollCommentReaction)
        .filter(PollCommentReaction.poll_comment_id == poll_comment.id)
        .all()
    )
    up = down = 0
    mine: Optional[str] = None
    for r in rows:
        if me_citizen is not None and r.citizen_id == me_citizen.id:
            mine = r.kind
            per_identity["citizen"] = r.kind
        if me_rep is not None and r.author_rep_id == me_rep.id:
            mine = r.kind
            per_identity["rep"] = r.kind
        if me_candidate is not None and r.author_candidate_id == me_candidate.id:
            mine = r.kind
            per_identity["candidate"] = r.kind
        if r.kind == "up":
            up += 1
        elif r.kind == "down":
            down += 1
    return ReactionSummary(
        up_count=up, down_count=down,
        my_reaction=mine, my_reactions=per_identity,
    )


@router.post(
    "/citizen-polls/comments/{comment_id}/reactions",
    response_model=ReactionSummary,
    summary="Add / flip / remove a reaction on a citizen-poll comment",
)
def react_to_poll_comment(
    comment_id: int,
    payload: ReactionRequest,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Create, flip, or toggle-off the caller's reaction on a poll
    comment. Mirrors react_to_comment in pages.py; semantics:

      • First call with kind='up'    → insert 'up'.
      • kind='down' while 'up' active → flip to 'down'.
      • kind='up'   while 'up' active → remove (toggle off).
    """
    comment = db.get(PollComment, comment_id)
    if comment is None or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")

    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter_poll(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=payload.as_identity,
    )
    if acting_citizen is None and acting_rep is None and acting_candidate is None:
        raise HTTPException(status_code=401, detail="Sign in to react")

    q = db.query(PollCommentReaction).filter(
        PollCommentReaction.poll_comment_id == comment.id
    )
    if acting_rep is not None:
        q = q.filter(PollCommentReaction.author_rep_id == acting_rep.id)
    elif acting_candidate is not None:
        q = q.filter(PollCommentReaction.author_candidate_id == acting_candidate.id)
    else:
        q = q.filter(PollCommentReaction.citizen_id == acting_citizen.id)
    existing = q.first()

    if existing:
        if existing.kind == payload.kind:
            db.delete(existing)
        else:
            existing.kind = payload.kind
            if acting_citizen is not None:
                existing.scope_state = acting_citizen.state
                existing.scope_district = acting_citizen.congressional_district
                existing.scope_city = acting_citizen.city
                existing.scope_county = acting_citizen.county
    else:
        db.add(PollCommentReaction(
            poll_comment_id=comment.id,
            citizen_id=acting_citizen.id if acting_citizen is not None else None,
            author_rep_id=acting_rep.id if acting_rep is not None else None,
            author_candidate_id=acting_candidate.id if acting_candidate is not None else None,
            kind=payload.kind,
            scope_state=acting_citizen.state if acting_citizen is not None else None,
            scope_district=acting_citizen.congressional_district if acting_citizen is not None else None,
            scope_city=acting_citizen.city if acting_citizen is not None else None,
            scope_county=acting_citizen.county if acting_citizen is not None else None,
        ))

    db.commit()
    db.refresh(comment)
    return _reaction_summary_for_poll_comment(
        comment, db,
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )


@router.delete(
    "/citizen-polls/comments/{comment_id}/reactions",
    response_model=ReactionSummary,
    summary="Clear the caller's reaction on a citizen-poll comment",
)
def clear_poll_comment_reaction(
    comment_id: int,
    as_identity: Optional[str] = None,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Clear the caller's reaction. `as_identity` query param narrows
    to the picker's exact chosen identity."""
    comment = db.get(PollComment, comment_id)
    if comment is None or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")

    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter_poll(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=as_identity,
    )
    if acting_citizen is None and acting_rep is None and acting_candidate is None:
        raise HTTPException(status_code=401, detail="Sign in to react")

    q = db.query(PollCommentReaction).filter(
        PollCommentReaction.poll_comment_id == comment.id
    )
    if acting_rep is not None:
        q = q.filter(PollCommentReaction.author_rep_id == acting_rep.id)
    elif acting_candidate is not None:
        q = q.filter(PollCommentReaction.author_candidate_id == acting_candidate.id)
    else:
        q = q.filter(PollCommentReaction.citizen_id == acting_citizen.id)
    existing = q.first()
    if existing:
        db.delete(existing)
        db.commit()
        db.refresh(comment)
    return _reaction_summary_for_poll_comment(
        comment, db,
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )
