# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Keeps the stored roll calls current and fills ten years of history
(2026-10-16).

One pass, run by the loop in main.py (never on the boot path):

  1. Takes a database advisory lock, so an old and a new instance
     overlapping during a deploy cannot both run it.
  2. The current Congress, newest votes first: for each House and Senate
     session, compares what the official source lists with what is
     stored and fetches only the missing roll calls. House: Congress.gov
     /house-vote gives the count (with CONGRESS_API_KEY; it answers for
     the 115th Congress onward), then a probe of the Clerk for anything
     newer; without a key or an answer, roll numbers are probed upward
     on clerk.house.gov until one doesn't exist. Senate: the vote menu,
     fetched with ETag / If-Modified-Since so an unchanged menu costs a
     304.
  3. The one re-check of votes stored within a day of being cast, and of
     House votes that came from Congress.gov's members endpoint because
     the Clerk's file could not be read (they lack the Clerk's
     description, which tells a rule vote from a passage vote, and any
     Speaker choices).
  4. History: the BACKFILL_CONGRESSES - 1 Congresses before the current
     one (ten years with the default of 5), newest first, for at most
     BACKFILL_BUDGET_SECONDS per pass. While history is incomplete the
     next pass comes after BACKFILL_PAUSE_SECONDS, so the current
     Congress is still checked between chunks.

Failing sources: after HOST_ERROR_LIMIT consecutive errors from one
site (403s, 5xx and timeouts after their retries) that site is left
alone for the rest of the pass. When history makes no progress for
NO_PROGRESS_LIMIT passes in a row, the loop goes back to the normal
schedule instead of the short backfill pause. Both are logged.

What a public request may fetch is limited too (may_fetch, and
OfficialVotesService): only the current session is probed, and an
unstored vote is fetched only inside the stored window, for a session
not yet found complete.

A finished session whose stored count matches the official count is
marked complete in roll_call_sync_state and not checked again. Each
pass writes one log line; GET /api/admin/roll-calls shows the counts,
the last pass and what was added.

Schedule (seconds_until_next_pass): hourly from 9 a.m. to midnight
Eastern on weekdays, when either chamber usually sits; every 6 hours
otherwise, and always a pass shortly after 5:15 a.m. Eastern.

On by default in production only; ROLL_CALL_SYNC_ENABLED=true or false
overrides that anywhere. Nothing here depends on GovTrack.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from app.services import roll_call_store as store
from app.services.official_votes_service import (
    HOUSE_ROLL_URL,
    HOUSE_VOTE_LIST_URL,
    HOUSE_VOTE_MEMBERS_URL,
    SENATE_MEMBERS_URL,
    SENATE_MENU_URL,
    SENATE_VOTE_URL,
    _LEGIS,
    current_congress_session,
    house_roll_missing,
    parse_house_roll,
    parse_house_vote_members,
    parse_senate_menu,
    parse_senate_vote,
    remap_senators,
    year_for,
)

logger = logging.getLogger(__name__)

ENV_FLAG = "ROLL_CALL_SYNC_ENABLED"
LOCK_NAME = "civicview.roll_call_sync"
BACKFILL_BUDGET_SECONDS = 25 * 60
BACKFILL_PAUSE_SECONDS = 5 * 60
FIRST_PASS_DELAY_SECONDS = 120
PROBE_BATCH = 4
FETCH_BATCH = 6
# Consecutive errors from one site before a pass leaves it alone.
HOST_ERROR_LIMIT = 5
# Passes in a row with history incomplete and none of it added before the
# loop drops back to the normal schedule.
NO_PROGRESS_LIMIT = 3
_HOSTS = {"h": "clerk.house.gov", "s": "senate.gov"}
_ET = ZoneInfo("America/New_York")

# The most recent pass, for the admin view (per process).
LAST_PASS: dict = {}
# Passes in a row that left history incomplete without adding any of it.
_NO_PROGRESS = {"passes": 0}


