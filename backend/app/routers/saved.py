# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Saved-items router (Task #16).

Per-identity server-side bookmarks for posts + polls, surfaced on the
citizen dashboard's "Saved" section. Same polymorphic owner shape as the
Tracked* tables (tracker_kind + tracker_id), gated to verified citizens
(same gate as like / vote — get_current_citizen).

Surface:
  POST   /api/saved                       → save a post/poll (idempotent)
  DELETE /api/saved/{item_type}/{item_id} → unsave
  GET    /api/saved?item_type=&cursor=    → list saved refs (keyset by
                                            saved_at), skipping dangling
                                            (deleted/archived) items

The list returns lightweight REFERENCES ({item_type, item_id, saved_at}),
not full cards — the frontend re-fetches live cards via /api/feed/polls?
ids= and /api/feed/posts?ids= so saved cards always show current
vote/comment counts and stay interactive. Anonymous GET returns empty.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.auth_citizen import get_current_citizen, get_optional_citizen
from app.db import get_db
from app.models.pages import CitizenAccount, Poll, Post, SavedItem
from app.routers.feed import _decode_cursor, _encode_cursor

router = APIRouter()

_VALID_TYPES = {"post", "poll"}
_PAGE = 20


class SavedCreate(BaseModel):
    item_type: str = Field(..., description="'post' | 'poll'")
    item_id: int


def _item_exists(db: Session, item_type: str, item_id: int) -> bool:
    """True if the referenced post/poll still exists and is live."""
    if item_type == "poll":
        return db.query(Poll.id).filter(
            Poll.id == item_id, Poll.archived_at.is_(None)
        ).first() is not None
    return db.query(Post.id).filter(
        Post.id == item_id, Post.deleted_at.is_(None)
    ).first() is not None


@router.post("")
def save_item(
    payload: SavedCreate,
    db: Session = Depends(get_db),
    me: CitizenAccount = Depends(get_current_citizen),
) -> dict:
    """Save a post or poll for the signed-in citizen. Idempotent — saving
    an already-saved item is a no-op that still returns saved=True."""
    item_type = (payload.item_type or "").lower()
    if item_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown item_type '{payload.item_type}'")
    if not _item_exists(db, item_type, payload.item_id):
        raise HTTPException(status_code=404, detail=f"{item_type} {payload.item_id} not found")

    existing = (
        db.query(SavedItem)
        .filter(
            SavedItem.tracker_kind == "citizen",
            SavedItem.tracker_id == me.id,
            SavedItem.item_type == item_type,
            SavedItem.item_id == payload.item_id,
        )
        .first()
    )
    if existing is None:
        db.add(SavedItem(
            tracker_kind="citizen",
            tracker_id=me.id,
            item_type=item_type,
            item_id=payload.item_id,
        ))
        db.commit()
    return {"saved": True, "item_type": item_type, "item_id": payload.item_id}


@router.delete("/{item_type}/{item_id}")
def unsave_item(
    item_type: str,
    item_id: int,
    db: Session = Depends(get_db),
    me: CitizenAccount = Depends(get_current_citizen),
) -> dict:
    """Remove a saved post/poll. Idempotent."""
    item_type = (item_type or "").lower()
    if item_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown item_type '{item_type}'")
    db.query(SavedItem).filter(
        SavedItem.tracker_kind == "citizen",
        SavedItem.tracker_id == me.id,
        SavedItem.item_type == item_type,
        SavedItem.item_id == item_id,
    ).delete()
    db.commit()
    return {"saved": False, "item_type": item_type, "item_id": item_id}


@router.get("")
def list_saved(
    item_type: str = Query(..., description="'post' | 'poll'"),
    cursor: Optional[str] = Query(default=None),
    limit: int = Query(default=_PAGE, ge=1, le=50),
    db: Session = Depends(get_db),
    me: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> dict:
    """List the citizen's saved refs of one type, newest-saved first.

    Keyset-paginated by (saved_at, id). Skips dangling saves (the target
    post/poll was deleted or archived) by inner-joining the live table.
    Anonymous callers get an empty payload.
    """
    item_type = (item_type or "").lower()
    if item_type not in _VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown item_type '{item_type}'")
    if me is None:
        return {"items": [], "next_cursor": None, "has_more": False}

    q = db.query(SavedItem).filter(
        SavedItem.tracker_kind == "citizen",
        SavedItem.tracker_id == me.id,
        SavedItem.item_type == item_type,
    )
    # Skip dangling saves via an inner join onto the live target table.
    if item_type == "poll":
        q = q.join(Poll, Poll.id == SavedItem.item_id).filter(Poll.archived_at.is_(None))
    else:
        q = q.join(Post, Post.id == SavedItem.item_id).filter(Post.deleted_at.is_(None))

    _cur = _decode_cursor(cursor) if cursor else None
    if _cur is not None:
        _c_ts, _c_id = _cur
        q = q.filter(or_(SavedItem.saved_at < _c_ts,
                         and_(SavedItem.saved_at == _c_ts, SavedItem.id < _c_id)))

    rows = (
        q.order_by(SavedItem.saved_at.desc(), SavedItem.id.desc())
        .limit(limit + 1)
        .all()
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows and rows[-1].saved_at is not None:
        next_cursor = _encode_cursor(rows[-1].saved_at, rows[-1].id)
    items = [
        {"item_type": r.item_type, "item_id": r.item_id,
         "saved_at": r.saved_at.isoformat() if r.saved_at else None}
        for r in rows
    ]
    return {"items": items, "next_cursor": next_cursor, "has_more": has_more}
