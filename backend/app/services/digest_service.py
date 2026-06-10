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
  • All content comes from CivicView's own tables (posts, polls,
    events the officials themselves created). Nothing fabricated.

The scheduler lives in app/main.py's lifespan (DIGEST_ENABLED env
gate); this module stays import-safe with no side effects.
"""
from __future__ import annotations

import html
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, or_
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
    rows = (
        db.query(TrackedOfficial.official_key)
        .filter(
            TrackedOfficial.tracker_kind == "citizen",
            TrackedOfficial.tracker_id == citizen_id,
        )
        .all()
    )
    return [r[0] for r in rows if r[0]]


def build_digest(db: Session, citizen: CitizenAccount) -> Optional[dict]:
    """Assemble the digest payload for one citizen. Returns None when
    there is nothing to say (no tracked officials, or a quiet week)."""
    keys = _tracked_official_keys(db, citizen.id)
    if not keys:
        return None
    now = datetime.utcnow()
    since = now - timedelta(days=LOOKBACK_DAYS)

    posts = (
        db.query(Post)
        .filter(
            Post.official_id.in_(keys),
            Post.created_at >= since,
            Post.deleted_at.is_(None),
            Post.hide_reason.is_(None),
        )
        .order_by(Post.created_at.desc())
        .limit(MAX_ITEMS_PER_SECTION)
        .all()
    )

    new_polls = (
        db.query(Poll)
        .join(Post, Poll.post_id == Post.id, isouter=True)
        .filter(
            or_(
                and_(Post.official_id.in_(keys), Poll.created_at >= since),
                and_(Poll.target_official_id.in_(keys), Poll.created_at >= since),
            ),
            Poll.archived_at.is_(None),
        )
        .order_by(Poll.created_at.desc())
        .limit(MAX_ITEMS_PER_SECTION)
        .all()
    )

    closing = (
        db.query(Poll)
        .join(Post, Poll.post_id == Post.id, isouter=True)
        .filter(
            or_(Post.official_id.in_(keys), Poll.target_official_id.in_(keys)),
            Poll.closes_at.isnot(None),
            Poll.closes_at > now,
            Poll.closes_at <= now + timedelta(days=CLOSING_AHEAD_DAYS),
            Poll.archived_at.is_(None),
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
            RepEvent.official_id.in_(keys),
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

    closing_ids = {p.id for p in closing}
    return {
        "citizen_name": citizen.display_name,
        "tracked_count": len(keys),
        "posts": [
            {
                "official_id": p.official_id,
                "preview": (p.body or "")[:180],
                "created_at": p.created_at,
            }
            for p in posts
        ],
        "new_polls": [
            {
                "question": p.question,
                "closes_at": p.closes_at,
                "official_id": p.target_official_id,
            }
            for p in new_polls
            if p.id not in closing_ids
        ],
        "closing_polls": [
            {"question": p.question, "closes_at": p.closes_at} for p in closing
        ],
        "events": [
            {
                "title": e.title,
                "start_at": e.start_at,
                "location": e.location,
                "official_id": e.official_id,
            }
            for e in events
        ],
    }


def _fmt_dt(dt) -> str:
    """Accepts datetime OR ISO string (RepEvent.start_at is a string
    column). No %-d — glibc-only, breaks on Windows dev machines."""
    if not dt:
        return ""
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return dt[:10]
    return f"{dt.strftime('%a, %b')} {dt.day}"


def render_digest(data: dict, app_url: str = "https://civicview.app") -> tuple[str, str, str]:
    """Return (subject, html_body, text_body). Plain inline-style HTML —
    email clients, not browsers, so no external CSS."""
    n_items = (
        len(data["posts"]) + len(data["new_polls"])
        + len(data["closing_polls"]) + len(data["events"])
    )
    subject = f"Your civic week — {n_items} update{'s' if n_items != 1 else ''} from officials you track"

    def esc(s):
        return html.escape(str(s or ""))

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

    section(
        "New posts from officials you track",
        [f"<p style=\"{row_style}\">{esc(p['preview'])}{'…' if len(p['preview']) >= 180 else ''}"
         f"<br><span style=\"color:#6b7280;font-size:12px;\">{_fmt_dt(p['created_at'])}</span></p>"
         for p in data["posts"]],
        [f"- {p['preview'][:100]} ({_fmt_dt(p['created_at'])})" for p in data["posts"]],
    )
    section(
        "New polls this week",
        [f"<p style=\"{row_style}\">{esc(p['question'])}"
         + (f"<br><span style=\"color:#6b7280;font-size:12px;\">closes {_fmt_dt(p['closes_at'])}</span>" if p["closes_at"] else "")
         + "</p>" for p in data["new_polls"]],
        [f"- {p['question']}" for p in data["new_polls"]],
    )
    section(
        "Polls closing soon — make your voice count",
        [f"<p style=\"{row_style}\">{esc(p['question'])}"
         f"<br><span style=\"color:#b45309;font-size:12px;\">closes {_fmt_dt(p['closes_at'])}</span></p>"
         for p in data["closing_polls"]],
        [f"- {p['question']} (closes {_fmt_dt(p['closes_at'])})" for p in data["closing_polls"]],
    )
    section(
        "Upcoming in your district",
        [f"<p style=\"{row_style}\">{esc(e['title'])}"
         f"<br><span style=\"color:#6b7280;font-size:12px;\">{_fmt_dt(e['start_at'])}"
         + (f" · {esc(e['location'])}" if e["location"] else "") + "</span></p>"
         for e in data["events"]],
        [f"- {e['title']} ({_fmt_dt(e['start_at'])})" for e in data["events"]],
    )

    html_body = (
        f"<div style=\"max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,"
        f"Roboto,Helvetica,Arial,sans-serif;padding:24px 16px;\">"
        f"<h2 style=\"margin:0 0 4px;font-size:20px;color:#111827;\">Your civic week</h2>"
        f"<p style=\"margin:0 0 8px;color:#6b7280;font-size:14px;\">"
        f"Hi {esc(data['citizen_name'])} — here's what the {data['tracked_count']} "
        f"official{'s' if data['tracked_count'] != 1 else ''} you track did this week.</p>"
        + "".join(sections_html)
        + f"<p style=\"margin:24px 0 0;font-size:13px;\"><a href=\"{app_url}\" "
        f"style=\"color:#2563eb;\">Open CivicView</a></p>"
        f"<p style=\"margin:16px 0 0;color:#9ca3af;font-size:12px;\">"
        f"You're receiving this because you turned on the weekly digest in "
        f"CivicView settings. Turn it off any time in Dashboard → Account &amp; "
        f"settings → Weekly digest.</p></div>"
    )
    text_body = (
        f"Your civic week\n\nHi {data['citizen_name']} — here's what the officials "
        f"you track did this week.\n" + "\n".join(sections_text)
        + f"\n\nOpen CivicView: {app_url}\n\nYou're receiving this because you "
        f"turned on the weekly digest in CivicView settings."
    )
    return subject, html_body, text_body


def send_weekly_digests(db: Session) -> dict:
    """Send the digest to every eligible opted-in citizen. Returns
    summary counts. Caller owns the session/transaction."""
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
    sent = skipped_empty = skipped_demo = failed = 0
    for citizen in citizens:
        if is_demo_email(citizen.email):
            skipped_demo += 1
            continue
        try:
            data = build_digest(db, citizen)
            if data is None:
                skipped_empty += 1
                continue
            subject, html_body, text_body = render_digest(data)
            ok = email_svc.send(
                to=citizen.email,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
            )
            if not ok:
                # send() never raises — False means the backend failed.
                # Leave digest_last_sent_at untouched so the next run
                # retries this citizen.
                failed += 1
                continue
            citizen.digest_last_sent_at = datetime.utcnow()
            db.add(citizen)
            db.commit()
            sent += 1
        except Exception:
            db.rollback()
            failed += 1
            logger.exception("digest send failed for citizen id=%s", citizen.id)
    summary = {
        "eligible": len(citizens),
        "sent": sent,
        "skipped_empty": skipped_empty,
        "skipped_demo": skipped_demo,
        "failed": failed,
    }
    logger.info("weekly digest run: %s", summary)
    return summary
