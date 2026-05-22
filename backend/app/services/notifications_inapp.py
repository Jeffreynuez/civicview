# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
In-app notification service — Phase 5 MVP.

Emits notifications into the Notification table when something happens
that one specific user (the "recipient") should know about. The
recipient could be a citizen, rep, or candidate; the table is keyed
polymorphically on (recipient_kind, recipient_id).

Scope today:
  • Reply notifications — when someone replies to your top-level
    comment, you get a notification. Authored by the rep, candidate,
    or another citizen; recipient is whichever identity authored the
    parent comment.

Out-of-scope for the MVP (called out in the help-build page):
  • Page-owner-posted-new-content notifications (needs a subscription
    model that doesn't exist yet).
  • Poll-close alerts (needs a scheduler).
  • Mentions (needs an @-parser).
  • Web push (needs a service worker + permission flow).

The frontend polls /api/notifications periodically — see the
Navbar bell.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.pages import Notification, PostComment


logger = logging.getLogger(__name__)


def _truncate(s: Optional[str], n: int = 120) -> str:
    if not s:
        return ""
    s = s.strip()
    return s if len(s) <= n else (s[: n - 1].rstrip() + "…")


def emit_reply_notification(
    db: Session,
    *,
    reply: PostComment,
    parent: PostComment,
    replier_display_name: str,
    official_id: str,
) -> Optional[Notification]:
    """Create a notification for the author of `parent` because
    `reply` was just posted. Returns None when there's no recipient
    to notify (e.g. the parent was authored by the same person now
    replying — common when the rep replies to their own pinned
    comment) or when the parent has no identifiable author.

    The replier and the recipient can be different identity kinds —
    e.g. a rep replying to a citizen's comment notifies the citizen,
    a citizen replying to the rep's comment notifies the rep.
    """
    # Identify the parent comment's author. Exactly one of these
    # should be populated per the XOR enforced at the route layer.
    recipient_kind: Optional[str] = None
    recipient_id: Optional[int] = None
    if parent.citizen_id is not None:
        recipient_kind = "citizen"
        recipient_id = parent.citizen_id
    elif getattr(parent, "author_rep_id", None) is not None:
        recipient_kind = "rep"
        recipient_id = parent.author_rep_id
    elif getattr(parent, "author_candidate_id", None) is not None:
        recipient_kind = "candidate"
        recipient_id = parent.author_candidate_id

    if recipient_kind is None or recipient_id is None:
        return None

    # Don't notify yourself — the rep replying to their own pinned
    # top-level comment shouldn't spam their own bell.
    reply_kind: Optional[str] = None
    reply_actor_id: Optional[int] = None
    if reply.citizen_id is not None:
        reply_kind = "citizen"
        reply_actor_id = reply.citizen_id
    elif getattr(reply, "author_rep_id", None) is not None:
        reply_kind = "rep"
        reply_actor_id = reply.author_rep_id
    elif getattr(reply, "author_candidate_id", None) is not None:
        reply_kind = "candidate"
        reply_actor_id = reply.author_candidate_id
    if reply_kind == recipient_kind and reply_actor_id == recipient_id:
        return None

    payload = {
        "comment_id": reply.id,
        "parent_comment_id": parent.id,
        "post_id": reply.post_id,
        "official_id": official_id,
        "replier_name": replier_display_name,
        "preview": _truncate(reply.body, 120),
    }
    n = Notification(
        recipient_kind=recipient_kind,
        recipient_id=recipient_id,
        kind="reply",
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


def list_for_recipient(
    db: Session, *, recipient_kind: str, recipient_id: int,
    limit: int = 50, unread_only: bool = False,
) -> list[Notification]:
    """Most-recent-first notifications for one (kind, id) pair."""
    q = (
        db.query(Notification)
        .filter(
            Notification.recipient_kind == recipient_kind,
            Notification.recipient_id == recipient_id,
        )
    )
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    return q.order_by(Notification.created_at.desc()).limit(limit).all()


def unread_count_for(
    db: Session, *, recipient_kind: str, recipient_id: int,
) -> int:
    """O(1)-friendly count of unread for the bell badge."""
    return (
        db.query(Notification)
        .filter(
            Notification.recipient_kind == recipient_kind,
            Notification.recipient_id == recipient_id,
            Notification.read_at.is_(None),
        )
        .count()
    )


def mark_read(
    db: Session, *, recipient_kind: str, recipient_id: int,
    notification_id: Optional[int] = None, all_for_user: bool = False,
) -> int:
    """Mark a single notification (notification_id) or every unread
    notification for this user (all_for_user=True) as read. Returns
    the count of rows updated. Defensive against cross-user marks —
    only rows matching the recipient pair get touched, so a
    misaligned id silently no-ops instead of leaking another user's
    inbox state."""
    q = (
        db.query(Notification)
        .filter(
            Notification.recipient_kind == recipient_kind,
            Notification.recipient_id == recipient_id,
            Notification.read_at.is_(None),
        )
    )
    if not all_for_user:
        if notification_id is None:
            return 0
        q = q.filter(Notification.id == notification_id)
    now = datetime.utcnow()
    updated = q.update({Notification.read_at: now}, synchronize_session=False)
    db.commit()
    return int(updated or 0)
