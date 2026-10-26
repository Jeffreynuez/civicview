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

Scope extension (phone notifications, 2026-10-17):
  • Every kind obeys the citizen's notification settings list
    (services/alert_settings.py): a row can send the bell and a push,
    the bell only, or nothing. Muted officials (My Tracked) get no bell
    row or push for their posts, polls and events.
  • Replies on citizen polls notify too (they created nothing before),
    and replies push to citizens' phones after the moderation screen
    (never to reps or candidates: Jeffrey, 2026-07-26).
  • Event alerts follow the Events row (on by default) instead of each
    official's on_event switch.
  • Poll results: services/poll_results.py. Bill updates:
    services/bill_updates.py.

Out-of-scope still:
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


def _identity_reply_alerts_enabled(
    db: Session, recipient_kind: str, recipient_id: int,
) -> bool:
    """Reply-alerts switch for a rep/candidate recipient (Task #23).
    Default ON: only an explicit reply_alerts=False in the identity's
    notification_prefs_json silences reply notifications. Any lookup
    failure fails OPEN (notify) — never lose a notification to a
    prefs read error."""
    from app.models.pages import CandidateAccount, RepAccount

    try:
        model = RepAccount if recipient_kind == "rep" else CandidateAccount
        blob = (
            db.query(model.notification_prefs_json)
            .filter(model.id == recipient_id)
            .scalar()
        )
        if not blob:
            return True
        prefs = json.loads(blob)
        return prefs.get("reply_alerts", True) is not False
    except Exception:
        return True


def emit_reply_notification(
    db: Session,
    *,
    reply: PostComment,
    parent: PostComment,
    replier_display_name: str,
    official_id: str,
    poll_id: Optional[int] = None,
) -> Optional[Notification]:
    """Create a notification for the author of `parent` because
    `reply` was just posted. Returns None when there's no recipient
    to notify (e.g. the parent was authored by the same person now
    replying — common when the rep replies to their own pinned
    comment) or when the parent has no identifiable author.

    The replier and the recipient can be different identity kinds —
    e.g. a rep replying to a citizen's comment notifies the citizen,
    a citizen replying to the rep's comment notifies the rep.

    A reply on a citizen poll (2026-10-17) passes the PollComment pair
    and poll_id; its payload carries poll_id instead of post_id. A
    citizen whose Replies setting is Off gets no bell row.
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

    # Identity opt-out (Task #23): reps/candidates can turn off reply
    # notifications entirely (reply_alerts=False) — a busy official can
    # get a lot of replies. Citizens have no such switch (reply_alerts
    # absent → default ON for everyone). A missing/corrupt prefs blob
    # counts as ON.
    if recipient_kind in ("rep", "candidate"):
        if not _identity_reply_alerts_enabled(db, recipient_kind, recipient_id):
            return None
    else:
        from app.services import alert_settings
        if not alert_settings.wanting(db, [recipient_id], "replies", alert_settings.BELL):
            return None

    payload = {
        "comment_id": reply.id,
        "parent_comment_id": parent.id,
        "official_id": official_id,
        "replier_name": replier_display_name,
        "preview": _truncate(reply.body, 120),
    }
    if poll_id is not None:
        payload["poll_id"] = poll_id
    else:
        payload["post_id"] = reply.post_id
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


_REPLY_CONTENT = {"post_comment", "poll_comment"}


def push_reply(db: Session, notification_id: int, content_type: str) -> int:
    """The phone push for a reply's bell row (2026-10-17). Citizens only:
    reps and candidates get no reply pushes (Jeffrey, 2026-07-26). Runs
    as a background task after the moderation screen, so a reply the
    screen flags, or one already hidden or deleted, is not pushed (its
    bell row stays). Follows the Replies row's push setting and quiet
    hours, not the daily or weekly summary setting. Returns devices sent."""
    from app.models.pages import ContentModerationVerdict, PollComment
    from app.services import alert_settings
    from app.services.push_service import push_to_citizens

    if content_type not in _REPLY_CONTENT:
        return 0
    n = db.get(Notification, notification_id)
    if n is None or n.recipient_kind != "citizen" or n.kind != "reply":
        return 0
    try:
        p = json.loads(n.payload_json or "{}")
    except (ValueError, TypeError):
        return 0
    comment_id = p.get("comment_id")
    model = PostComment if content_type == "post_comment" else PollComment
    comment = db.get(model, comment_id) if comment_id else None
    if comment is None or getattr(comment, "deleted_at", None) is not None or getattr(comment, "hide_reason", None):
        return 0
    decision = (
        db.query(ContentModerationVerdict.decision)
        .filter(ContentModerationVerdict.content_type == content_type,
                ContentModerationVerdict.content_id == comment_id)
        .order_by(ContentModerationVerdict.id.desc())
        .limit(1)
        .scalar()
    )
    if decision in _FLAGGED:
        logger.info("reply push held back: %s=%s moderation %s", content_type, comment_id, decision)
        return 0
    if not alert_settings.wanting(db, [n.recipient_id], "replies", alert_settings.PUSH):
        return 0
    name = p.get("replier_name") or "Someone"
    data = {"kind": "reply", "official_id": p.get("official_id") or ""}
    if p.get("poll_id"):
        data["poll_id"] = p["poll_id"]
    elif p.get("post_id"):
        data["post_id"] = p["post_id"]
    return push_to_citizens(
        db, [n.recipient_id], title=f"{name} replied to your comment", body=p.get("preview") or "",
        data=data, channel="replies", official_name=name,
        notification_ids={n.recipient_id: n.id}, timing=False,
    )


def push_reply_bg(notification_id: int, content_type: str) -> None:
    """BackgroundTasks entrypoint for push_reply; owns its session and
    swallows errors (the reply has already landed)."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        push_reply(db, notification_id, content_type)
    except Exception:
        db.rollback()
        logger.exception("reply push failed (notification=%s)", notification_id)
    finally:
        db.close()


