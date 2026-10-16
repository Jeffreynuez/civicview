# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
The daily job for former officials and candidates (2026-10-15).

A page's stage is worked out from dates on every read
(services/page_lifecycle.py), so this job never changes what a page
shows. It does the three things dates cannot:

  * notices to the person (claimed pages only, decision 7): when they
    leave office or their campaign ends, 30 days before the archive,
    and at the archive. In-app, plus email through the existing
    Postmark service where the account has a real address;
  * one notice to each person tracking the page, on claimed and
    unclaimed pages alike, with a button to follow whoever holds the
    seat now (officials), or to follow the winner in office;
  * at the archive, ending tracking: each tracked row is stamped
    ended_at, never deleted.

No backlog (Jeffrey, 2026-10-15): "First run after deploy: no backlog.
For anything already past, send only the one notice that fits today's
stage, once." When more than one person notice is due at once, only
the latest is sent and the others are stamped as skipped. The tracker
notice is worded for the stage it goes out in.

Runs at boot and once a day in the same loop as the retention jobs
(main.py), and on demand from the admin Transitions tab. Idempotent:
every notice is stamped on the page's page_transitions row.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.services import page_lifecycle as pl

logger = logging.getLogger(__name__)


def app_url() -> str:
    return (os.getenv("PUBLIC_APP_URL") or "https://civicview.app").rstrip("/")


def page_link(page_id: str) -> str:
    from urllib.parse import quote
    return f"{app_url()}/?page={quote(page_id, safe='')}"


# ── names ────────────────────────────────────────────────────────────

def page_display_name(page_id: Optional[str]) -> Optional[str]:
    """Best-effort name for a page id, from the data the app already
    loads. None when nothing knows the id."""
    if not page_id:
        return None
    t = pl.registry.all().get(page_id)
    if t and t.display_name:
        return t.display_name
    try:
        c = _elections().get_candidate(page_id)
        if c and c.get("name"):
            return c["name"]
    except Exception:
        pass
    try:
        from app.routers.state_officials import service as state_service
        prefix = page_id.split("-", 1)[0].upper()
        if len(prefix) == 2:
            person = state_service.find_person_by_id(prefix, page_id)
            if person and person.get("name"):
                return person["name"]
    except Exception:
        pass
    try:
        from app.services.federal_officials_service import FederalOfficialsService
        person = FederalOfficialsService().find_by_id(page_id)
        if person and person.get("name"):
            return person["name"]
    except Exception:
        pass
    try:
        from app.services.officials_index import _load_legislators_current_synchronously
        for m in _load_legislators_current_synchronously() or []:
            if ((m or {}).get("id") or {}).get("bioguide") == page_id:
                n = m.get("name") or {}
                return n.get("official_full") or f"{n.get('first', '')} {n.get('last', '')}".strip()
    except Exception:
        pass
    return None


_ELECTIONS = None


def _elections():
    global _ELECTIONS
    if _ELECTIONS is None:
        from app.services.elections_service import ElectionsService
        _ELECTIONS = ElectionsService()
    return _ELECTIONS


def successors_payload(t: pl.Transition) -> list:
    out = []
    for sid in (t.successor_ids or [])[:3]:
        out.append({"id": sid, "name": page_display_name(sid)})
    return out


# ── notice texts ─────────────────────────────────────────────────────
# Same words for everyone, whatever the party. No dashes.

def _verify_phrase() -> str:
    from app.services.entitlements import idme_enabled
    return "verify it with ID.me" if idme_enabled() else "verify it once ID.me verification opens"


def _what_happened_to_you(t: pl.Transition) -> str:
    office = t.office_label
    if t.page_kind == "official":
        if t.event_on:
            return f"You left office as {office} on {pl.long_date(t.event_on)}."
        return f"CivicView recorded on {pl.long_date(t.recorded_on)} that you no longer hold the office of {office}."
    if t.event == "not_on_ballot":
        when = pl.long_date(t.recorded_on or t.event_on)
        return f"CivicView recorded on {when} that you aren't on {pl.ballot_phrase(t)} for {office}."
    if t.event_on:
        how = "you withdrew" if t.event == "withdrew" else "the result was certified"
        return f"Your campaign for {office} ended when {how} on {pl.long_date(t.event_on)}."
    return f"CivicView recorded on {pl.long_date(t.recorded_on)} that your campaign for {office} has ended."


