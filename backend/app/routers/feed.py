# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Home-page feed endpoints — power the "National activity" and
"Popular polls" sections of the National Officials Panel on the
landing page.

These are aggregate read-only views over the existing Post + Poll
tables. They're separate from `/api/pages/{official_id}/...`
because the landing page doesn't have a single owner to scope
against; we want the latest and the most-engaged across the whole
app.

Endpoints:

  GET /api/feed/national-activity?limit=6
      Most recent non-deleted Posts authored by any RepAccount.
      Used for the alternating R/D activity feed. Returns
      `{ items: [...] }` so a future cursor / has_more field can
      be added without breaking clients.

  GET /api/feed/popular-polls?limit=9
      Active polls (rep + citizen) ordered by total vote count
      DESC, then created_at DESC as a tiebreaker. Used for the
      "Popular polls" trending grid.

When the DB is empty (fresh-start deploys, pre-onboarding), both
return `{ items: [] }`. The frontend renders an explanatory empty
state in that case instead of a fake demo feed.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    Poll,
    PollComment,
    PollOption,
    PollReaction,
    PollVote,
    Post,
    PostComment,
    PostReaction,
    RepAccount,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ── Party lookup ─────────────────────────────────────────────────────
# Build a static map official_id → 'R' | 'D' | 'I' from the curated
# federal_officials.json file. The frontend uses this to tint the
# avatar / show the party chip on each activity row. For sitting
# Congress members not in the curated leadership list, party returns
# None and the frontend renders neutrally — fine for the early
# launch, and the legislators-current.json fetch covers the long
# tail later if we want to extend.
_FEDERAL_OFFICIALS_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "federal" / "federal_officials.json"
)
_PARTY_BY_OFFICIAL_ID: Dict[str, str] = {}
_PARTY_INDEX_BUILT = False


def _walk_for_party(node: Any) -> None:
    """Recurse a federal_officials.json subtree, recording every
    leaf entry that has both `id` (or `official_id`) and `party`.
    Cheap one-time pass — the file is ~50KB."""
    if isinstance(node, dict):
        oid = node.get("id") or node.get("official_id")
        party = node.get("party")
        if oid and party and isinstance(party, str):
            # Normalize: take the first letter (R, D, I, L, G). Most
            # entries are already single-char; this handles e.g.
            # 'Independent' → 'I' if the data ever changes.
            _PARTY_BY_OFFICIAL_ID[str(oid)] = party.strip()[:1].upper()
        for v in node.values():
            _walk_for_party(v)
    elif isinstance(node, list):
        for item in node:
            _walk_for_party(item)


def _ensure_party_index() -> None:
    """Lazy-load the party map on first request. Module import time
    would also work but lazy keeps the test-suite's import graph
    cleaner (and the file is tiny — first call is microseconds)."""
    global _PARTY_INDEX_BUILT
    if _PARTY_INDEX_BUILT:
        return
    try:
        with _FEDERAL_OFFICIALS_PATH.open() as f:
            payload = json.load(f)
        _walk_for_party(payload)
        logger.info(
            "Feed party index built: %d officials with party affiliation.",
            len(_PARTY_BY_OFFICIAL_ID),
        )
    except FileNotFoundError:
        logger.warning(
            "federal_officials.json not found at %s — party will be null on every row.",
            _FEDERAL_OFFICIALS_PATH,
        )
    except Exception:
        logger.exception("Failed to build party index — falling back to null party.")
    _PARTY_INDEX_BUILT = True


def _party_for(official_id: Optional[str]) -> Optional[str]:
    if not official_id:
        return None
    _ensure_party_index()
    return _PARTY_BY_OFFICIAL_ID.get(official_id)


# ── /national-activity ──────────────────────────────────────────────
@router.get("/national-activity")
def national_activity(
    limit: int = Query(default=6, ge=1, le=30),
    db: Session = Depends(get_db),
) -> dict:
    """Return the most recent non-deleted Posts across all reps.

    We don't try to force an R/D alternation on the server — that
    constraint was useful for the seeded demo feed where every row
    was hand-curated. In production the feed is "most recent across
    everyone who's posted," and balance emerges naturally from
    onboarding both sides. If we ever want forced alternation we
    can add it as a frontend post-processing step on the response.

    Each item shape (matches what the frontend ActivityPostRow
    component already expects, modulo the ISO timestamp the frontend
    converts to a relative string):

      {
        id: int,
        official_id: str,
        author: str,           # rep display name
        role: str | null,      # cached role string from rep_accounts
        party: 'R'|'D'|'I'|null,
        created_at: iso8601,
        body: str,
        likes: int,            # net (up - down) reactions, clamped at 0
        comments: int,         # non-deleted comment count
      }
    """
    # Subquery: net reaction score per post. PostReaction.kind is
    # 'up' or 'down'; we sum +1 / -1 and clamp at zero for display
    # (matches the convention used by PostCard.js).
    rxn_score = (
        db.query(
            PostReaction.post_id.label("pid"),
            func.sum(
                case(
                    (PostReaction.kind == "up", 1),
                    (PostReaction.kind == "down", -1),
                    else_=0,
                )
            ).label("score"),
        )
        .group_by(PostReaction.post_id)
        .subquery()
    )
    # Subquery: non-deleted comment count per post.
    cmt_count = (
        db.query(
            PostComment.post_id.label("pid"),
            func.count(PostComment.id).label("cnt"),
        )
        .filter(PostComment.deleted_at.is_(None))
        .group_by(PostComment.post_id)
        .subquery()
    )

    rows = (
        db.query(
            Post.id,
            Post.official_id,
            Post.body,
            Post.created_at,
            RepAccount.display_name,
            RepAccount.role,
            rxn_score.c.score,
            cmt_count.c.cnt,
        )
        .join(RepAccount, RepAccount.id == Post.author_id)
        .outerjoin(rxn_score, rxn_score.c.pid == Post.id)
        .outerjoin(cmt_count, cmt_count.c.pid == Post.id)
        .filter(Post.deleted_at.is_(None))
        .order_by(Post.created_at.desc())
        .limit(limit)
        .all()
    )

    items: List[Dict[str, Any]] = []
    for r in rows:
        pid, official_id, body, created_at, display_name, role, score, cmts = r
        items.append(
            {
                "id": pid,
                "official_id": official_id,
                "author": display_name,
                "role": role,
                "party": _party_for(official_id),
                "created_at": created_at.isoformat() if created_at else None,
                "body": body,
                "likes": max(int(score or 0), 0),
                "comments": int(cmts or 0),
            }
        )
    return {"items": items}


