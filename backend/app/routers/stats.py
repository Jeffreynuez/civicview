# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Public stats router (Task #70).

Powers the "CivicView Stats" tile cluster in the National Officials
panel hero. Returns a small bundle of structural facts (how many
Senators / Representatives / SCOTUS Justices the US Congress + court
contain) alongside CivicView-side activity counts (reps who have
claimed their Page, verified citizens, demo accounts created).

The three structural counts (100 / 435 / 9) are baked in here rather
than counted from the federal_officials data because:

  1. They are constitutional / statutory facts about US government,
     not CivicView state. They don't change when our data layer
     reseeds or when a Senator dies and the seat sits vacant.
  2. The visitor reads them as "the surface area of the country this
     app covers," not "current head-count of body X." Showing 99 or
     434 during a vacancy would be confusing, not informative.

The activity counts come from live `COUNT()` over the relevant
identity tables. Cheap (each table is at most low-thousands of rows
at launch) and cache-able later if traffic warrants. No filters or
parameters — this endpoint always returns the same shape.

Demo accounts:
  - `demo_accounts_created` counts CitizenAccount rows where
    verified=False. Pre-ID.me launch every signup is unverified, so
    this is effectively "total signups." Once ID.me ships we plan to
    drop this tile from the hero and surface it on the expanded
    /stats page instead (Task #71).
  - `verified_citizens` counts the verified=True rows. Today this
    will return 0 until ID.me goes live — that's fine, the tile
    still renders and gives the visitor an honest signal of "we
    don't yet have verified citizens" rather than a fake number.

Reps joined:
  - Counts RepAccount rows where is_active=True. Seeded demo accounts
    are also rows in this table, so the count includes them — this
    matches the user-visible reality (a visitor looking at the panel
    sees those demo Pages and would expect them counted).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import (
    BillSummary,
    CandidateAccount,
    CitizenAccount,
    CommentReaction,
    EoSummary,
    Poll,
    PollComment,
    PollCommentReaction,
    PollReaction,
    PollVote,
    Post,
    PostComment,
    PostReaction,
    RepAccount,
    SavedItem,
    TrackedBill,
    TrackedElection,
    TrackedOfficial,
    VoteExplainer,
)


logger = logging.getLogger(__name__)
router = APIRouter()


class StatsSummary(BaseModel):
    """Public stats bundle for the hero tile cluster."""

    # Structural / aspirational coverage facts — constants.
    senators: int
    representatives: int
    scotus_justices: int

    # CivicView-side activity counts — live.
    reps_joined: int
    verified_citizens: int
    demo_accounts_created: int


@router.get("/summary", response_model=StatsSummary)
def stats_summary(db: Session = Depends(get_db)) -> StatsSummary:
    """Return the small bundle of stats rendered on the home hero."""
    try:
        reps_joined = (
            db.query(func.count(RepAccount.id))
            .filter(RepAccount.is_active.is_(True))
            .scalar()
            or 0
        )
    except Exception:
        logger.exception("stats_summary: reps_joined count failed; returning 0")
        reps_joined = 0

    try:
        verified_citizens = (
            db.query(func.count(CitizenAccount.id))
            .filter(CitizenAccount.verified.is_(True))
            .scalar()
            or 0
        )
    except Exception:
        logger.exception("stats_summary: verified_citizens count failed; returning 0")
        verified_citizens = 0

    try:
        demo_accounts_created = (
            db.query(func.count(CitizenAccount.id))
            .filter(CitizenAccount.verified.is_(False))
            .scalar()
            or 0
        )
    except Exception:
        logger.exception(
            "stats_summary: demo_accounts_created count failed; returning 0"
        )
        demo_accounts_created = 0

    return StatsSummary(
        senators=100,
        representatives=435,
        scotus_justices=9,
        reps_joined=int(reps_joined),
        verified_citizens=int(verified_citizens),
        demo_accounts_created=int(demo_accounts_created),
    )

# ── Expanded stats (Task #71) ───────────────────────────────────────
#
# Powers the /stats analytics page. Heavier than /summary (a dozen
# COUNT()s + two GROUP BYs + two 8-week time buckets), so results are
# memoized in-process for STATS_DETAIL_TTL seconds. Single-process
# Render deploy → a module-level cache is effective; if we ever scale
# to multiple workers each holds its own copy, which is still correct
# (just N cold fills instead of one).
#
# Design rules (CLAUDE.md):
#   • Separate endpoint from /summary so the home hero stays sub-100ms
#     no matter how much depth this page grows.
#   • Structural government numbers (535 / 100 / 435 / 9 / 50) are
#     constitutional/statutory facts, deliberately constants — same
#     rationale documented on /summary above.
#   • Everything else is a live COUNT() over our own tables. Nothing
#     fabricated, nothing estimated.

STATS_DETAIL_TTL = 60.0  # seconds
_detail_cache: dict = {"at": 0.0, "payload": None}


class WeekBucket(BaseModel):
    week_start: str  # ISO date (Monday) of the bucket
    count: int


class StateBucket(BaseModel):
    state: str
    count: int


class StatsDetail(BaseModel):
    """Payload for the /stats analytics page (Task #71)."""

    # Government structure — constants (see /summary docstring).
    senators: int
    representatives: int
    scotus_justices: int
    states_covered: int

    # Identity counts.
    citizens_total: int
    citizens_verified: int
    citizens_demo: int
    reps_joined: int
    candidates_joined: int

    # Content + engagement counts.
    posts: int
    polls: int
    poll_votes: int
    comments: int          # post + poll comments combined
    reactions: int         # all four reaction tables combined
    tracked_items: int     # bills + officials + elections
    saved_items: int

    # Civic-content coverage — live counts of our explainer corpus.
    bill_summaries: int
    eo_summaries: int
    vote_explainers: int

    # Trends — last 8 ISO weeks, oldest first. Buckets with zero
    # activity are included so charts don't skip weeks.
    signups_by_week: list[WeekBucket]
    poll_votes_by_week: list[WeekBucket]

    # Geography — citizens per state, descending, top 15.
    citizens_by_state: list[StateBucket]

    generated_at: str


def _count(db: Session, query_fn, label: str) -> int:
    """COUNT() with the same belt-and-suspenders error handling the
    /summary endpoint uses — a single failed aggregate degrades to 0
    instead of failing the whole payload."""
    try:
        return int(query_fn() or 0)
    except Exception:
        logger.exception("stats_detail: %s count failed; returning 0", label)
        return 0


def _week_buckets(rows, weeks: int = 8) -> list[WeekBucket]:
    """Bucket a list of datetimes into the last `weeks` ISO weeks
    (Monday-start), oldest first, zero-filled. Done in Python rather
    than SQL so the same code path works on SQLite (dev/tests) and
    Postgres (prod) — row counts here are low-thousands at most."""
    from datetime import datetime, timedelta

    today = datetime.utcnow().date()
    this_monday = today - timedelta(days=today.weekday())
    starts = [this_monday - timedelta(weeks=w) for w in range(weeks - 1, -1, -1)]
    counts = {s: 0 for s in starts}
    cutoff = starts[0]
    for (dt,) in rows:
        if dt is None:
            continue
        d = dt.date() if hasattr(dt, "date") else dt
        monday = d - timedelta(days=d.weekday())
        if monday >= cutoff and monday in counts:
            counts[monday] += 1
    return [WeekBucket(week_start=s.isoformat(), count=counts[s]) for s in starts]


@router.get("/detail", response_model=StatsDetail)
def stats_detail(db: Session = Depends(get_db)) -> StatsDetail:
    """Return the expanded stats bundle for the /stats page. Cached
    in-process for STATS_DETAIL_TTL seconds."""
    import time
    from datetime import datetime, timedelta

    now = time.monotonic()
    if _detail_cache["payload"] is not None and now - _detail_cache["at"] < STATS_DETAIL_TTL:
        return _detail_cache["payload"]

    c = lambda q, label: _count(db, q, label)  # noqa: E731

    citizens_total = c(lambda: db.query(func.count(CitizenAccount.id)).scalar(), "citizens_total")
    citizens_verified = c(
        lambda: db.query(func.count(CitizenAccount.id)).filter(CitizenAccount.verified.is_(True)).scalar(),
        "citizens_verified",
    )
    comments = (
        c(lambda: db.query(func.count(PostComment.id)).scalar(), "post_comments")
        + c(lambda: db.query(func.count(PollComment.id)).scalar(), "poll_comments")
    )
    reactions = (
        c(lambda: db.query(func.count(PostReaction.id)).scalar(), "post_reactions")
        + c(lambda: db.query(func.count(PollReaction.id)).scalar(), "poll_reactions")
        + c(lambda: db.query(func.count(CommentReaction.id)).scalar(), "comment_reactions")
        + c(lambda: db.query(func.count(PollCommentReaction.id)).scalar(), "poll_comment_reactions")
    )
    tracked_items = (
        c(lambda: db.query(func.count(TrackedBill.id)).scalar(), "tracked_bills")
        + c(lambda: db.query(func.count(TrackedOfficial.id)).scalar(), "tracked_officials")
        + c(lambda: db.query(func.count(TrackedElection.id)).scalar(), "tracked_elections")
    )

    # Trends — fetch just the timestamp column for the window, bucket
    # in Python (SQLite + Postgres compatible).
    eight_weeks_ago = datetime.utcnow() - timedelta(weeks=8)
    try:
        signup_rows = (
            db.query(CitizenAccount.created_at)
            .filter(CitizenAccount.created_at >= eight_weeks_ago)
            .all()
        )
    except Exception:
        logger.exception("stats_detail: signup trend query failed")
        signup_rows = []
    try:
        vote_rows = (
            db.query(PollVote.created_at)
            .filter(PollVote.created_at >= eight_weeks_ago)
            .all()
        )
    except Exception:
        logger.exception("stats_detail: vote trend query failed")
        vote_rows = []

    try:
        state_rows = (
            db.query(CitizenAccount.state, func.count(CitizenAccount.id))
            .group_by(CitizenAccount.state)
            .order_by(func.count(CitizenAccount.id).desc())
            .limit(15)
            .all()
        )
    except Exception:
        logger.exception("stats_detail: by-state query failed")
        state_rows = []

    payload = StatsDetail(
        senators=100,
        representatives=435,
        scotus_justices=9,
        states_covered=50,
        citizens_total=citizens_total,
        citizens_verified=citizens_verified,
        citizens_demo=max(citizens_total - citizens_verified, 0),
        reps_joined=c(
            lambda: db.query(func.count(RepAccount.id)).filter(RepAccount.is_active.is_(True)).scalar(),
            "reps_joined",
        ),
        candidates_joined=c(
            lambda: db.query(func.count(CandidateAccount.id)).filter(CandidateAccount.is_active.is_(True)).scalar(),
            "candidates_joined",
        ),
        posts=c(lambda: db.query(func.count(Post.id)).scalar(), "posts"),
        polls=c(lambda: db.query(func.count(Poll.id)).scalar(), "polls"),
        poll_votes=c(lambda: db.query(func.count(PollVote.id)).scalar(), "poll_votes"),
        comments=comments,
        reactions=reactions,
        tracked_items=tracked_items,
        saved_items=c(lambda: db.query(func.count(SavedItem.id)).scalar(), "saved_items"),
        bill_summaries=c(lambda: db.query(func.count(BillSummary.id)).scalar(), "bill_summaries"),
        eo_summaries=c(lambda: db.query(func.count(EoSummary.id)).scalar(), "eo_summaries"),
        vote_explainers=c(lambda: db.query(func.count(VoteExplainer.id)).scalar(), "vote_explainers"),
        signups_by_week=_week_buckets(signup_rows),
        poll_votes_by_week=_week_buckets(vote_rows),
        citizens_by_state=[
            StateBucket(state=s or "—", count=int(n)) for s, n in state_rows
        ],
        generated_at=datetime.utcnow().isoformat() + "Z",
    )
    _detail_cache["at"] = now
    _detail_cache["payload"] = payload
    return payload

