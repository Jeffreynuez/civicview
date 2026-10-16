# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Election reminders (2026-10-16).

Short, neutral reminders before voting deadlines, identical for every
voter in a state: the date, what to do, and a link to the state's own
election site. They never mention a candidate, a party, a measure or a
position.

What is sent (Jeffrey's decisions, 2026-10-16):

  registration_3d   voter registration deadline, 3 days before
  registration_1d   voter registration deadline, the day before
  mail_request_3d   mail or absentee ballot request deadline, 3 days before
  early_voting_1d   early voting starts, the day before (states with a
                    statewide early in-person voting start only)
  election_day_1d   Election Day is tomorrow, with the statewide poll
                    hours and a link to the official polling-place lookup

Where the dates come from: backend/app/data/<state>/elections.json,
for every state that has one. The format is documented in
docs/election-reminders.md. key_dates holds the dates, key_date_sources
the official page behind each one, and voter_info the links, poll
hours, deadline times and the few sentences a state's rules need. A
date without an https source is never scheduled (data lint E-11 also
refuses it), and voter_info
.no_reminder records, with its source, a reminder a state's rules rule
out (California has no mail ballot request deadline, Pennsylvania no
early voting period). Every election in those files whose date is still
ahead gets its reminders, so a future cycle needs only new dates.

Who gets them (no fixed list of states, 2026-10-16: a state is covered
when its elections.json has reminder dates with official sources, so
adding a state's dates is the whole change):
  * signed-in citizens whose account state has sourced reminder dates:
    on by default, as a bell row plus a push to any phone with push on.
    Nobody in a state without them gets one;
  * anyone tracking an election gets that election's reminders, subject
    to the tracked election's own alert settings;
  * nobody who turned election reminders off, and nobody who tapped
    "I already voted" on one of that election's reminders (the rest of
    that election only); nobody whose account is suspended, inactive
    or being deleted. Anonymous devices are not included in this
    version.
  * Email only for citizens who opted in (election_reminder_email_at),
    never to a demo account's generated address. The footer links to
    the settings where it is turned off (no List-Unsubscribe header:
    email_service.send takes no custom headers yet).

When: about SEND_HOUR (10 a.m.) in the recipient's local time, from the
tz_offset_minutes their notification settings carry, else Eastern time.
A "3 days before" reminder may still go out the next day if it was
missed (a deploy, the switch turned on late); a "tomorrow" reminder
goes out only on the day before, so its wording stays true. Election
reminders skip the push cadence limit (they are few and time-critical)
but never interrupt quiet hours: inside quiet hours the bell row is
still created and the push is not sent. Each push expires (TTL) at its
deadline.

One reminder per event per person, ever: each delivery is claimed with
a row in election_reminder_deliveries (unique per reminder and citizen)
before anything is sent, so two instances running at once, or the same
run twice, cannot double-send.

Kill switch: nothing is sent unless ELECTION_REMINDERS_ENABLED is set
(default off). The admin preview (GET /api/admin/election-reminders)
lists every scheduled reminder, its wording, source and recipient count
whether or not the switch is on.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

from sqlalchemy import false, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

ENV_FLAG = "ELECTION_REMINDERS_ENABLED"
# Local testing only: an ISO datetime the job treats as "now". Ignored in
# production, so a stray variable can never move the real schedule.
CLOCK_OVERRIDE_ENV = "ELECTION_REMINDERS_NOW"

SEND_HOUR = 10
FALLBACK_TZ = "America/New_York"
# How often the in-process loop in main.py looks for due reminders.
LOOP_INTERVAL_SECONDS = 5 * 60
NOTIFICATION_KIND = "election_reminder"

_PHASES = ("primary", "primary_runoff", "general")
_PHASE_LABEL = {
    "primary": "primary",
    "primary_runoff": "primary runoff",
    "general": "general election",
}


@dataclass(frozen=True)
class _KindSpec:
    kind: str
    date_prefix: Optional[str]  # key_dates prefix; None = the election date itself
    days_before: int
    pref_key: str               # the tracked-election alert that governs it
    link_key: str               # voter_info.links entry
    label: str                  # admin preview label
    link_label: str


KIND_SPECS = (
    _KindSpec("registration_3d", "voter_registration_deadline", 3, "on_registration_deadline",
              "registration", "Registration deadline, 3 days before", "Register or check your registration"),
    _KindSpec("registration_1d", "voter_registration_deadline", 1, "on_registration_deadline",
              "registration", "Registration deadline, the day before", "Register or check your registration"),
    _KindSpec("mail_request_3d", "vote_by_mail_request_deadline", 3, "on_mail_ballot_deadline",
              "mail_ballot", "Mail ballot request deadline, 3 days before", "Request a mail ballot"),
    _KindSpec("early_voting_1d", "early_voting_window", 1, "on_early_voting",
              "early_voting", "Early voting starts, the day before", "Find early voting locations"),
    _KindSpec("election_day_1d", None, 1, "on_election_day",
              "polling_place", "Election Day is tomorrow", "Find your polling place"),
)
_SPEC_BY_KIND = {s.kind: s for s in KIND_SPECS}

# Wording. Identical for every voter in a state; a state's voter_info
# .reminder_notes adds a sentence where its rules need one, and
# voter_info.reminder_text replaces a template where the generic
# sentence would not be true there (Florida's county early voting days).
_TEMPLATES = {
    "registration_3d": (
        "{state} voter registration deadline: {date}",
        "The deadline to register to vote in {state} for the {election} is {date}. "
        "{note}Check or update your registration on the official {state} site.",
    ),
    "registration_1d": (
        "{state} voter registration closes tomorrow",
        "Tomorrow, {date}, is the last day to register to vote in {state} for the {election}. "
        "{note}Check or update your registration on the official {state} site.",
    ),
    "mail_request_3d": (
        "{state} mail ballot request deadline: {date}",
        "The deadline to request a mail ballot in {state} for the {election} is {date}. "
        "{note}Request one on the official {state} site.",
    ),
    "early_voting_1d": (
        "{state} early voting starts tomorrow",
        "{state} early voting starts tomorrow, {start}, and runs through {end}. "
        "{note}Find your early voting location on the official {state} site.",
    ),
    "election_day_1d": (
        "{state} Election Day is tomorrow",
        "Election Day in {state} is tomorrow, {date}. "
        "{hours}Find your polling place on the official {state} site.",
    ),
}

_ISO_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


# ── Switch and clock ─────────────────────────────────────────────────

def reminders_enabled() -> bool:
    return (os.getenv(ENV_FLAG) or "").strip().lower() in ("1", "true", "yes")


def current_utc() -> datetime:
    """Naive UTC now, or the local-testing override."""
    raw = (os.getenv(CLOCK_OVERRIDE_ENV) or "").strip()
    if raw:
        from app.services.runtime_env import is_production
        if is_production():
            logger.warning("%s is ignored in production.", CLOCK_OVERRIDE_ENV)
        else:
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                if parsed.tzinfo is not None:
                    from datetime import timezone
                    parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
                return parsed
            except ValueError:
                logger.warning("%s=%r is not an ISO datetime; using the real clock.", CLOCK_OVERRIDE_ENV, raw)
    return datetime.utcnow()


def _eastern():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(FALLBACK_TZ)
    except Exception:  # pragma: no cover - zoneinfo and tzdata ship with the app
        return None


def today_et(now_utc: Optional[datetime] = None) -> date:
    now_utc = now_utc or current_utc()
    tz = _eastern()
    if tz is None:
        return (now_utc - timedelta(hours=5)).date()
    from datetime import timezone
    return now_utc.replace(tzinfo=timezone.utc).astimezone(tz).date()


# ── Formatting ───────────────────────────────────────────────────────

def _long_date(d: date) -> str:
    return f"{d.strftime('%A')}, {d.strftime('%B')} {d.day}"


def _short_date(d: date) -> str:
    return f"{d.strftime('%B')} {d.day}"


def _clock(hhmm: str) -> str:
    h, m = (int(x) for x in hhmm.split(":"))
    if h == 12 and m == 0:
        return "noon"
    suffix = "a.m." if h < 12 else "p.m."
    h12 = h % 12 or 12
    return f"{h12} {suffix}" if m == 0 else f"{h12}:{m:02d} {suffix}"


def _parse_dates(value) -> list[date]:
    out = []
    for y, m, d in _ISO_RE.findall(str(value or "")):
        try:
            out.append(date(int(y), int(m), int(d)))
        except ValueError:
            continue
    return out


def _https(url) -> bool:
    return isinstance(url, str) and url.startswith("https://")


def _retrieved(value) -> bool:
    """A key_date_retrieved / poll_hours.retrieved value: the day the
    official source was read, YYYY-MM-DD."""
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value or ""))) and bool(_parse_dates(value))


