# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Pages router — the social-network layer for reps and candidates.

Public (no auth):
  GET    /api/pages/{official_id}                    → page payload
                                                       (posts + upcoming events + claim status)
  POST   /api/pages/{official_id}/polls/{poll_id}/vote
                                                     → record an anonymous vote
                                                       (voter_token enforces one vote per browser)

Authenticated (session cookie):
  POST   /api/pages/{official_id}/posts              → create post (author must own the page)
  DELETE /api/pages/posts/{post_id}                  → soft-delete post
  POST   /api/pages/{official_id}/events             → create rep event
  DELETE /api/pages/events/{event_id}                → soft-delete rep event

Ownership rule: a RepAccount's `official_id` scopes every write. You
cannot post to someone else's page even if you're logged in — the
router checks `rep.official_id == path official_id` before mutating.
"""
from __future__ import annotations

from datetime import datetime
import logging
from typing import List, Optional

import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.auth import get_current_rep, get_optional_rep
from app.auth_citizen import get_current_citizen, get_optional_citizen
from app.auth_candidate import get_optional_candidate
from app.db import get_db
from pydantic import BaseModel, Field
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    CommentReaction,
    CommentReport,
    Poll,
    PollOption,
    PollVote,
    Post,
    PostComment,
    PostImage,
    PostReaction,
    PostReport,
    RepAccount,
    RepEvent,
)
from app.schemas.pages import (
    COMMENT_FILTERS,
    COMMENT_SORTS,
    SCOPE_VALUES,
    AuthorSummary,
    CommentCreate,
    CommentRead,
    DashboardCommenter,
    DashboardPostSummary,
    DashboardReactions,
    DashboardSummary,
    PageDashboardResponse,
    PageOwnerInfo,
    PageResponse,
    PollCreate,
    PollOptionRead,
    PollRead,
    PollScopeBreakdown,
    PollVoteRequest,
    PostCreate,
    PostImageRead,
    PostRead,
    ReactionRequest,
    ReactionSummary,
    RepEventCreate,
    RepEventRead,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────
def _allowed_scopes_for_owner(owner: Optional[RepAccount]) -> List[str]:
    """Which geographic scopes does this page owner's office support?

    Country is always an option. State/district/city each require the
    owner to have the corresponding attribute. For a U.S. House rep
    we return [country, state, district]. For a senator or governor we
    return [country, state]. For a mayor we'd return [country, state,
    city] once owner_city is populated.
    """
    scopes = ["country"]
    if owner is None:
        return scopes
    if owner.owner_state:
        scopes.append("state")
    if owner.owner_district:
        scopes.append("district")
    if owner.owner_city:
        scopes.append("city")
    return scopes


def _scope_label(scope: str, owner: Optional[RepAccount]) -> Optional[str]:
    """Human-friendly label describing what a scope resolves to.
    Used by the UI to render "Showing: FL-19 · 4 votes"."""
    if owner is None:
        return None
    if scope == "country":
        return "United States"
    if scope == "state":
        return owner.owner_state
    if scope == "district":
        return owner.owner_district
    if scope == "city":
        return owner.owner_city
    return None


# Phase 6 multi-identity: when the IdentityPicker UI sends an
# explicit as_identity (e.g. user is signed in as both citizen and
# rep, clicked Like, picked Pat Back), force _resolve_engager to
# treat the other identities as not-signed-in. Returns the
# narrowed (citizen, rep, candidate) tuple. If as_identity is
# 'citizen' but no citizen session is present (etc.), we leave
# the original sessions intact — _resolve_engager will 401 or
# 403 with a clearer message than we'd produce here.
def _apply_as_identity_filter(
    *,
    me_citizen,
    me_rep,
    me_candidate,
    as_identity: Optional[str],
):
    if not as_identity:
        return me_citizen, me_rep, me_candidate
    if as_identity == "citizen" and me_citizen is not None:
        return me_citizen, None, None
    if as_identity == "rep" and me_rep is not None:
        return None, me_rep, None
    if as_identity == "candidate" and me_candidate is not None:
        return None, None, me_candidate
    # Asked to act as an identity the caller isn't signed in to —
    # return all-None so _resolve_engager raises 401 with the
    # standard "sign in to engage" message.
    return None, None, None


# Phase 2/4c self-engagement: each engagement endpoint accepts either
# a citizen OR the rep / candidate who owns the target page. This
# helper centralises the "which identity is acting?" decision so
# every endpoint resolves it the same way.
def _resolve_engager(
    *,
    me_citizen: Optional["CitizenAccount"],
    me_rep: Optional["RepAccount"],
    page_official_id: str,
    me_candidate: Optional["CandidateAccount"] = None,
) -> tuple[Optional["CitizenAccount"], Optional["RepAccount"], Optional["CandidateAccount"]]:
    """Return a (citizen, rep, candidate) tuple with exactly one side
    populated.

    Decision order:
      1. REP signed in AND owns this page → engage as rep (Phase 2).
      2. CANDIDATE signed in AND owns this page → engage as candidate
         (Phase 4c — page-owner parity with reps).
      3. CITIZEN session → engage as citizen (the original path).
      4. None of the above → 401.

    Edge case — multiple sessions present in the same browser: the
    rep/candidate path wins only when they own the THIS page. A rep
    or candidate visiting a different page falls through to the
    citizen check. This keeps the engagement model "one identity
    per page", not "page-owners can engage anywhere they have an
    account."

    Backward compat: callers that don't pass me_candidate get the
    original two-identity behaviour (the candidate slot stays None).
    """
    if me_rep is not None and me_rep.official_id == page_official_id:
        return (None, me_rep, None)
    if me_candidate is not None and me_candidate.candidate_id == page_official_id:
        return (None, None, me_candidate)
    if me_citizen is not None:
        return (me_citizen, None, None)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sign in to engage with this content.",
    )


# Phase 4a: page-management endpoints (create_post, delete_post,
# event create/delete) need to recognize either a rep or a candidate
# as the page owner. This helper returns the (rep, candidate) pair —
# exactly one is non-None — or raises 403 when the caller isn't the
# owner of the named page.
def _resolve_page_owner(
    *,
    me_rep: Optional["RepAccount"],
    me_candidate: Optional["CandidateAccount"],
    page_official_id: str,
) -> tuple[Optional["RepAccount"], Optional["CandidateAccount"]]:
    """Return (rep, candidate) with exactly one populated, or 403.

    Rep wins if their RepAccount.official_id matches the page id.
    Candidate wins if their CandidateAccount.candidate_id matches.
    The two id spaces don't overlap, so a single page can only be
    owned by one or the other at any time.

    Used by routes that mutate page-level content (post creation,
    deletion, event management). Engagement routes use the
    citizen-friendly _resolve_engager instead.
    """
    if me_rep is not None and me_rep.official_id == page_official_id:
        return (me_rep, None)
    if me_candidate is not None and me_candidate.candidate_id == page_official_id:
        return (None, me_candidate)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You can only manage the page for your own official_id / candidate_id.",
    )


def _engagement_matches_scope(row, scope: str, owner: Optional[RepAccount]) -> bool:
    """Does an engagement row (PollVote / PostReaction / PostComment)
    count under the given scope for this page owner?

    All three models share the same `scope_state / scope_district /
    scope_city` denormalized columns, so one matcher covers all three.
    Reactions and comments always have a citizen_id (they're
    citizen-gated); PollVote can have citizen_id=None for legacy
    anonymous rows, in which case they only count under 'country'.
    """
    if scope == "country":
        return True
    # Only PollVote exposes citizen_id; reactions + comments always
    # carry one. getattr-with-default keeps this helper generic.
    if getattr(row, "citizen_id", 0) is None:
        return False
    if owner is None:
        return False
    if scope == "state":
        return bool(owner.owner_state) and row.scope_state == owner.owner_state
    if scope == "district":
        return bool(owner.owner_district) and row.scope_district == owner.owner_district
    if scope == "city":
        return bool(owner.owner_city) and row.scope_city == owner.owner_city
    return False


# Backward-compat alias for the poll path that used the old name.
_vote_matches_scope = _engagement_matches_scope


def _poll_to_read(
    poll: Poll,
    owner: Optional[RepAccount],
    active_scope: str,
    voter_choice_id: Optional[int] = None,
    is_owner_viewing: bool = False,
    voter_choices: Optional[dict] = None,
) -> PollRead:
    """Serialize a poll with its option counts filtered to `active_scope`
    plus a full-breakdown snapshot so the UI can show "4 in FL-19 / 31
    statewide" side-by-side.

    When the poll's presentation_mode is 'reveal_after_close' and the
    close time hasn't passed yet, we zero out every count in the
    response for non-owner viewers. The author still gets the real
    numbers (they need to know how their own poll is doing); anyone
    else sees a blackout until the close tick. `counts_suppressed` is
    surfaced so the frontend can render a polite placeholder without
    repeating the suppression logic.
    """
    allowed = _allowed_scopes_for_owner(owner)
    # Gracefully degrade — if the poll's author asked for a scope their
    # role doesn't support (shouldn't happen post-create, but defensive)
    # fall back to country.
    if active_scope not in allowed:
        active_scope = "country"

    mode = (poll.presentation_mode or "full").lower()
    now = datetime.utcnow()
    poll_is_closed = poll.closes_at is not None and now >= poll.closes_at
    suppress_counts = (
        mode == "reveal_after_close"
        and not poll_is_closed
        and not is_owner_viewing
    )

    # Full breakdown across all scopes — always useful to the owner, and
    # cheap since poll option votes are already in memory from the
    # selectinload.
    breakdown = PollScopeBreakdown()
    options_out: List[PollOptionRead] = []
    active_total = 0
    for opt in poll.options:
        votes = opt.votes or []
        if suppress_counts:
            active_count = 0
        else:
            active_count = sum(1 for v in votes if _vote_matches_scope(v, active_scope, owner))
        active_total += active_count
        options_out.append(PollOptionRead(
            id=opt.id, text=opt.text, sort_order=opt.sort_order, vote_count=active_count,
        ))
        if suppress_counts:
            continue  # breakdown stays zeroed
        for v in votes:
            breakdown.country_total += 1 if _vote_matches_scope(v, "country", owner) else 0
            if "state" in allowed:
                breakdown.state_total += 1 if _vote_matches_scope(v, "state", owner) else 0
            if "district" in allowed:
                breakdown.district_total += 1 if _vote_matches_scope(v, "district", owner) else 0
            if "city" in allowed:
                breakdown.city_total += 1 if _vote_matches_scope(v, "city", owner) else 0

    return PollRead(
        id=poll.id,
        question=poll.question,
        closes_at=poll.closes_at,
        options=options_out,
        total_votes=active_total,
        voter_choice_id=voter_choice_id,
        # Phase 6 multi-identity: per-identity vote choices. Empty
        # dict when only one identity is signed in (the IdentityPicker
        # falls back to the legacy voter_choice_id in that case).
        voter_choices=(voter_choices or {}),
        default_visibility_scope=poll.default_visibility_scope or "country",
        active_scope=active_scope,
        allowed_scopes=allowed,
        scope_totals=breakdown,
        active_scope_label=_scope_label(active_scope, owner),
        presentation_mode=mode,
        counts_suppressed=suppress_counts,
    )


def _reaction_summary_for_post(
    post: Post,
    me_citizen: Optional[CitizenAccount],
    engagement_scope: Optional[str] = None,
    owner=None,  # RepAccount | CandidateAccount | None — both expose owner_state etc.
    me_rep: Optional[RepAccount] = None,
    me_candidate: Optional["CandidateAccount"] = None,
) -> ReactionSummary:
    """Aggregate a post's reactions.

    When `engagement_scope` is provided (owner-only at the endpoint
    layer — this helper trusts its caller), the counts are filtered to
    only reactions from citizens whose geography matches. `my_reaction`
    is unaffected by the filter — it's always the caller's own and
    doesn't leak anyone else's identity.

    Rep AND candidate self-reactions count toward the totals too —
    Phase 2 + 4c self-engagement made both page-owner identities
    first-class engagers. When engagement_scope filters to a sub-
    country scope, rep + candidate self-reactions are excluded
    because they have no geography (scope columns NULL) — same
    rule that applies to legacy anonymous PollVotes.
    """
    up = down = 0
    mine: Optional[str] = None
    # Phase 6 multi-identity: track per-identity reaction state so the
    # frontend IdentityPicker can know which identities have / haven't
    # acted. Each slot is only present when the caller is signed in
    # to that identity.
    per_identity: dict = {}
    if me_citizen is not None:
        per_identity["citizen"] = None
    if me_rep is not None:
        per_identity["rep"] = None
    if me_candidate is not None:
        per_identity["candidate"] = None
    filtered = bool(engagement_scope) and engagement_scope != "country"
    for r in (post.reactions or []):
        # Always track the caller's own reactions first — the filter
        # should never mask "my reactions" even if I'm outside the
        # scope the owner is slicing by. Any of the three author
        # kinds can be the caller; each populates its own slot.
        if me_citizen is not None and r.citizen_id == me_citizen.id:
            mine = r.kind
            per_identity["citizen"] = r.kind
        if me_rep is not None and getattr(r, "author_rep_id", None) == me_rep.id:
            mine = r.kind
            per_identity["rep"] = r.kind
        if me_candidate is not None and getattr(r, "author_candidate_id", None) == me_candidate.id:
            mine = r.kind
            per_identity["candidate"] = r.kind
        if filtered and not _engagement_matches_scope(r, engagement_scope, owner):
            continue
        if r.kind == "up":
            up += 1
        elif r.kind == "down":
            down += 1
    return ReactionSummary(
        up_count=up, down_count=down, my_reaction=mine,
        my_reactions=per_identity,
    )


def _post_to_read(
    post: Post,
    owner,  # RepAccount | CandidateAccount | None
    db: Session,
    voter_token: Optional[str] = None,
    me_citizen: Optional[CitizenAccount] = None,
    me_rep: Optional[RepAccount] = None,
    me_candidate: Optional["CandidateAccount"] = None,
    scope_override: Optional[str] = None,
    engagement_scope: Optional[str] = None,
    is_owner_viewing: bool = False,
) -> PostRead:
    poll_read: Optional[PollRead] = None
    if post.poll is not None:
        # Phase 6 multi-identity: compute per-identity vote choices
        # in a single sweep across the eager-loaded options.votes.
        # Each identity the caller is signed in to gets a slot
        # populated with that identity's chosen option_id (or None
        # if they haven't voted). The legacy voter_choice_id stays
        # populated with whichever identity has the highest priority
        # (rep > candidate > citizen) for backward-compat.
        voter_choice_id: Optional[int] = None
        per_identity: dict = {}
        if me_citizen is not None:
            per_identity["citizen"] = None
        if me_rep is not None and (
            isinstance(owner, RepAccount) and me_rep.id == owner.id
        ):
            per_identity["rep"] = None
        if me_candidate is not None and (
            isinstance(owner, CandidateAccount) and me_candidate.id == owner.id
        ):
            per_identity["candidate"] = None

        # Iterate every vote on every option once and bin them into
        # the per-identity slots + the legacy voter_choice_id.
        for opt in (post.poll.options or []):
            for v in (opt.votes or []):
                if me_citizen is not None and v.citizen_id == me_citizen.id:
                    per_identity["citizen"] = v.option_id
                    if voter_choice_id is None:
                        voter_choice_id = v.option_id
                if (
                    "rep" in per_identity
                    and me_rep is not None
                    and getattr(v, "author_rep_id", None) == me_rep.id
                ):
                    per_identity["rep"] = v.option_id
                    voter_choice_id = v.option_id  # rep beats citizen
                if (
                    "candidate" in per_identity
                    and me_candidate is not None
                    and getattr(v, "author_candidate_id", None) == me_candidate.id
                ):
                    per_identity["candidate"] = v.option_id
                    if not (me_rep is not None and "rep" in per_identity):
                        voter_choice_id = v.option_id

        # Anonymous voter_token fallback — only surfaces a vote that
        # was itself anonymous. A prior citizen-attributed vote on
        # this browser must not leak to an unauthenticated viewer.
        if (
            voter_choice_id is None
            and me_citizen is None
            and me_rep is None
            and me_candidate is None
            and voter_token
        ):
            vote = (
                db.query(PollVote)
                .filter(
                    PollVote.poll_id == post.poll.id,
                    PollVote.voter_token == voter_token,
                    PollVote.citizen_id.is_(None),
                    PollVote.author_rep_id.is_(None),
                    PollVote.author_candidate_id.is_(None),
                )
                .first()
            )
            if vote:
                voter_choice_id = vote.option_id

        active_scope = scope_override or (post.poll.default_visibility_scope or "country")
        poll_read = _poll_to_read(
            post.poll, owner=owner, active_scope=active_scope,
            voter_choice_id=voter_choice_id,
            voter_choices=per_identity,
            is_owner_viewing=is_owner_viewing,
        )

    # Comment count — owner-only scope filter. Non-owners always see
    # the country-wide total so public-facing metadata is consistent
    # across viewers.
    comment_count_q = (
        db.query(func.count(PostComment.id))
        .filter(PostComment.post_id == post.id, PostComment.deleted_at.is_(None))
    )
    if engagement_scope and engagement_scope != "country" and owner is not None:
        if engagement_scope == "state" and owner.owner_state:
            comment_count_q = comment_count_q.filter(PostComment.scope_state == owner.owner_state)
        elif engagement_scope == "district" and owner.owner_district:
            comment_count_q = comment_count_q.filter(PostComment.scope_district == owner.owner_district)
        elif engagement_scope == "city" and owner.owner_city:
            comment_count_q = comment_count_q.filter(PostComment.scope_city == owner.owner_city)
    comment_count = comment_count_q.scalar() or 0

    # Serialize attached images. The relationship is loaded
    # lazily here because the page-payload query doesn't join it
    # — that's fine for small galleries (≤5 per post). A future
    # selectinload could batch these if we ever page this.
    images = [
        PostImageRead(
            id=img.id,
            url=f"/api/pages/images/{img.id}",
            content_type=img.content_type,
            sort_order=img.sort_order,
        )
        for img in sorted(post.images or [], key=lambda i: i.sort_order)
    ]

    # Author serialization. Rep-authored posts use the standard
    # AuthorSummary mapping. Candidate-authored posts (Phase 4a) map
    # candidate_id → official_id manually since AuthorSummary's
    # field name is rep-flavoured; candidates have no `role`, so
    # we leave it None.
    if post.author is not None:
        author_summary = AuthorSummary.model_validate(post.author)
    elif getattr(post, "author_candidate", None) is not None:
        author_summary = AuthorSummary(
            id=post.author_candidate.id,
            official_id=post.author_candidate.candidate_id,
            display_name=post.author_candidate.display_name,
            role=None,
        )
    else:
        # Shouldn't happen in practice — every post is authored by
        # one or the other. Fall back to a placeholder so the
        # response shape stays valid rather than 500-ing.
        author_summary = AuthorSummary(
            id=0,
            official_id=post.official_id,
            display_name="(unknown author)",
            role=None,
        )

    return PostRead(
        id=post.id,
        official_id=post.official_id,
        body=post.body,
        created_at=post.created_at,
        author=author_summary,
        poll=poll_read,
        reactions=_reaction_summary_for_post(
            post, me_citizen, engagement_scope=engagement_scope, owner=owner,
            # Light up "my_reaction" for the page owner's own
            # reactions on their own page. Outside their own page
            # this is None so the page-owner visiting someone
            # else's page doesn't see ghost reactions. Phase 4c
            # extends this to candidates too.
            me_rep=(me_rep if is_owner_viewing else None),
            me_candidate=(me_candidate if is_owner_viewing else None),
        ),
        comment_count=int(comment_count),
        images=images,
    )


def _assert_owns_page(rep: RepAccount, official_id: str) -> None:
    if rep.official_id != official_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only manage the page for your own official_id.",
        )


def _load_owner(db: Session, official_id: str) -> Optional[RepAccount]:
    """Look up the page's REP owner. Returns None for candidate-only
    pages (unclaimed-by-rep-but-claimed-by-candidate) and for fully-
    unclaimed pages. Existing call sites that need to distinguish
    rep-owned from candidate-owned should also call _load_candidate_owner.
    """
    return (
        db.query(RepAccount)
        .filter(RepAccount.official_id == official_id)
        .first()
    )


def _load_candidate_owner(db: Session, official_id: str) -> Optional["CandidateAccount"]:
    """Look up the page's CANDIDATE owner. Same string id space as
    _load_owner — candidate ids and rep official_ids don't collide,
    so passing the same value to both is safe. Returns None for
    rep-owned + fully-unclaimed pages.

    Lazy import to keep the helper near _load_owner without
    reshuffling the module-level import block."""
    from app.models.pages import CandidateAccount  # local — see docstring
    return (
        db.query(CandidateAccount)
        .filter(CandidateAccount.candidate_id == official_id)
        .first()
    )


def _load_post_or_404(db: Session, post_id: int) -> Post:
    post = db.get(Post, post_id)
    if not post or post.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


# ── Public: page payload ──────────────────────────────────────────────
@router.get("/{official_id}", response_model=PageResponse)
def get_page(
    official_id: str,
    voter_token: Optional[str] = Query(default=None, max_length=64),
    scope: Optional[str] = Query(
        default=None,
        description="Override each poll's default visibility scope. One of country/state/district/city.",
    ),
    db: Session = Depends(get_db),
    me: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """
    Return everything needed to render a rep/candidate page:
      • claim status + owner summary
      • posts (newest first, soft-deleted excluded) with reaction
        summary, comment count, and scope-filtered poll counts
      • upcoming rep-created events (soft-deleted excluded)

    Query params:
      voter_token — annotate polls with the caller's current anonymous
        vote choice (used when no citizen session is active).
      scope       — override the poll default visibility scope for this
        render. Citizens use this to "show all" instead of the author's
        default.

    is_owner determination (Phase 4a): the page may be rep-owned OR
    candidate-owned. We probe both account types — whichever returns
    a match becomes the owner, and the matching signed-in identity
    flips is_owner=True for that session.
    """
    if scope and scope not in SCOPE_VALUES:
        raise HTTPException(status_code=400, detail=f"Unknown scope '{scope}'")

    owner = _load_owner(db, official_id)
    candidate_owner = _load_candidate_owner(db, official_id) if owner is None else None
    # Resolve "am I the owner viewing my own page?" — rep path first,
    # candidate path second. Only one can ever be true since the id
    # spaces don't overlap.
    is_owner = (
        (owner is not None and me is not None and me.id == owner.id)
        or (candidate_owner is not None and me_candidate is not None and me_candidate.id == candidate_owner.id)
    )

    # Scope controls two different things:
    #   • `scope_override` drives the poll vote counts. This is public
    #     — the poll's author already chose a default_visibility_scope
    #     so non-owners seeing scope=... is just reading the public
    #     view with a different slice.
    #   • `engagement_scope` filters reactions + comment_count. That's
    #     OWNER-ONLY so a random viewer can't peek at per-district
    #     engagement on someone else's page. When a non-owner passes
    #     scope=, engagement_scope stays None and they get full
    #     country-wide counts for reactions + comment_count.
    poll_scope_override = scope
    engagement_scope = scope if is_owner else None

    posts_q = (
        db.query(Post)
        .options(
            selectinload(Post.author),
            # Phase 4a — eager-load the candidate author too so
            # candidate-authored posts don't trigger N+1 queries
            # in the serializer.
            selectinload(Post.author_candidate),
            selectinload(Post.poll).selectinload(Poll.options).selectinload(PollOption.votes),
            selectinload(Post.reactions),
            selectinload(Post.images),
        )
        .filter(
            Post.official_id == official_id,
            Post.deleted_at.is_(None),
        )
        .order_by(Post.created_at.desc())
        .limit(100)
    )
    # Effective owner for scope rollups + AuthorSummary lookups. Both
    # RepAccount and CandidateAccount expose the owner_state /
    # owner_district / owner_city columns _engagement_matches_scope
    # reads, so passing either through works without further
    # branching.
    effective_owner = owner if owner is not None else candidate_owner
    posts = [
        _post_to_read(
            p, owner=effective_owner, db=db, voter_token=voter_token,
            me_citizen=me_citizen,
            # Pass the rep + candidate sessions through so _post_to_read
            # can surface their own poll vote as voter_choice_id +
            # light up "my_reaction" for any reactions they made.
            # Both gated internally on is_owner_viewing so visiting a
            # peer's page doesn't leak ghost reactions.
            me_rep=me if is_owner else None,
            me_candidate=me_candidate if is_owner else None,
            scope_override=poll_scope_override,
            engagement_scope=engagement_scope,
            is_owner_viewing=is_owner,
        )
        for p in posts_q.all()
    ]

    now_iso = datetime.utcnow().isoformat()
    events_q = (
        db.query(RepEvent)
        .filter(
            RepEvent.official_id == official_id,
            RepEvent.deleted_at.is_(None),
            # Lexicographic compare is safe for ISO-8601 strings.
            RepEvent.start_at >= now_iso[:10],  # from today onward
        )
        .order_by(RepEvent.start_at.asc())
        .limit(50)
    )
    upcoming_events = [RepEventRead.model_validate(e) for e in events_q.all()]

    # Scope options for the owner's filter rail. Always include
    # 'country' as the always-available default. The rail itself is
    # hidden to non-owners, but we publish the list alongside the
    # payload so the frontend doesn't have to know about office roles.
    # Both RepAccount and CandidateAccount expose owner_state /
    # owner_district / owner_city so the helpers work on either.
    allowed_scopes = _allowed_scopes_for_owner(effective_owner) if effective_owner else []
    scope_labels = {
        s: _scope_label(s, effective_owner) for s in allowed_scopes
    } if effective_owner else {}

    return PageResponse(
        official_id=official_id,
        # A page is "claimed" when EITHER a rep or a candidate has
        # taken ownership. The frontend uses this to gate the
        # citizen-poll feature (only renders on unclaimed pages).
        claimed=effective_owner is not None,
        # PageOwnerInfo asks for {id, display_name, role}. CandidateAccount
        # has no `role` column, so model_validate falls back to the
        # schema's default of None for that field — same shape, no
        # special-case branching needed here.
        owner=PageOwnerInfo.model_validate(effective_owner) if effective_owner else None,
        is_owner=is_owner,
        posts=posts,
        upcoming_events=upcoming_events,
        allowed_engagement_scopes=allowed_scopes,
        engagement_scope_labels=scope_labels,
    )


# ── Authenticated: posts ──────────────────────────────────────────────
@router.post("/{official_id}/posts", response_model=PostRead, status_code=201)
def create_post(
    official_id: str,
    payload: PostCreate,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional["CandidateAccount"] = Depends(get_optional_candidate),
):
    """Create a post on the named page. Phase 4a: accepts either a
    rep or a candidate session — whichever owns the page (matched by
    official_id for reps, candidate_id for candidates). Writes
    author_id for rep-authored posts, author_candidate_id for
    candidate-authored ones; exactly one is set.
    """
    rep, candidate = _resolve_page_owner(
        me_rep=me_rep, me_candidate=me_candidate, page_official_id=official_id,
    )

    post = Post(
        author_id=rep.id if rep is not None else None,
        author_candidate_id=candidate.id if candidate is not None else None,
        official_id=official_id,
        body=payload.body.strip(),
    )
    db.add(post)
    db.flush()  # populate post.id for the poll FK

    attached_poll_id: Optional[int] = None
    if payload.poll is not None:
        # _attach_poll's scope-validation reads owner.owner_state /
        # owner_district / owner_city — both RepAccount and
        # CandidateAccount expose those columns, so passing either
        # works. The poll itself doesn't track its author's identity
        # kind; that's carried by the parent post.
        attached_poll_id = _attach_poll(
            db, post, payload.poll,
            owner=(rep if rep is not None else candidate),
        )

    # Claim uploaded images by post_id. We fetch all requested rows in
    # one query, then iterate the client's id list to preserve gallery
    # order. Validation per image:
    #   • Must exist (id lookup fails → 400).
    #   • Must belong to the SAME page owner posting (other owner's
    #     image → 403). Rep posts match on uploader_id; candidate
    #     posts match on uploader_candidate_id (Phase 4d).
    #   • Must still be an orphan (post_id IS NULL); reattaching is
    #     a bug in the client and we refuse rather than silently move
    #     an image across posts.
    if payload.image_ids:
        fetched = db.query(PostImage).filter(PostImage.id.in_(payload.image_ids)).all()
        by_id = {img.id: img for img in fetched}
        for idx, img_id in enumerate(payload.image_ids):
            img = by_id.get(img_id)
            if img is None:
                raise HTTPException(400, f"Image {img_id} not found.")
            # Ownership check — gated on whichever identity is
            # authoring the post.
            owns_image = (
                (rep is not None and img.uploader_id == rep.id)
                or (candidate is not None
                    and getattr(img, "uploader_candidate_id", None) == candidate.id)
            )
            if not owns_image:
                raise HTTPException(403, f"Image {img_id} was not uploaded by you.")
            if img.post_id is not None:
                raise HTTPException(400, f"Image {img_id} is already attached to another post.")
            img.post_id = post.id
            img.sort_order = idx

    db.commit()
    # Reload with joined edges so _post_to_read has author+poll+options.
    db.refresh(post)
    if post.poll:
        db.refresh(post.poll)

    # Kick off AI classification for the attached poll (if any) so
    # the /polls feed picks up sentiment/tones/topic tags. Background
    # task fires after the request returns — no latency hit for the
    # rep posting. No-op when AI isn't configured server-side.
    if attached_poll_id is not None:
        from app.services.poll_classifier import classify_poll
        bg_tasks.add_task(classify_poll, attached_poll_id)

    return _post_to_read(
        post,
        owner=(rep if rep is not None else candidate),
        db=db, is_owner_viewing=True,
    )


def _attach_poll(db: Session, post: Post, payload: PollCreate, owner: RepAccount) -> Optional[int]:
    # Validate the requested default scope is one this office actually
    # supports. A senator can't demand a "district" default because they
    # don't have one; we silently clamp to 'country' rather than 400 so
    # a frontend bug doesn't brick post creation.
    allowed = _allowed_scopes_for_owner(owner)
    scope = (payload.default_visibility_scope or "country").strip().lower()
    if scope not in allowed:
        scope = "country"

    # Validate / clamp presentation mode. 'reveal_after_close' only
    # makes sense with a close time — without one the results would
    # never be revealed, so we silently demote to 'full'.
    from app.schemas.pages import PRESENTATION_MODES
    mode = (payload.presentation_mode or "full").strip().lower()
    if mode not in PRESENTATION_MODES:
        mode = "full"
    if mode == "reveal_after_close" and payload.closes_at is None:
        mode = "full"

    poll = Poll(
        post_id=post.id,
        question=payload.question.strip(),
        closes_at=payload.closes_at,
        default_visibility_scope=scope,
        presentation_mode=mode,
    )
    db.add(poll)
    db.flush()
    for idx, opt in enumerate(payload.options):
        db.add(PollOption(
            poll_id=poll.id,
            text=opt.text.strip(),
            sort_order=idx,
        ))
    return poll.id


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Soft-delete a post. The author may delete their own —
    'author' covers both rep-authored (author_id) and candidate-
    authored (author_candidate_id) posts. Anyone else gets 403.
    """
    post = db.get(Post, post_id)
    if not post or post.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Post not found")

    is_rep_author = (
        me_rep is not None
        and post.author_id is not None
        and post.author_id == me_rep.id
    )
    is_candidate_author = (
        me_candidate is not None
        and getattr(post, "author_candidate_id", None) is not None
        and post.author_candidate_id == me_candidate.id
    )
    if not (is_rep_author or is_candidate_author):
        raise HTTPException(status_code=403, detail="You can only delete your own posts")

    post.deleted_at = datetime.utcnow()
    db.commit()
    return


