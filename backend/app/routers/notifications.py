# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Notifications router — Phase 5 MVP.

  GET    /api/notifications         → list recent notifications + unread count
  POST   /api/notifications/{id}/read       → mark one read
  POST   /api/notifications/read-all        → mark all read

The router resolves the caller's identity from whichever session
cookie is present (citizen / rep / candidate). With three signed-in
sessions simultaneously the response combines all three identities'
inboxes — most users have one active identity so this rarely matters,
but the multi-identity helper makes the merge explicit.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    Notification,
    RepAccount,
)
from app.services import notifications_inapp


logger = logging.getLogger(__name__)
router = APIRouter()


class NotificationItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recipient_kind: str
    kind: str
    payload: dict
    created_at: datetime
    read_at: Optional[datetime] = None


class NotificationsResponse(BaseModel):
    unread_count: int = 0
    items: List[NotificationItem] = []


def _row_to_item(n: Notification) -> NotificationItem:
    try:
        payload = json.loads(n.payload_json or "{}")
    except Exception:
        payload = {}
    return NotificationItem(
        id=n.id,
        recipient_kind=n.recipient_kind,
        kind=n.kind,
        payload=payload,
        created_at=n.created_at,
        read_at=n.read_at,
    )


def _active_recipients(
    me_citizen: Optional[CitizenAccount],
    me_rep: Optional[RepAccount],
    me_candidate: Optional[CandidateAccount],
) -> list[tuple[str, int]]:
    """Return all (recipient_kind, recipient_id) pairs the caller
    holds active sessions for. Multi-identity browsers (a rep who's
    also signed in as a citizen) see notifications across both
    inboxes in one feed."""
    out: list[tuple[str, int]] = []
    if me_citizen is not None:
        out.append(("citizen", me_citizen.id))
    if me_rep is not None:
        out.append(("rep", me_rep.id))
    if me_candidate is not None:
        out.append(("candidate", me_candidate.id))
    return out


@router.get("", response_model=NotificationsResponse)
def list_notifications(
    limit: int = 50,
    unread_only: bool = False,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    recipients = _active_recipients(me_citizen, me_rep, me_candidate)
    if not recipients:
        # Anonymous viewer — empty inbox, no auth error so the bell
        # icon can poll harmlessly while signed out.
        return NotificationsResponse(unread_count=0, items=[])

    items: list[Notification] = []
    unread_total = 0
    for kind, rid in recipients:
        items.extend(notifications_inapp.list_for_recipient(
            db, recipient_kind=kind, recipient_id=rid,
            limit=limit, unread_only=unread_only,
        ))
        unread_total += notifications_inapp.unread_count_for(
            db, recipient_kind=kind, recipient_id=rid,
        )
    # Newest-first across the merged inbox; cap to `limit` so
    # multi-identity callers don't get 2x or 3x the payload.
    items.sort(key=lambda n: n.created_at, reverse=True)
    items = items[:limit]
    return NotificationsResponse(
        unread_count=unread_total,
        items=[_row_to_item(n) for n in items],
    )


@router.post("/{notification_id}/read")
def mark_one_read(
    notification_id: int,
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    recipients = _active_recipients(me_citizen, me_rep, me_candidate)
    if not recipients:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to manage notifications.",
        )
    # Defensive — try each active recipient until one of them owns
    # the row. The service-layer mark_read scopes to (kind, id) so
    # a misaligned attempt silently no-ops without leaking another
    # user's inbox.
    total = 0
    for kind, rid in recipients:
        total += notifications_inapp.mark_read(
            db, recipient_kind=kind, recipient_id=rid,
            notification_id=notification_id,
        )
    return {"ok": True, "updated": total}


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
):
    recipients = _active_recipients(me_citizen, me_rep, me_candidate)
    if not recipients:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to manage notifications.",
        )
    total = 0
    for kind, rid in recipients:
        total += notifications_inapp.mark_read(
            db, recipient_kind=kind, recipient_id=rid,
            all_for_user=True,
        )
    return {"ok": True, "updated": total}
