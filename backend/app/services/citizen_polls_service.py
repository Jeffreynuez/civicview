# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Citizen-poll service — backing logic for the "Subscribed citizens
post polls on unclaimed rep pages" feature.

Three responsibilities:

  1. Serialize standalone (citizen-authored) polls into the wire
     shape the frontend consumes — including comment/report counts
     and the caller's own report state.

  2. Enforce the rate-limit rules at the model layer:
       • 1 active poll per (citizen, page) at a time.
       • PER_PAGE_ACTIVE_POLL_CAP active polls per page total.
     The first is checked at create-time; the second triggers an
     auto-archive of the oldest active poll on the page.

  3. Trigger archive cascades when a rep claims a previously-
     unclaimed page. Called from the rep-account-creation path
     (currently seed.py; later from a real claim endpoint).

The service is intentionally light — heavier orchestration lives in
the citizen-polls router which composes these helpers with the
existing auth / scope helpers from pages.py.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

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
    CitizenAuthorSummary,
    CitizenPollRead,
    PER_PAGE_ACTIVE_POLL_CAP,
    PollOptionRead,
    PollRead,
    PollScopeBreakdown,
)
from app.services.officials_index import (
    allowed_scopes_for_official,
    lookup as lookup_official_geography,
    scope_labels_for_official,
)


def _vote_matches_scope(vote, scope: str, geo: Optional[dict]) -> bool:
    """Does a vote count under the given scope, given the page's
    geographic context? Mirrors pages.py._engagement_matches_scope but
    drives off a plain dict (the citizen-polls path doesn't have a
    RepAccount to read from)."""
    if scope == "country":
        return True
    if not geo:
        return False
    # Anonymous votes (citizen_id None) only roll up under country.
    if getattr(vote, "citizen_id", 0) is None:
        return False
    if scope == "state":
        return bool(geo.get("state")) and vote.scope_state == geo["state"]
    if scope == "district":
        return bool(geo.get("district")) and vote.scope_district == geo["district"]
    if scope == "city":
        return bool(geo.get("city")) and vote.scope_city == geo["city"]
    return False


# ── Serialization ─────────────────────────────────────────────────────
def _poll_to_simple_read(
    poll: Poll,
    voter_choice_id: Optional[int] = None,
    *,
    active_scope: str = "country",
    allowed_scopes: Optional[List[str]] = None,
    scope_labels: Optional[dict] = None,
    geo: Optional[dict] = None,
) -> PollRead:
    """Serialize a citizen poll into the wire shape PollCard renders.

    Vote counts roll up to the requested `active_scope`. When the
    scope is something other than `country`, votes are filtered to
    only those whose denormalized geography matches the page's
    context (e.g. for a House rep's page in scope='district', only
    votes from citizens in that district count).

    `allowed_scopes` and `scope_labels` are surfaced on the response
    so the frontend can render the scope chip row without re-deriving
    them — the same convention rep polls use on `/api/pages/{id}`.
    """
    allowed_scopes = allowed_scopes or ["country"]
    scope_labels = scope_labels or {"country": "United States"}
    if active_scope not in allowed_scopes:
        active_scope = "country"

    mode = (poll.presentation_mode or "full").lower()
    now = datetime.utcnow()
    poll_is_closed = poll.closes_at is not None and now >= poll.closes_at
    # `reveal_after_close` blacks out counts on the wire until the
    # close tick passes. Citizen polls don't have an "owner" who
    # bypasses this, so suppression is binary.
    suppress_counts = mode == "reveal_after_close" and not poll_is_closed

    # Compute the scope breakdown across all allowed scopes so the
    # UI can show "X in district / Y statewide" simultaneously.
    breakdown = PollScopeBreakdown()
    options_out: List[PollOptionRead] = []
    active_total = 0
    for opt in poll.options:
        votes = opt.votes or []
        if suppress_counts:
            active_count = 0
        else:
            active_count = sum(1 for v in votes if _vote_matches_scope(v, active_scope, geo))
        active_total += active_count
        options_out.append(PollOptionRead(
            id=opt.id, text=opt.text, sort_order=opt.sort_order,
            vote_count=active_count,
        ))
        if suppress_counts:
            continue
        for v in votes:
            breakdown.country_total += 1 if _vote_matches_scope(v, "country", geo) else 0
            if "state" in allowed_scopes:
                breakdown.state_total += 1 if _vote_matches_scope(v, "state", geo) else 0
            if "district" in allowed_scopes:
                breakdown.district_total += 1 if _vote_matches_scope(v, "district", geo) else 0
            if "city" in allowed_scopes:
                breakdown.city_total += 1 if _vote_matches_scope(v, "city", geo) else 0

    return PollRead(
        id=poll.id,
        question=poll.question,
        closes_at=poll.closes_at,
        options=options_out,
        total_votes=active_total,
        voter_choice_id=voter_choice_id,
        default_visibility_scope="country",
        active_scope=active_scope,
        allowed_scopes=allowed_scopes,
        scope_totals=breakdown,
        active_scope_label=scope_labels.get(active_scope),
        presentation_mode=mode,
        counts_suppressed=suppress_counts,
    )


