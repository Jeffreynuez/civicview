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

Runs in its own loop in main.py (2026-10-16): FIRST_PASS_DELAY_SECONDS
after boot, never on the boot path, then once a day, and again after
RETRY_SECONDS when a pass left work for later. An advisory lock keeps
two instances from running it at once. Also on demand from the admin
Transitions tab, which first shows preview_page_lifecycle(): every
notice it would send, to how many people, how many by email, and the
text.

Exactly once per person (2026-10-16): every notice to every recipient
is claimed with a page_notice_deliveries row, committed before the bell
row and the email, so a failure part way through resends nothing and a
rerun continues where it stopped. A notice is stamped on the page's
page_transitions row only when all its recipients are done. Recipients
go in batches of BATCH_SIZE with a short pause, at most
MAX_RECIPIENTS_PER_PASS per pass (the January 3, 2027 turnover is
large); the rest go on the next pass. Suspended, inactive, self-deleted
and closed accounts get nothing (no bell row, no email).

Phone pushes (2026-10-17, Jeffrey): a citizen tracking a page that
changed also gets a push, on by default ("Changes to pages you track"
in the notification settings). When one run finds more than one change
for a person, they get one push, "3 pages you track changed", opening
the bell, instead of one per change; a single change keeps its own
push. That covers results week and the January 3 turnover. Quiet hours
hold it like any push; "Mute" in My Tracked does not (it silences an
official's posts, not the news that their page changed).
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
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

BATCH_SIZE = 100
BATCH_PAUSE_SECONDS = 1.0
MAX_RECIPIENTS_PER_PASS = 5000
FIRST_PASS_DELAY_SECONDS = 120
INTERVAL_SECONDS = 24 * 60 * 60
RETRY_SECONDS = 15 * 60
LOCK_NAME = "page-lifecycle-job"


@dataclass
class NoticePlan:
    """One notice, to everyone it goes to."""
    page_id: str
    notice: str                 # person_left | person_pre_archive | person_archived | trackers | followers
    kind: str                   # Notification.kind
    recipients: list            # [(recipient_kind, recipient_id)]
    payload: dict
    subject: Optional[str]
    stamp: Optional[str]        # PageTransition column set once everyone is done
    to_tracker: bool = False    # a notice about a page someone tracks


@dataclass
class PagePlan:
    page_id: str
    notices: list = field(default_factory=list)
    skipped: list = field(default_factory=list)   # person notices recorded as skipped (no backlog)
    end_tracking: bool = False


class _Budget:
    def __init__(self, n: int):
        self.left = n


_MODELS = None


def _account_model(kind: str):
    global _MODELS
    if _MODELS is None:
        from app.models.pages import CandidateAccount, CitizenAccount, RepAccount
        _MODELS = {"citizen": CitizenAccount, "rep": RepAccount, "candidate": CandidateAccount}
    return _MODELS.get(kind)


def account_for(db: Session, kind: str, account_id: int):
    model = _account_model(kind)
    return db.get(model, account_id) if model is not None else None


def account_is_open(acct) -> bool:
    """False for an account that must get nothing: gone, inactive,
    suspended, being deleted (the 30-day window) or closed."""
    if acct is None:
        return False
    if getattr(acct, "is_active", True) is False:
        return False
    for col in ("suspended_at", "self_deleted_at", "closed_at"):
        if getattr(acct, col, None) is not None:
            return False
    return True


def email_skip_reason(acct, plan: NoticePlan) -> Optional[str]:
    """Why this account gets the bell row but no email, or None."""
    from app.services.digest_service import is_demo_email

    email = (getattr(acct, "email", None) or "").strip()
    if not email or not plan.subject:
        return "no_address"
    if is_demo_email(email) or email.endswith("@closed.invalid"):
        return "demo_address"
    # "Email me when a page I track changes" (2026-10-16), on unless the
    # account turned it off. Only notices about a page someone tracks;
    # the person's own notices about their page always go.
    if plan.to_tracker and getattr(acct, "page_change_email_off_at", None) is not None:
        return "turned_off"
    return None


TRACKER_EMAIL_FOOTER = ("You get this email because you track this page on CivicView. To stop these emails, "
                        "turn off \"Email me when a page I track changes\" in your notification settings, "
                        "or use this link:")
# A citizen's settings list names it "Changes to pages you track" (2026-10-17).
CITIZEN_TRACKER_EMAIL_FOOTER = ("You get this email because you track this page on CivicView. To stop these "
                                "emails, choose a setting without email for \"Changes to pages you track\" "
                                "in your notification settings, or use this link:")


def _send_email(plan: NoticePlan, acct) -> bool:
    from app.services import email_unsubscribe
    from app.services.email_service import get_email_service

    body = plan.payload.get("text", "") + f"\n\n{page_link(plan.payload.get('official_id') or '')}\n\nThe CivicView team\n"
    extra = {}
    if plan.to_tracker:
        # The footer line and one-click unsubscribe (RFC 8058) turn off
        # just these emails; the in-app notice still comes.
        kind = {"RepAccount": "rep", "CandidateAccount": "candidate"}.get(type(acct).__name__, "citizen")
        unsub = email_unsubscribe.links(kind, acct.id, "page_changes")
        footer = CITIZEN_TRACKER_EMAIL_FOOTER if kind == "citizen" else TRACKER_EMAIL_FOOTER
        body += f"\n{footer} {unsub['page_url']}\n"
        extra["headers"] = unsub["headers"]
    return bool(get_email_service().send(to=acct.email, subject=plan.subject, text_body=body, **extra))


def _done_recipients(db: Session, plan: NoticePlan) -> set:
    from app.models.pages import PageNoticeDelivery
    return {
        (k, i) for k, i in db.query(PageNoticeDelivery.recipient_kind, PageNoticeDelivery.recipient_id)
        .filter(PageNoticeDelivery.page_id == plan.page_id, PageNoticeDelivery.notice == plan.notice)
    }


def deliver_notice(db: Session, plan: NoticePlan, summary: dict, *, budget: Optional[_Budget] = None,
                   pause_seconds: float = 0.0, pushes: Optional[dict] = None) -> bool:
    """Claim, bell row, email, for each recipient not yet done. Commits
    per recipient. Returns True when everyone is done (the notice can
    be stamped), False when the budget ran out first. pushes, when
    given, collects {citizen_id: [(notification_id, plan)]} for the
    tracker notices, sent at the end of the run (send_page_change_pushes)."""
    from app.models.pages import Notification, PageNoticeDelivery

    done = _done_recipients(db, plan)
    todo = [r for r in plan.recipients if r not in done]
    payload_json = json.dumps(plan.payload, ensure_ascii=False)
    for i, (rkind, rid) in enumerate(todo):
        if budget is not None and budget.left <= 0:
            summary["work_left"] = True
            return False
        if i and i % BATCH_SIZE == 0 and pause_seconds:
            time.sleep(pause_seconds)
        claim = PageNoticeDelivery(page_id=plan.page_id, notice=plan.notice,
                                   recipient_kind=rkind, recipient_id=rid)
        db.add(claim)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            summary["already_claimed"] += 1
            continue
        if budget is not None:
            budget.left -= 1
        acct = account_for(db, rkind, rid)
        if not account_is_open(acct):
            claim.email_status = "account_closed"
            db.commit()
            summary["skipped_accounts"] += 1
            continue
        note = Notification(recipient_kind=rkind, recipient_id=rid, kind=plan.kind, payload_json=payload_json)
        db.add(note)
        db.flush()
        claim.notification_id = note.id
        db.commit()
        if pushes is not None and plan.to_tracker and rkind == "citizen":
            pushes.setdefault(rid, []).append((note.id, plan))
        summary["followers_notices" if plan.notice == "followers"
                else "tracker_notices" if plan.notice == "trackers" else "person_notices"] += 1
        reason = email_skip_reason(acct, plan)
        if reason is None:
            try:
                ok = _send_email(plan, acct)
            except Exception:
                logger.exception("page_lifecycle_job: email failed (kind=%s)", plan.kind)
                ok = False
            reason = "sent" if ok else "failed"
            summary["emails_sent" if ok else "emails_failed"] += 1
        claim.email_status = reason
        db.commit()
    return True


def _short(text: str, n: int = 160) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "\u2026"


def send_page_change_pushes(db: Session, pushes: dict) -> dict:
    """One push per citizen for the page changes a run found: the change
    itself when there is one, else "N pages you track changed" opening
    the bell. Only citizens whose "Changes to pages you track" setting
    includes push. Never raises."""
    from app.services import alert_settings
    from app.services.push_service import push_to_citizens

    counts = {"single": 0, "grouped": 0, "devices": 0}
    if not pushes:
        return counts
    try:
        allowed = alert_settings.wanting(db, list(pushes), "page_changes", alert_settings.PUSH)
        for cid, items in pushes.items():
            if cid not in allowed or not items:
                continue
            if len(items) == 1:
                nid, plan = items[0]
                page_id = plan.payload.get("official_id") or plan.page_id
                counts["devices"] += push_to_citizens(
                    db, [cid], title=plan.subject or "A page you track changed",
                    body=_short(plan.payload.get("text", "")),
                    data={"kind": "page_change", "official_id": page_id},
                    channel="page_changes", tag=f"page-{page_id}",
                    official_name=plan.payload.get("official_name"),
                    notification_ids={cid: nid}, timing=False,
                )
                counts["single"] += 1
            else:
                names = []
                for _nid, plan in items:
                    name = plan.payload.get("official_name")
                    if name and name not in names:
                        names.append(name)
                if len(names) <= 2:
                    line = " and ".join(names)
                else:
                    line = f"{names[0]}, {names[1]} and {len(names) - 2} more"
                counts["devices"] += push_to_citizens(
                    db, [cid], title=f"{len(items)} pages you track changed",
                    body=f"{line}." if line else "Open the bell to see them.",
                    data={"kind": "page_changes", "count": len(items)},
                    channel="page_changes", tag="page-changes", timing=False,
                )
                counts["grouped"] += 1
    except Exception:
        db.rollback()
        logger.exception("page change pushes failed (non-fatal)")
    if counts["single"] or counts["grouped"]:
        logger.info("page change pushes: %s", counts)
    return counts


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
    return q.order_by(TrackedOfficial.id.asc()).all()


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


def _new_summary() -> dict:
    return {"transitions": 0, "person_notices": 0, "tracker_notices": 0, "followers_notices": 0,
            "tracking_ended": 0, "emails_sent": 0, "emails_failed": 0, "skipped_accounts": 0,
            "already_claimed": 0, "work_left": False}


def followers_plan(db: Session, t: pl.Transition, *, official_page_id: str, name: str,
                   reelected: bool, today: date) -> NoticePlan:
    text = reelected_text(t, name) if reelected else took_office_text(t, name)
    return NoticePlan(
        page_id=t.page_id, notice="followers", kind="tracked_now_in_office",
        recipients=[(r.tracker_kind, r.tracker_id) for r in _trackers(db, t.page_id)],
        payload={**_base_payload(t, name, today), "text": text,
                 "follow": {"id": official_page_id, "name": name, "label": "Follow in office"}},
        subject=f"{name} was re-elected" if reelected else f"{name} took office",
        stamp="followers_notice_at", to_tracker=True,
    )


def notify_followers_to_follow(db: Session, t: pl.Transition, *, official_page_id: str, name: str,
                               reelected: bool, today: date) -> int:
    """One "Follow in office" notice to each follower of a winner's
    campaign page. Used by the hand-off and by the job. Commits per
    recipient (claims), so the caller commits its own changes first."""
    summary = _new_summary()
    pushes: dict = {}
    deliver_notice(db, followers_plan(db, t, official_page_id=official_page_id, name=name,
                                      reelected=reelected, today=today), summary, pushes=pushes)
    send_page_change_pushes(db, pushes)
    return summary["followers_notices"]


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


def plan_page(db: Session, t: pl.Transition, row, today: date) -> PagePlan:
    """What is due for one page today. Reads only."""
    out = PagePlan(page_id=t.page_id)
    stage = t.stage(today)
    name = t.display_name or page_display_name(t.page_id) or "This official"

    # Winners: the followers' "Follow in office" notice.
    if t.event == "won":
        target = t.linked_page_id
        due = (t.incumbent and t.clock_start and today >= t.clock_start) or \
              (not t.incumbent and t.sworn_in_on and today >= t.sworn_in_on)
        if due and target and row.followers_notice_at is None:
            out.notices.append(followers_plan(db, t, official_page_id=target, name=name,
                                              reelected=t.incumbent, today=today))
        out.end_tracking = stage == pl.ARCHIVED and row.tracking_ended_at is None
        return out

    if stage == pl.ACTIVE:
        return out

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
        out.skipped = due[:-1]
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
            out.notices.append(NoticePlan(
                page_id=t.page_id, notice=f"person_{last}", kind=notice_kind,
                recipients=[(kind, account.id)], payload=payload, subject=subject,
                stamp=f"person_{last}_notice_at",
            ))

    # One notice to each tracker, claimed or not (decision f).
    if row.trackers_notice_at is None:
        successors = successors_payload(t) if t.page_kind == "official" else []
        out.notices.append(NoticePlan(
            page_id=t.page_id, notice="trackers",
            kind="tracked_left_office" if t.page_kind == "official" else "tracked_campaign_ended",
            recipients=[(tr.tracker_kind, tr.tracker_id) for tr in _trackers(db, t.page_id)],
            payload={**_base_payload(t, name, today), "text": tracker_text(t, name, today),
                     "successors": successors},
            subject=(f"{name} is no longer in office" if t.page_kind == "official"
                     else f"{name} isn't on the November ballot" if t.event == "not_on_ballot"
                     else f"{name}'s campaign has ended"),
            stamp="trackers_notice_at", to_tracker=True,
        ))

    # Tracking ends at the archive.
    out.end_tracking = stage == pl.ARCHIVED and row.tracking_ended_at is None
    return out


def execute_page(db: Session, plan: PagePlan, row, summary: dict, *, budget: Optional[_Budget] = None,
                 pause_seconds: float = 0.0, pushes: Optional[dict] = None) -> bool:
    """Send a page's plan. Returns False when the budget ran out (the
    rest goes next pass)."""
    now = datetime.utcnow()
    for skipped in plan.skipped:
        _stamp_skipped(row, skipped)
        setattr(row, f"person_{skipped}_notice_at", now)
    if plan.skipped:
        db.commit()
    for notice in plan.notices:
        if not deliver_notice(db, notice, summary, budget=budget, pause_seconds=pause_seconds,
                              pushes=pushes):
            return False
        if notice.stamp:
            setattr(row, notice.stamp, datetime.utcnow())
            db.commit()
    if plan.end_tracking:
        summary["tracking_ended"] += end_tracking(db, plan.page_id)
        row.tracking_ended_at = datetime.utcnow()
        db.commit()
    return True


def process(db: Session, t: pl.Transition, row, today: date, summary: dict) -> None:
    """Plan and send one page (kept for callers of the old name)."""
    execute_page(db, plan_page(db, t, row, today), row, summary)


def run_page_lifecycle(db: Optional[Session] = None, today: Optional[date] = None, *,
                       pause_seconds: Optional[float] = None,
                       max_recipients: int = MAX_RECIPIENTS_PER_PASS) -> dict:
    """One pass over every transition. Returns a summary
    (work_left=True when the per-pass limit stopped it). Never raises
    when it owns the session (the loop)."""
    from app.db import SessionLocal
    from app.models.pages import PageTransition

    owns = db is None
    db = db or SessionLocal()
    today = today or pl.today_et()
    if pause_seconds is None:
        pause_seconds = BATCH_PAUSE_SECONDS if owns else 0.0
    summary = _new_summary()
    budget = _Budget(max_recipients)
    pushes: dict = {}
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
            if row.first_processed_at is None:
                row.first_processed_at = now
            db.commit()
            summary["transitions"] += 1
            if not execute_page(db, plan_page(db, t, row, today), row, summary,
                                budget=budget, pause_seconds=pause_seconds, pushes=pushes):
                break
        # One push per person for everything this run found (2026-10-17).
        sent = send_page_change_pushes(db, pushes)
        summary["page_change_pushes"] = sent["single"] + sent["grouped"]
        logger.info("page lifecycle pass (%s): %s", today.isoformat(), summary)
    except Exception:
        db.rollback()
        logger.exception("page lifecycle pass failed")
        summary["work_left"] = True
        if not owns:
            raise
    finally:
        if owns:
            db.close()
    return summary


def preview_page_lifecycle(db: Session, today: Optional[date] = None) -> dict:
    """What run_page_lifecycle would send today, without sending or
    writing anything: per notice, the page, the people it goes to
    (minus anyone already notified), how many get an email, how many
    accounts get nothing, the subject and the text."""
    from app.models.pages import PageTransition

    today = today or pl.today_et()
    pl.invalidate_cache()
    transitions = pl.all_transitions(db)
    rows = {r.page_id: r for r in db.query(PageTransition).all()}
    items = []
    totals = {"notices": 0, "recipients": 0, "bell": 0, "emails": 0, "no_email": 0,
              "accounts_skipped": 0, "tracking_ends_on_pages": 0}
    for page_id, t in transitions.items():
        row = rows.get(page_id)
        if row is None:
            row = PageTransition(page_id=page_id, origin="data")   # never added to the session
            _sync_data_row(row, t)
        plan = plan_page(db, t, row, today)
        if plan.end_tracking:
            totals["tracking_ends_on_pages"] += 1
        for notice in plan.notices:
            done = _done_recipients(db, notice)
            todo = [r for r in notice.recipients if r not in done]
            bell = emails = skipped = 0
            for rkind, rid in todo:
                acct = account_for(db, rkind, rid)
                if not account_is_open(acct):
                    skipped += 1
                    continue
                bell += 1
                if email_skip_reason(acct, notice) is None:
                    emails += 1
            items.append({
                "page_id": page_id,
                "name": notice.payload.get("official_name"),
                "notice": notice.notice,
                "kind": notice.kind,
                "recipients": len(todo),
                "already_notified": len(notice.recipients) - len(todo),
                "bell": bell,
                "emails": emails,
                "accounts_skipped": skipped,
                "subject": notice.subject,
                "text": notice.payload.get("text"),
            })
            totals["notices"] += 1
            totals["recipients"] += len(todo)
            totals["bell"] += bell
            totals["emails"] += emails
            totals["no_email"] += bell - emails
            totals["accounts_skipped"] += skipped
    return {"today": today.isoformat(), "totals": totals, "items": items,
            "per_pass_limit": MAX_RECIPIENTS_PER_PASS}


def run_pass_with_session() -> dict:
    """Loop entrypoint: own session and a cross-instance lock; never
    raises."""
    from app.services.db_locks import AdvisoryLock

    lock = AdvisoryLock(LOCK_NAME)
    try:
        if not lock.try_acquire():
            return {"skipped": "another instance holds the lock", "work_left": False}
    except Exception:
        logger.exception("page lifecycle: lock failed; skipping this pass")
        return {"work_left": True}
    try:
        return run_page_lifecycle()
    except Exception:
        logger.exception("page lifecycle pass raised")
        return {"work_left": True}
    finally:
        try:
            lock.release()
        except Exception:
            logger.debug("page lifecycle: lock release failed", exc_info=True)