def _tracker_audience(db: Session, official_id: str, row: str) -> tuple:
    """(every citizen tracking the page, those who get a bell row, those
    who get a push) for one official's post or event. Tracking that
    ended at the archive is left out; so is anyone who muted the
    official in My Tracked or turned the row off."""
    from sqlalchemy import func as _f

    from app.services import alert_settings

    rows = (
        db.query(TrackedOfficial.tracker_id, TrackedOfficial.prefs_json)
        .filter(
            TrackedOfficial.tracker_kind == "citizen",
            _f.lower(TrackedOfficial.official_key) == (official_id or "").lower(),
            TrackedOfficial.ended_at.is_(None),
        )
        .all()
    )
    everyone = [tid for tid, _blob in rows]
    unmuted = alert_settings.unmuted_trackers(rows)
    bell = alert_settings.wanting(db, unmuted, row, alert_settings.BELL)
    push = alert_settings.wanting(db, unmuted, row, alert_settings.PUSH) & bell
    return everyone, [t for t in unmuted if t in bell], [t for t in unmuted if t in push]


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
    # the DB verbatim. lower() both sides so tracking can never miss on
    # case. Muted officials and the Officials row (2026-10-17) decide
    # who gets the bell row and who the push.
    _everyone, bell_ids, push_ids = _tracker_audience(db, official_id, "officials")
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
        for tid in bell_ids
    ]
    db.add_all(rows)
    db.flush()  # assigns ids; read them now, before commit expires the rows
    notification_ids = {n.recipient_id: n.id for n in rows}
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

    # No push for a post the moderation screen flagged, or one already
    # hidden or deleted (2026-10-16). The bell rows above stay: the
    # post is still on the page, and the screen hides nothing yet.
    held_back = push_held_back(db, post_id)
    if held_back:
        logger.info("tracked_post push held back: post=%s %s", post_id, held_back)
        return len(rows)

    # Each tracker's own bell row id rides on their push, so tapping
    # it marks that row read (2026-10-16).
    # Signed-out phones tracking the page still get it (anon_key), so
    # this runs even when no signed-in tracker wants a push.
    push_tracked_post(
        db,
        push_ids,
        official_id=official_id,
        official_name=official_name,
        post_id=post_id,
        preview=_truncate(preview, 120),
        has_poll=has_poll,
        notification_ids=notification_ids,
    )
    return len(rows)


_FLAGGED = ("flag", "auto_hide")