# ── /popular-polls ───────────────────────────────────────────────────
@router.get("/popular-polls")
def popular_polls(
    limit: int = Query(default=9, ge=1, le=30),
    db: Session = Depends(get_db),
) -> dict:
    """Return active polls ordered by total vote count DESC.

    "Active" = archived_at IS NULL (catches both rep polls — which
    don't archive — and live citizen polls). Closes-at expiration is
    not yet enforced anywhere else in the codebase, so we don't
    filter on it here either; if `closes_at` ever starts driving UI
    we can add the filter in one place.

    Result mixes rep-authored and citizen-authored polls. The kind
    field tells the frontend which path to render:
      kind='rep'      → author/role/party come from RepAccount via the
                        attached Post
      kind='citizen'  → author comes from CitizenAccount.display_name,
                        role is the citizen's state+city, party is null

    Each item shape (matches PopularPollCard's expectations):

      {
        id: int,
        kind: 'rep' | 'citizen',
        author: str,
        role: str | null,
        party: 'R'|'D'|'I'|null,
        official_id: str | null,   # target page (citizen polls only)
        created_at: iso8601,
        question: str,
        options: [{label: str, percent: int}],
        votes: int,
        comments: int,
      }

    Empty array if no polls have any votes yet — the frontend renders
    an explanatory empty state instead of stale demo data.
    """
    # Subquery: vote count per poll, computed via PollOption join so
    # we get a per-poll total (PollVote keys to PollOption, not Poll).
    vote_counts = (
        db.query(
            PollOption.poll_id.label("pid"),
            func.count(PollVote.id).label("vcnt"),
            PollOption.id.label("oid"),
        )
        .outerjoin(PollVote, PollVote.option_id == PollOption.id)
        .group_by(PollOption.poll_id, PollOption.id)
        .subquery()
    )
    # Aggregate the per-option totals up to per-poll totals so we can
    # order by them. Two passes is simpler than a single window query
    # and SQLite-portable.
    totals_by_poll = (
        db.query(
            vote_counts.c.pid.label("pid"),
            func.sum(vote_counts.c.vcnt).label("total"),
        )
        .group_by(vote_counts.c.pid)
        .subquery()
    )

    # Get the top N poll ids. We INCLUDE polls with zero votes so the
    # surface isn't completely barren when the app first launches —
    # but they sort to the bottom because total=0 < any positive total.
    poll_rows = (
        db.query(Poll, totals_by_poll.c.total)
        .outerjoin(totals_by_poll, totals_by_poll.c.pid == Poll.id)
        .filter(Poll.archived_at.is_(None))
        # Tiebreaker on Poll.created_at descending. NULLs (legacy rows
        # before this column was added) sort to the end either way on
        # SQLite + Postgres — fine for the tail.
        .order_by(
            func.coalesce(totals_by_poll.c.total, 0).desc(),
            Poll.created_at.desc(),
        )
        .limit(limit)
        .all()
    )

    items: List[Dict[str, Any]] = []
    for poll, total in poll_rows:
        total = int(total or 0)
        # Per-option breakdown for the bars on the card.
        option_rows = (
            db.query(
                PollOption.id,
                PollOption.text,
                PollOption.sort_order,
                func.count(PollVote.id).label("vcnt"),
            )
            .outerjoin(PollVote, PollVote.option_id == PollOption.id)
            .filter(PollOption.poll_id == poll.id)
            .group_by(PollOption.id, PollOption.text, PollOption.sort_order)
            .order_by(PollOption.sort_order)
            .all()
        )
        options = []
        for _oid, text, _so, vcnt in option_rows:
            pct = round((int(vcnt or 0) / total) * 100) if total else 0
            options.append({"label": text, "percent": pct})

        # Comment count — PollComment for citizen polls, PostComment for
        # rep polls (attached via post_id).
        if poll.author_kind == "citizen":
            comments = (
                db.query(func.count(PollComment.id))
                .filter(PollComment.poll_id == poll.id)
                .filter(PollComment.deleted_at.is_(None))
                .scalar()
                or 0
            )
        else:
            comments = (
                db.query(func.count(PostComment.id))
                .filter(PostComment.post_id == poll.post_id)
                .filter(PostComment.deleted_at.is_(None))
                .scalar()
                or 0
            )

        # Author resolution branches on author_kind.
        if poll.author_kind == "citizen":
            cz = (
                db.query(CitizenAccount)
                .filter(CitizenAccount.id == poll.author_citizen_id)
                .first()
            )
            author = cz.display_name if cz else "Citizen"
            role_parts = []
            if cz and cz.state:
                role_parts.append(cz.state)
            if cz and cz.city:
                role_parts.append(cz.city)
            role = " · ".join(role_parts) if role_parts else None
            party = None
            official_id = poll.target_official_id
        else:
            # Rep poll — author is the rep that authored the attached post.
            post = (
                db.query(Post)
                .filter(Post.id == poll.post_id)
                .first()
                if poll.post_id else None
            )
            rep = (
                db.query(RepAccount)
                .filter(RepAccount.id == post.author_id)
                .first()
                if post else None
            )
            author = rep.display_name if rep else "Representative"
            role = rep.role if rep else None
            official_id = post.official_id if post else None
            party = _party_for(official_id)

        items.append(
            {
                "id": poll.id,
                "kind": poll.author_kind,
                "author": author,
                "role": role,
                "party": party,
                "official_id": official_id,
                "created_at": (poll.created_at.isoformat() if poll.created_at else None),
                "question": poll.question,
                "options": options,
                "votes": total,
                "comments": int(comments),
            }
        )
    return {"items": items}


