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
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    Poll,
    PollComment,
    Post,
    PostComment,
    RepAccount,
)
from app.services import notifications_inapp

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
