# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Weekly civic digest (Task #104).

Builds and sends an opt-in Saturday-morning email per citizen:

  • New posts + polls this week from officials the citizen tracks
  • Polls closing in the next 7 days (from tracked officials)
  • Upcoming district events (next 14 days, tracked officials)

Design rules:
  • OPT-IN ONLY (CitizenAccount.digest_opt_in, default False). No
    surprise email, ever.
  • Demo-domain addresses (@demo-citizens.civicview.app and the
    legacy @civiclens-demo.com) are never sent to — they don't
    receive mail and would only generate Postmark bounces. The
    preview endpoint still works for demo accounts so the feature
    is fully exercisable pre-ID.me.
  • Empty digest → no send. An email with nothing in it trains
    people to ignore the real ones.
  • Per-citizen idempotency via digest_last_sent_at (skip if mailed
    within the last 6 days) — a restart on send day can't double-send.
    Each citizen is also claimed with one conditional UPDATE before
    the send (_claim_for_send), so two processes running the job at
    once during a deploy cannot both mail the same person.
  • All content comes from CivicView's own tables (posts, polls,
    events the officials themselves created). Nothing fabricated.
    Citizen polls about an official are not "what the officials you
    track did", so they are not listed (2026-10-16); neither is
    anything hidden or deleted. Each item names the official and
    links to it.
  • Every digest carries a one-click unsubscribe header and a footer
    link that turn off just the digest (2026-10-16).

The scheduler lives in app/main.py's lifespan (DIGEST_ENABLED env
gate); this module stays import-safe with no side effects.
"""
from __future__ import annotations

import html
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models.pages import (
    CitizenAccount,
    Poll,
    Post,
    RepEvent,
    TrackedOfficial,
)

logger = logging.getLogger(__name__)

DEMO_EMAIL_DOMAINS = ("@demo-citizens.civicview.app", "@civiclens-demo.com")

LOOKBACK_DAYS = 7        # posts/polls "this week"
CLOSING_AHEAD_DAYS = 7   # polls closing soon
EVENTS_AHEAD_DAYS = 14   # upcoming district events
MAX_ITEMS_PER_SECTION = 8


def is_demo_email(email: str) -> bool:
    return any((email or "").lower().endswith(d) for d in DEMO_EMAIL_DOMAINS)


def _tracked_official_keys(db: Session, citizen_id: int) -> list[str]:
    """The citizen's tracked official keys, lowercased.

    routers/tracked.py stores every key lowercased, but official ids
    keep their case on posts, polls and events ("vt-sen-Essex-1"), so
    every match below compares lowercased ids (_lower_id). Until
    2026-10-15 the digest compared them as stored and left out every
    followed official whose id has a capital letter, the same miss
    notifications_inapp fixed for push and bell alerts."""
    from app.services.alert_settings import is_muted

    rows = (
        db.query(TrackedOfficial.official_key, TrackedOfficial.prefs_json)
        .filter(
            TrackedOfficial.tracker_kind == "citizen",
            TrackedOfficial.tracker_id == citizen_id,
            # Tracking ends when a page is archived (2026-10-15).
            TrackedOfficial.ended_at.is_(None),
        )
        .all()
    )
    # "Mute" in My Tracked (2026-10-17) leaves that official out of the
    # digest too.
    return sorted({r[0].strip().lower() for r in rows
                   if r[0] and r[0].strip() and not is_muted(r[1])})


def _lower_id(column):
    """An official-id column, lowercased for matching tracked keys."""
    return func.lower(column)


class _Names:
    """Officials' names for one digest run, looked up once each. A post
    or event carries its author's account; anything else falls back to
    the page's name in the data, then the page id."""

    def __init__(self, db: Session):
        self.db = db
        self._cache: dict = {}

    def get(self, official_id: str, rep_id=None, candidate_id=None) -> str:
        key = (official_id, rep_id, candidate_id)
        if key in self._cache:
            return self._cache[key]
        name = None
        from app.models.pages import CandidateAccount, RepAccount
        if rep_id:
            acct = self.db.get(RepAccount, rep_id)
            name = acct.display_name if acct else None
        if not name and candidate_id:
            acct = self.db.get(CandidateAccount, candidate_id)
            name = acct.display_name if acct else None
        if not name:
            try:
                from app.services.page_lifecycle_job import page_display_name
                name = page_display_name(official_id)
            except Exception:
                name = None
        self._cache[key] = name or official_id
        return self._cache[key]