def sync_enabled() -> bool:
    """ROLL_CALL_SYNC_ENABLED=true / false when set; otherwise on in
    production only (runtime_env.is_production, the check the production
    settings guard uses), so a local run or a test never starts a ten-year
    crawl of the official sites."""
    raw = (os.getenv(ENV_FLAG) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    from app.services.runtime_env import is_production

    return is_production()


def backfill_congresses() -> int:
    """How many Congresses to keep, counting the current one (5 = ten years)."""
    try:
        return max(1, int(os.getenv("ROLL_CALL_BACKFILL_CONGRESSES") or 5))
    except ValueError:
        return 5


def stored_window(now_cs: Optional[tuple[int, int]] = None) -> tuple[int, int]:
    """(oldest, newest) Congress the sync keeps."""
    cc = (now_cs or current_congress_session())[0]
    return cc - backfill_congresses() + 1, cc


def in_window(congress: int, session: int, now_cs: Optional[tuple[int, int]] = None) -> bool:
    """A session the sync keeps: inside the stored window, session 1 or 2,
    and not in the future."""
    now_cs = now_cs or current_congress_session()
    lo, hi = stored_window(now_cs)
    return lo <= congress <= hi and session in (1, 2) and (congress, session) <= now_cs


# A request may fetch an unstored vote numbered at most this far above the
# highest one stored for its session (votes cast since the last pass).
FETCH_AHEAD = 100


def may_fetch(db, chamber: str, congress: int, session: int, number: Optional[int] = None) -> bool:
    """Whether a request may fetch an unstored vote of this session from the
    official site: only inside the stored window, never for a session
    already found complete (all its votes are stored, so an unstored
    number doesn't exist), and only up to FETCH_AHEAD above the highest
    stored number."""
    if not in_window(congress, session):
        return False
    from sqlalchemy import func, select

    from app.models.pages import RollCall, RollCallSyncState

    done = db.execute(select(RollCallSyncState.completed_at).where(
        RollCallSyncState.chamber == chamber, RollCallSyncState.congress == congress,
        RollCallSyncState.session == session)).scalar_one_or_none()
    if done is not None:
        return False
    if number is None:
        return True
    highest = db.execute(select(func.max(RollCall.number)).where(
        RollCall.chamber == chamber, RollCall.congress == congress,
        RollCall.session == session)).scalar() or 0
    return 1 <= number <= highest + FETCH_AHEAD


@dataclass
class PassSummary:
    added: dict = field(default_factory=lambda: {"h": [], "s": []})
    rechecked: int = 0
    changed: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    skipped_members: int = 0
    backfill_pending: bool = False
    # chamber -> consecutive errors from its site, and the sites left alone
    host_errors: dict = field(default_factory=lambda: {"h": 0, "s": 0})
    tripped: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "added_house": len(self.added["h"]),
            "added_senate": len(self.added["s"]),
            "added": self.added["h"][:50] + self.added["s"][:50],
            "rechecked": self.rechecked,
            "changed_on_recheck": self.changed,
            "errors": self.errors[:20],
            "members_without_id": self.skipped_members,
            "backfill_pending": self.backfill_pending,
            "sites_stopped": {_HOSTS[c]: why for c, why in self.tripped.items()},
        }


# ── fetching one roll call ─────────────────────────────────────────────
# Each fetcher returns (status, parsed, site_status): status "ok",
# "missing" (no such roll) or "error"; site_status is the HTTP status the
# chamber's own site gave (0 for no answer), which the error breaker counts.
async def fetch_house_roll(congress: int, session: int, number: int, *,
                           fallback: bool = True) -> tuple[str, Optional[dict], int]:
    """The Clerk's file. When it can't be read and fallback is on, Congress.gov's
    members endpoint instead; such a vote is stored as provisional and
    fetched again from the Clerk later."""
    from app.services.official_http import congress_api, fetch

    res = await fetch(HOUSE_ROLL_URL.format(year=year_for(congress, session), roll=number))
    if res.status == 404 or (res.ok and house_roll_missing(res.text)):
        return "missing", None, res.status
    if res.ok:
        try:
            return "ok", await asyncio.to_thread(parse_house_roll, res.text), 200
        except Exception as exc:
            logger.warning("house roll %s-%s-%s unreadable: %s", congress, session, number, exc)
    if fallback and os.getenv("CONGRESS_API_KEY"):
        payload = await congress_api(HOUSE_VOTE_MEMBERS_URL.format(congress=congress, session=session, num=number))
        parsed = parse_house_vote_members(payload) if payload else None
        if parsed:
            return "ok", parsed, res.status
    return "error", None, res.status


