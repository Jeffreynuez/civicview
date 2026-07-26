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

Scope extension (Task #105, 2026-06-10):
  • Tracked-official content notifications — when an official the
    citizen tracks publishes a post (optionally with a poll), every
    tracking citizen gets a kind='tracked_post' notification. The
    "subscription model" the MVP was waiting on turned out to already
    exist: TrackedOfficial.

Out-of-scope still:
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

from app.models.pages import Notification, PostComment, TrackedOfficial


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


def emit_tracked_content_notifications(
    db: Session,
    *,
    official_id: str,
    official_name: str,
    post_id: int,
    preview: str,
    has_poll: bool,
) -> int:
    """Fan a kind='tracked_post' notification out to every citizen
    tracking `official_id`. Single bulk insert + one commit. Returns
    the number of notifications created.

    Called from a BackgroundTask after create_post commits, with its
    own session — fan-out cost never rides on the posting rep's
    request latency."""
    # Case-insensitive key match (2026-07-25): the frontend lowercases
    # official keys (officialKey()), while page official_ids come from
    # the DB verbatim. They agree today for registry-backed pages, but
    # a mixed-case page id (test/internal accounts, future imports)
    # would silently fan out to nobody. lower() both sides so tracking
    # can never miss on case.
    from sqlalchemy import func as _f

    trackers = (
        db.query(TrackedOfficial.tracker_id)
        .filter(
            TrackedOfficial.tracker_kind == "citizen",
            _f.lower(TrackedOfficial.official_key) == (official_id or "").lower(),
        )
        .all()
    )
    if not trackers:
        return 0
    payload = json.dumps(
        {
            "official_id": official_id,
            "official_name": official_name,
            "post_id": post_id,
            "preview": _truncate(preview, 120),
            "has_poll": bool(has_poll),
        },
        ensure_ascii=False,
    )
    rows = [
        Notification(
            recipient_kind="citizen",
            recipient_id=tid,
            kind="tracked_post",
            payload_json=payload,
        )
        for (tid,) in trackers
    ]
    db.add_all(rows)
    db.commit()
    logger.info(
        "tracked_post fan-out: official=%s post=%s -> %d citizens",
        official_id, post_id, len(rows),
    )
    # Device-push mirror (v1 push scope: tracked activity only). Runs
    # in the same background session AFTER the in-app rows commit;
    # push_tracked_post never raises, so a push/FCM problem cannot
    # disturb the bell notifications above.
    from app.services.push_service import push_tracked_post

    push_tracked_post(
        db,
        [tid for (tid,) in trackers],
        official_id=official_id,
        official_name=official_name,
        post_id=post_id,
        preview=_truncate(preview, 120),
        has_poll=has_poll,
    )
    return len(rows)


def emit_tracked_event_notifications(
    db: Session,
    *,
    official_id: str,
    official_name: str,
    event_id: int,
    title: str,
    start_at: str,
    location: Optional[str],
) -> int:
    """Fan a kind='tracked_event' notification out to citizens who
    track `official_id` AND opted into that official's 'on_event'
    pref. The pref's schema default is OFF ('key events ON, chatter
    OFF' — lib/notificationPrefs.js), so event alerts are strictly
    opt-in per tracked official; a missing/unparseable prefs blob
    counts as opted OUT to mirror the frontend default. Push mirror
    is bound-devices only — anonymous devices never expressed
    on_event, so they get no event pushes."""
    from sqlalchemy import func as _f

    rows = (
        db.query(TrackedOfficial.tracker_id, TrackedOfficial.prefs_json)
        .filter(
            TrackedOfficial.tracker_kind == "citizen",
            _f.lower(TrackedOfficial.official_key) == (official_id or "").lower(),
        )
        .all()
    )
    opted: list[int] = []
    for tid, blob in rows:
        try:
            prefs = json.loads(blob) if blob else {}
        except (ValueError, TypeError):
            prefs = {}
        if prefs.get("on_event") is True:
            opted.append(tid)
    if not opted:
        logger.info(
            "tracked_event fan-out: official=%s event=%s -> 0 of %d tracker(s) "
            "opted into on_event",
            official_id, event_id, len(rows),
        )
        return 0
    payload = json.dumps(
        {
            "official_id": official_id,
            "official_name": official_name,
            "event_id": event_id,
            "preview": _truncate(title, 120),
            "start_at": start_at,
            "location": location or None,
        },
        ensure_ascii=False,
    )
    notif_rows = [
        Notification(
            recipient_kind="citizen",
            recipient_id=tid,
            kind="tracked_event",
            payload_json=payload,
        )
        for tid in opted
    ]
    db.add_all(notif_rows)
    db.commit()
    logger.info(
        "tracked_event fan-out: official=%s event=%s -> %d of %d tracker(s)",
        official_id, event_id, len(notif_rows), len(rows),
    )
    from app.services.push_service import push_tracked_event

    push_tracked_event(
        db, opted,
        official_id=official_id,
        official_name=official_name,
        event_id=event_id,
        title=_truncate(title, 120),
        start_at=start_at,
        location=location,
    )
    return len(notif_rows)


def emit_tracked_event_notifications_bg(
    official_id: str,
    official_name: str,
    event_id: int,
    title: str,
    start_at: str,
    location: Optional[str],
) -> None:
    """BackgroundTasks entrypoint — owns its session, swallows errors
    (a failed courtesy notification must never surface to the event
    author)."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        emit_tracked_event_notifications(
            db,
            official_id=official_id,
            official_name=official_name,
            event_id=event_id,
            title=title,
            start_at=start_at,
            location=location,
        )
    except Exception:
        db.rollback()
        logger.exception("tracked_event fan-out failed (official=%s)", official_id)
    finally:
        db.close()


def emit_tracked_content_notifications_bg(
    official_id: str,
    official_name: str,
    post_id: int,
    preview: str,
    has_poll: bool,
) -> None:
    """BackgroundTasks entrypoint — owns its session, swallows errors
    (a failed courtesy notification must never surface to the poster)."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        emit_tracked_content_notifications(
            db,
            official_id=official_id,
            official_name=official_name,
            post_id=post_id,
            preview=preview,
            has_poll=has_poll,
        )
    except Exception:
        db.rollback()
        logger.exception("tracked_post fan-out failed (official=%s)", official_id)
    finally:
        db.close()