def _page_url(app_url: str, official_id: str, post_id=None) -> str:
    """The same deep link the bell and push use (lib/deepLinks.js)."""
    from urllib.parse import quote
    url = f"{app_url}/?page={quote(str(official_id), safe='')}"
    return f"{url}#post-{post_id}" if post_id else url


def build_digest(db: Session, citizen: CitizenAccount, app_url: str = "https://civicview.app") -> Optional[dict]:
    """Assemble the digest payload for one citizen. Returns None when
    there is nothing to say (no tracked officials, or a quiet week).

    Since 2026-10-16: only what the officials themselves did (their
    posts, the polls on their posts, their events); citizen polls about
    them are not listed. Hidden or deleted posts, the polls on them,
    archived polls and deleted events are left out. Every item names
    the official and links to it."""
    keys = _tracked_official_keys(db, citizen.id)
    if not keys:
        return None
    now = datetime.utcnow()
    since = now - timedelta(days=LOOKBACK_DAYS)
    names = _Names(db)

    visible_post = and_(Post.deleted_at.is_(None), Post.hide_reason.is_(None))

    posts = (
        db.query(Post)
        .filter(
            _lower_id(Post.official_id).in_(keys),
            Post.created_at >= since,
            visible_post,
        )
        .order_by(Post.created_at.desc())
        .limit(MAX_ITEMS_PER_SECTION)
        .all()
    )

    # Officials' polls: attached to one of their posts (inner join), so
    # a citizen poll that only targets the official never matches.
    official_poll = and_(
        _lower_id(Post.official_id).in_(keys),
        visible_post,
        Poll.archived_at.is_(None),
    )
    new_polls = (
        db.query(Poll, Post)
        .join(Post, Poll.post_id == Post.id)
        .filter(official_poll, Poll.created_at >= since)
        .order_by(Poll.created_at.desc())
        .limit(MAX_ITEMS_PER_SECTION)
        .all()
    )

    closing = (
        db.query(Poll, Post)
        .join(Post, Poll.post_id == Post.id)
        .filter(
            official_poll,
            Poll.closes_at.isnot(None),
            Poll.closes_at > now,
            Poll.closes_at <= now + timedelta(days=CLOSING_AHEAD_DAYS),
        )
        .order_by(Poll.closes_at.asc())
        .limit(MAX_ITEMS_PER_SECTION)
        .all()
    )

    # RepEvent.start_at is a String(40) ISO timestamp (model choice),
    # not DateTime — ISO-8601 compares correctly as text, so bound the
    # window with isoformat strings.
    events = (
        db.query(RepEvent)
        .filter(
            _lower_id(RepEvent.official_id).in_(keys),
            RepEvent.start_at >= now.isoformat(),
            RepEvent.start_at <= (now + timedelta(days=EVENTS_AHEAD_DAYS)).isoformat(),
            RepEvent.deleted_at.is_(None),
        )
        .order_by(RepEvent.start_at.asc())
        .limit(MAX_ITEMS_PER_SECTION)
        .all()
    )

    if not (posts or new_polls or closing or events):
        return None

    def poll_item(poll, post):
        return {
            "question": poll.question,
            "closes_at": poll.closes_at,
            "official_id": post.official_id,
            "official_name": names.get(post.official_id, post.author_id, post.author_candidate_id),
            "url": _page_url(app_url, post.official_id, post.id),
        }

    closing_ids = {poll.id for poll, _post in closing}
    return {
        "citizen_name": citizen.display_name,
        # Dates and times in the citizen's own clock (2026-10-16).
        "tz_prefs": citizen.notification_prefs_json,
        "tracked_count": len(keys),
        "posts": [
            {
                "official_id": p.official_id,
                "official_name": names.get(p.official_id, p.author_id, p.author_candidate_id),
                "preview": (p.body or "")[:180],
                "created_at": p.created_at,
                "url": _page_url(app_url, p.official_id, p.id),
            }
            for p in posts
        ],
        "new_polls": [poll_item(poll, post) for poll, post in new_polls if poll.id not in closing_ids],
        "closing_polls": [poll_item(poll, post) for poll, post in closing],
        "events": [
            {
                "title": e.title,
                "start_at": e.start_at,
                "location": e.location,
                "official_id": e.official_id,
                "official_name": names.get(e.official_id, e.author_id, e.author_candidate_id),
                "url": _page_url(app_url, e.official_id),
            }
            for e in events
        ],
    }