async def fetch_senate_vote(congress: int, session: int, number: int, *,
                            fallback: bool = True) -> tuple[str, Optional[dict], int]:
    from app.services.official_http import fetch

    res = await fetch(SENATE_VOTE_URL.format(congress=congress, session=session, num=number))
    if res.status == 404:
        return "missing", None, 404
    if not res.ok:
        return "error", None, res.status
    try:
        return "ok", await asyncio.to_thread(parse_senate_vote, res.text), 200
    except Exception as exc:
        logger.warning("senate vote %s-%s-%s unreadable: %s", congress, session, number, exc)
        return "error", None, 200


def _note_site(chamber: str, status: str, site_status: int, summary: PassSummary) -> None:
    """Count consecutive failures of a chamber's site (an answer other than a
    readable file or a clean "no such roll", even when Congress.gov stood
    in for it); after HOST_ERROR_LIMIT in a row the site is left alone for
    the rest of the pass."""
    failed = status == "error" or (status == "ok" and site_status != 200)
    if not failed:
        summary.host_errors[chamber] = 0
        return
    summary.host_errors[chamber] += 1
    if summary.host_errors[chamber] >= HOST_ERROR_LIMIT and chamber not in summary.tripped:
        why = f"{HOST_ERROR_LIMIT} errors in a row, last status {site_status or 'no answer'}"
        summary.tripped[chamber] = why
        logger.warning("Roll-call sync: leaving %s alone for the rest of this pass (%s).", _HOSTS[chamber], why)


async def _store(parsed: dict, summary: PassSummary) -> str:
    still = await asyncio.to_thread(remap_senators, parsed)
    if still:
        summary.errors.append(f"{parsed.get('vote_id')}: {still} senator(s) with no bioguide id, not stored")
        return "unmapped"
    rec = store.record_from_parsed(parsed)
    summary.skipped_members += len(rec["skipped"])
    outcome = await asyncio.to_thread(store.with_session, store.store_roll_call, rec)
    if outcome == "added":
        summary.added[rec["chamber"]].append(rec["vote_id"])
    return outcome


async def _fetch_and_store(chamber: str, congress: int, session: int, number: int,
                           summary: PassSummary) -> str:
    """One roll call: "added" | "exists" | "missing" | "error" (couldn't be
    read) | "store_error" | "unmapped" | "tripped" (its site is being left
    alone for this pass; nothing was fetched)."""
    if chamber in summary.tripped:
        return "tripped"
    fetcher = fetch_house_roll if chamber == "h" else fetch_senate_vote
    status, parsed, site_status = await fetcher(congress, session, number)
    _note_site(chamber, status, site_status, summary)
    if status != "ok":
        if status == "error":
            summary.errors.append(f"{chamber}-{congress}-{session}-{number}: could not be read ({site_status})")
        return status
    try:
        return await _store(parsed, summary)
    except Exception as exc:
        logger.exception("storing %s-%s-%s-%s failed", chamber, congress, session, number)
        summary.errors.append(f"{chamber}-{congress}-{session}-{number}: {type(exc).__name__}")
        return "store_error"


# ── sync state rows ────────────────────────────────────────────────────
def _state_get(db, chamber: str, congress: int, session: int):
    from sqlalchemy import select

    from app.models.pages import RollCallSyncState

    row = db.execute(select(RollCallSyncState).where(
        RollCallSyncState.chamber == chamber, RollCallSyncState.congress == congress,
        RollCallSyncState.session == session)).scalar_one_or_none()
    if row is None:
        row = RollCallSyncState(chamber=chamber, congress=congress, session=session)
        db.add(row)
        db.commit()
        db.refresh(row)
    return {"official_count": row.official_count, "stored_count": row.stored_count,
            "menu_etag": row.menu_etag, "menu_last_modified": row.menu_last_modified,
            "completed": row.completed_at is not None}


def _state_put(db, chamber: str, congress: int, session: int, **values) -> None:
    from sqlalchemy import select

    from app.models.pages import RollCallSyncState

    row = db.execute(select(RollCallSyncState).where(
        RollCallSyncState.chamber == chamber, RollCallSyncState.congress == congress,
        RollCallSyncState.session == session)).scalar_one()
    for k, v in values.items():
        setattr(row, k, v)
    db.commit()