def list_for_recipient(
    db: Session, *, recipient_kind: str, recipient_id: int,
    limit: int = 50, unread_only: bool = False,
    include_cleared: bool = False,
) -> list[Notification]:
    """Most-recent-first notifications for one (kind, id) pair.
    Cleared rows are hidden by default (bell view); the dashboard
    archive passes include_cleared=True for full history."""
    q = (
        db.query(Notification)
        .filter(
            Notification.recipient_kind == recipient_kind,
            Notification.recipient_id == recipient_id,
        )
    )
    if not include_cleared:
        q = q.filter(Notification.cleared_at.is_(None))
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
            # Cleared rows never count toward the badge — "Clear"
            # must zero the bell even if something stayed unread.
            Notification.cleared_at.is_(None),
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


def clear_all(
    db: Session, *, recipient_kind: str, recipient_id: int,
) -> int:
    """Soft-clear every visible notification for this user: stamp
    cleared_at (and read_at where still unread — a cleared row is by
    definition acknowledged). Returns rows cleared. The rows survive
    for the dashboard archive; only the bell view empties."""
    now = datetime.utcnow()
    base = db.query(Notification).filter(
        Notification.recipient_kind == recipient_kind,
        Notification.recipient_id == recipient_id,
        Notification.cleared_at.is_(None),
    )
    cleared = base.filter(Notification.read_at.is_(None)).update(
        {Notification.read_at: now, Notification.cleared_at: now},
        synchronize_session=False,
    )
    cleared += base.filter(Notification.read_at.isnot(None)).update(
        {Notification.cleared_at: now},
        synchronize_session=False,
    )
    db.commit()
    return int(cleared or 0)
