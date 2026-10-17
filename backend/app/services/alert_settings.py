# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""The notification settings list (2026-10-17, work order 9b).

One short list replaces the 32 per-item "Notify me when..." switches.
Each row is one kind of alert, with one dropdown deciding where it
arrives: the bell, a push to the person's phones, an email.

  officials     Officials you track (their posts and polls)
  events        Events (officials you track scheduling one)
  replies       Replies to your comments
  bills         Bill updates (federal bills you track, Congress.gov)
  poll_results  Poll results (a poll you voted in closed)
  elections     Election reminders
  page_changes  Changes to pages you track (left office, campaign ended,
                took office); the bell always comes (work order 8)

Every send path asks this module, so the list is enforced on the
server and is the same on every device. Per official, "Mute" in My
Tracked (TrackedOfficial.prefs_json {"muted": true}) stops that
official's posts, polls and events in the bell, the push and the
weekly digest; notices that their page changed still come.

Storage (Jeffrey, 2026-10-17): only the cells that differ from the
defaults, in CitizenAccount.alert_settings_json, changed one row at a
time (set_choice) and never replaced whole by a device's sync. Three
cells already had their own columns and keep them, so the settings,
the unsubscribe links and the jobs that read them agree:
  elections.bell    election_reminders_off_at (NULL = on)
  elections.email   election_reminder_email_at (set = on)
  page_changes.email page_change_email_off_at (NULL = on)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Iterable

logger = logging.getLogger(__name__)

BELL, PUSH, EMAIL = "bell", "push", "email"

# Row -> the channels it has and their defaults (Jeffrey, 2026-10-17:
# events on for everyone, page change pushes on).
ROWS: dict = {
    "officials": {BELL: True, PUSH: True},
    "events": {BELL: True, PUSH: True},
    "replies": {BELL: True, PUSH: True},
    "bills": {BELL: True, PUSH: True, EMAIL: False},
    "poll_results": {BELL: True, PUSH: True},
    "elections": {BELL: True, PUSH: True, EMAIL: False},
    "page_changes": {BELL: True, PUSH: True, EMAIL: True},
}
ROW_ORDER = ("officials", "events", "replies", "bills", "poll_results", "elections", "page_changes")

# The dropdown's values. A push never comes without its bell row (the
# push opens it), so "push only" is not a choice.
CHOICE_CELLS = {
    "bell_push_email": (True, True, True),
    "bell_push": (True, True, False),
    "bell_email": (True, False, True),
    "bell": (True, False, False),
    "off": (False, False, False),
}
# Rows whose bell can't be turned off (work order 8: the notice that a
# page you track changed always reaches the bell).
_BELL_FIXED = {"page_changes"}


def choices_for(row: str) -> list:
    """The dropdown's choices for one row, in display order."""
    has_email = EMAIL in ROWS[row]
    out = []
    for value, (bell, push, email) in CHOICE_CELLS.items():
        if email and not has_email:
            continue
        if not bell and row in _BELL_FIXED:
            continue
        out.append(value)
    return out


def _loads(raw) -> dict:
    if not raw:
        return {}
    try:
        val = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    return val if isinstance(val, dict) else {}


def _cells_from(alert_json, reminders_off_at, reminder_email_at, page_email_off_at) -> dict:
    stored = _loads(alert_json)
    out = {}
    for row, defaults in ROWS.items():
        cells = dict(defaults)
        saved = stored.get(row)
        if isinstance(saved, dict):
            for channel in cells:
                if isinstance(saved.get(channel), bool):
                    cells[channel] = saved[channel]
        out[row] = cells
    out["elections"][BELL] = reminders_off_at is None
    out["elections"][EMAIL] = reminder_email_at is not None
    out["page_changes"][EMAIL] = page_email_off_at is None
    out["page_changes"][BELL] = True
    for cells in out.values():
        if not cells[BELL]:
            cells[PUSH] = False
            if EMAIL in cells:
                cells[EMAIL] = False
    return out


def cells_for(citizen) -> dict:
    """{row: {channel: bool}} for one citizen account."""
    return _cells_from(
        getattr(citizen, "alert_settings_json", None),
        getattr(citizen, "election_reminders_off_at", None),
        getattr(citizen, "election_reminder_email_at", None),
        getattr(citizen, "page_change_email_off_at", None),
    )