def person_left_text(t: pl.Transition, today: date) -> str:
    title = t.title(today) or ""
    acting = "as the official" if t.page_kind == "official" else "as a candidate"
    start = pl.long_date(t.clock_start)
    parts = [
        _what_happened_to_you(t),
        f'Your page now reads "{title}".',
        f"Polls, events, comments, likes and votes {acting} ended on {start}.",
    ]
    archive = pl.long_date(t.archive_on)
    if t.farewell_ends_on and today < t.farewell_ends_on:
        parts.append(
            f"Until {pl.long_date(t.farewell_ends_on)} you can still publish posts. After that the page is "
            f"read-only, and on {archive} it is archived: it leaves search, the map, feeds and tracked "
            "lists, stays readable by direct link, and nothing on it is deleted."
        )
    else:
        parts.append(
            f"The 30-day window for farewell posts ended on {pl.long_date(t.farewell_ends_on)}, so the page "
            f"is read-only. On {archive} it will be archived: it leaves search, the map, feeds and tracked "
            "lists, stays readable by direct link, and nothing on it is deleted."
        )
    carry = ("your name, a copy of your tracked items, saved posts and notification settings, and an "
             "optional Served as line" if t.page_kind == "official" else
             "your name and a copy of your tracked items, saved posts and notification settings")
    parts.append(
        f"To keep taking part, create a citizen account and {_verify_phrase()}. From your dashboard you "
        f"can choose to carry {carry} to that citizen account."
    )
    return " ".join(parts)


def person_pre_archive_text(t: pl.Transition) -> str:
    return (f"Your page will be archived on {pl.long_date(t.archive_on)}. It will leave search, the map, "
            "feeds and tracked lists, and stay readable by direct link. Nothing on it is deleted. "
            "Your dashboard still has the choices for your citizen account.")


def person_archived_text(t: pl.Transition, today: date) -> str:
    when = "today" if t.archive_on == today else f"on {pl.long_date(t.archive_on)}"
    return (f"Your page was archived {when}. It stays readable at {page_link(t.page_id)}. "
            "Nothing on it was deleted.")


def tracker_text(t: pl.Transition, name: str, today: date) -> str:
    office = t.office_label
    if t.page_kind == "official":
        if t.event_on:
            first = f"{name} left office as {office} on {pl.long_date(t.event_on)}."
        else:
            first = f"CivicView recorded on {pl.long_date(t.recorded_on)} that {name} is no longer {office}."
    elif t.event == "not_on_ballot":
        when = pl.long_date(t.recorded_on or t.event_on)
        first = f"CivicView recorded on {when} that {name} isn't on {pl.ballot_phrase(t)} for {office}."
    elif t.event_on:
        first = f"{name}'s campaign for {office} ended on {pl.long_date(t.event_on)}."
    else:
        first = f"CivicView recorded on {pl.long_date(t.recorded_on)} that {name}'s campaign for {office} has ended."
    if t.stage(today) == pl.ARCHIVED:
        second = f"The page was archived on {pl.long_date(t.archive_on)}, so you no longer track it."
    elif t.archive_on:
        second = f"You'll stop tracking this page when it is archived on {pl.long_date(t.archive_on)}."
    else:
        second = "You can keep reading the page by direct link."
    return f"{first} {second}"


def took_office_text(t: pl.Transition, name: str) -> str:
    office = t.office_label
    return (f"{name} took office as {pl.elect_title(office).replace('-elect', '')}. "
            "This campaign page is archived, so you no longer track it. Follow the official page to keep up.")


def reelected_text(t: pl.Transition, name: str) -> str:
    return (f"{name} was re-elected ({t.office_label}). This campaign page will be archived on "
            f"{pl.long_date(t.archive_on)}, and you'll stop tracking it then. Follow the official page "
            "to keep up.")


# ── delivery ─────────────────────────────────────────────────────────

def _deliver(db: Session, *, recipient_kind: str, recipient_id: int, kind: str, payload: dict,
             email: Optional[str] = None, subject: Optional[str] = None) -> None:
    from app.models.pages import Notification
    db.add(Notification(
        recipient_kind=recipient_kind,
        recipient_id=recipient_id,
        kind=kind,
        payload_json=json.dumps(payload, ensure_ascii=False),
    ))
    if email and subject:
        from app.services.digest_service import is_demo_email
        if is_demo_email(email) or email.endswith("@closed.invalid"):
            return
        try:
            from app.services.email_service import get_email_service
            body = payload.get("text", "") + f"\n\n{page_link(payload.get('official_id') or '')}\n\nThe CivicView team\n"
            get_email_service().send(to=email, subject=subject, text_body=body)
        except Exception:
            logger.exception("page_lifecycle_job: email failed (kind=%s)", kind)