def _is_past(congress: int, session: int, now_cs: tuple[int, int]) -> bool:
    return (congress, session) < now_cs


async def _finish_session(chamber: str, congress: int, session: int, official: Optional[int],
                          now_cs: tuple[int, int], error: Optional[str] = None, **extra) -> None:
    stored_now = await asyncio.to_thread(store.with_session, store.stored_numbers, chamber, congress, session)
    values = {"stored_count": len(stored_now), "checked_at": store.utcnow(), "last_error": error, **extra}
    if official is not None:
        values["official_count"] = official
        if _is_past(congress, session, now_cs) and error is None and len(stored_now) >= official:
            values["completed_at"] = store.utcnow()
    await asyncio.to_thread(store.with_session, _state_put, chamber, congress, session, **values)


def _stopped_for_site(chamber: str, summary: PassSummary) -> Optional[str]:
    if chamber in summary.tripped:
        return f"stopped: {_HOSTS[chamber]} gave {summary.tripped[chamber]}"
    return None


async def _fetch_numbers(chamber: str, congress: int, session: int, numbers: list[int],
                         summary: PassSummary, deadline: Optional[float]) -> Optional[str]:
    """Fetch the given roll numbers, newest first. Returns None when done,
    or why it stopped early: the time budget, or the site failing."""
    for i in range(0, len(numbers), FETCH_BATCH):
        stopped = _stopped_for_site(chamber, summary)
        if stopped:
            return stopped
        if deadline is not None and time.monotonic() > deadline:
            return "stopped for the time budget"
        batch = numbers[i:i + FETCH_BATCH]
        await asyncio.gather(*(_fetch_and_store(chamber, congress, session, n, summary) for n in batch))
    return _stopped_for_site(chamber, summary)


async def _probe_up(congress: int, session: int, start: int, summary: PassSummary,
                    deadline: Optional[float], batch_size: int = PROBE_BATCH,
                    confirm_end: bool = True) -> tuple[Optional[int], bool]:
    """Fetch House rolls start, start+1, ... until the Clerk says one doesn't
    exist. Returns (highest roll that exists or None if unknown, finished).

    The Clerk answers a roll that doesn't exist with HTTP 200 and a short
    error document, the same body it can give for a passing failure, so
    with confirm_end an apparent end is checked again (that roll and the
    next) before it is believed: otherwise a hiccup could mark a past
    session complete with its last votes missing. The current session is
    never marked complete (a false end just waits for the next pass), so
    its hourly check skips that and costs one request."""
    n = start
    highest = start - 1
    while True:
        if deadline is not None and time.monotonic() > deadline:
            return None, False
        batch = list(range(n, n + batch_size))
        results = await asyncio.gather(*(_fetch_and_store("h", congress, session, b, summary) for b in batch))
        end_at = None
        for b, status in zip(batch, results):
            if status in ("error", "tripped"):
                return None, True  # unknown end; try again next pass
            if status == "missing":
                end_at = b
                break
            highest = b
        if end_at is None:
            n += batch_size
            continue
        if not confirm_end:
            return highest, True
        first, second = await asyncio.gather(
            _fetch_and_store("h", congress, session, end_at, summary),
            _fetch_and_store("h", congress, session, end_at + 1, summary),
        )
        if first == "missing" and second == "missing":
            return highest, True
        if {first, second} & {"error", "tripped"}:
            return None, True
        if second == "missing":
            highest, n = end_at, end_at + 1  # end_at exists; check what follows it
        else:
            # end_at + 1 exists (end_at too, or it is a gap the next pass fills)
            highest, n = end_at + 1, end_at + 2