def serialize_citizen_poll(
    db: Session,
    poll: Poll,
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount],
    *,
    me_candidate=None,  # Optional[CandidateAccount] — added Phase 4c
    active_scope: str = "country",
    allowed_scopes: Optional[List[str]] = None,
    scope_labels: Optional[dict] = None,
    geo: Optional[dict] = None,
) -> CitizenPollRead:
    """Compose a CitizenPollRead from a Poll + author lookup +
    counts (comments, reports, the caller's own state).

    Performs at most three small COUNT queries per poll, plus a
    single citizen lookup. List endpoints invoking this in a loop
    eat N+3 round-trips — fine for our cap of 20 polls per page.
    If we ever raise the cap, fold these into a single GROUP BY.
    """
    author = db.get(CitizenAccount, poll.author_citizen_id) if poll.author_citizen_id else None

    # Caller's own vote on the poll, if any. Used to highlight the
    # option they picked in the wire shape. Three identity paths:
    #   • citizen — keyed on citizen_id (the original path).
    #   • rep — keyed on author_rep_id (Phase 2 self-engagement).
    #   • candidate — keyed on author_candidate_id (Phase 4c).
    # Page-owner paths (rep/candidate) checked first so a multi-
    # session browser shows the page-owner's vote, not a stale
    # citizen one.
    voter_choice_id = None
    if me_rep is not None:
        existing_vote = (
            db.query(PollVote)
            .filter(
                PollVote.poll_id == poll.id,
                PollVote.author_rep_id == me_rep.id,
            )
            .first()
        )
        if existing_vote:
            voter_choice_id = existing_vote.option_id
    if voter_choice_id is None and me_candidate is not None:
        existing_vote = (
            db.query(PollVote)
            .filter(
                PollVote.poll_id == poll.id,
                PollVote.author_candidate_id == me_candidate.id,
            )
            .first()
        )
        if existing_vote:
            voter_choice_id = existing_vote.option_id
    if voter_choice_id is None and me_citizen is not None:
        existing_vote = (
            db.query(PollVote)
            .filter(
                PollVote.poll_id == poll.id,
                PollVote.citizen_id == me_citizen.id,
            )
            .first()
        )
        if existing_vote:
            voter_choice_id = existing_vote.option_id

    # Live comment count — the model relationship loads soft-deleted
    # rows too, so filter at query time.
    comment_count = (
        db.query(func.count(PollComment.id))
        .filter(
            PollComment.poll_id == poll.id,
            PollComment.deleted_at.is_(None),
        )
        .scalar()
    ) or 0

    # Has the caller already reported this poll? Affects whether the
    # UI shows "Report" or "Reported".
    my_report_filed = False
    if me_citizen is not None:
        my_report_filed = bool(
            db.query(PollReport.id)
            .filter(
                PollReport.poll_id == poll.id,
                PollReport.reporter_citizen_id == me_citizen.id,
            )
            .first()
        )
    elif me_rep is not None:
        my_report_filed = bool(
            db.query(PollReport.id)
            .filter(
                PollReport.poll_id == poll.id,
                PollReport.reporter_rep_id == me_rep.id,
            )
            .first()
        )

    # Author can close their own poll; nobody else can.
    can_close = (
        me_citizen is not None
        and poll.author_citizen_id == me_citizen.id
        and poll.archived_at is None
    )

    author_payload = (
        CitizenAuthorSummary(
            id=author.id,
            display_name=author.display_name,
            state=author.state,
            city=author.city,
            congressional_district=author.congressional_district,
            verified=author.verified,
        )
        if author is not None
        else CitizenAuthorSummary(id=0, display_name="(deleted citizen)")
    )

    return CitizenPollRead(
        id=poll.id,
        target_official_id=poll.target_official_id or "",
        author=author_payload,
        poll=_poll_to_simple_read(
            poll,
            voter_choice_id=voter_choice_id,
            active_scope=active_scope,
            allowed_scopes=allowed_scopes,
            scope_labels=scope_labels,
            geo=geo,
        ),
        created_at=poll.created_at or datetime.utcnow(),
        archived_at=poll.archived_at,
        archived_reason=poll.archived_reason,
        comment_count=comment_count,
        report_count=poll.report_count or 0,
        my_report_filed=my_report_filed,
        can_close=can_close,
    )


# ── Querying ──────────────────────────────────────────────────────────
def list_citizen_polls_for_page(
    db: Session,
    target_official_id: str,
    *,
    active: bool = True,
) -> List[Poll]:
    """All citizen-authored polls on this rep's page, newest first.
    `active=True` (the default) returns the visible feed; False
    returns archived polls (for the rep's "Pre-claim discussion"
    section)."""
    q = (
        db.query(Poll)
        .options(selectinload(Poll.options).selectinload(PollOption.votes))
        .filter(
            Poll.author_kind == "citizen",
            Poll.target_official_id == target_official_id,
        )
    )
    if active:
        q = q.filter(Poll.archived_at.is_(None))
    else:
        q = q.filter(Poll.archived_at.is_not(None))
    return q.order_by(Poll.created_at.desc()).all()