def choice_of(cells: dict) -> str:
    bell, push, email = cells.get(BELL, False), cells.get(PUSH, False), cells.get(EMAIL, False)
    for value, triple in CHOICE_CELLS.items():
        if triple == (bell, push, email):
            return value
    return "bell" if bell else "off"


def settings_for(citizen) -> dict:
    """{row: choice} for the settings list."""
    cells = cells_for(citizen)
    return {row: choice_of(cells[row]) for row in ROW_ORDER}


def wants(citizen, row: str, channel: str) -> bool:
    """One cell. A missing account gets the default."""
    if citizen is None:
        return bool(ROWS[row].get(channel, False))
    return bool(cells_for(citizen)[row].get(channel, False))


def wanting(db, citizen_ids: Iterable[int], row: str, channel: str) -> set:
    """The citizens, of those given, whose setting allows this row on
    this channel. One query for any number of people."""
    from app.models.pages import CitizenAccount

    ids = list({int(i) for i in citizen_ids if i is not None})
    if not ids:
        return set()
    out = set()
    for i in range(0, len(ids), 900):
        chunk = ids[i:i + 900]
        rows = (
            db.query(CitizenAccount.id, CitizenAccount.alert_settings_json,
                     CitizenAccount.election_reminders_off_at, CitizenAccount.election_reminder_email_at,
                     CitizenAccount.page_change_email_off_at)
            .filter(CitizenAccount.id.in_(chunk))
            .all()
        )
        for cid, blob, rem_off, rem_email, page_off in rows:
            if _cells_from(blob, rem_off, rem_email, page_off)[row].get(channel, False):
                out.add(cid)
    return out


def _locked(db, citizen):
    """The account row, read again and locked until the commit, so two
    rows changed at once (two devices, or a dropdown and an unsubscribe
    link) cannot overwrite each other's change to the stored JSON."""
    from app.models.pages import CitizenAccount

    db.flush()  # sessions don't autoflush: keep any pending change to the row
    return (
        db.query(CitizenAccount)
        .filter(CitizenAccount.id == citizen.id)
        .with_for_update()
        .populate_existing()
        .one()
    )


def set_choice(db, citizen, row: str, value: str) -> None:
    """Apply one row's dropdown choice. Raises ValueError for a row or
    value the list does not have. Commits."""
    if row not in ROWS or value not in choices_for(row):
        raise ValueError(f"no choice {value!r} for {row!r}")
    _apply(db, _locked(db, citizen), row, value)


def _apply(db, citizen, row: str, value: str) -> None:
    bell, push, email = CHOICE_CELLS[value]
    wanted = {BELL: bell, PUSH: push, EMAIL: email}
    stored = _loads(citizen.alert_settings_json)
    row_cells = {}
    now = datetime.utcnow()
    for channel, default in ROWS[row].items():
        on = wanted[channel]
        if row == "elections" and channel == BELL:
            citizen.election_reminders_off_at = None if on else (citizen.election_reminders_off_at or now)
        elif row == "elections" and channel == EMAIL:
            citizen.election_reminder_email_at = (citizen.election_reminder_email_at or now) if on else None
        elif row == "page_changes" and channel == EMAIL:
            citizen.page_change_email_off_at = None if on else (citizen.page_change_email_off_at or now)
        elif row == "page_changes" and channel == BELL:
            continue
        elif on != default:
            row_cells[channel] = on
    if row_cells:
        stored[row] = row_cells
    else:
        stored.pop(row, None)
    citizen.alert_settings_json = json.dumps(stored, sort_keys=True) if stored else None
    db.add(citizen)
    db.commit()


def turn_off_email(db, citizen, row: str) -> bool:
    """Turn off one row's email and nothing else (an unsubscribe link).
    Returns True when it was on."""
    citizen = _locked(db, citizen)
    cells = cells_for(citizen)[row]
    if not cells.get(EMAIL):
        db.commit()  # release the lock
        return False
    _apply(db, citizen, row, choice_of({**cells, EMAIL: False}))
    return True


# ── Mute this official (My Tracked) ──────────────────────────────────

def is_muted(prefs_json) -> bool:
    return _loads(prefs_json).get("muted") is True


def unmuted_trackers(rows) -> list:
    """[tracker_id] of (tracker_id, prefs_json) rows that did not mute."""
    return [tid for tid, blob in rows if not is_muted(blob)]
