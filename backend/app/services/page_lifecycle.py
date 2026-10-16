# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Former officials and candidates: one rule for every page (2026-10-15).

Jeffrey: former officials "are considered just citizens if they are
not in office, so it would seem like they have special privileges just
because they served." His decisions, built here:

  1. Leaving office. The page becomes "Former" the day the person
     leaves office ("Former State Senator, Ohio District 1 (2019 to
     2027)"). Every official privilege ends that day (polls, liking or
     disliking as the official, acting as the official anywhere),
     except a 30-day farewell window in which they can still publish
     posts. After 30 days the page is read-only. Citizens keep
     commenting, liking and voting on what is there until the archive.
  2. Archive 6 months after leaving office: frozen, removed from
     search, the map, feeds, suggestions and tracked lists, still
     readable by direct link with an "Archived" banner. Reports still
     work. Nothing is deleted.
  5. Candidates who lose or withdraw: the same steps on a shorter
     clock (30-day farewell, archive 3 months after certification or
     withdrawal), "Former candidate for Governor of Florida (2026)".
  6. Winners: "<Office>-elect" from certification until sworn in, then
     the official page through an admin-approved hand-off; the campaign
     page is archived with a link from the official page.
     Re-elected incumbents get no -elect label and no hand-off; their
     campaign page is archived 3 months after certification. An
     incumbent who loses turns Former on the day the term ends.
  7. Unclaimed pages get the same labels and timing, from the data.

The stage is worked out from dates on every read, so moving a date
moves the page, and nothing has to run for a page to change. The daily
job (services/page_lifecycle_job.py) only does what dates cannot: send
the notices and end tracking at the archive.

Where a page's dates come from, in order:
  * an admin entry (page_transitions, origin 'admin'), set by hand with
    a source in the admin Transitions tab;
  * the data files: state and federal _former_members, curated
    departures in congress_profiles.json, withdrawn and eliminated
    candidates.