def list_citizen_polls_for_citizen(
    db: Session,
    citizen_id: int,
    *,
    active: bool = True,
) -> List[Poll]:
    """All polls authored by this citizen, for their dashboard."""
    q = (
        db.query(Poll)
        .options(selectinload(Poll.options).selectinload(PollOption.votes))
        .filter(
            Poll.author_kind == "citizen",
            Poll.author_citizen_id == citizen_id,
        )
    )
    if active:
        q = q.filter(Poll.archived_at.is_(None))
    else:
        q = q.filter(Poll.archived_at.is_not(None))
    return q.order_by(Poll.created_at.desc()).all()


def citizen_has_active_poll_on_page(
    db: Session,
    citizen_id: int,
    target_official_id: str,
) -> bool:
    """Rate-limit check: 1 active poll per (citizen, page) at a time."""
    return bool(
        db.query(Poll.id)
        .filter(
            Poll.author_kind == "citizen",
            Poll.author_citizen_id == citizen_id,
            Poll.target_official_id == target_official_id,
            Poll.archived_at.is_(None),
        )
        .first()
    )


def active_poll_count_for_page(db: Session, target_official_id: str) -> int:
    """How many active citizen polls live on this page right now.
    Used both for the cap check and surfaced to the client so the
    UI can disable the create-poll button before the round-trip."""
    return (
        db.query(func.count(Poll.id))
        .filter(
            Poll.author_kind == "citizen",
            Poll.target_official_id == target_official_id,
            Poll.archived_at.is_(None),
        )
        .scalar()
    ) or 0


def citizen_active_rep_page_poll_count(db: Session, citizen_id: int) -> int:
    """Aggregate count of a citizen's active citizen-authored polls
    across every rep page they've ever posted on. Used by the new
    aggregate quota (TOTAL_REP_PAGE_POLL_CAP_PER_CITIZEN) — the
    per-page cap of 1 is still checked separately."""
    return (
        db.query(func.count(Poll.id))
        .filter(
            Poll.author_kind == "citizen",
            Poll.author_citizen_id == citizen_id,
            Poll.target_official_id.is_not(None),
            Poll.archived_at.is_(None),
        )
        .scalar()
    ) or 0


def citizen_active_standalone_poll_count(db: Session, citizen_id: int) -> int:
    """Count of the citizen's currently-active standalone polls (no
    target_official_id, author_kind='citizen'). Standalone polls
    live on /polls instead of a rep page. Cap is STANDALONE_POLL_
    CAP_PER_CITIZEN — currently 1 — so this returning > 0 is the
    block signal for a new standalone create."""
    return (
        db.query(func.count(Poll.id))
        .filter(
            Poll.author_kind == "citizen",
            Poll.author_citizen_id == citizen_id,
            Poll.target_official_id.is_(None),
            Poll.archived_at.is_(None),
        )
        .scalar()
    ) or 0


# ── Mutations ─────────────────────────────────────────────────────────
def archive_poll(
    db: Session,
    poll: Poll,
    *,
    reason: str,
    commit: bool = True,
) -> Poll:
    """Soft-archive a citizen poll. Reason is one of POLL_ARCHIVE_REASONS;
    the router validates that. Idempotent — re-calling on an already-
    archived poll updates the timestamp + reason."""
    poll.archived_at = datetime.utcnow()
    poll.archived_reason = reason
    if commit:
        db.commit()
        db.refresh(poll)
    return poll


def maybe_supersede_oldest_active_poll(
    db: Session,
    target_official_id: str,
) -> Optional[Poll]:
    """Enforce the per-page active cap. If the page is already at
    PER_PAGE_ACTIVE_POLL_CAP, archive the oldest active poll with
    reason='superseded'. Caller commits.

    Returns the poll that was superseded, or None if no eviction
    was needed.
    """
    active = list_citizen_polls_for_page(db, target_official_id, active=True)
    if len(active) < PER_PAGE_ACTIVE_POLL_CAP:
        return None
    oldest = min(active, key=lambda p: p.created_at or datetime.utcnow())
    archive_poll(db, oldest, reason="superseded", commit=False)
    return oldest


def archive_polls_for_claim(
    db: Session,
    target_official_id: str,
) -> int:
    """Archive every active citizen poll on a page that just got
    claimed by a rep. Called from the rep-account-creation pathway
    (seed + future claim endpoint).

    Returns the number of polls archived. Safe to call on a page
    with no citizen polls — returns 0.

    Run inside the caller's transaction; we don't commit so the
    rep-account-create + archive-cascade both land atomically.
    """
    active = list_citizen_polls_for_page(db, target_official_id, active=True)
    for poll in active:
        archive_poll(db, poll, reason="rep_claimed", commit=False)
    return len(active)