def _fmt_dt(dt, prefs=None, *, with_time: bool = False) -> str:
    """Accepts datetime (naive UTC) OR ISO string (RepEvent.start_at is
    a string column). In the citizen's own time zone since 2026-10-16
    (tz_offset_minutes from their settings), else Eastern with "ET" on
    times; dates alone carry no label. No %-d: glibc-only, breaks on
    Windows dev machines."""
    if not dt:
        return ""
    from app.services.local_time import format_when, parse_utc

    if parse_utc(dt) is None:
        return str(dt)[:10]
    return format_when(dt, prefs, with_time=with_time)


SETTINGS_URL_PATH = "/?open=settings"


def render_digest(data: dict, app_url: str = "https://civicview.app",
                  unsubscribe_url: Optional[str] = None) -> tuple[str, str, str]:
    """Return (subject, html_body, text_body). Plain inline-style HTML,
    email clients, not browsers, so no external CSS. Both versions end
    with why it came, where to turn it off and, when sending, the
    one-click unsubscribe link (services/email_unsubscribe.py)."""
    n_items = (
        len(data["posts"]) + len(data["new_polls"])
        + len(data["closing_polls"]) + len(data["events"])
    )
    subject = f"Your civic week: {n_items} update{'s' if n_items != 1 else ''} from officials you track"

    def esc(s):
        return html.escape(str(s or ""))

    tz = data.get("tz_prefs")
    settings_url = f"{app_url}{SETTINGS_URL_PATH}"

    sections_html: list[str] = []
    sections_text: list[str] = []

    def section(title, rows_html, rows_text):
        if not rows_html:
            return
        sections_html.append(
            f"<h3 style=\"margin:24px 0 8px;font-size:14px;text-transform:uppercase;"
            f"letter-spacing:0.05em;color:#6b7280;\">{esc(title)}</h3>"
            + "".join(rows_html)
        )
        sections_text.append(f"\n{title.upper()}\n" + "\n".join(rows_text))

    row_style = (
        "margin:0 0 10px;padding:12px 14px;border:1px solid #e5e7eb;"
        "border-radius:8px;font-size:14px;line-height:1.5;color:#111827;"
    )
    meta = "color:#6b7280;font-size:12px;"

    def who(item):
        return (f"<a href=\"{esc(item['url'])}\" style=\"color:#111827;font-weight:700;"
                f"text-decoration:none;\">{esc(item['official_name'])}</a><br>")

    def open_link(item, label="Open"):
        return f" &middot; <a href=\"{esc(item['url'])}\" style=\"color:#2563eb;\">{label}</a>"

    section(
        "New posts from officials you track",
        [f"<p style=\"{row_style}\">{who(p)}{esc(p['preview'])}{'…' if len(p['preview']) >= 180 else ''}"
         f"<br><span style=\"{meta}\">{_fmt_dt(p['created_at'], tz)}{open_link(p)}</span></p>"
         for p in data["posts"]],
        [f"- {p['official_name']}: {p['preview'][:100]} ({_fmt_dt(p['created_at'], tz)})\n  {p['url']}"
         for p in data["posts"]],
    )
    section(
        "New polls this week",
        [f"<p style=\"{row_style}\">{who(p)}{esc(p['question'])}<br><span style=\"{meta}\">"
         + (f"closes {_fmt_dt(p['closes_at'], tz, with_time=True)}" if p["closes_at"] else "")
         + f"{open_link(p, 'Vote')}</span></p>" for p in data["new_polls"]],
        [f"- {p['official_name']}: {p['question']}\n  {p['url']}" for p in data["new_polls"]],
    )
    section(
        "Polls closing soon",
        [f"<p style=\"{row_style}\">{who(p)}{esc(p['question'])}"
         f"<br><span style=\"color:#b45309;font-size:12px;\">closes {_fmt_dt(p['closes_at'], tz, with_time=True)}"
         f"{open_link(p, 'Vote')}</span></p>"
         for p in data["closing_polls"]],
        [f"- {p['official_name']}: {p['question']} (closes {_fmt_dt(p['closes_at'], tz, with_time=True)})\n  {p['url']}"
         for p in data["closing_polls"]],
    )
    section(
        "Upcoming events",
        [f"<p style=\"{row_style}\">{who(e)}{esc(e['title'])}"
         f"<br><span style=\"{meta}\">{_fmt_dt(e['start_at'], tz, with_time=True)}"
         + (f" &middot; {esc(e['location'])}" if e["location"] else "") + f"{open_link(e)}</span></p>"
         for e in data["events"]],
        [f"- {e['official_name']}: {e['title']} ({_fmt_dt(e['start_at'], tz, with_time=True)})\n  {e['url']}"
         for e in data["events"]],
    )

    why = ("You're receiving this because you turned on the weekly digest in CivicView settings. "
           "Turn it off any time in your notification settings, Weekly email digest:")
    unsub_html = (f" Or turn it off with one click: <a href=\"{esc(unsubscribe_url)}\" style=\"color:#9ca3af;\">"
                  f"unsubscribe</a>." if unsubscribe_url else "")
    unsub_text = f"\nOr turn it off with one click: {unsubscribe_url}" if unsubscribe_url else ""
    count = data["tracked_count"]
    html_body = (
        f"<div style=\"max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,"
        f"Roboto,Helvetica,Arial,sans-serif;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 4px;font-size:20px;color:#111827;\">Your civic week</h2>"
        f"<p style=\"margin:0 0 8px;color:#6b7280;font-size:14px;\">"
        f"Hi {esc(data['citizen_name'])}, here's what the {count} "
        f"official{'s' if count != 1 else ''} you track did this week.</p>"
        + "".join(sections_html)
        + f"<p style=\"margin:24px 0 0;font-size:13px;\"><a href=\"{app_url}\" "
        f"style=\"color:#2563eb;\">Open CivicView</a></p>"
        f"<p style=\"margin:16px 0 0;color:#9ca3af;font-size:12px;\">"
        f"{esc(why)} <a href=\"{esc(settings_url)}\" style=\"color:#9ca3af;\">{esc(settings_url)}</a>."
        f"{unsub_html}</p></div>"
    )
    text_body = (
        f"Your civic week\n\nHi {data['citizen_name']}, here's what the {count} "
        f"official{'s' if count != 1 else ''} you track did this week.\n" + "\n".join(sections_text)
        + f"\n\nOpen CivicView: {app_url}\n\n{why} {settings_url}{unsub_text}\n"
    )
    return subject, html_body, text_body