def push_held_back(db: Session, post_id: int) -> Optional[str]:
    """Why a post must not be pushed, or None. Reads the moderation
    verdicts recorded for the post and its poll (moderation runs before
    the fan-out, routers/pages.create_post); a post with no verdict, or
    only a 'skipped' one (AI unavailable), is pushed."""
    from app.models.pages import ContentModerationVerdict, Poll, Post

    post = db.get(Post, post_id)
    if post is None or post.deleted_at is not None:
        return "deleted"
    if post.hide_reason:
        return "hidden"
    targets = [("post", post_id)]
    poll_id = db.query(Poll.id).filter(Poll.post_id == post_id).scalar()
    if poll_id:
        targets.append(("poll", poll_id))
    for content_type, content_id in targets:
        decision = (
            db.query(ContentModerationVerdict.decision)
            .filter(ContentModerationVerdict.content_type == content_type,
                    ContentModerationVerdict.content_id == content_id)
            .order_by(ContentModerationVerdict.id.desc())
            .limit(1)
            .scalar()
        )
        if decision in _FLAGGED:
            return f"moderation {decision} ({content_type})"
    return None


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
    track `official_id`. Since 2026-10-17 (Jeffrey) the Events row of
    the notification settings decides it, on for everyone by default,
    and "Mute" in My Tracked silences one official; each official's old
    on_event switch is no longer read. The push follows the "Push
    alerts" timing like a post. Bound devices only: signed-out phones
    get officials' posts and polls, not events."""
    everyone, opted, push_ids = _tracker_audience(db, official_id, "events")
    if not opted:
        logger.info(
            "tracked_event fan-out: official=%s event=%s -> 0 of %d tracker(s) "
            "(muted or Events off)",
            official_id, event_id, len(everyone),
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
    db.flush()
    notification_ids = {n.recipient_id: n.id for n in notif_rows}
    db.commit()
    logger.info(
        "tracked_event fan-out: official=%s event=%s -> %d of %d tracker(s)",
        official_id, event_id, len(notif_rows), len(everyone),
    )
    from app.services.push_service import push_tracked_event

    push_tracked_event(
        db, push_ids,
        official_id=official_id,
        official_name=official_name,
        event_id=event_id,
        title=_truncate(title, 120),
        start_at=start_at,
        location=location,
        notification_ids=notification_ids,
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


def emit_moderation_hidden(db: Session, *, target, kind: str) -> Optional[Notification]:
    """Tell the author that moderation hid their post, comment or poll,
    with a way to appeal it (2026-10-26). Called when an admin hides
    content and when the trusted-report threshold auto-hides it; a
    "Keep hidden" on content already hidden sends nothing new.

    Always a bell row, whatever the author's alert settings: this is
    about their own account, like a sign-in notice. No push. The row
    carries no reporter or admin identity. The caller commits.

    For a rep or a candidate the payload names their own page, whose
    dashboard lists hidden content; a citizen's opens their dashboard."""
    from app.models.pages import CandidateAccount, RepAccount
    from app.services.moderation import APPEALABLE_HIDE_REASONS, content_author, target_state

    author = content_author(target, kind)
    if author is None:
        return None
    state = target_state(target, kind)
    if state not in APPEALABLE_HIDE_REASONS:
        return None
    recipient_kind, recipient_id = author
    body = getattr(target, "body", None) or getattr(target, "question", None)
    payload = {
        "target_kind": kind,
        "target_id": target.id,
        "hide_reason": state,
        "preview": _truncate(body, 120),
    }
    if recipient_kind == "rep":
        acct = db.get(RepAccount, recipient_id)
        if acct is not None and acct.official_id:
            payload["page_id"] = acct.official_id
    elif recipient_kind == "candidate":
        acct = db.get(CandidateAccount, recipient_id)
        if acct is not None and acct.candidate_id:
            payload["page_id"] = acct.candidate_id
    n = Notification(
        recipient_kind=recipient_kind,
        recipient_id=recipient_id,
        kind="moderation_hidden",
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(n)
    return n


def list_for_recipient(
    db: Session, *, recipient_kind: str, recipient_id: int,
    limit: int = 50, unread_only: bool = False,
    include_cleared: bool = False, offset: int = 0,
    kind: Optional[str] = None,
) -> list[Notification]:
    """Most-recent-first notifications for one (kind, id) pair.
    Cleared rows are hidden by default (bell view); the dashboard
    archive passes include_cleared=True for full history, plus
    offset pagination and an optional kind filter ('reply' is the
    archive's replies-received view)."""
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
    if kind:
        q = q.filter(Notification.kind == kind)
    q = q.order_by(Notification.created_at.desc())
    if offset:
        q = q.offset(offset)
    return q.limit(limit).all()


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
    only_ids: Optional[list] = None,
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
    elif only_ids is not None:
        # Only the rows the bell showed (2026-10-16).
        if not only_ids:
            return 0
        q = q.filter(Notification.id.in_(list(only_ids)))
    now = datetime.utcnow()
    updated = q.update({Notification.read_at: now}, synchronize_session=False)
    db.commit()
    return int(updated or 0)


def clear_all(
    db: Session, *, recipient_kind: str, recipient_id: int,
    only_ids: Optional[list] = None,
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
    if only_ids is not None:
        # Only the rows the bell showed (2026-10-16).
        if not only_ids:
            return 0
        base = base.filter(Notification.id.in_(list(only_ids)))
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
