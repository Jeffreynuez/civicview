# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Activity archive router (2026-07-26, Jeffrey's ask: "an archive for an
account's comments and notifications when they receive replies on
their comments. The archive should live in their dashboards. Rep and
candidate accounts should have the same features.").

  GET /api/activity/comments       → the caller's own comments (posts
                                     + citizen polls), newest first
  GET /api/activity/notifications  → full notification history
                                     INCLUDING bell-cleared rows
                                     (kind-filterable; ?kind=reply is
                                     the "replies I've received" view)
  GET /api/activity/dashboard      → the citizen dashboard Overview:
                                     this month's counts, the last 7
                                     days and what's coming up
                                     (2026-10-19)

Identity model: all three account kinds get the identical feature.
The ?identity= param names which signed-in identity's archive to
read; when omitted, the resolver falls back to the standard
citizen → rep → candidate precedence over whichever sessions are
active. Requesting an identity you don't hold a session for is a 401,
never a leak.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import (
    BillReaction,
    CandidateAccount,
    CitizenAccount,
    CommentReaction,
    Poll,
    PollComment,
    PollCommentReaction,
    PollReaction,
    PollVote,
    Post,
    PostComment,
    PostReaction,
    RepAccount,
    RepEvent,
    TrackedOfficial,
)
from app.routers.events import _filter_upcoming_rep_events, _rep_event_to_dict
from app.services import election_reminders, notifications_inapp

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_LIMIT = 100


def _resolve_identity(
    identity: Optional[str],
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount],
    me_candidate: Optional[CandidateAccount],
) -> tuple[str, int]:
    """Map the requested identity onto an ACTIVE session, or 401.
    No identity requested → citizen → rep → candidate precedence
    (matches the backend-wide engagement resolution order)."""
    if identity in (None, ""):
        if me_citizen is not None:
            return ("citizen", me_citizen.id)
        if me_rep is not None:
            return ("rep", me_rep.id)
        if me_candidate is not None:
            return ("candidate", me_candidate.id)
    elif identity == "citizen" and me_citizen is not None:
        return ("citizen", me_citizen.id)
    elif identity == "rep" and me_rep is not None:
        return ("rep", me_rep.id)
    elif identity == "candidate" and me_candidate is not None:
        return ("candidate", me_candidate.id)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sign in with the requested identity to view its archive.",
    )


# ── Comments archive ─────────────────────────────────────────────────


class ArchivedComment(BaseModel):
    id: int
    source: str                      # 'post' | 'poll'
    body: str
    created_at: datetime
    edited: bool = False
    deleted: bool = False
    post_id: Optional[int] = None
    poll_id: Optional[int] = None
    official_id: Optional[str] = None   # page to deep-link to
    context: Optional[str] = None       # post/poll snippet for display
    is_reply: bool = False


class CommentsArchiveResponse(BaseModel):
    items: List[ArchivedComment] = []
    has_more: bool = False


def _snippet(text: Optional[str], n: int = 90) -> Optional[str]:
    if not text:
        return None
    text = text.strip()
    return text if len(text) <= n else (text[: n - 1].rstrip() + "…")