def _claim_for_send(db: Session, citizen_id: int, cutoff: datetime) -> Optional[datetime]:
    """Stamp digest_last_sent_at before sending, only if the citizen is
    still due, in one conditional UPDATE (audit O7).

    Two processes running the weekly job at once (an old and a new
    instance overlapping during a deploy) used to read the same due
    list and both send. The UPDATE is atomic, so only one of them gets
    rowcount 1 for a citizen. Returns the claim time, or None when the
    citizen was already claimed.

    Trade-off: a process killed between the claim and the send leaves
    the citizen marked as sent, so that one week's digest is skipped
    rather than sent twice.
    """
    claimed_at = datetime.utcnow()
    claimed = (
        db.query(CitizenAccount)
        .filter(
            CitizenAccount.id == citizen_id,
            or_(
                CitizenAccount.digest_last_sent_at.is_(None),
                CitizenAccount.digest_last_sent_at < cutoff,
            ),
        )
        .update({CitizenAccount.digest_last_sent_at: claimed_at}, synchronize_session=False)
    )
    db.commit()
    return claimed_at if claimed else None


def _release_claim(db: Session, citizen_id: int, claimed_at: datetime, previous: Optional[datetime]) -> None:
    """Undo _claim_for_send when nothing was sent (an empty digest or a
    failed send), so the citizen stays due. Only touches the row if it
    still carries our claim."""
    try:
        (
            db.query(CitizenAccount)
            .filter(
                CitizenAccount.id == citizen_id,
                CitizenAccount.digest_last_sent_at == claimed_at,
            )
            .update({CitizenAccount.digest_last_sent_at: previous}, synchronize_session=False)
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("could not release the digest claim for citizen id=%s", citizen_id)


def send_weekly_digests(db: Session) -> dict:
    """Send the digest to every eligible opted-in citizen. Returns
    summary counts. Caller owns the session/transaction."""
    from app.services import email_unsubscribe
    from app.services.email_service import get_email_service

    email_svc = get_email_service()
    cutoff = datetime.utcnow() - timedelta(days=6)
    citizens = (
        db.query(CitizenAccount)
        .filter(
            CitizenAccount.digest_opt_in.is_(True),
            CitizenAccount.is_active.is_(True),
            CitizenAccount.suspended_at.is_(None),
            CitizenAccount.self_deleted_at.is_(None),
            or_(
                CitizenAccount.digest_last_sent_at.is_(None),
                CitizenAccount.digest_last_sent_at < cutoff,
            ),
        )
        .all()
    )
    sent = skipped_empty = skipped_demo = skipped_claimed = failed = 0
    # Plain values read once: each commit below expires the ORM objects,
    # and re-reading them outside the try could end the whole run.
    due = [(c.id, c.email, c.digest_last_sent_at) for c in citizens]
    for citizen_id, email, previous in due:
        if is_demo_email(email):
            skipped_demo += 1
            continue
        claimed_at = None
        try:
            claimed_at = _claim_for_send(db, citizen_id, cutoff)
            if claimed_at is None:
                # Another process (an overlapping deploy) claimed this
                # citizen after our list was read; it sends, we don't.
                skipped_claimed += 1
                continue
            citizen = db.get(CitizenAccount, citizen_id)
            if citizen is None:
                # Hard-deleted since the list was read.
                _release_claim(db, citizen_id, claimed_at, previous)
                continue
            data = build_digest(db, citizen)
            if data is None:
                skipped_empty += 1
                _release_claim(db, citizen_id, claimed_at, previous)
                continue
            # One-click unsubscribe (RFC 8058) for this digest only, and
            # the digest's own Postmark stream when one is set (unset:
            # the account stream, as before). See
            # services/email_unsubscribe.py and docs/push_notifications_runbook.md.
            unsub = email_unsubscribe.links("citizen", citizen_id, "digest")
            subject, html_body, text_body = render_digest(data, unsubscribe_url=unsub["page_url"])
            ok = email_svc.send(
                to=email,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                headers=unsub["headers"],
                message_stream=(os.getenv("POSTMARK_DIGEST_STREAM") or "").strip() or None,
            )
            if not ok:
                # send() never raises; False means the backend failed.
                # Put digest_last_sent_at back so the next run retries
                # this citizen.
                failed += 1
                _release_claim(db, citizen_id, claimed_at, previous)
                continue
            # The claim already stamped digest_last_sent_at.
            sent += 1
        except Exception:
            db.rollback()
            failed += 1
            logger.exception("digest send failed for citizen id=%s", citizen_id)
            if claimed_at is not None:
                _release_claim(db, citizen_id, claimed_at, previous)
    summary = {
        "eligible": len(citizens),
        "sent": sent,
        "skipped_empty": skipped_empty,
        "skipped_demo": skipped_demo,
        "skipped_claimed": skipped_claimed,
        "failed": failed,
    }
    logger.info("weekly digest run: %s", summary)
    return summary