Dates: event_on is the day it happened, from an official source only.
When none is known, the clock runs from recorded_on, the day our data
recorded the change, and every label says "recorded on", never that it
happened that day (Jeffrey: a "recorded on" date "must never read as
the day they left").
"""
from __future__ import annotations

import calendar
import json
import logging
import re
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

FAREWELL_DAYS = 30
PRE_ARCHIVE_NOTICE_DAYS = 30
OFFICIAL_ARCHIVE_MONTHS = 6
CANDIDATE_ARCHIVE_MONTHS = 3

# Stages, in order.
ACTIVE = "active"          # in office, or running
ELECT = "elect"            # won, not sworn in yet
FAREWELL = "farewell"      # left, day 0 to day 30: posts only
READ_ONLY = "read_only"    # left, day 30 to the archive
ARCHIVED = "archived"      # frozen, off discovery, readable by link
FORMER_STAGES = (FAREWELL, READ_ONLY, ARCHIVED)

EVENTS = ("left_office", "lost_primary", "lost_general", "withdrew", "not_on_ballot", "won")
# not_on_ballot: the person is not on the state's certified general
# election list and no official source gives a reason (lost, withdrew,
# disqualified). It reads neutrally everywhere; it never claims a loss.
CANDIDATE_ENDINGS = ("lost_primary", "lost_general", "withdrew", "not_on_ballot")

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
    "PR": "Puerto Rico", "GU": "Guam", "VI": "U.S. Virgin Islands",
    "AS": "American Samoa", "MP": "Northern Mariana Islands",
}
_NAME_TO_CODE = {v.lower(): k for k, v in STATE_NAMES.items()}


# ── dates ────────────────────────────────────────────────────────────

def today_et() -> date:
    """The calendar day in Eastern time, which every clock here uses."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # pragma: no cover - zoneinfo is in the stdlib
        return datetime.utcnow().date()


def add_months(day: date, months: int) -> date:
    """Same day of the month, `months` later (the last day when the
    month is shorter: Aug 31 + 6 months is Feb 28)."""
    month0 = day.month - 1 + months
    year = day.year + month0 // 12
    month = month0 % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def parse_date(value) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def long_date(day: Optional[date]) -> str:
    """'October 14, 2026'. No leading zero."""
    if not day:
        return ""
    return f"{calendar.month_name[day.month]} {day.day}, {day.year}"


def ballot_phrase(t) -> str:
    """ "the 2026 general election ballot", the same words for everyone."""
    year = getattr(t, "election_year", None)
    return f"the {year} general election ballot" if year else "the general election ballot"


# ── titles ───────────────────────────────────────────────────────────

def _district_place(state_name: str, district: object) -> str:
    d = str(district or "").strip()
    if not d:
        return state_name
    if re.fullmatch(r"\d+[A-Za-z]?(-\d+)?", d):
        return f"{state_name} District {d}"
    return f"{state_name}, {d}"


def official_office_label(record: dict, state_code: Optional[str]) -> str:
    """The office a person held, naming the state: "State Senator,
    Florida District 39", "Governor of Florida", "U.S. Attorney
    General". Built from the record's own role, chamber and district."""
    role = (record.get("role") or "").strip()
    state_name = STATE_NAMES.get((state_code or "").upper(), "")
    district = record.get("district")
    chamber = (record.get("chamber") or "").lower()
    if not state_name:  # federal executive
        if not role:
            return "Federal official"
        if "united states" in role.lower() or role.lower().startswith("u.s."):
            return role
        return f"U.S. {role}"
    if district not in (None, "") or "senate" in chamber or "house" in chamber or "assembly" in chamber:
        return f"{role or 'Legislator'}, {_district_place(state_name, district)}"
    return f"{role} of {state_name}" if role else state_name


_SEEKING_HOUSE = re.compile(r"^U\.S\. House,\s*([A-Z]{2})-(\d+|AL)$")


def candidate_office_label(seeking_office: Optional[str]) -> str:
    """seeking_office with the state named and "Dist." spelled out:
    "U.S. House, FL-7" -> "U.S. House, Florida District 7"."""
    text = (seeking_office or "").strip()
    m = _SEEKING_HOUSE.match(text)
    if m:
        state_name = STATE_NAMES.get(m.group(1), m.group(1))
        seat = "at-large seat" if m.group(2) == "AL" else f"District {int(m.group(2))}"
        return f"U.S. House, {state_name} {seat}"
    text = re.sub(r"^FL House Dist\.\s*", "Florida House of Representatives, District ", text)
    text = re.sub(r"\bDist\.\s*", "District ", text)
    return text


def elect_title(office_label: str) -> str:
    """"Governor of Florida" -> "Governor-elect of Florida";
    "U.S. House, Florida District 7" -> "U.S. Representative-elect,
    Florida District 7"; "Texas State Senate, District 22" -> "State
    Senator-elect, Texas District 22"."""
    label = (office_label or "").strip()
    m = re.match(r"^(.*?) of (.+)$", label)
    if m and "," not in m.group(1):
        return f"{m.group(1)}-elect of {m.group(2)}"
    m = re.match(r"^U\.S\. House, (.+)$", label)
    if m:
        return f"U.S. Representative-elect, {m.group(1)}"
    m = re.match(r"^U\.S\. Senate, (.+)$", label)
    if m:
        return f"U.S. Senator-elect, {m.group(1)}"
    m = re.match(r"^(.+?) (State Senate|State House|House of Representatives|State Assembly), District (.+)$", label)
    if m:
        office = {"State Senate": "State Senator", "State House": "State Representative",
                  "House of Representatives": "State Representative",
                  "State Assembly": "Assembly Member"}[m.group(2)]
        return f"{office}-elect, {m.group(1)} District {m.group(3)}"
    return f"{label}, elect" if label else "Elected"


def years_suffix(served_from: Optional[str], served_to: Optional[str]) -> str:
    if served_from and served_to:
        return f" ({served_from} to {served_to})"
    if served_from:
        return f" (from {served_from})"
    if served_to:
        return f" (until {served_to})"
    return ""


# ── the transition record ────────────────────────────────────────────

@dataclass
class Transition:
    page_id: str
    page_kind: str                 # 'official' | 'candidate'
    event: str                     # one of EVENTS
    event_on: Optional[date] = None
    recorded_on: Optional[date] = None
    incumbent: bool = False
    sworn_in_on: Optional[date] = None
    handoff_on: Optional[date] = None
    office_label: str = ""
    served_from: Optional[str] = None
    served_to: Optional[str] = None
    election_year: Optional[str] = None
    successor_ids: list = field(default_factory=list)
    linked_page_id: Optional[str] = None
    display_name: Optional[str] = None
    state: Optional[str] = None
    source_url: Optional[str] = None
    source_note: Optional[str] = None
    origin: str = "data"
    set_by: Optional[str] = None
    set_at: Optional[datetime] = None
    # Where the data record lives, for the admin view.
    data_ref: Optional[str] = None

    # ── clock ──
    @property
    def clock_start(self) -> Optional[date]:
        return self.event_on or self.recorded_on

    @property
    def date_is_recorded(self) -> bool:
        """True when the clock runs from the day our data recorded the
        change, not from an official date of the event itself."""
        return self.event_on is None and self.recorded_on is not None

    @property
    def farewell_ends_on(self) -> Optional[date]:
        if self.event == "won" or not self.clock_start:
            return None
        return self.clock_start + timedelta(days=FAREWELL_DAYS)

    @property
    def archive_on(self) -> Optional[date]:
        start = self.clock_start
        if self.event == "left_office":
            return add_months(start, OFFICIAL_ARCHIVE_MONTHS) if start else None
        if self.event in CANDIDATE_ENDINGS:
            return add_months(start, CANDIDATE_ARCHIVE_MONTHS) if start else None
        if self.event == "won":
            if not start:
                return None
            if self.incumbent:
                return add_months(start, CANDIDATE_ARCHIVE_MONTHS)
            if self.handoff_on:
                return self.handoff_on
            later = add_months(start, CANDIDATE_ARCHIVE_MONTHS)
            return max(later, self.sworn_in_on) if self.sworn_in_on else later
        return None

    @property
    def pre_archive_notice_on(self) -> Optional[date]:
        a = self.archive_on
        return a - timedelta(days=PRE_ARCHIVE_NOTICE_DAYS) if a else None

    def stage(self, today: Optional[date] = None) -> str:
        today = today or today_et()
        start = self.clock_start
        archive = self.archive_on
        if self.event == "won":
            if archive and today >= archive:
                return ARCHIVED
            if self.incumbent:
                return ACTIVE
            if start and today >= start and not (self.sworn_in_on and today >= self.sworn_in_on):
                return ELECT
            if self.sworn_in_on and today >= self.sworn_in_on:
                # Sworn in, hand-off not approved yet: the campaign page
                # takes no more posts as a campaign.
                return READ_ONLY
            return ACTIVE
        if start is None:
            # Known to have left, with no date at all (a departure the
            # Congress.gov API reports before anyone records a date).
            return READ_ONLY
        if today < start:
            return ACTIVE
        if self.farewell_ends_on and today < self.farewell_ends_on:
            return FAREWELL
        if archive and today < archive:
            return READ_ONLY
        return ARCHIVED

    # ── labels ──
    def title(self, today: Optional[date] = None) -> Optional[str]:
        """The line under the person's name, or None while nothing has
        changed. Identical wording for every party."""
        st = self.stage(today)
        if self.event == "won":
            if self.incumbent:
                return None
            if st == ELECT:
                return elect_title(self.office_label)
            if st in (READ_ONLY, ARCHIVED):
                year = f" ({self.election_year})" if self.election_year else ""
                return f"Elected {self.office_label}{year}"
            return None
        if st == ACTIVE:
            return None
        if self.page_kind == "candidate":
            year = f" ({self.election_year})" if self.election_year else ""
            return f"Former candidate for {self.office_label}{year}"
        return f"Former {self.office_label}{years_suffix(self.served_from, self.served_to)}"

    def date_line(self) -> Optional[str]:
        """How the date reads in banners and notices. A recorded-on date
        says so and never claims to be the day it happened."""
        if self.event_on:
            verb = {
                "left_office": "Left office on",
                "lost_primary": "Primary result certified on",
                "lost_general": "General election result certified on",
                "withdrew": "Withdrew on",
                "won": "Result certified on",
            }.get(self.event, "On")
            return f"{verb} {long_date(self.event_on)}"
        if self.recorded_on:
            if self.event == "not_on_ballot":
                return (f"CivicView recorded on {long_date(self.recorded_on)} that this candidate "
                        f"isn't on {ballot_phrase(self)}")
            what = "a departure from office" if self.event == "left_office" else "the end of this campaign"
            return f"CivicView recorded {what} on {long_date(self.recorded_on)}"
        return None

    def as_dict(self, today: Optional[date] = None) -> dict:
        """The public lifecycle block on page payloads."""
        today = today or today_et()
        st = self.stage(today)
        return {
            "page_id": self.page_id,
            "page_kind": self.page_kind,
            "event": self.event,
            "stage": st,
            "former": st in FORMER_STAGES and self.event != "won",
            "archived": st == ARCHIVED,
            "title": self.title(today),
            "date_line": self.date_line(),
            "event_on": self.event_on.isoformat() if self.event_on else None,
            "recorded_on": self.recorded_on.isoformat() if self.recorded_on else None,
            "date_is_recorded": self.date_is_recorded,
            "farewell_ends_on": self.farewell_ends_on.isoformat() if self.farewell_ends_on else None,
            "archive_on": self.archive_on.isoformat() if self.archive_on else None,
            "sworn_in_on": self.sworn_in_on.isoformat() if self.sworn_in_on else None,
            "incumbent": self.incumbent,
            "office_label": self.office_label,
            "served_from": self.served_from,
            "served_to": self.served_to,
            "election_year": self.election_year,
            "successor_ids": list(self.successor_ids or []),
            "linked_page_id": self.linked_page_id,
            "source_url": self.source_url,
            "can_post": st in (ACTIVE, ELECT, FAREWELL),
            "can_poll": st in (ACTIVE, ELECT),
            "can_act_as_owner": st in (ACTIVE, ELECT),
            "accepts_engagement": st != ARCHIVED,
            "accepts_tracking": st in (ACTIVE, ELECT),
        }


# ── the data registry ────────────────────────────────────────────────

def _load(path: Path):
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("page_lifecycle: could not read %s: %s", path, e)
        return None


def _former_from_officials(doc: dict, state_code: Optional[str], ref: str) -> Iterable[Transition]:
    for rec in doc.get("_former_members") or []:
        if not isinstance(rec, dict) or not rec.get("id"):
            continue
        event_on = parse_date(rec.get("left_office_on"))
        yield Transition(
            page_id=rec["id"],
            page_kind="official",
            event="left_office",
            event_on=event_on,
            recorded_on=parse_date(rec.get("recorded_on")),
            office_label=official_office_label(rec, state_code),
            served_from=rec.get("served_from"),
            served_to=rec.get("served_to"),
            successor_ids=list(rec.get("successor_ids") or []),
            display_name=rec.get("name"),
            state=(state_code or "").upper() or None,
            source_url=rec.get("left_office_source") if event_on else None,
            source_note=rec.get("reason"),
            data_ref=ref,
        )


def _election_years() -> dict:
    """{state code: year of its next general election} from the
    elections files' key dates."""
    years = {}
    for path in DATA_DIR.glob("*/elections.json"):
        doc = _load(path) or {}
        general = str(((doc.get("key_dates") or {}).get("general")) or "")
        if general[:4].isdigit():
            years[(doc.get("state") or path.parent.name).upper()] = general[:4]
    return years


def _candidate_transitions() -> Iterable[Transition]:
    years = _election_years()
    for path in sorted(DATA_DIR.glob("*/candidates.json")):
        state = path.parent.name.upper()
        if state.startswith("_"):
            continue
        doc = _load(path) or {}
        for cid, c in (doc.get("candidates") or {}).items():
            if not isinstance(c, dict) or c.get("duplicate_of"):
                continue
            if not (c.get("withdrawn") or c.get("eliminated")):
                continue
            if c.get("withdrawn"):
                event = "withdrew"
            elif c.get("ended_reason") == "not_on_ballot":
                event = "not_on_ballot"
            else:
                event = "lost_primary"
            event_on = parse_date(c.get("ended_on"))
            yield Transition(
                page_id=cid,
                page_kind="candidate",
                event=event,
                event_on=event_on,
                recorded_on=parse_date(c.get("ended_recorded_on")),
                incumbent=bool(c.get("incumbent")),
                office_label=candidate_office_label(c.get("seeking_office")),
                election_year=years.get(state),
                display_name=c.get("name"),
                state=state,
                source_url=(c.get("ended_on_source") if event_on else
                            (c.get("withdrawn_source") or c.get("eliminated_source"))),
                source_note=c.get("withdrawn_note") or c.get("eliminated_note"),
                data_ref=str(path.relative_to(DATA_DIR)),
            )


def _congress_transitions() -> Iterable[Transition]:
    doc = _load(DATA_DIR / "federal" / "congress_profiles.json") or {}
    for bioguide, prof in doc.items():
        if not isinstance(prof, dict) or not prof.get("former_member"):
            continue
        event_on = parse_date(prof.get("left_office_on"))
        yield Transition(
            page_id=bioguide,
            page_kind="official",
            event="left_office",
            event_on=event_on,
            office_label=prof.get("former_office_label") or "Member of Congress",
            served_from=prof.get("served_from"),
            served_to=prof.get("served_to"),
            state=prof.get("state"),
            display_name=prof.get("former_name"),
            source_url=prof.get("left_office_source") if event_on else None,
            data_ref="federal/congress_profiles.json",
        )


class _Registry:
    """Every transition the data files describe, by page id. Built once
    per process (the files only change with a deploy)."""

    def __init__(self):
        self._by_id: Optional[dict] = None
        self._by_lower: dict = {}
        self._lock = threading.Lock()

    def build(self) -> dict:
        out: dict = {}
        for path in sorted(DATA_DIR.glob("*/state_officials.json")):
            doc = _load(path) or {}
            state = (doc.get("state") or path.parent.name).upper()
            for t in _former_from_officials(doc, state, str(path.relative_to(DATA_DIR))):
                out[t.page_id] = t
        fed = _load(DATA_DIR / "federal" / "federal_officials.json") or {}
        for t in _former_from_officials(fed, None, "federal/federal_officials.json"):
            out[t.page_id] = t
        for t in _congress_transitions():
            out.setdefault(t.page_id, t)
        for t in _candidate_transitions():
            out.setdefault(t.page_id, t)
        return out

    def all(self) -> dict:
        if self._by_id is None:
            with self._lock:
                if self._by_id is None:
                    built = self.build()
                    self._by_lower = {k.lower(): v for k, v in built.items()}
                    self._by_id = built
                    logger.info("page_lifecycle: %d data transitions", len(self._by_id))
        return self._by_id

    def get(self, page_id: str) -> Optional[Transition]:
        """Exact id first, then ignoring case: tracked keys and push
        keys are stored lowercased, page ids keep their case."""
        by_id = self.all()
        return by_id.get(page_id) or self._by_lower.get(page_id.lower())

    def reset(self) -> None:
        with self._lock:
            self._by_id = None
            self._by_lower = {}


registry = _Registry()


# ── database rows ────────────────────────────────────────────────────

def _from_row(row) -> Transition:
    try:
        successors = json.loads(row.successor_ids_json) if row.successor_ids_json else []
    except (ValueError, TypeError):
        successors = []
    return Transition(
        page_id=row.page_id,
        page_kind=row.page_kind,
        event=row.event,
        event_on=row.event_on,
        recorded_on=row.recorded_on,
        incumbent=bool(row.incumbent),
        sworn_in_on=row.sworn_in_on,
        handoff_on=row.handoff_on,
        office_label=row.office_label or "",
        served_from=row.served_from,
        served_to=row.served_to,
        election_year=row.election_year,
        successor_ids=successors if isinstance(successors, list) else [],
        linked_page_id=row.linked_page_id,
        display_name=row.display_name,
        state=row.state,
        source_url=row.source_url,
        source_note=row.source_note,
        origin=row.origin or "data",
        set_by=row.set_by,
        set_at=row.set_at,
    )


_ADMIN_CACHE: dict = {"at": 0.0, "rows": None}
_ADMIN_TTL_SECONDS = 30


def invalidate_cache() -> None:
    _ADMIN_CACHE["at"] = 0.0
    _ADMIN_CACHE["rows"] = None


def _admin_rows(db) -> dict:
    """Admin-set transitions (and hand-off links), by page id. Cached
    for 30 seconds; every admin write calls invalidate_cache()."""
    now = time.monotonic()
    if _ADMIN_CACHE["rows"] is not None and now - _ADMIN_CACHE["at"] < _ADMIN_TTL_SECONDS:
        return _ADMIN_CACHE["rows"]
    from app.models.pages import PageTransition
    rows = {}
    try:
        for row in db.query(PageTransition).filter(PageTransition.origin == "admin").all():
            rows[row.page_id] = _from_row(row)
    except Exception:
        logger.exception("page_lifecycle: could not read admin transitions")
        return {}
    _ADMIN_CACHE["rows"] = rows
    _ADMIN_CACHE["at"] = now
    return rows


def all_transitions(db) -> dict:
    """Every transition, data and admin, by page id. Admin wins."""
    out = dict(registry.all())
    if db is not None:
        out.update(_admin_rows(db))
    return out


def get_transition(db, page_id: Optional[str]) -> Optional[Transition]:
    if not page_id:
        return None
    if db is not None:
        rows = _admin_rows(db)
        hit = rows.get(page_id)
        if hit is None:
            low = page_id.lower()
            hit = next((t for pid, t in rows.items() if pid.lower() == low), None)
        if hit is not None:
            return hit
    return registry.get(page_id)


def linked_campaign_for(db, official_page_id: str) -> Optional[Transition]:
    """The archived campaign page that handed off to this official page."""
    for t in all_transitions(db).values():
        if t.page_kind == "candidate" and t.linked_page_id == official_page_id:
            return t
    return None


def stage_of(db, page_id: Optional[str], today: Optional[date] = None) -> str:
    t = get_transition(db, page_id)
    return t.stage(today) if t else ACTIVE


def lifecycle_block(db, page_id: Optional[str], today: Optional[date] = None) -> Optional[dict]:
    t = get_transition(db, page_id)
    block = t.as_dict(today) if t else None
    if block is not None and t.page_kind == "official" and not block.get("linked_page_id"):
        camp = linked_campaign_for(db, page_id)
        if camp:
            block["linked_page_id"] = camp.page_id
    if block is None and db is not None and page_id:
        camp = linked_campaign_for(db, page_id)
        if camp:
            return {"page_id": page_id, "page_kind": "official", "stage": ACTIVE, "former": False,
                    "archived": False, "title": None, "linked_page_id": camp.page_id,
                    "can_post": True, "can_poll": True, "can_act_as_owner": True,
                    "accepts_engagement": True, "accepts_tracking": True}
    return block


def page_ids_in_stages(db, stages: Iterable[str], today: Optional[date] = None) -> set:
    wanted = set(stages)
    today = today or today_et()
    return {pid for pid, t in all_transitions(db).items() if t.stage(today) in wanted}


def archived_page_ids(db, today: Optional[date] = None) -> set:
    """Pages to leave out of search, feeds, suggestions and tracking."""
    return page_ids_in_stages(db, (ARCHIVED,), today)


def archived_keys_lower(db, today: Optional[date] = None) -> set:
    """archived_page_ids, lowercased, for matching tracked keys."""
    return {pid.lower() for pid in archived_page_ids(db, today)}


def departed_page_ids(db, today: Optional[date] = None) -> set:
    """Officials who are no longer anyone's current official, whatever
    the roster file still says (decision d: from the day someone leaves
    office, show the successor or "Vacant" instead)."""
    today = today or today_et()
    return {pid for pid, t in all_transitions(db).items()
            if t.event == "left_office" and t.stage(today) in FORMER_STAGES}


# ── permission checks ────────────────────────────────────────────────

class LifecycleRefusal(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _http(refusal: LifecycleRefusal):
    from fastapi import HTTPException
    return HTTPException(status_code=refusal.status_code,
                         detail={"code": refusal.code, "message": refusal.message})


def _office_phrase(t: Transition) -> str:
    return t.office_label or ("the official" if t.page_kind == "official" else "a candidate")


def _ended_sentence(t: Transition) -> str:
    if t.page_kind == "official":
        when = f"on {long_date(t.event_on)}" if t.event_on else "when you left office"
        return f"Your time as {_office_phrase(t)} ended {when}."
    if t.event == "not_on_ballot":
        return f"You aren't on {ballot_phrase(t)} for {t.office_label}."
    when = f"on {long_date(t.event_on)}" if t.event_on else ""
    return f"Your campaign for {t.office_label} ended {when}".rstrip() + "."


def owner_post_refusal(db, page_id: str, *, with_poll: bool = False, today: Optional[date] = None):
    """None when the page owner may publish this post now, else the
    LifecycleRefusal. Polls end the day the person leaves; posts
    continue through the 30-day farewell window."""
    t = get_transition(db, page_id)
    if t is None:
        return None
    st = t.stage(today)
    if st in (ACTIVE, ELECT):
        return None
    if st == FAREWELL and not with_poll:
        return None
    if st == FAREWELL and with_poll:
        return LifecycleRefusal(403, "polls_ended",
                                _ended_sentence(t) + " Polls ended that day. You can still publish "
                                f"posts until {long_date(t.farewell_ends_on)}.")
    if st == ARCHIVED:
        return LifecycleRefusal(403, "page_archived", "This page is archived. It can be read but not changed.")
    return LifecycleRefusal(403, "page_read_only",
                            _ended_sentence(t) + " The farewell window for posts has closed, "
                            "so the page is read-only.")


def require_owner_can_post(db, page_id: str, *, with_poll: bool = False) -> None:
    r = owner_post_refusal(db, page_id, with_poll=with_poll)
    if r:
        raise _http(r)


def require_owner_can_manage_events(db, page_id: str) -> None:
    t = get_transition(db, page_id)
    if t and t.stage() not in (ACTIVE, ELECT):
        raise _http(LifecycleRefusal(403, "events_ended", _ended_sentence(t) + " Events ended that day."))


def official_identity_refusal(db, *, rep=None, candidate=None, today: Optional[date] = None):
    """Acting as an official or a candidate (likes, dislikes, votes,
    comments, replies, bill likes) ends the day they leave or their
    campaign ends. Returns the refusal, or None."""
    page_id = rep.official_id if rep is not None else (candidate.candidate_id if candidate is not None else None)
    if not page_id:
        return None
    t = get_transition(db, page_id)
    if t is None or t.stage(today) in (ACTIVE, ELECT):
        return None
    who = "the official" if rep is not None else "a candidate"
    return LifecycleRefusal(
        403, "official_identity_ended",
        _ended_sentence(t) + f" Liking, voting and commenting as {who} ended that day. "
        "Choose your citizen account to take part.",
    )


def require_official_identity_active(db, *, rep=None, candidate=None) -> None:
    r = official_identity_refusal(db, rep=rep, candidate=candidate)
    if r:
        raise _http(r)


def own_content_refusal(db, *, rep=None, candidate=None, created_at: Optional[datetime] = None):
    """Editing or deleting what the person published as the official or
    candidate. From the day they leave, what they published before is
    locked (Jeffrey: posts made in office stay); farewell posts follow
    the normal rules until the window closes."""
    page_id = rep.official_id if rep is not None else (candidate.candidate_id if candidate is not None else None)
    t = get_transition(db, page_id) if page_id else None
    if t is None:
        return None
    st = t.stage()
    if st in (ACTIVE, ELECT):
        return None
    start = t.clock_start
    if st == FAREWELL and created_at is not None and start is not None and created_at.date() >= start:
        return None
    return LifecycleRefusal(
        403, "content_locked",
        "What you published as " + ("the official" if rep is not None else "a candidate")
        + " stays on the page as a record, so it can no longer be edited or deleted.",
    )


def require_can_change_own_content(db, *, rep=None, candidate=None, created_at=None) -> None:
    r = own_content_refusal(db, rep=rep, candidate=candidate, created_at=created_at)
    if r:
        raise _http(r)


def page_engagement_refusal(db, page_id: Optional[str]):
    """Anyone engaging with content on a page (likes, votes, comments,
    new citizen polls). Open until the archive; reports always work."""
    if not page_id:
        return None
    t = get_transition(db, page_id)
    if t and t.stage() == ARCHIVED:
        return LifecycleRefusal(403, "page_archived",
                                "This page is archived. It can be read, and reported, but not changed.")
    return None


def require_page_open(db, page_id: Optional[str]) -> None:
    r = page_engagement_refusal(db, page_id)
    if r:
        raise _http(r)


def poll_closed_by_departure(db, page_id: Optional[str], *, today: Optional[date] = None) -> Optional[date]:
    """An official's or candidate's own polls close to new votes the day
    they leave (results stay visible). Returns that day when it applies."""
    t = get_transition(db, page_id) if page_id else None
    if t is None or t.event == "won":
        return None
    if t.stage(today) in FORMER_STAGES:
        return t.clock_start or (today or today_et())
    return None


def tracking_refusal(db, page_id: Optional[str]):
    """No new tracking from the day someone leaves office or a campaign
    ends; existing tracking continues until the archive."""
    t = get_transition(db, page_id) if page_id else None
    if t is None:
        return None
    if t.stage() in (ACTIVE, ELECT):
        return None
    name = t.display_name or "This person"
    if t.page_kind == "official":
        return LifecycleRefusal(409, "tracking_closed",
                                f"{name} is no longer in office, so the page can't be tracked anymore.")
    if t.event == "not_on_ballot":
        return LifecycleRefusal(409, "tracking_closed",
                                f"{name} isn't on {ballot_phrase(t)}, so the page can't be tracked anymore.")
    return LifecycleRefusal(409, "tracking_closed",
                            f"{name}'s campaign has ended, so the page can't be tracked anymore.")


def role_at(db, page_id: Optional[str], created_at: Optional[datetime], role: Optional[str]) -> Optional[str]:
    """The title to show on a post header: the office the person held
    when they wrote it. A post written in office keeps the in-office
    role; a farewell post reads "Former ..." (role columns are stored,
    so without this every old post would change with the account)."""
    t = get_transition(db, page_id) if page_id else None
    if t is None or t.event == "won" or created_at is None:
        return role
    start = t.clock_start
    if start is not None and created_at.date() >= start:
        return t.title() or role
    return role


def served_as_line(t: Transition) -> Optional[str]:
    """"Served as State Senator, Florida District 39 (2022 to 2026)",
    generated from our records, never typed by the person."""
    if t is None or t.page_kind != "official" or t.event != "left_office":
        return None
    return f"Served as {t.office_label}{years_suffix(t.served_from, t.served_to)}"


def with_overrides(t: Transition, **changes) -> Transition:
    return replace(t, **changes)