# ── Schedule ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Reminder:
    id: str
    state: str
    state_name: str
    phase: str
    election_key: str        # matches tracked elections ("2026-general")
    election_date: date
    kind: str
    pref_key: str
    date_key: str
    event_date: date         # the deadline, the first day of early voting, or Election Day
    send_on: date            # first local day it may go out
    last_send_on: date       # last local day it may go out
    deadline_local: datetime  # when it stops being useful, recipient's local clock (push TTL)
    title: str
    body: str
    link_url: str
    link_label: str
    source_url: str
    hours_source_url: Optional[str] = None

    def payload(self) -> dict:
        return {
            "reminder_id": self.id,
            "reminder_kind": self.kind,
            "state": self.state,
            "state_name": self.state_name,
            "election_key": self.election_key,
            "election_date": self.election_date.isoformat(),
            "event_date": self.event_date.isoformat(),
            "title": self.title,
            "body": self.body,
            "link_url": self.link_url,
            "link_label": self.link_label,
            "source_url": self.source_url,
        }


@dataclass
class Skipped:
    state: str
    election_key: str
    election_date: str
    kind: str
    date_key: str
    reason: str
    source_url: Optional[str] = None


@dataclass
class Schedule:
    reminders: list = field(default_factory=list)
    skipped: list = field(default_factory=list)