# ── /polls — full polls feed (the dedicated /polls page) ────────────
@router.get("/polls")
def polls_feed(
    limit: int = Query(default=100, ge=1, le=300),
    kind: Optional[List[str]] = Query(
        default=None,
        description=(
            "Filter by one or more of 'rep' | 'citizen' | 'standalone' | 'candidate'. "
            "Repeat the parameter for additive multi-select "
            "(e.g. ?kind=rep&kind=standalone). Omit for the unfiltered feed."
        ),
    ),
    state: Optional[str] = Query(
        default=None,
        min_length=2,
        max_length=2,
        pattern=r"^[A-Za-z]{2}$",
        description=(
            "Filter to polls whose author lives in (citizen polls) or "
            "represents (rep + candidate polls) the given 2-letter state. "
            "Case-insensitive; normalized to upper-case server-side."
        ),
    ),
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
) -> dict:
    """Every active poll across the entire app, newest first.

    Differs from /api/feed/popular-polls in three ways:
      • Returns ALL active polls (capped at `limit`), not just the
        top-engaged set.
      • Includes a page_tag string per row (e.g. "BD · FL-19" or
        "Standalone") so the /polls UI can render the source-page
        chip without an extra round-trip per poll.
      • Surfaces standalone polls (target_official_id IS NULL,
        author_kind='citizen') — these don't appear on any rep
        page and only exist in this feed.

    Active = archived_at IS NULL. Rep polls don't archive normally
    so they always appear here once authored; citizen polls drop
    out when their rep claims the page or the citizen closes them.

    Kind filter (additive — repeat the param to union):
      'rep'        → rep-authored polls only
      'citizen'    → citizen polls tied to a rep page (target_official_id is a rep id)
      'standalone' → citizen polls with no target rep / candidate page
      'candidate'  → polls targeting a candidate page (citizen-authored
                     today since candidate accounts ship in Phase 3+)
      omitted      → everything
    Multiple values return the union (e.g. ?kind=rep&kind=standalone
    returns rep polls + standalone citizen polls).

    State filter:
      Restricts the feed to authors associated with the given state.
        • Rep polls   → matches when post.author.owner_state == state
                        (covers rep-authored posts) OR
                        post.author_candidate.owner_state == state
                        (covers candidate-authored posts once those land).
        • Citizen polls → matches when author_citizen.state == state.
      States are 2-letter codes (case-insensitive).
    """
    from app.services.page_tags import resolve_page_tag, is_candidate_id
    from sqlalchemy import or_

    # Normalize the kind param. FastAPI hands us a list with one item
    # for the single-value form (?kind=rep) and a multi-item list for
    # repeated params. None for the unfiltered case.
    kinds: List[str] = [k for k in (kind or []) if k] or []

    def _kind_clause(k: str):
        """Map a single kind string to its SQLAlchemy filter clause."""
        if k == "rep":
            return Poll.author_kind == "rep"
        if k == "citizen":
            # Citizen polls on rep pages (not candidate pages — those
            # get their own bucket so the chip count is meaningful).
            # The candidate-id exclusion still has to happen in Python
            # because candidate ids are an in-memory dict; the SQL here
            # is a superset that the Python post-filter narrows.
            return (
                (Poll.author_kind == "citizen") & (Poll.target_official_id.is_not(None))
            )
        if k == "standalone":
            return (Poll.author_kind == "citizen") & (Poll.target_official_id.is_(None))
        if k == "candidate":
            # Same superset story as 'citizen' — Python narrows.
            return Poll.target_official_id.is_not(None)
        return None

    q = db.query(Poll).filter(Poll.archived_at.is_(None))
    if kinds:
        clauses = [c for k in kinds if (c := _kind_clause(k)) is not None]
        if clauses:
            q = q.filter(or_(*clauses))

    # State filter — applies across both author paths. Joins are LEFT
    # so polls without a matching join row stay in the result set as
    # NULL on the relevant column; the WHERE then uses COALESCE so
    # one of the three (rep, candidate, citizen) wins per row.
    state_upper = state.upper() if state else None
    if state_upper:
        q = (
            q.outerjoin(Post, Post.id == Poll.post_id)
            .outerjoin(RepAccount, RepAccount.id == Post.author_id)
            .outerjoin(CandidateAccount, CandidateAccount.id == Post.author_candidate_id)
            .outerjoin(CitizenAccount, CitizenAccount.id == Poll.author_citizen_id)
            .filter(
                func.coalesce(
                    RepAccount.owner_state,
                    CandidateAccount.owner_state,
                    CitizenAccount.state,
                )
                == state_upper
            )
        )

    rows = q.order_by(Poll.created_at.desc()).limit(limit).all()

    # Pre-compute parent-post like/dislike counts in a single batched
    # query so the rep-poll items can render the engagement footer
    # without N+1 SQL. For citizen polls the keys are absent and the
    # items loop falls back to 0/0 (citizen polls don't have a like /
    # dislike concept yet — that's a future PR; the design treats it
    # as forward-compatible).
    rep_post_ids = [p.post_id for p in rows if p.author_kind == "rep" and p.post_id]
    post_likes: Dict[int, int] = {}
    post_dislikes: Dict[int, int] = {}
    if rep_post_ids:
        rxn_rows = (
            db.query(
                PostReaction.post_id,
                PostReaction.kind,
                func.count(PostReaction.id),
            )
            .filter(PostReaction.post_id.in_(rep_post_ids))
            .group_by(PostReaction.post_id, PostReaction.kind)
            .all()
        )
        for pid, k, cnt in rxn_rows:
            if k == "up":
                post_likes[int(pid)] = int(cnt or 0)
            elif k == "down":
                post_dislikes[int(pid)] = int(cnt or 0)

    # Pre-compute the viewer's vote per poll — keyed by identity so
    # the IdentityPicker can mark which identities have already voted
    # for which option (the "✓ Voted" stamp on picker rows). Single
    # batched query across the result set at the 300-poll cap.
    # Two shapes returned per item:
    #   • viewer.voter_choice_id  — legacy single value (citizen wins,
    #     then rep, then candidate). Kept for backwards-compat with
    #     UI that doesn't yet read per-identity state.
    #   • viewer.voter_choices    — { citizen: oid, rep: oid, candidate: oid }
    #     mapping per identity. UI surfaces with per-identity markers.
    viewer_votes_by_identity: Dict[int, Dict[str, int]] = {}
    poll_ids = [p.id for p in rows]
    if poll_ids and (me_citizen or me_rep or me_candidate):
        vq = db.query(PollVote.poll_id, PollVote.option_id).filter(
            PollVote.poll_id.in_(poll_ids)
        )
        if me_citizen is not None:
            for pid, oid in vq.filter(PollVote.citizen_id == me_citizen.id).all():
                viewer_votes_by_identity.setdefault(int(pid), {})["citizen"] = int(oid)
        if me_rep is not None:
            for pid, oid in vq.filter(PollVote.author_rep_id == me_rep.id).all():
                viewer_votes_by_identity.setdefault(int(pid), {})["rep"] = int(oid)
        if me_candidate is not None:
            for pid, oid in vq.filter(PollVote.author_candidate_id == me_candidate.id).all():
                viewer_votes_by_identity.setdefault(int(pid), {})["candidate"] = int(oid)

    # Citizen-wins-then-rep-then-candidate resolution for the legacy
    # single-value field. Used by callers that haven't switched to
    # voter_choices yet.
    def _resolved_choice(poll_id: int) -> Optional[int]:
        m = viewer_votes_by_identity.get(int(poll_id), {})
        return m.get("citizen") or m.get("rep") or m.get("candidate")

    # Pre-compute per-identity reactions on each REP poll's parent
    # post. Citizen polls don't have reactions yet (no PollReaction
    # model) so they get empty maps.
    rep_post_ids_for_rxn = [p.post_id for p in rows if p.author_kind == "rep" and p.post_id]
    my_reactions_by_post: Dict[int, Dict[str, str]] = {}
    if rep_post_ids_for_rxn and (me_citizen or me_rep or me_candidate):
        rq = db.query(PostReaction.post_id, PostReaction.kind).filter(
            PostReaction.post_id.in_(rep_post_ids_for_rxn)
        )
        if me_citizen is not None:
            for pid, k in rq.filter(PostReaction.citizen_id == me_citizen.id).all():
                my_reactions_by_post.setdefault(int(pid), {})["citizen"] = k
        if me_rep is not None:
            for pid, k in rq.filter(PostReaction.author_rep_id == me_rep.id).all():
                my_reactions_by_post.setdefault(int(pid), {})["rep"] = k
        if me_candidate is not None:
            for pid, k in rq.filter(PostReaction.author_candidate_id == me_candidate.id).all():
                my_reactions_by_post.setdefault(int(pid), {})["candidate"] = k

    # Citizen-poll reactions (Phase 7 — PollReaction model). Same
    # shape as the rep-side aggregation; keyed by poll_id rather
    # than post_id. Citizen polls now have full like/dislike parity
    # with posts.
    citizen_poll_ids = [p.id for p in rows if p.author_kind == "citizen"]
    poll_rxn_counts: Dict[int, Dict[str, int]] = {}
    my_reactions_by_poll: Dict[int, Dict[str, str]] = {}
    if citizen_poll_ids:
        # Aggregate counts (up + down) per poll in one batched group-by.
        for pid, k, cnt in (
            db.query(
                PollReaction.poll_id,
                PollReaction.kind,
                func.count(PollReaction.id),
            )
            .filter(PollReaction.poll_id.in_(citizen_poll_ids))
            .group_by(PollReaction.poll_id, PollReaction.kind)
            .all()
        ):
            d = poll_rxn_counts.setdefault(int(pid), {"up": 0, "down": 0})
            if k in d:
                d[k] = int(cnt or 0)
        if me_citizen or me_rep or me_candidate:
            prq = db.query(PollReaction.poll_id, PollReaction.kind).filter(
                PollReaction.poll_id.in_(citizen_poll_ids)
            )
            if me_citizen is not None:
                for pid, k in prq.filter(PollReaction.citizen_id == me_citizen.id).all():
                    my_reactions_by_poll.setdefault(int(pid), {})["citizen"] = k
            if me_rep is not None:
                for pid, k in prq.filter(PollReaction.author_rep_id == me_rep.id).all():
                    my_reactions_by_poll.setdefault(int(pid), {})["rep"] = k
            if me_candidate is not None:
                for pid, k in prq.filter(PollReaction.author_candidate_id == me_candidate.id).all():
                    my_reactions_by_poll.setdefault(int(pid), {})["candidate"] = k
    # Candidate-id narrowing — ElectionsService is an in-memory dict so
    # there's no SQL way to ask "is this id a candidate." We do this in
    # Python after the SQL pass. Three cases to handle in multi-kind mode:
    #
    #   • 'candidate' present, 'citizen' absent → keep only candidate-tagged.
    #   • 'citizen' present,  'candidate' absent → drop candidate-tagged.
    #   • both (or neither) present → keep everything from the SQL pass.
    #
    # With the result set capped at 300 this is trivially cheap.
    if kinds:
        has_candidate = "candidate" in kinds
        has_citizen = "citizen" in kinds
        if has_candidate and not has_citizen:
            # Only candidate-page polls should remain from the union.
            # rep + standalone polls (if requested) pass through unchanged.
            rows = [
                p for p in rows
                if (p.author_kind == "rep")
                or (p.author_kind == "citizen" and p.target_official_id is None and "standalone" in kinds)
                or is_candidate_id(p.target_official_id)
            ]
        elif has_citizen and not has_candidate:
            # Citizen on rep pages only — drop candidate-page polls.
            rows = [p for p in rows if not is_candidate_id(p.target_official_id)]

    items: List[Dict[str, Any]] = []
    for poll in rows:
        # Per-option vote counts (re-use the same query shape as
        # popular_polls; this is N+1 over polls in the result set
        # but with limit=100 it's fine).
        option_rows = (
            db.query(
                PollOption.id,
                PollOption.text,
                PollOption.sort_order,
                func.count(PollVote.id).label("vcnt"),
            )
            .outerjoin(PollVote, PollVote.option_id == PollOption.id)
            .filter(PollOption.poll_id == poll.id)
            .group_by(PollOption.id, PollOption.text, PollOption.sort_order)
            .order_by(PollOption.sort_order)
            .all()
        )
        total = sum(int(r.vcnt or 0) for r in option_rows)
        options = []
        for _oid, text, _so, vcnt in option_rows:
            pct = round((int(vcnt or 0) / total) * 100) if total else 0
            options.append({
                "id": int(_oid),
                "label": text,
                "percent": pct,
                "count": int(vcnt or 0),
            })

        # Comment count by author_kind.
        if poll.author_kind == "citizen":
            comments = (
                db.query(func.count(PollComment.id))
                .filter(PollComment.poll_id == poll.id)
                .filter(PollComment.deleted_at.is_(None))
                .scalar()
                or 0
            )
        else:
            comments = (
                db.query(func.count(PostComment.id))
                .filter(PostComment.post_id == poll.post_id)
                .filter(PostComment.deleted_at.is_(None))
                .scalar()
                or 0
            )

        # Author resolution + display kind chip.
        # display_kind: 'rep' | 'citizen' | 'standalone'
        author = "(unknown)"
        role = None
        party = None
        official_id: Optional[str] = None
        if poll.author_kind == "citizen":
            cz = (
                db.query(CitizenAccount)
                .filter(CitizenAccount.id == poll.author_citizen_id)
                .first()
            )
            author = cz.display_name if cz else "Citizen"
            role_parts: list[str] = []
            if cz and cz.state:
                role_parts.append(cz.state)
            if cz and cz.city:
                role_parts.append(cz.city)
            role = " · ".join(role_parts) if role_parts else None
            official_id = poll.target_official_id
            # Three citizen-poll display kinds:
            #   standalone — no target page at all
            #   candidate  — target_official_id is a candidate registry id
            #   citizen    — target_official_id is a rep id (default)
            if poll.target_official_id is None:
                display_kind = "standalone"
            elif is_candidate_id(poll.target_official_id):
                display_kind = "candidate"
            else:
                display_kind = "citizen"
        else:
            # Rep- or candidate-authored poll attached to a Post. Branch
            # on the Post's author fields (mirrors the /posts endpoint at
            # feed.py:1086) — candidate posts populate author_candidate_id,
            # rep posts populate author_id. Pre-fix, this branch hardcoded
            # display_kind='rep' which mis-labeled every candidate poll
            # on the /polls feed (and fell back to the literal string
            # "Representative" for the author name because the
            # RepAccount lookup returned None for a candidate's post).
            post = (
                db.query(Post).filter(Post.id == poll.post_id).first()
                if poll.post_id else None
            )
            if post and post.author_candidate_id:
                cand = (
                    db.query(CandidateAccount)
                    .filter(CandidateAccount.id == post.author_candidate_id)
                    .first()
                )
                author = cand.display_name if cand else "Candidate"
                # CandidateAccount has no role column by design (see model
                # docstring) — seeking_office lives in the registry and
                # would drift if cached here. Leave role None; the
                # page_tag chip carries the candidate context.
                role = None
                official_id = post.official_id
                display_kind = "candidate"
                party = _party_for(official_id) if official_id else None
            else:
                rep = (
                    db.query(RepAccount).filter(RepAccount.id == post.author_id).first()
                    if post else None
                )
                author = rep.display_name if rep else "Representative"
                role = rep.role if rep else None
                official_id = post.official_id if post else None
                display_kind = "rep"
                # Party lookup — re-use the lazy index built for the
                # National Activity feed earlier in this module.
                party = _party_for(official_id) if official_id else None

        # Page-tag for the chip. Standalone polls get the literal
        # 'Standalone' string at the UI layer; this endpoint returns
        # None for that case so the frontend can branch.
        page_tag = resolve_page_tag(db, official_id) if official_id else None

        # Per-viewer context. Anonymous viewers get is_author=False
        # and voter_choice_id=None. Citizens see is_author=True on
        # their own standalone / page-scoped polls (only citizens
        # author citizen polls today, so the comparison is single-
        # identity safe). Reps + candidates don't author citizen
        # polls today so is_author is always False for them.
        is_author = bool(
            me_citizen is not None
            and poll.author_kind == "citizen"
            and poll.author_citizen_id == me_citizen.id
        )
        # Per-identity engagement state. UI picks: voter_choice_id is
        # the resolved single value (legacy callers); voter_choices is
        # the per-identity map IdentityPicker reads. my_reactions is
        # the per-identity reaction map — sourced from the parent
        # post for REP polls, from PollReaction for CITIZEN polls.
        per_identity_votes = viewer_votes_by_identity.get(int(poll.id), {})
        if poll.author_kind == "rep" and poll.post_id:
            per_identity_rxns = my_reactions_by_post.get(int(poll.post_id), {})
        elif poll.author_kind == "citizen":
            per_identity_rxns = my_reactions_by_poll.get(int(poll.id), {})
        else:
            per_identity_rxns = {}
        viewer = {
            "voter_choice_id": _resolved_choice(poll.id),
            "voter_choices": per_identity_votes,
            "my_reactions": per_identity_rxns,
            "is_author": is_author,
        }

        # Engagement counters. Likes + dislikes are sourced from the
        # right table per poll kind:
        #   • Rep polls  → PostReaction on the parent Post
        #   • Citizen polls → PollReaction on the poll itself
        # Returned explicitly so the frontend doesn't have to special-
        # case "likes missing" — every poll item has the same shape.
        if poll.author_kind == "rep" and poll.post_id:
            likes = post_likes.get(int(poll.post_id), 0)
            dislikes = post_dislikes.get(int(poll.post_id), 0)
        elif poll.author_kind == "citizen":
            counts = poll_rxn_counts.get(int(poll.id), {"up": 0, "down": 0})
            likes = int(counts.get("up", 0))
            dislikes = int(counts.get("down", 0))
        else:
            likes = 0
            dislikes = 0

        items.append(
            {
                "id": poll.id,
                "kind": display_kind,
                "author": author,
                "role": role,
                "party": party,
                "official_id": official_id,
                "page_tag": page_tag,
                "created_at": (poll.created_at.isoformat() if poll.created_at else None),
                "question": poll.question,
                "options": options,
                "votes": total,
                "comments": int(comments),
                "likes": likes,
                "dislikes": dislikes,
                # Cross-feed link to the post this poll was attached
                # to. Non-null for rep polls (every rep poll is
                # attached to a Post by construction); null for
                # citizen polls. The frontend uses this to render
                # the "from a post" badge on the polls feed.
                "parent_post_id": int(poll.post_id) if poll.post_id else None,
                "viewer": viewer,
            }
        )
    return {"items": items}