def _owner_account(db: Session, t: pl.Transition):
    from app.models.pages import CandidateAccount, RepAccount
    if t.page_kind == "official":
        return "rep", db.query(RepAccount).filter(RepAccount.official_id == t.page_id).first()
    return "candidate", db.query(CandidateAccount).filter(CandidateAccount.candidate_id == t.page_id).first()


def _trackers(db: Session, page_id: str, *, include_ended: bool = False):
    from app.models.pages import TrackedOfficial
    q = db.query(TrackedOfficial).filter(func.lower(TrackedOfficial.official_key) == page_id.lower())
    if not include_ended:
        q = q.filter(TrackedOfficial.ended_at.is_(None))
    return q.all()


def _tracker_email(db: Session, kind: str, tracker_id: int) -> Optional[str]:
    from app.models.pages import CandidateAccount, CitizenAccount, RepAccount
    model = {"citizen": CitizenAccount, "rep": RepAccount, "candidate": CandidateAccount}.get(kind)
    if model is None:
        return None
    acct = db.get(model, tracker_id)
    return getattr(acct, "email", None) if acct is not None else None


def _base_payload(t: pl.Transition, name: str, today: date) -> dict:
    return {
        "official_id": t.page_id,
        "official_name": name,
        "page_kind": t.page_kind,
        "title": t.title(today),
        "office_label": t.office_label,
        "archive_on": t.archive_on.isoformat() if t.archive_on else None,
        "farewell_ends_on": t.farewell_ends_on.isoformat() if t.farewell_ends_on else None,
    }


def notify_followers_to_follow(db: Session, t: pl.Transition, *, official_page_id: str, name: str,
                               reelected: bool, today: date) -> int:
    """One "Follow in office" notice to each follower of a winner's
    campaign page. Used by the hand-off and by the job."""
    text = reelected_text(t, name) if reelected else took_office_text(t, name)
    sent = 0
    for row in _trackers(db, t.page_id):
        payload = {**_base_payload(t, name, today), "text": text,
                   "follow": {"id": official_page_id, "name": name, "label": "Follow in office"}}
        _deliver(db, recipient_kind=row.tracker_kind, recipient_id=row.tracker_id,
                 kind="tracked_now_in_office", payload=payload,
                 email=_tracker_email(db, row.tracker_kind, row.tracker_id),
                 subject=f"{name} was re-elected" if reelected else f"{name} took office")
        sent += 1
    return sent


def end_tracking(db: Session, page_id: str, reason: str = "archived") -> int:
    now = datetime.utcnow()
    n = 0
    for row in _trackers(db, page_id):
        row.ended_at = now
        row.ended_reason = reason
        n += 1
    return n


# ── the pass ─────────────────────────────────────────────────────────

_ROW_FIELDS = ("page_kind", "event", "event_on", "recorded_on", "incumbent", "sworn_in_on",
               "handoff_on", "office_label", "served_from", "served_to", "election_year",
               "linked_page_id", "display_name", "state", "source_url", "source_note")


def _sync_data_row(row, t: pl.Transition) -> None:
    for f in _ROW_FIELDS:
        setattr(row, f, getattr(t, f))
    row.successor_ids_json = json.dumps(list(t.successor_ids or []))


def _stamp_skipped(row, name: str) -> None:
    have = [s for s in (row.skipped_notices or "").split(",") if s]
    if name not in have:
        have.append(name)
    row.skipped_notices = ",".join(have)