@router.get("/comments", response_model=CommentsArchiveResponse)
def list_my_comments(
    identity: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    kind, uid = _resolve_identity(identity, me_citizen, me_rep, me_candidate)

    pc_col = {
        "citizen": PostComment.citizen_id,
        "rep": PostComment.author_rep_id,
        "candidate": PostComment.author_candidate_id,
    }[kind]
    plc_col = {
        "citizen": PollComment.citizen_id,
        "rep": PollComment.author_rep_id,
        "candidate": PollComment.author_candidate_id,
    }[kind]

    # Merged newest-first pagination across the two comment tables:
    # each side over-fetches to offset+limit+1, then a Python merge
    # sorts and slices. Fine at per-user comment volumes; revisit
    # with a UNION query if a power user ever makes this hot.
    fetch_n = offset + limit + 1

    post_rows = (
        db.query(PostComment, Post.official_id, Post.body)
        .join(Post, PostComment.post_id == Post.id)
        .filter(pc_col == uid)
        .order_by(PostComment.created_at.desc())
        .limit(fetch_n)
        .all()
    )
    poll_rows = (
        db.query(PollComment, Poll.target_official_id, Poll.question)
        .join(Poll, PollComment.poll_id == Poll.id)
        .filter(plc_col == uid)
        .order_by(PollComment.created_at.desc())
        .limit(fetch_n)
        .all()
    )

    merged: list[ArchivedComment] = []
    for c, official_id, post_body in post_rows:
        merged.append(ArchivedComment(
            id=c.id,
            source="post",
            body=c.body or "",
            created_at=c.created_at,
            edited=getattr(c, "edited_at", None) is not None,
            deleted=c.deleted_at is not None,
            post_id=c.post_id,
            official_id=official_id,
            context=_snippet(post_body),
            is_reply=getattr(c, "parent_comment_id", None) is not None,
        ))
    for c, target_official_id, question in poll_rows:
        merged.append(ArchivedComment(
            id=c.id,
            source="poll",
            body=c.body or "",
            created_at=c.created_at,
            edited=getattr(c, "edited_at", None) is not None,
            deleted=c.deleted_at is not None,
            poll_id=c.poll_id,
            official_id=target_official_id,
            context=_snippet(question),
            is_reply=getattr(c, "parent_comment_id", None) is not None,
        ))

    merged.sort(key=lambda x: x.created_at, reverse=True)
    window = merged[offset: offset + limit]
    return CommentsArchiveResponse(
        items=window,
        has_more=len(merged) > offset + limit,
    )


# ── Notifications archive ────────────────────────────────────────────


class ArchivedNotification(BaseModel):
    id: int
    recipient_kind: str
    kind: str
    payload: dict
    created_at: datetime
    read_at: Optional[datetime] = None
    cleared_at: Optional[datetime] = None


class NotificationsArchiveResponse(BaseModel):
    items: List[ArchivedNotification] = []
    has_more: bool = False


@router.get("/notifications", response_model=NotificationsArchiveResponse)
def list_notification_archive(
    identity: Optional[str] = Query(default=None),
    kind: Optional[str] = Query(default=None, max_length=32),
    limit: int = Query(default=20, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    ident_kind, uid = _resolve_identity(identity, me_citizen, me_rep, me_candidate)

    rows = notifications_inapp.list_for_recipient(
        db, recipient_kind=ident_kind, recipient_id=uid,
        limit=limit + 1, offset=offset,
        include_cleared=True, kind=kind,
    )
    has_more = len(rows) > limit
    rows = rows[:limit]

    items = []
    for n in rows:
        try:
            payload = json.loads(n.payload_json or "{}")
        except Exception:
            payload = {}
        items.append(ArchivedNotification(
            id=n.id,
            recipient_kind=n.recipient_kind,
            kind=n.kind,
            payload=payload,
            created_at=n.created_at,
            read_at=n.read_at,
            cleared_at=n.cleared_at,
        ))
    return NotificationsArchiveResponse(items=items, has_more=has_more)


# ── Citizen dashboard (2026-10-19) ───────────────────────────────────
#
# The Overview tab's "Your activity" tiles, "Recent activity" and
# "Coming up" used to have no data source: three tiles read a
# hard-coded 0 and the two cards always showed their empty state.
# This one read gives them real data that CivicView already holds:
#
#   counts    this month's poll votes, comments and reactions by the
#             signed-in citizen (since = the start of the month on the
#             citizen's own clock, sent by the browser)
#   recent    the last 7 days of their notifications, bell-cleared
#             rows included (the same rows the bell and the archive
#             show, so the wording and the links agree)
#   upcoming  their state's next voting deadlines (only dates with an
#             official source, the same ones election reminders use),
#             events from officials they track, and polls they voted
#             in that close within 14 days
#
# Citizen only: reps and candidates have their own page Dashboard.

_RECENT_DAYS = 7
_POLL_CLOSING_DAYS = 14
_UPCOMING_MAX = 8

_DEADLINE_TITLES = {
    "voter_registration_deadline": "{state} voter registration deadline",
    "vote_by_mail_request_deadline": "{state} mail ballot request deadline",
    "early_voting_window": "{state} early voting starts",
}


class DashboardCounts(BaseModel):
    polls_cast: int = 0
    comments_left: int = 0
    reactions: int = 0
    since: datetime


class DashboardUpcoming(BaseModel):
    id: str
    kind: str                         # 'ballot' | 'event' | 'poll-closing'
    title: str
    when: str                         # ISO; dates carry local noon so they never slip a day
    meta: Optional[str] = None
    url: Optional[str] = None         # an official site (ballot) or an RSVP link (event)
    official_id: Optional[str] = None
    poll_id: Optional[int] = None
    post_id: Optional[int] = None


class DashboardRecent(BaseModel):
    id: int
    kind: str
    payload: dict
    created_at: datetime


class DashboardResponse(BaseModel):
    counts: DashboardCounts
    recent: List[DashboardRecent] = []
    upcoming: List[DashboardUpcoming] = []


def _month_start_utc(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _clamp_since(since: Optional[datetime], now: datetime) -> datetime:
    """The browser sends the start of the month on its own clock. Keep
    it within the last 32 days; without it, use the UTC month."""
    if since is None:
        return _month_start_utc(now)
    if since.tzinfo is not None:
        since = since.astimezone(timezone.utc).replace(tzinfo=None)
    floor = now - timedelta(days=32)
    if since < floor or since > now:
        return _month_start_utc(now)
    return since


def _count(db: Session, model, uid: int, since: datetime, *, live_only: bool = False) -> int:
    q = db.query(func.count(model.id)).filter(model.citizen_id == uid, model.created_at >= since)
    if live_only:
        q = q.filter(model.deleted_at.is_(None))
    return int(q.scalar() or 0)


def _deadline_items(state: Optional[str]) -> list[DashboardUpcoming]:
    """The state's next voting deadlines: one row per date (the 3-days-
    before and day-before reminders share a date), only what election
    reminders would also send (an official https source, its retrieved
    date and an official link)."""
    if not state or len(state) != 2:
        return []
    path = election_reminders.DATA_DIR / state.lower() / "elections.json"
    try:
        with path.open(encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return []
    sched = election_reminders.build_schedule(docs={state.upper(): doc})
    today = election_reminders.today_et()
    seen: set = set()
    out: list[DashboardUpcoming] = []
    for r in sched.reminders:
        key = (r.election_key, r.date_key)
        if key in seen or r.event_date < today:
            continue
        seen.add(key)
        if r.date_key == r.phase:
            title = f"{r.state_name} Election Day"
        else:
            prefix = next((p for p in _DEADLINE_TITLES if r.date_key.startswith(p)), None)
            if prefix is None:
                continue
            title = _DEADLINE_TITLES[prefix].format(state=r.state_name)
        label = election_reminders._PHASE_LABEL.get(r.phase, r.phase)
        out.append(DashboardUpcoming(
            id=f"deadline-{r.state.lower()}-{r.election_key}-{r.date_key}",
            kind="ballot",
            title=title,
            when=f"{r.event_date.isoformat()}T12:00:00",
            meta=f"For the {election_reminders._short_date(r.election_date)} {label}. Official date from the state.",
            url=r.link_url,
        ))
    return out


def _event_items(db: Session, uid: int) -> list[DashboardUpcoming]:
    rows = (
        db.query(TrackedOfficial.official_key, TrackedOfficial.snapshot_json)
        .filter(
            TrackedOfficial.tracker_kind == "citizen",
            TrackedOfficial.tracker_id == uid,
            TrackedOfficial.ended_at.is_(None),
        )
        .all()
    )
    names = {}
    for key, snap in rows:
        try:
            names[key] = (json.loads(snap or "{}") or {}).get("name")
        except Exception:
            names[key] = None
    if not names:
        return []
    events = (
        db.query(RepEvent)
        .filter(RepEvent.official_id.in_(list(names)), RepEvent.deleted_at.is_(None))
        .all()
    )
    out: list[DashboardUpcoming] = []
    for e in _filter_upcoming_rep_events([_rep_event_to_dict(ev) for ev in events]):
        who = names.get(e.get("official_id")) or None
        where = e.get("location") or None
        out.append(DashboardUpcoming(
            id=str(e["id"]),
            kind="event",
            title=e.get("title") or "Event",
            when=e.get("date") or "",
            meta=" · ".join(x for x in (who, where) if x) or None,
            url=e.get("rsvp_url") or None,
            official_id=e.get("official_id"),
        ))
    return out


def _closing_poll_items(db: Session, uid: int, now: datetime) -> list[DashboardUpcoming]:
    horizon = now + timedelta(days=_POLL_CLOSING_DAYS)
    rows = (
        db.query(Poll, Post.official_id)
        .join(PollVote, PollVote.poll_id == Poll.id)
        .outerjoin(Post, Post.id == Poll.post_id)
        .filter(
            PollVote.citizen_id == uid,
            Poll.closes_at.isnot(None),
            Poll.closes_at > now,
            Poll.closes_at <= horizon,
            Poll.archived_at.is_(None),
        )
        .all()
    )
    out: list[DashboardUpcoming] = []
    seen: set = set()
    for poll, post_official in rows:
        if poll.id in seen:
            continue
        seen.add(poll.id)
        out.append(DashboardUpcoming(
            id=f"poll-{poll.id}",
            kind="poll-closing",
            title=poll.question,
            when=poll.closes_at.isoformat() + "Z",
            meta="A poll you voted in closes",
            official_id=post_official or poll.target_official_id,
            poll_id=poll.id,
            post_id=poll.post_id,
        ))
    return out


@router.get("/dashboard", response_model=DashboardResponse)
def citizen_dashboard(
    since: Optional[datetime] = Query(default=None),
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    if me_citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in as a citizen.")
    uid = me_citizen.id
    now = datetime.utcnow()
    month_since = _clamp_since(since, now)

    counts = DashboardCounts(
        polls_cast=_count(db, PollVote, uid, month_since),
        comments_left=(_count(db, PostComment, uid, month_since, live_only=True)
                       + _count(db, PollComment, uid, month_since, live_only=True)),
        reactions=sum(_count(db, m, uid, month_since) for m in (
            PostReaction, PollReaction, CommentReaction, PollCommentReaction, BillReaction)),
        since=month_since,
    )

    cutoff = now - timedelta(days=_RECENT_DAYS)
    recent = []
    for n in notifications_inapp.list_for_recipient(
            db, recipient_kind="citizen", recipient_id=uid, limit=20, include_cleared=True):
        if n.created_at is None or n.created_at < cutoff:
            continue
        try:
            payload = json.loads(n.payload_json or "{}")
        except Exception:
            payload = {}
        recent.append(DashboardRecent(id=n.id, kind=n.kind, payload=payload, created_at=n.created_at))

    upcoming: list[DashboardUpcoming] = []
    for build in (
        lambda: _deadline_items(me_citizen.state),
        lambda: _event_items(db, uid),
        lambda: _closing_poll_items(db, uid, now),
    ):
        try:
            upcoming.extend(build())
        except Exception:  # one source failing must not blank the others
            logger.exception("Dashboard: an upcoming source failed")

    def _key(item: DashboardUpcoming) -> str:
        return item.when or "9999"
    upcoming.sort(key=_key)
    return DashboardResponse(counts=counts, recent=recent, upcoming=upcoming[:_UPCOMING_MAX])