# ── /posts — full posts feed (the new /posts tab on the redesign) ───
@router.get("/posts")
def posts_feed(
    limit: int = Query(default=100, ge=1, le=300),
    kind: Optional[List[str]] = Query(
        default=None,
        description=(
            "Filter by one or more of 'rep' | 'candidate'. Repeat the "
            "parameter for additive multi-select. Omit for the "
            "unfiltered feed."
        ),
    ),
    state: Optional[str] = Query(
        default=None,
        min_length=2,
        max_length=2,
        pattern=r"^[A-Za-z]{2}$",
        description=(
            "Filter to posts whose author represents the given 2-letter "
            "state. Matches RepAccount.owner_state for rep posts and "
            "CandidateAccount.owner_state for candidate posts. Case-"
            "insensitive."
        ),
    ),
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
) -> dict:
    """Every non-deleted post from verified reps + candidates, sorted
    by engagement score so the most-engaged posts surface first.

    Pairs with /api/feed/polls; together they back the dual-feed
    /polls + /posts redesign. Citizens can't author posts, so this
    surface has no 'citizen' or 'standalone' kind.

    Engagement score:
        likes + dislikes + comments + attached_poll_votes
      where attached_poll_votes is the total option-vote count on the
      Poll attached to the post (0 if no poll is attached). The score
      is computed in Python at response time over the full non-deleted
      result set, then the top `limit` are returned. There's no
      cached engagement column yet; with the early-launch volume the
      Python sum over ~hundreds of posts is comfortably cheap and
      keeps the model schema unchanged.

    Item shape:
      {
        id: int,
        kind: 'rep' | 'candidate',
        author: str,
        role: str | null,
        party: 'R'|'D'|'I'|null,
        official_id: str,
        page_tag: str | null,
        created_at: iso8601,
        body: str,
        likes: int,
        dislikes: int,
        comments: int,
        # Cross-feed link to the attached poll (if any). Non-null
        # when the post carries a poll; null otherwise. The frontend
        # uses this to render the "+ poll attached" badge.
        attached_poll_id: int | null,
        has_attached_poll: bool,
        # Total votes across the attached poll's options. Included
        # in the engagement-score sum, returned as a field so the
        # frontend can render a hint of activity in the poll badge.
        attached_poll_votes: int,
        viewer: {
          # Per-viewer reaction state. 'up' / 'down' / null. Mirrors
          # the polls feed's viewer block; useful for the like/dislike
          # button highlight without a separate /reactions round-trip.
          reaction: str | null,
        }
      }
    """
    from app.services.page_tags import resolve_page_tag
    from sqlalchemy import or_

    kinds: List[str] = [k for k in (kind or []) if k] or []

    def _kind_clause(k: str):
        if k == "rep":
            return Post.author_id.is_not(None)
        if k == "candidate":
            return Post.author_candidate_id.is_not(None)
        return None

    q = db.query(Post).filter(Post.deleted_at.is_(None))
    if kinds:
        clauses = [c for k in kinds if (c := _kind_clause(k)) is not None]
        if clauses:
            q = q.filter(or_(*clauses))

    state_upper = state.upper() if state else None
    if state_upper:
        q = (
            q.outerjoin(RepAccount, RepAccount.id == Post.author_id)
            .outerjoin(CandidateAccount, CandidateAccount.id == Post.author_candidate_id)
            .filter(
                func.coalesce(
                    RepAccount.owner_state,
                    CandidateAccount.owner_state,
                )
                == state_upper
            )
        )

    # Pull the full filtered set so we can score-sort in Python. The
    # `limit` is applied after sort, not at SQL — otherwise we'd be
    # ordering by created_at and chopping before engagement entered
    # the picture. Within the cap (300) this is a few hundred rows
    # tops with current usage.
    posts = q.all()

    if not posts:
        return {"items": []}

    post_ids = [p.id for p in posts]

    # Batched: reaction counts per post (up + down separately).
    rxn_rows = (
        db.query(
            PostReaction.post_id,
            PostReaction.kind,
            func.count(PostReaction.id),
        )
        .filter(PostReaction.post_id.in_(post_ids))
        .group_by(PostReaction.post_id, PostReaction.kind)
        .all()
    )
    likes_by_post: Dict[int, int] = {}
    dislikes_by_post: Dict[int, int] = {}
    for pid, k, cnt in rxn_rows:
        if k == "up":
            likes_by_post[int(pid)] = int(cnt or 0)
        elif k == "down":
            dislikes_by_post[int(pid)] = int(cnt or 0)

    # Batched: non-deleted comment counts per post.
    cmt_rows = (
        db.query(
            PostComment.post_id,
            func.count(PostComment.id),
        )
        .filter(PostComment.post_id.in_(post_ids))
        .filter(PostComment.deleted_at.is_(None))
        .group_by(PostComment.post_id)
        .all()
    )
    comments_by_post: Dict[int, int] = {pid: int(cnt or 0) for pid, cnt in cmt_rows}

    # Batched: attached-poll lookup. Poll.post_id is unique so this
    # is at most one Poll per Post. We also fetch each attached poll's
    # total vote count in the same join — saves an N+1 in the items
    # loop and folds neatly into the engagement-score formula below.
    poll_rows = (
        db.query(
            Poll.id,
            Poll.post_id,
            func.count(PollVote.id),
        )
        .outerjoin(PollOption, PollOption.poll_id == Poll.id)
        .outerjoin(PollVote, PollVote.option_id == PollOption.id)
        .filter(Poll.post_id.in_(post_ids))
        .filter(Poll.archived_at.is_(None))
        .group_by(Poll.id, Poll.post_id)
        .all()
    )
    poll_id_by_post: Dict[int, int] = {}
    poll_votes_by_post: Dict[int, int] = {}
    for poll_id, post_id, vcnt in poll_rows:
        poll_id_by_post[int(post_id)] = int(poll_id)
        poll_votes_by_post[int(post_id)] = int(vcnt or 0)

    # Batched: viewer's reaction per post, KEPT PER-IDENTITY so the
    # IdentityPicker can mark "✓ Liked" / "✓ Disliked" against the
    # specific identity that acted. Three response fields per item:
    #   • viewer.reaction       — legacy single resolved value (citizen
    #                              wins, then rep, then candidate)
    #   • viewer.my_reaction    — same as reaction (alias for
    #                              consistency with PostCard's shape)
    #   • viewer.my_reactions   — { citizen, rep, candidate } per-identity
    viewer_rxns_by_identity: Dict[int, Dict[str, str]] = {}
    if me_citizen is not None:
        for pid, k in (
            db.query(PostReaction.post_id, PostReaction.kind)
            .filter(PostReaction.post_id.in_(post_ids))
            .filter(PostReaction.citizen_id == me_citizen.id)
            .all()
        ):
            viewer_rxns_by_identity.setdefault(int(pid), {})["citizen"] = k
    if me_rep is not None:
        for pid, k in (
            db.query(PostReaction.post_id, PostReaction.kind)
            .filter(PostReaction.post_id.in_(post_ids))
            .filter(PostReaction.author_rep_id == me_rep.id)
            .all()
        ):
            viewer_rxns_by_identity.setdefault(int(pid), {})["rep"] = k
    if me_candidate is not None:
        for pid, k in (
            db.query(PostReaction.post_id, PostReaction.kind)
            .filter(PostReaction.post_id.in_(post_ids))
            .filter(PostReaction.author_candidate_id == me_candidate.id)
            .all()
        ):
            viewer_rxns_by_identity.setdefault(int(pid), {})["candidate"] = k

    def _resolved_reaction(post_id: int) -> Optional[str]:
        m = viewer_rxns_by_identity.get(int(post_id), {})
        return m.get("citizen") or m.get("rep") or m.get("candidate")

    # Score, sort, slice. Tiebreaker is created_at DESC so newer posts
    # win when engagement is equal (matches the design brief's note
    # that recency is the tiebreaker).
    def _score(p: Post) -> int:
        return (
            likes_by_post.get(int(p.id), 0)
            + dislikes_by_post.get(int(p.id), 0)
            + comments_by_post.get(int(p.id), 0)
            + poll_votes_by_post.get(int(p.id), 0)
        )

    posts.sort(
        key=lambda p: (
            -_score(p),
            -(p.created_at.timestamp() if p.created_at else 0),
        )
    )
    posts = posts[:limit]

    # Resolve authors in two batched lookups (one per identity kind).
    rep_ids = [p.author_id for p in posts if p.author_id]
    cand_ids = [p.author_candidate_id for p in posts if p.author_candidate_id]
    reps_by_id: Dict[int, RepAccount] = (
        {r.id: r for r in db.query(RepAccount).filter(RepAccount.id.in_(rep_ids)).all()}
        if rep_ids
        else {}
    )
    cands_by_id: Dict[int, CandidateAccount] = (
        {c.id: c for c in db.query(CandidateAccount).filter(CandidateAccount.id.in_(cand_ids)).all()}
        if cand_ids
        else {}
    )

    items: List[Dict[str, Any]] = []
    for p in posts:
        if p.author_id and p.author_id in reps_by_id:
            rep = reps_by_id[p.author_id]
            kind_label = "rep"
            author = rep.display_name
            role = rep.role
            party = _party_for(p.official_id) if p.official_id else None
        elif p.author_candidate_id and p.author_candidate_id in cands_by_id:
            cand = cands_by_id[p.author_candidate_id]
            kind_label = "candidate"
            author = cand.display_name
            # CandidateAccount has no `role` column by design; the
            # seeking_office comes from ElectionsService at render
            # time on rep pages. For the feed we surface a stable
            # short string here and leave the deep label to the
            # page_tag.
            role = None
            party = _party_for(p.official_id) if p.official_id else None
        else:
            # Orphan post — author row was deleted out from under
            # it. Show what we have and move on; the row is still
            # useful for moderation/audit but won't render the rich
            # author tile.
            kind_label = "rep" if p.author_id else "candidate"
            author = "(unknown)"
            role = None
            party = None

        page_tag = resolve_page_tag(db, p.official_id) if p.official_id else None
        attached_poll_id = poll_id_by_post.get(int(p.id))
        attached_poll_votes = poll_votes_by_post.get(int(p.id), 0)

        items.append(
            {
                "id": int(p.id),
                "kind": kind_label,
                "author": author,
                "role": role,
                "party": party,
                "official_id": p.official_id,
                "page_tag": page_tag,
                "created_at": (p.created_at.isoformat() if p.created_at else None),
                "body": p.body,
                "likes": likes_by_post.get(int(p.id), 0),
                "dislikes": dislikes_by_post.get(int(p.id), 0),
                "comments": comments_by_post.get(int(p.id), 0),
                "attached_poll_id": attached_poll_id,
                "has_attached_poll": attached_poll_id is not None,
                "attached_poll_votes": attached_poll_votes,
                "viewer": {
                    # Legacy single-value field (citizen wins). Kept for
                    # backwards-compat with callers that pre-date the
                    # per-identity shape.
                    "reaction": _resolved_reaction(p.id),
                    # Alias for ReactionSummary parity — PostCard reads
                    # both `my_reaction` and `my_reactions` per the
                    # Phase 6 multi-identity contract.
                    "my_reaction": _resolved_reaction(p.id),
                    "my_reactions": viewer_rxns_by_identity.get(int(p.id), {}),
                },
            }
        )
    return {"items": items}
