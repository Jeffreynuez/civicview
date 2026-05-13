# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
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
from app.models.pages import (
    CitizenAccount,
    Poll,
    PollComment,
    PollOption,
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