async def sync_house_session(congress: int, session: int, summary: PassSummary,
                             deadline: Optional[float], now_cs: tuple[int, int]) -> bool:
    from app.services.official_http import congress_api

    state = await asyncio.to_thread(store.with_session, _state_get, "h", congress, session)
    if state["completed"]:
        return True
    stored = await asyncio.to_thread(store.with_session, store.stored_numbers, "h", congress, session)
    official = None
    # Congress.gov's list (it covers the 115th Congress onward as of
    # 2026-10-16); without a key, or when it has no answer, the Clerk probe.
    payload = await congress_api(HOUSE_VOTE_LIST_URL.format(congress=congress, session=session),
                                 {"limit": 1, "offset": 0})
    if payload is not None and (payload.get("pagination") or {}).get("count"):
        official = int(payload["pagination"]["count"])
    if official is not None:
        missing = sorted((n for n in range(1, official + 1) if n not in stored), reverse=True)
        stopped = await _fetch_numbers("h", congress, session, missing, summary, deadline)
        if stopped:
            await _finish_session("h", congress, session, None, now_cs, stopped)
            return False
        if not _is_past(congress, session, now_cs):
            # Congress.gov can trail the Clerk by a few hours.
            highest, _ = await _probe_up(congress, session, max(official, max(stored, default=0)) + 1,
                                         summary, deadline, batch_size=1, confirm_end=False)
            if highest is not None and highest > official:
                official = highest
    else:
        current = not _is_past(congress, session, now_cs)
        highest, finished = await _probe_up(congress, session, max(stored, default=0) + 1, summary, deadline,
                                            batch_size=1 if current else PROBE_BATCH, confirm_end=not current)
        if not finished:
            await _finish_session("h", congress, session, None, now_cs, "stopped for the time budget")
            return False
        if highest is None and "h" in summary.tripped:
            await _finish_session("h", congress, session, None, now_cs, _stopped_for_site("h", summary))
            return False
        official = highest
        # A gap below the highest stored roll (an earlier failure) is filled too.
        if official:
            stored = await asyncio.to_thread(store.with_session, store.stored_numbers, "h", congress, session)
            gaps = sorted((n for n in range(1, official + 1) if n not in stored), reverse=True)
            stopped = await _fetch_numbers("h", congress, session, gaps, summary, deadline) if gaps else None
            if stopped:
                await _finish_session("h", congress, session, None, now_cs, stopped)
                return False
    await _finish_session("h", congress, session, official, now_cs,
                          None if official is not None else "could not find the latest roll")
    return True


async def sync_senate_session(congress: int, session: int, summary: PassSummary,
                              deadline: Optional[float], now_cs: tuple[int, int]) -> bool:
    from app.services.official_http import fetch

    if "s" in summary.tripped:
        return False
    state = await asyncio.to_thread(store.with_session, _state_get, "s", congress, session)
    if state["completed"]:
        return True
    stored = await asyncio.to_thread(store.with_session, store.stored_numbers, "s", congress, session)
    complete_so_far = state["official_count"] is not None and state["stored_count"] == state["official_count"]
    res = await fetch(SENATE_MENU_URL.format(congress=congress, session=session),
                      etag=state["menu_etag"] if complete_so_far else None,
                      last_modified=state["menu_last_modified"] if complete_so_far else None)
    if res.not_modified:
        await _finish_session("s", congress, session, state["official_count"], now_cs)
        return True
    if not res.ok:
        if res.status == 404:  # a session with no votes yet
            await _finish_session("s", congress, session, None, now_cs)
            return True
        _note_site("s", "error", res.status, summary)
        await _finish_session("s", congress, session, None, now_cs, f"vote menu answered {res.status}")
        summary.errors.append(f"senate menu {congress}-{session}: {res.status}")
        return False
    try:
        menu = await asyncio.to_thread(parse_senate_menu, res.text, False)
        numbers = sorted({r["rollcall"] for r in menu}, reverse=True)
    except Exception as exc:
        summary.errors.append(f"senate menu {congress}-{session} unreadable: {type(exc).__name__}")
        return False
    _note_site("s", "ok", 200, summary)
    missing = [n for n in numbers if n not in stored]
    if missing:
        await _ensure_senate_members()
    stopped = await _fetch_numbers("s", congress, session, missing, summary, deadline)
    await _finish_session(
        "s", congress, session, None if stopped else len(numbers), now_cs, stopped,
        menu_etag=(res.headers.get("etag") or None), menu_last_modified=(res.headers.get("last-modified") or None),
    )
    return stopped is None


_SENATE_MEMBERS_LOADED_AT = 0.0