@lru_cache(maxsize=1)
def _load_state_docs() -> dict:
    """{state code: elections.json} for every state folder that has one.
    Which states get reminders is decided from these files alone."""
    docs = {}
    for path in sorted(DATA_DIR.glob("*/elections.json")):
        if path.parent.name.startswith("_"):
            continue
        try:
            with path.open(encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.exception("Election reminders: could not read %s", path)
            continue
        docs[str(doc.get("state") or path.parent.name).upper()] = doc
    return docs


def reload_data() -> None:
    _load_state_docs.cache_clear()


def covered_states(today: Optional[date] = None, docs: Optional[dict] = None) -> list:
    """States with at least one sourced reminder for an election still
    ahead. Decided from the data alone."""
    return sorted({r.state for r in build_schedule(today=today, docs=docs).reminders})


def _render(state_doc: dict, spec: _KindSpec, fields: dict) -> tuple[str, str]:
    override = ((state_doc.get("voter_info") or {}).get("reminder_text") or {}).get(spec.kind) or {}
    title_t, body_t = _TEMPLATES[spec.kind]
    title_t = override.get("title") or title_t
    body_t = override.get("body") or body_t
    title = title_t.format_map(fields)
    body = re.sub(r"\s+", " ", body_t.format_map(fields)).strip()
    return title, body


def build_schedule(today: Optional[date] = None, docs: Optional[dict] = None) -> Schedule:
    """Every reminder for every election still ahead (election date on or
    after `today`, Eastern), including ones whose send window has passed,
    plus the reminders that will not be sent and why."""
    today = today or today_et()
    docs = docs if docs is not None else _load_state_docs()
    out = Schedule()
    for state in sorted(docs):
        doc = docs.get(state) or {}
        key_dates = doc.get("key_dates") or {}
        sources = doc.get("key_date_sources") or {}
        retrieved = doc.get("key_date_retrieved") or {}
        info = doc.get("voter_info") or {}
        links = info.get("links") or {}
        notes = info.get("reminder_notes") or {}
        no_reminder = info.get("no_reminder") or {}
        deadline_times = info.get("deadline_times") or {}
        state_name = doc.get("state_name") or state
        cycle = str(doc.get("cycle") or "")
        official = info.get("official_site") if _https(info.get("official_site")) else None

        hours = info.get("poll_hours") or {}
        hours_ok = (_HHMM_RE.match(str(hours.get("open") or "")) and _HHMM_RE.match(str(hours.get("close") or ""))
                    and _https(hours.get("source_url")) and _retrieved(hours.get("retrieved")))

        for phase in _PHASES:
            election_dates = _parse_dates(key_dates.get(phase))
            if len(election_dates) != 1:
                continue
            election_date = election_dates[0]
            if election_date < today:
                continue
            election_key = f"{cycle}-{phase}" if cycle else phase
            election_label = f"{_short_date(election_date)} {_PHASE_LABEL[phase]}"

            for spec in KIND_SPECS:
                date_key = f"{spec.date_prefix}_{phase}" if spec.date_prefix else phase

                def skip(reason, source=None, _spec=spec, _key=date_key):
                    out.skipped.append(Skipped(state, election_key, election_date.isoformat(),
                                               _spec.kind, _key, reason, source))

                if date_key in no_reminder:
                    entry = no_reminder[date_key]
                    entry = entry if isinstance(entry, dict) else {"reason": str(entry)}
                    skip(entry.get("reason") or "Not sent in this state.", entry.get("source_url"))
                    continue
                raw = key_dates.get(date_key)
                dates = _parse_dates(raw)
                if not dates:
                    skip("No date for this in the state's election data.")
                    continue
                source = sources.get(date_key)
                if not _https(source):
                    skip("No official https source for this date, so it is not sent.")
                    continue
                if not _retrieved(retrieved.get(date_key)):
                    skip("No key_date_retrieved date for this date's source, so it is not sent.")
                    continue
                if spec.kind == "election_day_1d" and not (
                        _https(sources.get(phase)) and _retrieved(retrieved.get(phase))):
                    skip("No official https source, with its retrieved date, for the election date.")
                    continue
                link = links.get(spec.link_key) if _https(links.get(spec.link_key)) else official
                if not link:
                    skip("No official link for this reminder.")
                    continue

                start, end = dates[0], dates[-1]
                event_date = start
                send_on = event_date - timedelta(days=spec.days_before)
                last_send_on = event_date - timedelta(days=1 if spec.days_before == 1 else 2)

                if spec.kind == "early_voting_1d":
                    deadline_local = datetime.combine(event_date, time(0, 0))
                elif spec.kind == "election_day_1d":
                    close = hours.get("close") if hours_ok else None
                    deadline_local = datetime.combine(
                        event_date, time(*(int(x) for x in close.split(":"))) if close else time(23, 59))
                else:
                    t = str(deadline_times.get(date_key) or "")
                    deadline_local = datetime.combine(
                        event_date, time(*(int(x) for x in t.split(":"))) if _HHMM_RE.match(t) else time(23, 59))

                note = str(notes.get(date_key) or "").strip()
                fields = {
                    "state": state_name,
                    "date": _long_date(event_date),
                    "start": _long_date(start),
                    "end": _long_date(end),
                    "election": election_label,
                    "note": f"{note} " if note else "",
                    "hours": (f"Polls are open from {_clock(hours['open'])} to {_clock(hours['close'])} local time. "
                              if hours_ok else ""),
                }
                title, body = _render(doc, spec, fields)
                out.reminders.append(Reminder(
                    id=f"{state.lower()}-{election_date.isoformat()}-{spec.kind.replace('_', '-')}",
                    state=state, state_name=state_name, phase=phase,
                    election_key=election_key, election_date=election_date,
                    kind=spec.kind, pref_key=spec.pref_key, date_key=date_key,
                    event_date=event_date, send_on=send_on, last_send_on=last_send_on,
                    deadline_local=deadline_local, title=title, body=body,
                    link_url=link, link_label=spec.link_label, source_url=source,
                    hours_source_url=hours.get("source_url") if (hours_ok and spec.kind == "election_day_1d") else None,
                ))
    out.reminders.sort(key=lambda r: (r.send_on, r.state, r.kind))
    return out


# ── Recipients ───────────────────────────────────────────────────────

_ELECTION_PREF_KEYS = ("on_election_day", "on_registration_deadline", "on_early_voting", "on_mail_ballot_deadline")


def _loads(raw) -> dict:
    if not raw:
        return {}
    try:
        val = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    return val if isinstance(val, dict) else {}


def _tracking(db: Session, reminder: Reminder) -> dict:
    """citizen_id -> that citizen's alert prefs for the tracked election
    matching this reminder. Tracked election keys are "2026-general"
    style ids (or an older "state|office|date" composite), and the
    snapshot names the state."""
    from app.models.pages import TrackedElection

    iso = reminder.election_date.isoformat()
    rows = (
        db.query(TrackedElection.tracker_id, TrackedElection.election_key,
                 TrackedElection.snapshot_json, TrackedElection.prefs_json)
        .filter(
            TrackedElection.tracker_kind == "citizen",
            or_(func.lower(TrackedElection.election_key) == reminder.election_key.lower(),
                TrackedElection.election_key.contains(iso)),
        )
        .all()
    )
    out = {}
    for tracker_id, key, snap_raw, prefs_raw in rows:
        snap = _loads(snap_raw)
        snap_state = str(snap.get("state") or "").upper()
        if not snap_state and "|" in (key or ""):
            snap_state = key.split("|", 1)[0].upper()
        if snap_state != reminder.state:
            continue
        key_l = (key or "").lower()
        if key_l != reminder.election_key.lower() and str(snap.get("date") or "") != iso and iso not in key_l:
            continue
        prefs = _loads(prefs_raw)
        out[tracker_id] = {k: prefs.get(k, True) for k in _ELECTION_PREF_KEYS}
    return out


@dataclass
class Recipient:
    citizen_id: int
    prefs_json: Optional[str]
    tracking: bool
    email: Optional[str] = None  # set only when they opted in to reminder emails


def _stopped(db: Session, reminder: Reminder) -> set:
    """Citizens who said "I already voted" in this election."""
    from app.models.pages import ElectionReminderStop
    return {cid for (cid,) in db.query(ElectionReminderStop.citizen_id).filter(
        ElectionReminderStop.state == reminder.state,
        ElectionReminderStop.election_key == reminder.election_key,
    )}


def eligible_recipients(db: Session, reminder: Reminder) -> list[Recipient]:
    """Everyone this reminder is for, before time of day and before the
    one-per-person check."""
    from app.models.pages import CitizenAccount

    tracking = _tracking(db, reminder)
    stopped = _stopped(db, reminder)
    in_state = or_(func.upper(CitizenAccount.state) == reminder.state,
                   CitizenAccount.id.in_(list(tracking)) if tracking else false())
    rows = (
        db.query(CitizenAccount.id, CitizenAccount.email, CitizenAccount.notification_prefs_json,
                 CitizenAccount.election_reminder_email_at)
        .filter(
            in_state,
            CitizenAccount.is_active.is_(True),
            CitizenAccount.suspended_at.is_(None),
            CitizenAccount.self_deleted_at.is_(None),
            CitizenAccount.election_reminders_off_at.is_(None),
        )
        .all()
    )
    from app.services.digest_service import is_demo_email

    out = []
    for cid, email, prefs_json, email_at in rows:
        if cid in stopped:
            continue  # "I already voted" in this election
        prefs = tracking.get(cid)
        if prefs is not None and prefs.get(reminder.pref_key) is False:
            continue  # tracked election with this alert turned off
        wants_email = email_at is not None and email and not is_demo_email(email)
        out.append(Recipient(cid, prefs_json, prefs is not None, email if wants_email else None))
    return out


# ── Local time ───────────────────────────────────────────────────────

def _tz_offset(prefs_json: Optional[str]) -> Optional[int]:
    tz = _loads(prefs_json).get("tz_offset_minutes")
    if isinstance(tz, int) and not isinstance(tz, bool) and abs(tz) <= 14 * 60:
        return tz
    return None


def local_now(prefs_json: Optional[str], now_utc: datetime) -> datetime:
    """The recipient's wall clock: their synced tz offset, else Eastern."""
    tz = _tz_offset(prefs_json)
    if tz is not None:
        return now_utc + timedelta(minutes=tz)
    eastern = _eastern()
    if eastern is None:
        return now_utc - timedelta(hours=5)
    from datetime import timezone
    return now_utc.replace(tzinfo=timezone.utc).astimezone(eastern).replace(tzinfo=None)


def local_to_utc(prefs_json: Optional[str], local: datetime) -> datetime:
    tz = _tz_offset(prefs_json)
    if tz is not None:
        return local - timedelta(minutes=tz)
    eastern = _eastern()
    if eastern is None:
        return local + timedelta(hours=5)
    from datetime import timezone
    return local.replace(tzinfo=eastern).astimezone(timezone.utc).replace(tzinfo=None)


def is_due(reminder: Reminder, local: datetime) -> bool:
    return (reminder.send_on <= local.date() <= reminder.last_send_on
            and local.hour >= SEND_HOUR)


# ── Email ────────────────────────────────────────────────────────────

APP_URL = "https://civicview.app"
SETTINGS_URL = f"{APP_URL}/?open=settings"


def render_email(reminder: Reminder) -> tuple[str, str, str]:
    """(subject, html, text). The same words as the bell row and the
    push, the official link and the date's source, and a footer that
    says why it came and where to turn it off."""
    import html as _html

    esc = _html.escape
    footer = ("You get this email because you turned on election reminder emails in CivicView. "
              "To stop them, turn off \"Also email me election reminders\" in your settings:")
    text = (f"{reminder.body}\n\n{reminder.link_label}: {reminder.link_url}\n"
            f"Source for this date: {reminder.source_url}\n\n"
            "CivicView is not a government site. The link above goes to the state's official election site.\n\n"
            f"{footer} {SETTINGS_URL}\n")
    html_body = (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1b2430;'
        'max-width:560px">'
        f'<h1 style="font-size:19px;margin:0 0 10px">{esc(reminder.title)}</h1>'
        f'<p style="margin:0 0 14px">{esc(reminder.body)}</p>'
        f'<p style="margin:0 0 14px"><a href="{esc(reminder.link_url)}" style="color:#1d6b3a;font-weight:bold">'
        f'{esc(reminder.link_label)}</a> ({esc(reminder.link_url)})</p>'
        f'<p style="margin:0 0 14px;font-size:13px;color:#5b6573">Source for this date: '
        f'<a href="{esc(reminder.source_url)}" style="color:#5b6573">{esc(reminder.source_url)}</a></p>'
        '<p style="margin:0 0 14px;font-size:13px;color:#5b6573">CivicView is not a government site. '
        "The link above goes to the state's official election site.</p>"
        '<hr style="border:none;border-top:1px solid #dde2e8;margin:18px 0">'
        f'<p style="margin:0;font-size:12px;color:#5b6573">{esc(footer)} '
        f'<a href="{SETTINGS_URL}" style="color:#5b6573">{SETTINGS_URL}</a></p>'
        "</div>"
    )
    return reminder.title, html_body, text


# ── Delivery ─────────────────────────────────────────────────────────

def _claim(db: Session, reminder_id: str, citizen_id: int) -> Optional[int]:
    """Insert the delivery row; None when it already exists (sent, or
    claimed by another process a moment ago)."""
    from app.models.pages import ElectionReminderDelivery

    row = ElectionReminderDelivery(reminder_id=reminder_id, citizen_id=citizen_id)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return row.id


def _release(db: Session, claim_id: int) -> None:
    from app.models.pages import ElectionReminderDelivery
    try:
        db.query(ElectionReminderDelivery).filter(ElectionReminderDelivery.id == claim_id).delete(
            synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Election reminders: could not release claim %s", claim_id)


def _delivered_ids(db: Session, reminder_id: str) -> set:
    from app.models.pages import ElectionReminderDelivery
    return {cid for (cid,) in db.query(ElectionReminderDelivery.citizen_id)
            .filter(ElectionReminderDelivery.reminder_id == reminder_id)}


def deliver(db: Session, reminder: Reminder, recipients: Iterable[Recipient], now_utc: datetime) -> dict:
    """Claim, then bell row, then push, for each recipient. Returns counts."""
    from app.models.pages import ElectionReminderDelivery, Notification
    from app.services.push_service import push_election_reminder

    counts = {"claimed": 0, "already": 0, "notified": 0, "pushed_devices": 0, "emailed": 0}
    emails = []
    payload = json.dumps(reminder.payload(), ensure_ascii=False)
    pushes = []
    for rcp in recipients:
        claim_id = _claim(db, reminder.id, rcp.citizen_id)
        if claim_id is None:
            counts["already"] += 1
            continue
        counts["claimed"] += 1
        try:
            n = Notification(recipient_kind="citizen", recipient_id=rcp.citizen_id,
                             kind=NOTIFICATION_KIND, payload_json=payload)
            db.add(n)
            db.flush()
            db.query(ElectionReminderDelivery).filter(ElectionReminderDelivery.id == claim_id).update(
                {ElectionReminderDelivery.notification_id: n.id}, synchronize_session=False)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Election reminder %s: bell row failed for citizen %s", reminder.id, rcp.citizen_id)
            _release(db, claim_id)  # nothing went out, so they stay due
            continue
        counts["notified"] += 1
        if rcp.email:
            emails.append((rcp.email, claim_id))
        deadline_utc = local_to_utc(rcp.prefs_json, reminder.deadline_local)
        pushes.append((rcp.citizen_id, claim_id, int((deadline_utc - now_utc).total_seconds())))

    if pushes:
        sent = push_election_reminder(
            db, [(cid, ttl) for cid, _claim_id, ttl in pushes],
            title=reminder.title, body=reminder.body,
            data={"kind": NOTIFICATION_KIND, "reminder_id": reminder.id, "state": reminder.state},
            now_utc=now_utc,
        )
        for cid, claim_id, _ttl in pushes:
            n_dev = sent.get(cid, 0)
            counts["pushed_devices"] += n_dev
            if n_dev:
                db.query(ElectionReminderDelivery).filter(ElectionReminderDelivery.id == claim_id).update(
                    {ElectionReminderDelivery.push_devices: n_dev}, synchronize_session=False)
        db.commit()

    if emails:
        from app.services.email_service import get_email_service

        svc = get_email_service()
        subject, html_body, text_body = render_email(reminder)
        for address, claim_id in emails:
            # send() never raises; a failure is logged there and the
            # reminder is not retried (the bell row is already there).
            if svc.send(to=address, subject=subject, text_body=text_body, html_body=html_body):
                counts["emailed"] += 1
                db.query(ElectionReminderDelivery).filter(ElectionReminderDelivery.id == claim_id).update(
                    {ElectionReminderDelivery.email_sent_at: datetime.utcnow()}, synchronize_session=False)
        db.commit()
    return counts


def run_due(db: Session, now_utc: Optional[datetime] = None) -> dict:
    """Send every reminder that is due now. Does nothing unless
    ELECTION_REMINDERS_ENABLED is set. Safe to run as often as you like
    and from two processes at once."""
    if not reminders_enabled():
        return {"enabled": False}
    now_utc = now_utc or current_utc()
    # Every US local date is within a day of UTC's.
    utc_day = now_utc.date()
    schedule = build_schedule(today=today_et(now_utc) - timedelta(days=1))
    summary = {"enabled": True, "now_utc": now_utc.isoformat(), "reminders": {}}
    for reminder in schedule.reminders:
        if not (reminder.send_on - timedelta(days=1) <= utc_day <= reminder.last_send_on + timedelta(days=1)):
            continue
        done = _delivered_ids(db, reminder.id)
        due = [r for r in eligible_recipients(db, reminder)
               if r.citizen_id not in done and is_due(reminder, local_now(r.prefs_json, now_utc))]
        if not due:
            continue
        counts = deliver(db, reminder, due, now_utc)
        summary["reminders"][reminder.id] = counts
        logger.info("Election reminder %s: %s", reminder.id, counts)
    return summary


def run_due_with_session() -> dict:
    """Loop entrypoint: own session, never raises."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        return run_due(db)
    except Exception:
        db.rollback()
        logger.exception("Election reminders run failed; it runs again at the next interval.")
        return {"error": True}
    finally:
        db.close()


# ── Admin preview ────────────────────────────────────────────────────

def preview(db: Session, now_utc: Optional[datetime] = None) -> dict:
    """Every reminder for the elections ahead with its wording, source,
    send window, status and recipient count, plus what will not be sent
    and why. Read-only; works whether or not the switch is on."""
    from app.models.pages import ElectionReminderDelivery

    now_utc = now_utc or current_utc()
    today = today_et(now_utc)
    schedule = build_schedule(today=today)
    delivered = dict(
        db.query(ElectionReminderDelivery.reminder_id, func.count(ElectionReminderDelivery.id))
        .group_by(ElectionReminderDelivery.reminder_id)
        .all()
    )
    items = []
    for r in schedule.reminders:
        if r.last_send_on < today:
            status = "passed"
        elif r.send_on <= today:
            status = "sending"
        else:
            status = "scheduled"
        row = asdict(r)
        for k, v in list(row.items()):
            if isinstance(v, (date, datetime)):
                row[k] = v.isoformat()
        row.update({
            "kind_label": _SPEC_BY_KIND[r.kind].label,
            "status": status,
            "recipient_count": None if status == "passed" else len(eligible_recipients(db, r)),
            "delivered_count": int(delivered.get(r.id, 0)),
        })
        items.append(row)
    return {
        "enabled": reminders_enabled(),
        "now_utc": now_utc.isoformat(),
        "today_et": today.isoformat(),
        "send_hour_local": SEND_HOUR,
        "fallback_timezone": FALLBACK_TZ,
        "states": sorted({r.state for r in schedule.reminders}),
        "reminders": items,
        "skipped": [asdict(s) for s in schedule.skipped],
    }


# ── Citizen settings ─────────────────────────────────────────────────

def citizen_settings(citizen) -> dict:
    from app.services.digest_service import is_demo_email

    state = (citizen.state or "").upper()
    covered = covered_states()
    return {
        "enabled": citizen.election_reminders_off_at is None,
        "covered_states": covered,
        "your_state_covered": state in covered,
        "email": citizen.election_reminder_email_at is not None,
        # A demo account's sign-in address receives no mail.
        "email_available": bool(citizen.email) and not is_demo_email(citizen.email),
    }


def find_reminder(reminder_id: str, now_utc: Optional[datetime] = None) -> Optional[Reminder]:
    """A reminder of an election still ahead (or held today), by id."""
    now_utc = now_utc or current_utc()
    for r in build_schedule(today=today_et(now_utc) - timedelta(days=1)).reminders:
        if r.id == reminder_id:
            return r
    return None


def set_voted(db: Session, citizen_id: int, reminder: Reminder, voted: bool) -> None:
    """"I already voted" (voted=True) stops the rest of this election's
    reminders for this citizen; voted=False undoes it."""
    from app.models.pages import ElectionReminderStop

    q = db.query(ElectionReminderStop).filter(
        ElectionReminderStop.citizen_id == citizen_id,
        ElectionReminderStop.state == reminder.state,
        ElectionReminderStop.election_key == reminder.election_key,
    )
    if voted:
        if q.first() is None:
            db.add(ElectionReminderStop(citizen_id=citizen_id, state=reminder.state,
                                        election_key=reminder.election_key))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()  # a double tap: the row is already there
    else:
        q.delete(synchronize_session=False)
        db.commit()