# ── Public: poll voting ───────────────────────────────────────────────
@router.post("/{official_id}/polls/{poll_id}/vote", response_model=PollRead)
def vote_on_poll(
    official_id: str,
    poll_id: int,
    payload: PollVoteRequest,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """
    Record (or switch) a vote on this poll.

    Phase 2 self-engagement: accepts either a citizen session or the
    rep session that owns this page. Rep self-votes count toward
    totals identically to citizen votes, but have no geography so
    they only appear under scope='country' in the dashboard
    rollups. See _resolve_engager for the identity decision tree.

    Citizen path (unchanged from Phase 1): we look up the caller's
    existing vote by citizen_id only; the legacy voter_token field
    is ignored on writes so two citizens sharing a browser no longer
    collide on one row. If the caller previously voted anonymously
    on this same browser, we adopt that row into their citizen
    account so they don't lose their vote.
    """
    poll = (
        db.query(Poll)
        .options(selectinload(Poll.options).selectinload(PollOption.votes))
        .filter(Poll.id == poll_id)
        .first()
    )
    if not poll:
        raise HTTPException(status_code=404, detail="Poll not found")

    post = db.get(Post, poll.post_id)
    if not post or post.official_id != official_id or post.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Poll not found on this page")

    if poll.closes_at is not None and datetime.utcnow() >= poll.closes_at:
        raise HTTPException(status_code=400, detail="This poll is closed")

    option = db.get(PollOption, payload.option_id)
    if not option or option.poll_id != poll.id:
        raise HTTPException(status_code=400, detail="Invalid option for this poll")

    # Phase 6 multi-identity: honor the IdentityPicker's explicit
    # choice when sent. Narrows the candidate identities before
    # _resolve_engager picks one.
    # Phase 6 fix — narrow which identity ACTS based on the picker's
    # explicit choice, but DON'T overwrite the originals. The summary
    # helpers below need ALL signed-in identities so my_reactions /
    # voter_choices populate every slot the caller is signed in to,
    # not just the one that fired this particular click.
    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=payload.as_identity,
    )
    citizen, rep, candidate = _resolve_engager(
        me_citizen=acting_citizen, me_rep=acting_rep, me_candidate=acting_candidate,
        page_official_id=official_id,
    )

    # Authoritative lookup keyed on whichever identity is acting.
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
            # Refresh geography — cheap and covers the case where a
            # citizen updates their address after voting. Clear the
            # legacy voter_token so the browser slot is free for
            # other citizens to vote on the same poll from the same
            # browser.
            existing.scope_state = citizen.state
            existing.scope_district = citizen.congressional_district
            existing.scope_city = citizen.city
            existing.scope_county = citizen.county
            existing.voter_token = None
    else:
        # Adopt a pre-existing anonymous vote from this browser, if any —
        # citizen path only. Reps + candidates never have an anonymous-
        # vote row to adopt since their self-voting only exists once
        # they're signed in as the page owner.
        adopted = None
        if citizen is not None and payload.voter_token:
            adopted = (
                db.query(PollVote)
                .filter(
                    PollVote.poll_id == poll.id,
                    PollVote.voter_token == payload.voter_token,
                    PollVote.citizen_id.is_(None),
                    PollVote.author_rep_id.is_(None),
                    PollVote.author_candidate_id.is_(None),
                )
                .first()
            )

        if adopted:
            adopted.option_id = option.id
            adopted.citizen_id = citizen.id
            adopted.voter_token = None  # free the browser slot
            adopted.scope_state = citizen.state
            adopted.scope_district = citizen.congressional_district
            adopted.scope_city = citizen.city
            adopted.scope_county = citizen.county
        else:
            db.add(PollVote(
                poll_id=poll.id,
                option_id=option.id,
                voter_token=None,  # signed-in votes aren't keyed by browser
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

    owner = _load_owner(db, official_id)
    # Phase 6 — build per-identity voter_choices across ALL signed-in
    # identities (not just the one that fired this vote) so the
    # frontend's picker can render ✓ markers on every identity that
    # has voted. Same single-sweep pattern as _post_to_read.
    per_identity_votes: dict = {}
    if me_citizen is not None:
        per_identity_votes["citizen"] = None
    if me_rep is not None:
        per_identity_votes["rep"] = None
    if me_candidate is not None:
        per_identity_votes["candidate"] = None
    for opt in (poll.options or []):
        for v in (opt.votes or []):
            if me_citizen is not None and v.citizen_id == me_citizen.id:
                per_identity_votes["citizen"] = v.option_id
            if me_rep is not None and getattr(v, "author_rep_id", None) == me_rep.id:
                per_identity_votes["rep"] = v.option_id
            if me_candidate is not None and getattr(v, "author_candidate_id", None) == me_candidate.id:
                per_identity_votes["candidate"] = v.option_id

    return _poll_to_read(
        poll, owner=owner,
        active_scope=(poll.default_visibility_scope or "country"),
        voter_choice_id=option.id,
        voter_choices=per_identity_votes,
    )


# ── Authenticated: reactions ──────────────────────────────────────────
@router.post("/posts/{post_id}/reactions", response_model=ReactionSummary)
def react_to_post(
    post_id: int,
    payload: ReactionRequest,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Create, flip, or remove the caller's reaction on a post.

    Accepts citizen / rep-on-own-page / candidate-on-own-page sessions
    (Phase 2 + 4c self-engagement). See _resolve_engager for the full
    decision tree.

    Semantics:
      • First time with kind=up → add 'up' reaction.
      • Send kind=down while 'up' is active → flip to 'down'.
      • Send kind=up while 'up' is active → remove (toggle off).
    """
    post = _load_post_or_404(db, post_id)
    # Phase 6 multi-identity: narrow by as_identity when sent.
    # Phase 6 fix — narrow which identity ACTS based on the picker's
    # explicit choice, but DON'T overwrite the originals. The summary
    # helpers below need ALL signed-in identities so my_reactions /
    # voter_choices populate every slot the caller is signed in to,
    # not just the one that fired this particular click.
    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=payload.as_identity,
    )
    citizen, rep, candidate = _resolve_engager(
        me_citizen=acting_citizen, me_rep=acting_rep, me_candidate=acting_candidate,
        page_official_id=post.official_id,
    )

    # Dedupe lookup keyed on whichever identity is acting. The three
    # parallel unique indexes (uq_post_reaction_citizen/_rep/_candidate)
    # enforce one-row-per-identity-per-post; this query mirrors that
    # key so we update the existing row instead of inserting a duplicate.
    q = db.query(PostReaction).filter(PostReaction.post_id == post.id)
    if rep is not None:
        q = q.filter(PostReaction.author_rep_id == rep.id)
    elif candidate is not None:
        q = q.filter(PostReaction.author_candidate_id == candidate.id)
    else:
        q = q.filter(PostReaction.citizen_id == citizen.id)
    existing = q.first()

    if existing:
        if existing.kind == payload.kind:
            db.delete(existing)
        else:
            existing.kind = payload.kind
            # Refresh geography in case the citizen's address changed.
            # Rep + candidate engagement has no geography — scope
            # columns stay NULL and the row only counts under
            # scope='country' in dashboard rollups.
            if citizen is not None:
                existing.scope_state = citizen.state
                existing.scope_district = citizen.congressional_district
                existing.scope_city = citizen.city
                existing.scope_county = citizen.county
    else:
        db.add(PostReaction(
            post_id=post.id,
            citizen_id=citizen.id if citizen is not None else None,
            author_rep_id=rep.id if rep is not None else None,
            author_candidate_id=candidate.id if candidate is not None else None,
            kind=payload.kind,
            scope_state=citizen.state if citizen is not None else None,
            scope_district=citizen.congressional_district if citizen is not None else None,
            scope_city=citizen.city if citizen is not None else None,
            scope_county=citizen.county if citizen is not None else None,
        ))

    db.commit()
    # Reload + recompute summary for response.
    db.refresh(post)
    return _reaction_summary_for_post(
        # Phase 6: pass ORIGINAL identities so my_reactions reports
        # every signed-in identity's state, not just the one that
        # fired this click. citizen/rep/candidate above are the
        # acting tuple; me_* are the originals carried in from the
        # request dependencies.
        post, me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )


@router.delete("/posts/{post_id}/reactions", response_model=ReactionSummary)
def clear_reaction(
    post_id: int,
    as_identity: Optional[str] = None,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    post = _load_post_or_404(db, post_id)
    # Phase 6 multi-identity: narrow by `as_identity` query param when
    # sent so the IdentityPicker's toggle-off clears the EXACT identity
    # the user picked, not whichever one _resolve_engager picks first
    # (which was citizen-wins precedence and silently cleared the
    # wrong row when multiple identities were signed in).
    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=as_identity,
    )
    citizen, rep, candidate = _resolve_engager(
        me_citizen=acting_citizen, me_rep=acting_rep, me_candidate=acting_candidate,
        page_official_id=post.official_id,
    )
    q = db.query(PostReaction).filter(PostReaction.post_id == post.id)
    if rep is not None:
        q = q.filter(PostReaction.author_rep_id == rep.id)
    elif candidate is not None:
        q = q.filter(PostReaction.author_candidate_id == candidate.id)
    else:
        q = q.filter(PostReaction.citizen_id == citizen.id)
    existing = q.first()
    if existing:
        db.delete(existing)
        db.commit()
        db.refresh(post)
    return _reaction_summary_for_post(
        # Phase 6: pass ORIGINAL identities so my_reactions reports
        # every signed-in identity's state, not just the one that
        # fired this click. citizen/rep/candidate above are the
        # acting tuple; me_* are the originals carried in from the
        # request dependencies.
        post, me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )


# ── Comments ──────────────────────────────────────────────────────────
def _comment_to_read(
    c: PostComment,
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount] = None,
    me_candidate: Optional[CandidateAccount] = None,
) -> CommentRead:
    """Serialize a comment with its reaction summary.

    `my_reaction` is the caller's own reaction (or None) — never leaks
    anyone else's identity. Any of the three author kinds can be the
    caller; whichever matches lights up my_reaction. Reactions come
    from the eager-loaded relationship so there's no extra query per
    row.

    author_kind discriminates citizen-authored vs rep-authored vs
    candidate-authored
    comments (Phase 2 self-engagement). The frontend uses it to
    render an 'Author' badge on rep comments and to gate the
    Phase 3 reply-thread two-party rule.
    """
    up = down = 0
    mine: Optional[str] = None
    # Phase 6 multi-identity: per-identity reaction tracking. Slots
    # populated only for identities the caller is signed in to so the
    # frontend IdentityPicker can stamp ✓ Liked / ✓ Disliked per
    # identity on the comment-row picker.
    per_identity: dict = {}
    if me_citizen is not None:
        per_identity["citizen"] = None
    if me_rep is not None:
        per_identity["rep"] = None
    if me_candidate is not None:
        per_identity["candidate"] = None
    for r in (c.reactions or []):
        if r.kind == "up":
            up += 1
        elif r.kind == "down":
            down += 1
        if me_citizen is not None and r.citizen_id == me_citizen.id:
            mine = r.kind
            per_identity["citizen"] = r.kind
        if me_rep is not None and getattr(r, "author_rep_id", None) == me_rep.id:
            mine = r.kind
            per_identity["rep"] = r.kind
        if me_candidate is not None and getattr(r, "author_candidate_id", None) == me_candidate.id:
            mine = r.kind
            per_identity["candidate"] = r.kind
    rep_id = getattr(c, "author_rep_id", None)
    candidate_id = getattr(c, "author_candidate_id", None)
    if rep_id is not None:
        author_kind = "rep"
    elif candidate_id is not None:
        author_kind = "candidate"
    else:
        author_kind = "citizen"
    return CommentRead(
        id=c.id,
        post_id=c.post_id,
        # Phase 3 reply threading — exposed so the frontend can
        # group replies under their top-level parents and render
        # the conversation pool.
        parent_comment_id=getattr(c, "parent_comment_id", None),
        citizen_id=c.citizen_id,
        author_rep_id=rep_id,
        author_candidate_id=candidate_id,
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
    )


@router.get("/posts/{post_id}/comments", response_model=List[CommentRead])
def list_comments(
    post_id: int,
    scope: Optional[str] = Query(
        default=None,
        description="Filter to a scope (country/state/district/city). Requires the caller to be the page owner.",
    ),
    sort: str = Query(
        default="latest",
        description="Sort order — one of: " + ", ".join(COMMENT_SORTS),
    ),
    filter_by: Optional[str] = Query(
        default=None, alias="filter_by",
        description="Citizen-only filters — 'my_district' or 'my_state'. Anonymous callers fall through to an unfiltered list.",
    ),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    me: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Return comments on a post.

    Layered filters/sort:
      • `scope` — owner-only; narrows by geography (state/district/city).
      • `filter_by` — citizen-only; pins to the caller's own district
        or state. Anonymous callers passing this get the unfiltered
        list rather than a 400 — the UI hides those options for them
        anyway, but being lenient here keeps the endpoint easy to
        exercise from a shared demo browser.
      • `sort` — public; any caller can pick how to order.

    Soft-deleted comments are omitted but retained for moderation.
    """
    if sort not in COMMENT_SORTS:
        raise HTTPException(status_code=400, detail=f"Unknown sort '{sort}'")
    if filter_by is not None and filter_by not in COMMENT_FILTERS:
        raise HTTPException(status_code=400, detail=f"Unknown filter_by '{filter_by}'")

    post = _load_post_or_404(db, post_id)

    q = (
        db.query(PostComment)
        .options(selectinload(PostComment.reactions))
        .filter(PostComment.post_id == post.id, PostComment.deleted_at.is_(None))
    )

    # Owner-only scope filter (unchanged semantics).
    if scope:
        if scope not in SCOPE_VALUES:
            raise HTTPException(status_code=400, detail=f"Unknown scope '{scope}'")
        owner = _load_owner(db, post.official_id)
        if owner is None or me is None or me.id != owner.id:
            raise HTTPException(
                status_code=403,
                detail="Scope filtering is restricted to the page owner.",
            )
        if scope == "state" and owner.owner_state:
            q = q.filter(PostComment.scope_state == owner.owner_state)
        elif scope == "district" and owner.owner_district:
            q = q.filter(PostComment.scope_district == owner.owner_district)
        elif scope == "city" and owner.owner_city:
            q = q.filter(PostComment.scope_city == owner.owner_city)

    # Citizen-only geography filter.
    if filter_by and me_citizen is not None:
        if filter_by == "my_district" and me_citizen.congressional_district:
            q = q.filter(PostComment.scope_district == me_citizen.congressional_district)
        elif filter_by == "my_state" and me_citizen.state:
            q = q.filter(PostComment.scope_state == me_citizen.state)

    # SQL-side ordering for latest/oldest. Most-liked / most-disliked
    # are computed in Python since we need aggregate counts over the
    # reactions relationship.
    #
    # `id` is always the tiebreaker. SQLite's CURRENT_TIMESTAMP has
    # second-level resolution, so two comments posted in the same
    # second share a created_at and the sort would otherwise return
    # them in an undefined order (any ORM's stable sort falls back to
    # insertion order). Using monotonically-increasing id as a
    # secondary key makes latest/oldest deterministic even under that
    # collision.
    if sort == "latest":
        q = q.order_by(PostComment.created_at.desc(), PostComment.id.desc())
    elif sort == "oldest":
        q = q.order_by(PostComment.created_at.asc(), PostComment.id.asc())

    rows = q.limit(limit).all()

    if sort == "most_liked":
        rows.sort(
            key=lambda c: (
                sum(1 for r in (c.reactions or []) if r.kind == "up"),
                c.id,   # tiebreak by id — newer rows first under ties
            ),
            reverse=True,
        )
    elif sort == "most_disliked":
        rows.sort(
            key=lambda c: (
                sum(1 for r in (c.reactions or []) if r.kind == "down"),
                c.id,
            ),
            reverse=True,
        )

    return [
        _comment_to_read(c, me_citizen, me_rep=me, me_candidate=me_candidate)
        for c in rows
    ]


# Reactions on a comment. Schema identical to the post reactions
# endpoints — same toggle/flip semantics, same citizen gate.
def _comment_reaction_summary(
    comment: PostComment,
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount] = None,
    me_candidate: Optional["CandidateAccount"] = None,
) -> dict:
    """Roll a comment's reactions into the per-row summary.

    Same triple-identity treatment as _reaction_summary_for_post: rep
    AND candidate self-reactions count toward up/down totals, and any
    of the three identities on the caller side can light up
    `my_reaction`.
    """
    up = down = 0
    mine: Optional[str] = None
    # Phase 6 multi-identity: per-identity reaction tracking. Same
    # pattern as _reaction_summary_for_post above.
    per_identity: dict = {}
    if me_citizen is not None:
        per_identity["citizen"] = None
    if me_rep is not None:
        per_identity["rep"] = None
    if me_candidate is not None:
        per_identity["candidate"] = None
    for r in (comment.reactions or []):
        if r.kind == "up":
            up += 1
        elif r.kind == "down":
            down += 1
        if me_citizen is not None and r.citizen_id == me_citizen.id:
            mine = r.kind
            per_identity["citizen"] = r.kind
        if me_rep is not None and getattr(r, "author_rep_id", None) == me_rep.id:
            mine = r.kind
            per_identity["rep"] = r.kind
        if me_candidate is not None and getattr(r, "author_candidate_id", None) == me_candidate.id:
            mine = r.kind
            per_identity["candidate"] = r.kind
    return {
        "up_count": up, "down_count": down,
        "my_reaction": mine, "my_reactions": per_identity,
    }


@router.post("/comments/{comment_id}/reactions", response_model=ReactionSummary)
def react_to_comment(
    comment_id: int,
    payload: ReactionRequest,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    comment = db.get(PostComment, comment_id)
    if not comment or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Page identity comes from the parent post. Reps + candidates
    # engaging as themselves must own that page.
    post = db.get(Post, comment.post_id)
    if post is None or post.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")
    # Phase 6 multi-identity: narrow by as_identity when sent.
    # Phase 6 fix — narrow which identity ACTS based on the picker's
    # explicit choice, but DON'T overwrite the originals. The summary
    # helpers below need ALL signed-in identities so my_reactions /
    # voter_choices populate every slot the caller is signed in to,
    # not just the one that fired this particular click.
    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=payload.as_identity,
    )
    citizen, rep, candidate = _resolve_engager(
        me_citizen=acting_citizen, me_rep=acting_rep, me_candidate=acting_candidate,
        page_official_id=post.official_id,
    )

    q = db.query(CommentReaction).filter(CommentReaction.comment_id == comment.id)
    if rep is not None:
        q = q.filter(CommentReaction.author_rep_id == rep.id)
    elif candidate is not None:
        q = q.filter(CommentReaction.author_candidate_id == candidate.id)
    else:
        q = q.filter(CommentReaction.citizen_id == citizen.id)
    existing = q.first()
    if existing:
        if existing.kind == payload.kind:
            db.delete(existing)
        else:
            existing.kind = payload.kind
            if citizen is not None:
                existing.scope_state = citizen.state
                existing.scope_district = citizen.congressional_district
                existing.scope_city = citizen.city
                existing.scope_county = citizen.county
    else:
        db.add(CommentReaction(
            comment_id=comment.id,
            citizen_id=citizen.id if citizen is not None else None,
            author_rep_id=rep.id if rep is not None else None,
            author_candidate_id=candidate.id if candidate is not None else None,
            kind=payload.kind,
            scope_state=citizen.state if citizen is not None else None,
            scope_district=citizen.congressional_district if citizen is not None else None,
            scope_city=citizen.city if citizen is not None else None,
            scope_county=citizen.county if citizen is not None else None,
        ))

    db.commit()
    db.refresh(comment)
    return _comment_reaction_summary(
        # Phase 6: ORIGINAL identities — see react_to_post for the
        # full rationale. my_reactions needs every signed-in slot
        # populated, not just the acting one.
        comment, me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )


@router.delete("/comments/{comment_id}/reactions", response_model=ReactionSummary)
def clear_comment_reaction(
    comment_id: int,
    as_identity: Optional[str] = None,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    comment = db.get(PostComment, comment_id)
    if not comment or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")
    post = db.get(Post, comment.post_id)
    if post is None or post.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")
    # Phase 6 multi-identity: same as_identity narrow as clear_reaction.
    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=as_identity,
    )
    citizen, rep, candidate = _resolve_engager(
        me_citizen=acting_citizen, me_rep=acting_rep, me_candidate=acting_candidate,
        page_official_id=post.official_id,
    )
    q = db.query(CommentReaction).filter(CommentReaction.comment_id == comment.id)
    if rep is not None:
        q = q.filter(CommentReaction.author_rep_id == rep.id)
    elif candidate is not None:
        q = q.filter(CommentReaction.author_candidate_id == candidate.id)
    else:
        q = q.filter(CommentReaction.citizen_id == citizen.id)
    existing = q.first()
    if existing:
        db.delete(existing)
        db.commit()
        db.refresh(comment)
    return _comment_reaction_summary(
        # Phase 6: ORIGINAL identities — see react_to_post for the
        # full rationale. my_reactions needs every signed-in slot
        # populated, not just the acting one.
        comment, me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )


@router.post("/posts/{post_id}/comments", response_model=CommentRead, status_code=201)
def create_comment(
    post_id: int,
    payload: CommentCreate,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Create a top-level comment (parent_comment_id NULL) or a reply
    (parent_comment_id pointing at a top-level comment on the same
    post). Phase 3 reply threading; Phase 4c adds candidate parity.

    Top-level: any signed-in citizen, the page-owning rep (Phase 2),
               or the page-owning candidate (Phase 4c).
    Reply: only the post creator (page owner, rep OR candidate) OR
           the parent top-level comment's original author may reply.
           Two-party rule keeps citizen-vs-citizen pile-ons off the
           thread.
    Reply-to-reply: rejected (400). Replies stay one level deep so
           the render is a simple flat pool.
    """
    post = _load_post_or_404(db, post_id)
    # Phase 6 multi-identity: narrow by as_identity when sent (from
    # the "Posting as: ▾" picker above the composer).
    # Phase 6 fix — narrow which identity ACTS based on the picker's
    # explicit choice, but DON'T overwrite the originals. The summary
    # helpers below need ALL signed-in identities so my_reactions /
    # voter_choices populate every slot the caller is signed in to,
    # not just the one that fired this particular click.
    acting_citizen, acting_rep, acting_candidate = _apply_as_identity_filter(
        me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
        as_identity=payload.as_identity,
    )
    citizen, rep, candidate = _resolve_engager(
        me_citizen=acting_citizen, me_rep=acting_rep, me_candidate=acting_candidate,
        page_official_id=post.official_id,
    )

    # Reply-path validation. Done before write so we don't half-create
    # rows that fail the gate.
    parent_id = payload.parent_comment_id
    if parent_id is not None:
        parent = db.get(PostComment, parent_id)
        if parent is None or parent.deleted_at is not None or parent.post_id != post.id:
            raise HTTPException(
                status_code=404,
                detail="Parent comment not found on this post.",
            )
        # One-level-deep enforcement. A reply target must itself be a
        # top-level comment. Replies-to-replies would let the
        # conversation drift into nested arguments — exactly what
        # the two-party rule is designed to avoid.
        if parent.parent_comment_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Replies can only target top-level comments, not other replies.",
            )
        # Two-party rule: caller must be (a) the page-owning rep or
        # candidate OR (b) the parent comment's original author
        # (citizen, rep, or candidate — whichever side authored
        # the top-level comment).
        is_post_creator = (
            (rep is not None and rep.official_id == post.official_id)
            or (candidate is not None and candidate.candidate_id == post.official_id)
        )
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
        if not (is_post_creator or is_parent_author):
            raise HTTPException(
                status_code=403,
                detail=(
                    "Only the post author and the original commenter can reply "
                    "in this thread."
                ),
            )

    # Pick the display name + identity from whichever side resolved.
    # Rep / candidate comments inherit that account's display_name;
    # citizens use their CitizenAccount.display_name (which the UI
    # renders with "(Unverified)" until they confirm their address).
    if rep is not None:
        display_name = rep.display_name
    elif candidate is not None:
        display_name = candidate.display_name
    else:
        display_name = citizen.display_name
    comment = PostComment(
        post_id=post.id,
        parent_comment_id=parent_id,
        citizen_id=citizen.id if citizen is not None else None,
        author_rep_id=rep.id if rep is not None else None,
        author_candidate_id=candidate.id if candidate is not None else None,
        citizen_display_name=display_name,
        body=payload.body.strip(),
        scope_state=citizen.state if citizen is not None else None,
        scope_district=citizen.congressional_district if citizen is not None else None,
        scope_city=citizen.city if citizen is not None else None,
        scope_county=citizen.county if citizen is not None else None,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    # Kick off the AI classification as a background task — the
    # comment is already committed and visible; the tags get applied
    # ~1s later. If the AI is unconfigured or fails the task is a
    # no-op and the comment stays in the unclassified pool (still
    # visible, just not filterable on sentiment / tone).
    from app.services.comment_classifier import classify_post_comment
    bg_tasks.add_task(classify_post_comment, comment.id)

    # Phase 5 reply notification — fired in-process (not via
    # background task) because the row is tiny and we want the
    # notification visible on the recipient's next poll. Only fires
    # when this comment is a reply (parent_id is non-NULL); top-
    # level comments don't generate a notification today (no
    # subscriber model yet).
    if parent_id is not None:
        try:
            from app.services.notifications_inapp import emit_reply_notification
            # `parent` was loaded earlier in the reply-validation
            # block; reuse that object to avoid a second SELECT.
            replier_name = (
                rep.display_name if rep is not None
                else candidate.display_name if candidate is not None
                else citizen.display_name
            )
            emit_reply_notification(
                db, reply=comment, parent=parent,
                replier_display_name=replier_name,
                official_id=post.official_id,
            )
        except Exception:
            # Don't let a notification-emission bug fail the comment
            # write — the user has already seen their comment land,
            # the bell just won't ring this once.
            logger.exception("Failed to emit reply notification for comment %s", comment.id)

    # New comment has no reactions yet — _comment_to_read handles that,
    # and it gives the UI a consistent shape so it can drop the row
    # into the list without special-casing "freshly-created" comments.
    return _comment_to_read(
        # Phase 6: ORIGINAL identities — see react_to_post comment.
        comment, me_citizen=me_citizen, me_rep=me_rep, me_candidate=me_candidate,
    )


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Soft-delete a comment. Allowed ONLY for the comment's author.

    Page-owner deletion was removed deliberately: reps shouldn't be
    able to unilaterally silence constituent voices on their pages.
    The path for moderating problematic comments is /reports — any
    signed-in user (rep or citizen) can flag a comment for admin
    review, and admins take action through a separate moderation
    surface (TBD).

    Phase 2 + 4c self-engagement: "author" now covers citizen, rep,
    OR candidate — whichever identity authored the comment may
    delete it via the same endpoint.
    """
    comment = db.get(PostComment, comment_id)
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


# ── Report endpoints ─────────────────────────────────────────────────
# Anyone signed in (citizen or rep) can report a post or comment.
# Anonymous viewers cannot — both endpoints 401 if neither session
# is present. We use the same dedupe pattern as PollReport: one row
# per (target, reporter) enforced by a unique index; re-clicking
# Report is an idempotent no-op rather than a duplicate row.


class _ReportPayload(BaseModel):
    """Shared request body for post + comment reports."""
    reason: str = Field(..., min_length=1, max_length=64)
    detail: Optional[str] = Field(default=None, max_length=1000)


class _ReportStatus(BaseModel):
    """Shared response — `already_reported` lets the UI distinguish a
    first-time report from a duplicate click without a flicker."""
    ok: bool = True
    already_reported: bool = False


def _require_signed_in(
    rep: Optional[RepAccount],
    citizen: Optional[CitizenAccount],
) -> None:
    """Both endpoints require ONE valid session. Raises 401 if neither."""
    if rep is None and citizen is None:
        raise HTTPException(
            status_code=401,
            detail="Sign in to report content.",
        )


@router.post("/posts/{post_id}/reports", response_model=_ReportStatus)
def report_post(
    post_id: int,
    payload: _ReportPayload,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> _ReportStatus:
    """Flag a rep-authored post for admin review. Idempotent per
    (post, reporter): re-clicking returns already_reported=true
    instead of creating a duplicate row.
    """
    _require_signed_in(me, me_citizen)
    post = db.get(Post, post_id)
    if not post or post.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Post not found")

    # Dedupe: check the existing row for this (post, reporter) pair.
    q = db.query(PostReport).filter(PostReport.post_id == post.id)
    if me_citizen is not None:
        q = q.filter(PostReport.reporter_citizen_id == me_citizen.id)
    else:
        q = q.filter(PostReport.reporter_rep_id == me.id)
    if q.first() is not None:
        return _ReportStatus(ok=True, already_reported=True)

    db.add(
        PostReport(
            post_id=post.id,
            reporter_citizen_id=me_citizen.id if me_citizen is not None else None,
            reporter_rep_id=me.id if me is not None else None,
            reason=payload.reason.strip(),
            detail=(payload.detail or "").strip() or None,
        )
    )
    # Increment report_count + auto-hide if threshold crossed. The
    # helper handles both — caller commits.
    from app.services.moderation import record_report
    record_report(db, post, kind="post")
    db.commit()

    # Fire-and-forget email notification to admins. Build the
    # payload from the freshly-committed report context. Wrapped
    # in BackgroundTasks so the reporter's request doesn't pay the
    # email round-trip latency.
    reporter_name = (
        (me_citizen.display_name if me_citizen is not None
         else (me.display_name if me is not None else "(unknown)"))
    )
    preview = (post.body or "")[:200]
    from app.services.notifications import notify_new_report
    bg_tasks.add_task(
        notify_new_report,
        kind="post",
        target_id=post.id,
        reason=payload.reason.strip(),
        detail=(payload.detail or "").strip() or None,
        reporter_name=reporter_name,
        target_preview=preview,
        context_official_id=post.official_id,
    )
    return _ReportStatus(ok=True, already_reported=False)


@router.post("/comments/{comment_id}/reports", response_model=_ReportStatus)
def report_comment(
    comment_id: int,
    payload: _ReportPayload,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> _ReportStatus:
    """Flag a comment for admin review. Anyone signed in EXCEPT the
    comment's own author can report (you can't report yourself — if
    you regret it, just delete it).
    """
    _require_signed_in(me, me_citizen)
    comment = db.get(PostComment, comment_id)
    if not comment or comment.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Comment not found")

    # Self-report guard.
    if me_citizen is not None and comment.citizen_id == me_citizen.id:
        raise HTTPException(
            status_code=400,
            detail="You can't report your own comment. Delete it if you regret it.",
        )

    q = db.query(CommentReport).filter(CommentReport.comment_id == comment.id)
    if me_citizen is not None:
        q = q.filter(CommentReport.reporter_citizen_id == me_citizen.id)
    else:
        q = q.filter(CommentReport.reporter_rep_id == me.id)
    if q.first() is not None:
        return _ReportStatus(ok=True, already_reported=True)

    db.add(
        CommentReport(
            comment_id=comment.id,
            reporter_citizen_id=me_citizen.id if me_citizen is not None else None,
            reporter_rep_id=me.id if me is not None else None,
            reason=payload.reason.strip(),
            detail=(payload.detail or "").strip() or None,
        )
    )
    from app.services.moderation import record_report
    record_report(db, comment, kind="post_comment")
    db.commit()

    # Notify admins (background task, never blocks the response).
    reporter_name = (
        (me_citizen.display_name if me_citizen is not None
         else (me.display_name if me is not None else "(unknown)"))
    )
    # Resolve the hosting page for the context-url link.
    parent_post = db.get(Post, comment.post_id) if comment.post_id else None
    from app.services.notifications import notify_new_report
    bg_tasks.add_task(
        notify_new_report,
        kind="post_comment",
        target_id=comment.id,
        reason=payload.reason.strip(),
        detail=(payload.detail or "").strip() or None,
        reporter_name=reporter_name,
        target_preview=(comment.body or "")[:200],
        context_official_id=parent_post.official_id if parent_post else None,
    )
    return _ReportStatus(ok=True, already_reported=False)


# ── Post image upload / serve ────────────────────────────────────────
# Limits kept modest for the demo; bump them when we swap the disk
# sink for S3. Content-type allow-list protects against trivially-
# hostile uploads; magic-byte sniffing would be a nice belt-and-
# suspenders addition for production.
_ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png":  "png",
    "image/webp": "webp",
}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB per image
# Storage backend is picked by the get_storage() factory based on env
# vars — R2 in prod (durable), LocalDisk in dev (ephemeral on Render
# but fine for sandbox testing). See app/services/image_storage.py
# for the full env var docs.


@router.post("/images/upload", response_model=PostImageRead)
async def upload_post_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Upload a single image as an unclaimed orphan.

    Flow: page owner uploads → gets {id, url} back → composer shows
    the thumbnail → on publish, sends image_ids to /posts to claim
    them. Images not claimed within a post stay as orphans on disk;
    a future janitor can sweep them.

    Phase 4d: candidates can upload images too. The uploader gets
    written to either uploader_id (rep) or uploader_candidate_id
    (candidate); create_post's image-attachment validation checks
    whichever applies. Requires a rep OR candidate session — pure
    citizen sessions can't upload images (no surface for them to
    attach images to today).
    """
    if me_rep is None and me_candidate is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in as a rep or candidate to upload images.",
        )
    ct = (file.content_type or "").lower()
    if ct not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only JPEG, PNG, and WebP images are supported.",
        )

    # Read with a hard cap — UploadFile.read(size) returns up to `size`
    # bytes but doesn't itself error at the limit, so we check and
    # reject large payloads after the fact. Reading one byte past the
    # limit is the canonical way to detect overrun without buffering
    # the whole oversized stream.
    data = await file.read(_MAX_IMAGE_BYTES + 1)
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large — max {_MAX_IMAGE_BYTES // 1024 // 1024} MB.",
        )
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")

    ext = _ALLOWED_IMAGE_TYPES[ct]
    fname = f"{uuid.uuid4().hex}.{ext}"
    # Storage backend is the factory's choice — R2 in prod, LocalDisk
    # in dev. Either way the row stores just the filename; the storage
    # layer knows how to resolve it back to bytes / URL later.
    from app.services.image_storage import get_storage
    try:
        get_storage().write(fname, data, ct)
    except Exception as e:
        logger.exception("Failed to write uploaded image via storage backend")
        raise HTTPException(status_code=500, detail="Could not save image.") from e

    img = PostImage(
        uploader_id=me_rep.id if me_rep is not None else None,
        uploader_candidate_id=me_candidate.id if me_candidate is not None else None,
        filename=fname,
        content_type=ct,
        file_size=len(data),
    )
    db.add(img)
    db.commit()
    db.refresh(img)

    return PostImageRead(
        id=img.id,
        url=f"/api/pages/images/{img.id}",
        content_type=img.content_type,
        sort_order=img.sort_order,
    )


@router.get("/images/{image_id}")
def get_post_image(image_id: int, db: Session = Depends(get_db)):
    """Resolve an uploaded image by id. Public — once a post is
    published anyone viewing the page should see its images. Orphan
    images (still unclaimed by a post) are also fetchable by id so
    the composer can render thumbnails straight after upload.

    Two response paths depending on the storage backend:
      • LocalDisk → FileResponse streams the bytes through the
        backend (fine in dev, eats Render bandwidth in prod).
      • R2 → 302 RedirectResponse to a presigned R2 URL (or a
        direct public URL if R2_PUBLIC_BASE_URL is set). Browser
        fetches from R2 directly — no backend bandwidth used.

    The router doesn't need to know which backend is active; the
    storage layer's url() vs path() return values are the signal.
    """
    img = db.get(PostImage, image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")

    from app.services.image_storage import get_storage
    storage = get_storage()

    # Prefer a URL (R2 path) — single 302 redirect, no backend bytes.
    url = storage.url(img.filename, img.content_type)
    if url:
        return RedirectResponse(url, status_code=302)

    # Fall through to local-file path. None means the backend doesn't
    # store on local disk either (shouldn't happen with current
    # implementations) — return 404 in that case.
    fpath = storage.path(img.filename)
    if fpath is None or not fpath.exists():
        raise HTTPException(status_code=404, detail="Image file missing")
    return FileResponse(fpath, media_type=img.content_type)


# ── Authenticated: rep events ─────────────────────────────────────────
@router.post("/{official_id}/events", response_model=RepEventRead, status_code=201)
def create_rep_event(
    official_id: str,
    payload: RepEventCreate,
    db: Session = Depends(get_db),
    rep: RepAccount = Depends(get_current_rep),
):
    _assert_owns_page(rep, official_id)

    evt = RepEvent(
        author_id=rep.id,
        official_id=official_id,
        title=payload.title.strip(),
        description=(payload.description or None),
        location=(payload.location or None),
        url=(payload.url or None),
        start_at=payload.start_at,
        end_at=payload.end_at,
    )
    db.add(evt)
    db.commit()
    db.refresh(evt)
    return RepEventRead.model_validate(evt)


@router.delete("/events/{event_id}", status_code=204)
def delete_rep_event(
    event_id: int,
    db: Session = Depends(get_db),
    rep: RepAccount = Depends(get_current_rep),
):
    evt = db.get(RepEvent, event_id)
    if not evt or evt.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Event not found")
    if evt.author_id != rep.id:
        raise HTTPException(status_code=403, detail="You can only delete your own events")

    evt.deleted_at = datetime.utcnow()
    db.commit()
    return


# ── Owner dashboard (Step 7) ──────────────────────────────────────────
def _apply_geo_filter(q, col_prefix_obj, scope: str, owner: RepAccount):
    """Append a geography filter to an engagement query. `col_prefix_obj`
    is the model class whose scope_* columns we filter on (PostReaction
    / PostComment / PollVote). No-op for scope='country'.
    """
    if scope == "state" and owner.owner_state:
        return q.filter(col_prefix_obj.scope_state == owner.owner_state)
    if scope == "district" and owner.owner_district:
        return q.filter(col_prefix_obj.scope_district == owner.owner_district)
    if scope == "city" and owner.owner_city:
        return q.filter(col_prefix_obj.scope_city == owner.owner_city)
    return q


def _body_preview(body: str, limit: int = 200) -> str:
    body = (body or "").strip()
    if len(body) <= limit:
        return body
    return body[:limit].rstrip() + "…"


@router.get("/{official_id}/dashboard", response_model=PageDashboardResponse)
def get_page_dashboard(
    official_id: str,
    scope: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    """Owner-only engagement rollup across every post on this page.

    Returns summary metrics, top 5 most-engaged posts, top 5 most-
    active commenters, and a reactions breakdown. All engagement
    counts respect the active scope; the unscoped 'country' path
    returns everything.

    Gated to the page owner — accepts either a rep session matching
    the page's official_id or a candidate session matching the
    page's candidate_id (Phase 4b). Same cross-page-scraping
    protection as before: Byron Donalds' rep account can pull
    D000032's dashboard but not Ron DeSantis's, and a candidate
    can only see their own page's dashboard.
    """
    rep_owner = _load_owner(db, official_id)
    candidate_owner = _load_candidate_owner(db, official_id) if rep_owner is None else None
    # Rebind `owner` to whichever side resolved so the rest of this
    # function (scope filters, label rendering, geo-filter helpers)
    # keeps working unchanged — both account types expose the same
    # owner_state / owner_district / owner_city columns.
    owner = rep_owner if rep_owner is not None else candidate_owner
    if owner is None:
        raise HTTPException(status_code=404, detail="Page is not claimed")

    # Authorization: the signed-in caller must match the page's owner.
    # _resolve_page_owner raises 403 if neither rep nor candidate
    # matches the official_id / candidate_id.
    _resolve_page_owner(
        me_rep=me_rep, me_candidate=me_candidate,
        page_official_id=official_id,
    )

    active_scope = (scope or "country").lower()
    if active_scope not in SCOPE_VALUES:
        raise HTTPException(status_code=400, detail=f"Unknown scope '{active_scope}'")
    # Silently demote to country when the owner's role doesn't support
    # the requested scope (shouldn't happen from the UI but belt+suspenders).
    allowed = _allowed_scopes_for_owner(owner)
    if active_scope not in allowed:
        active_scope = "country"

    # Pre-fetch post ids once — every aggregation below is bounded to
    # posts authored on this official's page.
    posts = (
        db.query(Post)
        .filter(Post.official_id == official_id, Post.deleted_at.is_(None))
        .all()
    )
    post_ids = [p.id for p in posts]
    total_posts = len(posts)
    if not post_ids:
        # Short-circuit — no posts, no engagement possible.
        return PageDashboardResponse(
            official_id=official_id,
            scope=active_scope,
            scope_label=_scope_label(active_scope, owner),
            summary=DashboardSummary(total_posts=0),
            top_posts=[],
            top_commenters=[],
            reactions_breakdown=DashboardReactions(),
        )

    # ── Reactions per post (scoped) ──────────────────────────────────
    r_q = (
        db.query(PostReaction.post_id, PostReaction.kind, func.count(PostReaction.id))
        .filter(PostReaction.post_id.in_(post_ids))
    )
    r_q = _apply_geo_filter(r_q, PostReaction, active_scope, owner)
    r_rows = r_q.group_by(PostReaction.post_id, PostReaction.kind).all()
    up_by_post: dict[int, int] = {}
    down_by_post: dict[int, int] = {}
    for post_id, kind, n in r_rows:
        if kind == "up":
            up_by_post[post_id] = n
        elif kind == "down":
            down_by_post[post_id] = n
    total_up = sum(up_by_post.values())
    total_down = sum(down_by_post.values())

    # ── Comments per post (scoped, non-deleted only) ─────────────────
    c_q = (
        db.query(PostComment.post_id, func.count(PostComment.id))
        .filter(PostComment.post_id.in_(post_ids), PostComment.deleted_at.is_(None))
    )
    c_q = _apply_geo_filter(c_q, PostComment, active_scope, owner)
    comments_by_post: dict[int, int] = dict(
        c_q.group_by(PostComment.post_id).all()
    )
    total_comments = sum(comments_by_post.values())

    # ── Poll votes per post (scoped) ─────────────────────────────────
    # Vote rows live on poll_votes, joined through polls to posts.
    v_q = (
        db.query(Poll.post_id, func.count(PollVote.id))
        .join(PollVote, PollVote.poll_id == Poll.id)
        .filter(Poll.post_id.in_(post_ids))
    )
    v_q = _apply_geo_filter(v_q, PollVote, active_scope, owner)
    votes_by_post: dict[int, int] = dict(
        v_q.group_by(Poll.post_id).all()
    )
    total_votes = sum(votes_by_post.values())

    # ── Unique engaged citizens (scoped) ─────────────────────────────
    # Citizens who reacted OR commented OR voted count once each. We
    # union three scoped queries rather than one giant JOIN to keep
    # each filter local to the relevant table.
    def _engaged_citizen_ids(model) -> set[int]:
        q = db.query(model.citizen_id).filter(model.citizen_id.isnot(None))
        # All three engagement models are scoped by post_id via their
        # relationship — restrict to this official's posts.
        if model is PostComment:
            q = q.filter(model.post_id.in_(post_ids), model.deleted_at.is_(None))
        elif model is PostReaction:
            q = q.filter(model.post_id.in_(post_ids))
        elif model is PollVote:
            # PollVote has no post_id; join through Poll.
            q = (
                db.query(PollVote.citizen_id)
                .join(Poll, Poll.id == PollVote.poll_id)
                .filter(Poll.post_id.in_(post_ids), PollVote.citizen_id.isnot(None))
            )
        q = _apply_geo_filter(q, model, active_scope, owner)
        return {row[0] for row in q.all() if row[0] is not None}

    engaged = (
        _engaged_citizen_ids(PostReaction)
        | _engaged_citizen_ids(PostComment)
        | _engaged_citizen_ids(PollVote)
    )

    # ── Build per-post engagement summaries and rank ─────────────────
    post_summaries: list[DashboardPostSummary] = []
    for p in posts:
        up = up_by_post.get(p.id, 0)
        down = down_by_post.get(p.id, 0)
        cc = comments_by_post.get(p.id, 0)
        vc = votes_by_post.get(p.id, 0)
        post_summaries.append(DashboardPostSummary(
            post_id=p.id,
            body_preview=_body_preview(p.body),
            created_at=p.created_at,
            up_count=up,
            down_count=down,
            comment_count=cc,
            poll_vote_count=vc,
            engagement_score=up + down + cc + vc,
        ))

    # Top posts by engagement score (descending). Break ties with
    # created_at descending so the newer post wins — feels right in a
    # social feed.
    top_posts = sorted(
        post_summaries,
        key=lambda s: (s.engagement_score, s.created_at),
        reverse=True,
    )[:5]

    # Most-liked / most-disliked. Only surface them when at least one
    # reaction exists — otherwise the "most liked post" is an arbitrary
    # tie among 0s.
    most_liked = None
    if total_up > 0:
        most_liked = max(post_summaries, key=lambda s: (s.up_count, s.created_at))
        if most_liked.up_count == 0:
            most_liked = None
    most_disliked = None
    if total_down > 0:
        most_disliked = max(post_summaries, key=lambda s: (s.down_count, s.created_at))
        if most_disliked.down_count == 0:
            most_disliked = None

    # ── Top commenters (scoped) ──────────────────────────────────────
    tc_q = (
        db.query(
            PostComment.citizen_id,
            PostComment.citizen_display_name,
            PostComment.scope_city,
            PostComment.scope_district,
            PostComment.scope_state,
            func.count(PostComment.id).label("n"),
        )
        .filter(PostComment.post_id.in_(post_ids), PostComment.deleted_at.is_(None))
    )
    tc_q = _apply_geo_filter(tc_q, PostComment, active_scope, owner)
    tc_rows = (
        tc_q.group_by(
            PostComment.citizen_id,
            PostComment.citizen_display_name,
            PostComment.scope_city,
            PostComment.scope_district,
            PostComment.scope_state,
        )
        .order_by(func.count(PostComment.id).desc())
        .limit(5)
        .all()
    )
    top_commenters = [
        DashboardCommenter(
            citizen_id=cid, display_name=name,
            city=city, scope_district=dist, scope_state=state,
            comment_count=n,
        )
        for cid, name, city, dist, state, n in tc_rows
    ]

    return PageDashboardResponse(
        official_id=official_id,
        scope=active_scope,
        scope_label=_scope_label(active_scope, owner),
        summary=DashboardSummary(
            total_posts=total_posts,
            total_reactions=total_up + total_down,
            total_comments=total_comments,
            total_poll_votes=total_votes,
            unique_engaged_citizens=len(engaged),
            reactions_net=total_up - total_down,
        ),
        top_posts=top_posts,
        top_commenters=top_commenters,
        reactions_breakdown=DashboardReactions(
            up_total=total_up,
            down_total=total_down,
            most_liked_post=most_liked,
            most_disliked_post=most_disliked,
        ),
    )