async def _ensure_senate_members() -> None:
    """Load senate.gov's own lis → bioguide file, at most every 12 hours."""
    global _SENATE_MEMBERS_LOADED_AT
    if time.monotonic() - _SENATE_MEMBERS_LOADED_AT < 12 * 3600 and _SENATE_MEMBERS_LOADED_AT:
        return
    from app.services.official_http import fetch

    res = await fetch(SENATE_MEMBERS_URL)
    if res.ok:
        n = await asyncio.to_thread(_LEGIS.add_senate_members, res.text)
        logger.info("senate.gov member file: %d senators mapped", n)
        _SENATE_MEMBERS_LOADED_AT = time.monotonic()


async def probe_house_session(congress: int, session: int) -> None:
    """Store any House roll newer than the highest stored one, for the
    current session only (the /bills House list when Congress.gov is
    unavailable). One request when nothing is new."""
    if (congress, session) != current_congress_session():
        return
    stored = await asyncio.to_thread(store.with_session, store.stored_numbers, "h", congress, session)
    await _probe_up(congress, session, max(stored, default=0) + 1, PassSummary(), time.monotonic() + 60,
                    batch_size=1, confirm_end=False)


async def recheck_unconfirmed(summary: PassSummary) -> None:
    """The one later re-check of votes stored the day they were cast, and of
    provisional House votes (Congress.gov), from the chamber's own file
    only: a provisional vote stays provisional until the Clerk's file can
    be read."""
    pending = await asyncio.to_thread(store.with_session, store.unconfirmed)
    for chamber, congress, session, number in pending:
        if chamber in summary.tripped:
            continue
        fetcher = fetch_house_roll if chamber == "h" else fetch_senate_vote
        status, parsed, site_status = await fetcher(congress, session, number, fallback=False)
        _note_site(chamber, status, site_status, summary)
        if status != "ok":
            continue
        if await asyncio.to_thread(remap_senators, parsed):
            continue
        rec = store.record_from_parsed(parsed)
        outcome = await asyncio.to_thread(store.with_session, store.confirm_roll_call, rec)
        summary.rechecked += 1
        if outcome == "changed":
            summary.changed.append(rec["vote_id"])


def sessions_newest_first(current: tuple[int, int], congresses: int) -> list[tuple[int, int]]:
    """(congress, session) pairs from the current one back through
    `congresses` Congresses, newest first. Session 3 (rare) is ignored."""
    cc, cs = current
    out = []
    for c in range(cc, cc - congresses, -1):
        for s in (2, 1):
            if (c, s) <= (cc, cs):
                out.append((c, s))
    return out


