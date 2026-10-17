# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Poll results (2026-10-17): "Results are in" when a poll you voted in
closes.

A poll has closed when its closing time has passed, or when its citizen
author closed it. The citizens who voted in it get a bell row
(kind='poll_results') and a push on the Poll results channel, opening
the poll. Their notification settings decide (the Poll results row);
the push follows quiet hours and the "Push alerts" timing like other
updates.

Nothing is sent for a poll taken down after reports, or for a citizen
poll archived when its page was claimed or when the page's newest polls
pushed it off (unless its closing time had already passed by then), or
for a post's poll when the post was deleted or hidden.

Exactly once: each poll is claimed with one conditional UPDATE on
polls.results_notified_at before anything is sent, so two instances
cannot both send it. The first pass after the deploy only stamps the
polls already closed (no backlog) and records that it did
(job_runs: poll-results / seeded).

Runs every few minutes inside the push summaries loop
(services/push_summaries.run_pass_with_session), under its lock.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

JOB = "poll-results"
SEEDED = "seeded"
MAX_POLLS_PER_PASS = 200
_NO_SEND_ARCHIVES = ("rep_claimed", "superseded")


def _truncate(s: Optional[str], n: int = 120) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _closed_polls(db, now: datetime, limit: int):
    from app.models.pages import Poll

    return (
        db.query(Poll)
        .filter(
            Poll.results_notified_at.is_(None),
            or_(
                and_(Poll.closes_at.isnot(None), Poll.closes_at <= now),
                and_(Poll.author_kind == "citizen", Poll.archived_reason == "citizen_closed"),
            ),
        )
        .order_by(Poll.id.asc())
        .limit(limit)
        .all()
    )


def _claim(db, poll_id: int, now: datetime) -> bool:
    from app.models.pages import Poll

    n = (
        db.query(Poll)
        .filter(Poll.id == poll_id, Poll.results_notified_at.is_(None))
        .update({Poll.results_notified_at: now}, synchronize_session=False)
    )
    db.commit()
    return bool(n)


def skip_reason(db, poll) -> Optional[str]:
    """Why a closed poll's voters are not told, or None."""
    from app.models.pages import Post

    if poll.archived_reason == "reported":
        return "taken down"
    if poll.archived_reason in _NO_SEND_ARCHIVES:
        closed_first = poll.closes_at is not None and poll.archived_at is not None \
            and poll.closes_at <= poll.archived_at
        if not closed_first:
            return f"archived ({poll.archived_reason})"
    if poll.post_id is not None:
        post = db.get(Post, poll.post_id)
        if post is None or post.deleted_at is not None or post.hide_reason:
            return "post deleted or hidden"
    return None


def _voters(db, poll_id: int) -> list:
    from app.models.pages import CitizenAccount, PollVote

    ids = {cid for (cid,) in db.query(PollVote.citizen_id).filter(
        PollVote.poll_id == poll_id, PollVote.citizen_id.isnot(None)).distinct()}
    if not ids:
        return []
    return [cid for (cid,) in db.query(CitizenAccount.id).filter(
        CitizenAccount.id.in_(list(ids)),
        CitizenAccount.is_active.is_(True),
        CitizenAccount.suspended_at.is_(None),
        CitizenAccount.self_deleted_at.is_(None),
    )]


def _where(db, poll) -> dict:
    """The page and post a poll lives on, for the deep link."""
    from app.models.pages import Post

    if poll.post_id is not None:
        post = db.get(Post, poll.post_id)
        return {"official_id": post.official_id if post else "", "post_id": poll.post_id}
    return {"official_id": poll.target_official_id or ""}


def notify_poll(db, poll, now: datetime) -> dict:
    """Bell rows and pushes for one claimed poll. Returns counts."""
    from app.models.pages import Notification
    from app.services import alert_settings
    from app.services.push_service import push_to_citizens

    voters = _voters(db, poll.id)
    bell_ids = alert_settings.wanting(db, voters, "poll_results", alert_settings.BELL)
    push_ids = alert_settings.wanting(db, voters, "poll_results", alert_settings.PUSH) & bell_ids
    where = _where(db, poll)
    question = _truncate(poll.question)
    payload = json.dumps({"poll_id": poll.id, "question": question, **where}, ensure_ascii=False)
    rows = [Notification(recipient_kind="citizen", recipient_id=cid, kind="poll_results",
                         payload_json=payload) for cid in sorted(bell_ids)]
    db.add_all(rows)
    db.flush()
    notification_ids = {n.recipient_id: n.id for n in rows}
    db.commit()
    devices = 0
    if push_ids:
        devices = push_to_citizens(
            db, sorted(push_ids), title="Results are in", body=question,
            data={"kind": "poll_results", "poll_id": poll.id, **where},
            channel="poll_results", tag=f"poll-{poll.id}",
            notification_ids=notification_ids, timing=True,
        )
    return {"voters": len(voters), "bell": len(rows), "pushed_devices": devices}


def _seeded(db) -> bool:
    from app.models.pages import JobRun
    return db.query(JobRun.id).filter(JobRun.job == JOB, JobRun.run_key == SEEDED).first() is not None


def _seed(db, now: datetime) -> int:
    """First pass: stamp every poll already closed, send nothing."""
    from app.models.pages import JobRun, Poll

    n = 0
    while True:
        polls = _closed_polls(db, now, 1000)
        if not polls:
            break
        ids = [p.id for p in polls]
        db.query(Poll).filter(Poll.id.in_(ids)).update(
            {Poll.results_notified_at: now}, synchronize_session=False)
        db.commit()
        n += len(ids)
    db.add(JobRun(job=JOB, run_key=SEEDED, finished_at=now, summary_json=json.dumps({"stamped": n})))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    if n:
        logger.info("poll results: first pass stamped %d poll(s) already closed (no backlog)", n)
    return n


def run(db, now_utc: Optional[datetime] = None) -> dict:
    """Tell voters about every poll that closed since the last pass.
    Safe to run as often as you like and from two processes at once."""
    now = now_utc or datetime.utcnow()
    if not _seeded(db):
        return {"seeded": _seed(db, now)}
    counts = {"polls": 0, "skipped": 0, "bell": 0, "pushed_devices": 0}
    for poll in _closed_polls(db, now, MAX_POLLS_PER_PASS):
        if not _claim(db, poll.id, now):
            continue
        reason = skip_reason(db, poll)
        if reason:
            counts["skipped"] += 1
            logger.info("poll results: poll %s not announced (%s)", poll.id, reason)
            continue
        try:
            got = notify_poll(db, poll, now)
        except Exception:
            db.rollback()
            logger.exception("poll results: poll %s failed after its claim; not retried", poll.id)
            continue
        counts["polls"] += 1
        counts["bell"] += got["bell"]
        counts["pushed_devices"] += got["pushed_devices"]
    if counts["polls"] or counts["skipped"]:
        logger.info("poll results: %s", counts)
    return counts