def process(db: Session, t: pl.Transition, row, today: date, summary: dict) -> None:
    now = datetime.utcnow()
    stage = t.stage(today)
    name = t.display_name or page_display_name(t.page_id) or "This official"

    # Winners: the followers' "Follow in office" notice.
    if t.event == "won":
        target = t.linked_page_id
        due = (t.incumbent and t.clock_start and today >= t.clock_start) or \
              (not t.incumbent and t.sworn_in_on and today >= t.sworn_in_on)
        if due and target and row.followers_notice_at is None:
            summary["followers_notices"] += notify_followers_to_follow(
                db, t, official_page_id=target, name=name, reelected=t.incumbent, today=today)
            row.followers_notice_at = now
        if stage == pl.ARCHIVED and row.tracking_ended_at is None:
            summary["tracking_ended"] += end_tracking(db, t.page_id)
            row.tracking_ended_at = now
        return

    if stage == pl.ACTIVE:
        return

    # Notices to the person (claimed pages only).
    kind, account = _owner_account(db, t)
    if account is not None:
        due = []
        if stage in pl.FORMER_STAGES and row.person_left_notice_at is None:
            due.append("left")
        # Past the archive this is never the last one due, so it is
        # recorded as skipped instead of sent (no backlog).
        if (t.pre_archive_notice_on and today >= t.pre_archive_notice_on
                and row.person_pre_archive_notice_at is None):
            due.append("pre_archive")
        if stage == pl.ARCHIVED and row.person_archived_notice_at is None:
            due.append("archived")
        for skipped in due[:-1]:
            _stamp_skipped(row, skipped)
            setattr(row, f"person_{skipped}_notice_at", now)
        if due:
            last = due[-1]
            payload = _base_payload(t, name, today)
            if last == "left":
                payload["text"] = person_left_text(t, today)
                notice_kind = "office_ended" if t.page_kind == "official" else "campaign_ended"
                subject = ("Your CivicView page is now a former official's page" if t.page_kind == "official"
                           else "Your CivicView campaign page has changed")
            elif last == "pre_archive":
                payload["text"] = person_pre_archive_text(t)
                notice_kind = "page_archive_soon"
                subject = f"Your CivicView page will be archived on {pl.long_date(t.archive_on)}"
            else:
                payload["text"] = person_archived_text(t, today)
                notice_kind = "page_archived"
                subject = "Your CivicView page was archived"
            _deliver(db, recipient_kind=kind, recipient_id=account.id, kind=notice_kind,
                     payload=payload, email=getattr(account, "email", None), subject=subject)
            setattr(row, f"person_{last}_notice_at", now)
            summary["person_notices"] += 1

    # One notice to each tracker, claimed or not (decision f).
    if row.trackers_notice_at is None:
        text = tracker_text(t, name, today)
        successors = successors_payload(t) if t.page_kind == "official" else []
        n = 0
        for tr in _trackers(db, t.page_id):
            payload = {**_base_payload(t, name, today), "text": text, "successors": successors}
            _deliver(db, recipient_kind=tr.tracker_kind, recipient_id=tr.tracker_id,
                     kind="tracked_left_office" if t.page_kind == "official" else "tracked_campaign_ended",
                     payload=payload, email=_tracker_email(db, tr.tracker_kind, tr.tracker_id),
                     subject=(f"{name} is no longer in office" if t.page_kind == "official"
                              else f"{name} isn't on the November ballot" if t.event == "not_on_ballot"
                              else f"{name}'s campaign has ended"))
            n += 1
        row.trackers_notice_at = now
        summary["tracker_notices"] += n

    # Tracking ends at the archive.
    if stage == pl.ARCHIVED and row.tracking_ended_at is None:
        summary["tracking_ended"] += end_tracking(db, t.page_id)
        row.tracking_ended_at = now


def run_page_lifecycle(db: Optional[Session] = None, today: Optional[date] = None) -> dict:
    """One pass over every transition. Returns a summary. Never raises
    when it owns the session (boot and the daily loop)."""
    from app.db import SessionLocal
    from app.models.pages import PageTransition

    owns = db is None
    db = db or SessionLocal()
    today = today or pl.today_et()
    summary = {"transitions": 0, "person_notices": 0, "tracker_notices": 0,
               "followers_notices": 0, "tracking_ended": 0}
    try:
        pl.invalidate_cache()
        transitions = pl.all_transitions(db)
        rows = {r.page_id: r for r in db.query(PageTransition).all()}
        now = datetime.utcnow()
        for page_id, t in transitions.items():
            row = rows.get(page_id)
            if row is None:
                row = PageTransition(page_id=page_id, origin="data")
                _sync_data_row(row, t)
                db.add(row)
                rows[page_id] = row
            elif row.origin != "admin":
                _sync_data_row(row, t)
            process(db, t, row, today, summary)
            if row.first_processed_at is None:
                row.first_processed_at = now
            summary["transitions"] += 1
        db.commit()
        logger.info("page lifecycle pass (%s): %s", today.isoformat(), summary)
    except Exception:
        db.rollback()
        logger.exception("page lifecycle pass failed")
        if not owns:
            raise
    finally:
        if owns:
            db.close()
    return summary