# ── one pass ───────────────────────────────────────────────────────────
async def run_pass(*, include_backfill: bool = True, budget_seconds: float = BACKFILL_BUDGET_SECONDS,
                   congresses: Optional[int] = None) -> dict:
    from app.services.db_locks import AdvisoryLock

    lock = AdvisoryLock(LOCK_NAME)
    if not await asyncio.to_thread(lock.try_acquire):
        logger.info("Roll-call sync: another instance holds the lock; skipping this pass.")
        return {"skipped": "locked"}
    started = time.monotonic()
    summary = PassSummary()
    failed = False
    now_cs = current_congress_session()
    kept = congresses or backfill_congresses()
    try:
        await asyncio.to_thread(_LEGIS._ensure)
        deadline = started + budget_seconds
        for congress, session in sessions_newest_first(now_cs, kept):
            current_congress = congress == now_cs[0]
            if not current_congress:
                if not include_backfill:
                    break
                if time.monotonic() > deadline or len(summary.tripped) == 2:
                    summary.backfill_pending = True
                    break
                await asyncio.to_thread(_LEGIS.ensure_historical)
            limit = None if current_congress else deadline
            h_done, s_done = await asyncio.gather(
                sync_house_session(congress, session, summary, limit, now_cs),
                sync_senate_session(congress, session, summary, limit, now_cs),
            )
            if current_congress and session == now_cs[1]:
                await recheck_unconfirmed(summary)
            if not (h_done and s_done):
                summary.backfill_pending = True
                if not current_congress:
                    break
        if include_backfill and not summary.backfill_pending:
            summary.backfill_pending = await asyncio.to_thread(store.with_session, _history_incomplete, now_cs, kept)
    except Exception as exc:
        failed = True
        logger.exception("Roll-call sync pass failed")
        summary.errors.append(f"pass failed: {type(exc).__name__}")
    finally:
        await asyncio.to_thread(lock.release)
    result = summary.as_dict()
    result["failed"] = failed
    result["history_stalled"] = False
    history_added = sum(1 for v in summary.added["h"] + summary.added["s"] if int(v.split("-")[1]) < now_cs[0])
    if include_backfill and (summary.backfill_pending or failed) and not history_added:
        _NO_PROGRESS["passes"] += 1
        if _NO_PROGRESS["passes"] >= NO_PROGRESS_LIMIT:
            result["history_stalled"] = True
            logger.warning(
                "Roll-call sync: history has not progressed in %d passes in a row; back to the normal "
                "schedule until it does (GET /api/admin/roll-calls lists the errors).", _NO_PROGRESS["passes"])
    else:
        _NO_PROGRESS["passes"] = 0
    result["seconds"] = round(time.monotonic() - started, 1)
    result["finished_at"] = store.utcnow().isoformat(timespec="seconds") + "Z"
    LAST_PASS.clear()
    LAST_PASS.update(result)
    if result["history_stalled"]:
        history = "history stalled"
    else:
        history = "history still filling" if result["backfill_pending"] else "history complete"
    logger.info(
        "Roll-call sync: added House %d, Senate %d%s; re-checked %d (%d changed); %s; %.0fs%s%s",
        result["added_house"], result["added_senate"],
        (" (" + ", ".join(result["added"][:8]) + ("..." if len(result["added"]) > 8 else "") + ")")
        if result["added"] else "",
        result["rechecked"], len(result["changed_on_recheck"]), history, result["seconds"],
        ("; left alone: " + ", ".join(f"{host} ({why})" for host, why in result["sites_stopped"].items()))
        if result["sites_stopped"] else "",
        ("; errors: " + "; ".join(result["errors"][:3])) if result["errors"] else "",
    )
    return result


def _history_incomplete(db, now_cs: tuple[int, int], congresses: int) -> bool:
    from sqlalchemy import select

    from app.models.pages import RollCallSyncState

    done = {(c, s, ch) for ch, c, s in db.execute(select(
        RollCallSyncState.chamber, RollCallSyncState.congress, RollCallSyncState.session).where(
        RollCallSyncState.completed_at.is_not(None))).all()}
    for c, s in sessions_newest_first(now_cs, congresses):
        if c == now_cs[0]:
            continue
        if (c, s, "h") not in done or (c, s, "s") not in done:
            return True
    return False


# ── schedule ───────────────────────────────────────────────────────────
def seconds_after_pass(result: dict, now: Optional[datetime] = None) -> float:
    """How long the loop sleeps after a pass. The short backfill pause when
    history is still filling, and also when the pass was skipped because
    another instance held the lock or when it failed: either may have left
    history half done, and sleeping up to 6 hours would stall it. Once
    history has made no progress for NO_PROGRESS_LIMIT passes in a row
    (a site refusing us, a vote that can never be stored), the normal
    schedule instead."""
    short = bool(result.get("backfill_pending") or result.get("skipped") or result.get("failed"))
    if result.get("history_stalled"):
        short = False
    return seconds_until_next_pass(now, backfill_pending=short)


def seconds_until_next_pass(now: Optional[datetime] = None, *, backfill_pending: bool = False) -> float:
    """Hourly 9 a.m. to midnight Eastern on weekdays; otherwise every 6
    hours, never sleeping past 5:15 a.m. or a weekday's 9 a.m. While
    history is still filling, BACKFILL_PAUSE_SECONDS."""
    now = (now or datetime.now(_ET)).astimezone(_ET)
    if backfill_pending:
        return float(BACKFILL_PAUSE_SECONDS)
    if now.weekday() < 5 and now.hour >= 9:
        return 3600.0
    candidates = [now + timedelta(hours=6)]
    daily = now.replace(hour=5, minute=15, second=0, microsecond=0)
    if daily <= now:
        daily += timedelta(days=1)
    candidates.append(daily)
    day = now.replace(hour=9, minute=0, second=0, microsecond=0)
    for _ in range(8):
        if day > now and day.weekday() < 5:
            candidates.append(day)
            break
        day += timedelta(days=1)
    return max(60.0, (min(candidates) - now).total_seconds())
