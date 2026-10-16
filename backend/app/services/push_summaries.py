# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Summary pushes (2026-10-16).

Jeffrey's decisions: nothing is dropped silently. "Push alerts" in the
bell has three choices:

  realtime  As they happen: each update at once (the default)
  daily     Daily summary: one push at SUMMARY_DAILY_HOUR (6 p.m.)
  weekly    Weekly summary: one push Saturday at SUMMARY_WEEKLY_HOUR
            (10 a.m.)

all in the device's local time (tz_offset_minutes in its prefs, else
Eastern). A tracked-activity push for a daily or weekly device is held
(models.PushHeldItem, written by push_service._deliver_tracked_push).
So is one that lands in quiet hours on a realtime device: it goes out
in one summary when quiet hours end. A summary time that falls inside
quiet hours waits for them to end too.

run_summaries() is called every LOOP_INTERVAL_SECONDS by main.py. For
each device with held updates that is due, it claims the device with
one conditional UPDATE on summary_sent_at (two instances during a
deploy cannot both send), leaves out updates the person already read
or cleared in the bell, and sends one push:

  "4 updates from officials you track" / "From Jane Doe, John Roe and
  2 more."

Tapping it opens the bell (signed-in devices) or the page of the newest
update (signed-out devices, which have no bell). A summary of exactly
one update is that update's own push. Election reminders never come
here.

migrate_legacy_cadence() is the one-time rename of the old
digest_cadence setting (default 'daily', which silently dropped
pushes) to push_cadence: 'daily' and anything else become realtime,
'weekly' stays weekly. It runs on the loop's first pass, off the boot
path, and finds nothing to do after that.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import or_

from app.services.push_service import (
    PushMessage,
    _in_quiet_hours,
    _parse_json_or_none,
    device_prefs,
    effective_cadence,
    send_push_messages,
)

logger = logging.getLogger(__name__)

LOOP_INTERVAL_SECONDS = 5 * 60
FIRST_PASS_DELAY_SECONDS = 60
SUMMARY_DAILY_HOUR = 18
SUMMARY_WEEKLY_HOUR = 10
SUMMARY_WEEKDAY = 5  # Saturday
SUMMARY_TTL_SECONDS = 2 * 24 * 3600
LOCK_NAME = "push-summaries"


# ── Local time ───────────────────────────────────────────────────────

def _tz_offset(prefs: Optional[dict]) -> Optional[int]:
    tz = (prefs or {}).get("tz_offset_minutes")
    if isinstance(tz, int) and not isinstance(tz, bool) and abs(tz) <= 14 * 60:
        return tz
    return None


def to_local(prefs: Optional[dict], now_utc: datetime) -> datetime:
    """The device's wall clock: its tz offset, else Eastern time."""
    tz = _tz_offset(prefs)
    if tz is not None:
        return now_utc + timedelta(minutes=tz)
    from datetime import timezone
    from zoneinfo import ZoneInfo
    return now_utc.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("America/New_York")).replace(tzinfo=None)


def to_utc(prefs: Optional[dict], local: datetime) -> datetime:
    tz = _tz_offset(prefs)
    if tz is not None:
        return local - timedelta(minutes=tz)
    from datetime import timezone
    from zoneinfo import ZoneInfo
    return local.replace(tzinfo=ZoneInfo("America/New_York")).astimezone(timezone.utc).replace(tzinfo=None)


def last_slot_utc(cadence: str, prefs: Optional[dict], now_utc: datetime) -> Optional[datetime]:
    """The most recent scheduled summary time at or before now, in UTC.
    None for realtime (no schedule: held updates go as soon as quiet
    hours allow)."""
    local = to_local(prefs, now_utc)
    if cadence == "daily":
        slot = local.replace(hour=SUMMARY_DAILY_HOUR, minute=0, second=0, microsecond=0)
        if slot > local:
            slot -= timedelta(days=1)
    elif cadence == "weekly":
        slot = local.replace(hour=SUMMARY_WEEKLY_HOUR, minute=0, second=0, microsecond=0)
        slot -= timedelta(days=(local.weekday() - SUMMARY_WEEKDAY) % 7)
        if slot > local:
            slot -= timedelta(days=7)
    else:
        return None
    return to_utc(prefs, slot)


# ── Wording ──────────────────────────────────────────────────────────
# The same for every official, party and state. No dashes.

def summary_title(count: int) -> str:
    if count == 1:
        return "1 update from an official you track"
    return f"{count} updates from officials you track"


def summary_body(names: list, *, quiet: bool) -> str:
    names = [n for n in names if n]
    if not names:
        who = "From officials you track"
    elif len(names) == 1:
        who = f"From {names[0]}"
    elif len(names) == 2:
        who = f"From {names[0]} and {names[1]}"
    else:
        who = f"From {names[0]}, {names[1]} and {len(names) - 2} more"
    return f"{who}, while your quiet hours were on." if quiet else f"{who}."


# ── The pass ─────────────────────────────────────────────────────────

def _still_unread(db, items) -> list:
    """Drop held updates whose bell row the person already read or
    cleared (bound devices only carry notification ids)."""
    from app.models.pages import Notification

    ids = [i.notification_id for i in items if i.notification_id]
    if not ids:
        return list(items)
    seen = {
        nid for (nid,) in db.query(Notification.id).filter(
            Notification.id.in_(ids),
            or_(Notification.read_at.isnot(None), Notification.cleared_at.isnot(None)),
        )
    }
    return [i for i in items if not i.notification_id or i.notification_id not in seen]


def _claim(db, device_id: int, threshold: datetime, now: datetime) -> tuple:
    """Stamp summary_sent_at only if no summary was claimed since
    threshold. Returns (claimed, previous value)."""
    from app.models.pages import DeviceToken

    previous = db.query(DeviceToken.summary_sent_at).filter(DeviceToken.id == device_id).scalar()
    n = (
        db.query(DeviceToken)
        .filter(
            DeviceToken.id == device_id,
            or_(DeviceToken.summary_sent_at.is_(None), DeviceToken.summary_sent_at < threshold),
        )
        .update({DeviceToken.summary_sent_at: now}, synchronize_session=False)
    )
    db.commit()
    return bool(n), previous


def _release(db, device_id: int, claimed_at: datetime, previous: Optional[datetime]) -> None:
    from app.models.pages import DeviceToken
    try:
        db.query(DeviceToken).filter(
            DeviceToken.id == device_id, DeviceToken.summary_sent_at == claimed_at,
        ).update({DeviceToken.summary_sent_at: previous}, synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("push summaries: could not release the claim on device %s", device_id)


def build_message(row, items) -> PushMessage:
    """One push for a device's held updates (newest first)."""
    items = sorted(items, key=lambda i: (i.created_at, i.id), reverse=True)
    if len(items) == 1:
        only = items[0]
        data = _parse_json_or_none(only.data_json) or {}
        return PushMessage(token=row.token, title=only.title, body=only.body, data=data,
                           ttl_seconds=SUMMARY_TTL_SECONDS)
    names: list = []
    for i in items:
        if i.official_name and i.official_name not in names:
            names.append(i.official_name)
    quiet = all(i.reason == "quiet" for i in items)
    data = {"kind": "tracked_summary", "count": len(items)}
    if row.citizen_id is None:
        # No bell on a signed-out device: open the newest update's page.
        data["official_id"] = items[0].official_id or ""
    return PushMessage(token=row.token, title=summary_title(len(items)),
                       body=summary_body(names, quiet=quiet), data=data,
                       ttl_seconds=SUMMARY_TTL_SECONDS)


def run_summaries(db, now_utc: Optional[datetime] = None) -> dict:
    """Send every summary that is due. Safe to run as often as you like
    and from two processes at once."""
    from app.models.pages import CitizenAccount, DeviceToken, PushHeldItem

    now = now_utc or datetime.utcnow()
    counts = {"devices_with_held": 0, "summaries_sent": 0, "updates_covered": 0, "already_read": 0,
              "waiting": 0, "claimed_elsewhere": 0, "failed": 0, "pruned": 0}
    device_ids = [d for (d,) in db.query(PushHeldItem.device_token_id).distinct()]
    counts["devices_with_held"] = len(device_ids)
    if not device_ids:
        return counts
    rows = {r.id: r for r in db.query(DeviceToken).filter(DeviceToken.id.in_(device_ids))}
    # Held rows whose device is gone (unregistered or pruned) go too.
    orphans = [d for d in device_ids if d not in rows]
    if orphans:
        db.query(PushHeldItem).filter(PushHeldItem.device_token_id.in_(orphans)).delete(
            synchronize_session=False)
        db.commit()
    account_prefs = {
        cid: _parse_json_or_none(blob)
        for cid, blob in db.query(CitizenAccount.id, CitizenAccount.notification_prefs_json).filter(
            CitizenAccount.id.in_({r.citizen_id for r in rows.values() if r.citizen_id is not None}))
    }

    for device_id, row in rows.items():
        prefs = device_prefs(row, account_prefs)
        if _in_quiet_hours(prefs, now):
            counts["waiting"] += 1
            continue
        cadence = effective_cadence(prefs)
        oldest = (
            db.query(PushHeldItem.created_at)
            .filter(PushHeldItem.device_token_id == device_id)
            .order_by(PushHeldItem.created_at.asc())
            .limit(1)
            .scalar()
        )
        if oldest is None:
            continue
        slot = last_slot_utc(cadence, prefs, now)
        if slot is not None and oldest > slot:
            counts["waiting"] += 1  # everything held arrived after the last summary time
            continue
        # Realtime (held by quiet hours): anything not claimed in the
        # last minute, so an update held while a summary was being sent
        # goes out on the next pass instead of waiting forever.
        threshold = slot if slot is not None else now - timedelta(seconds=60)
        claimed, previous = _claim(db, device_id, threshold, now)
        if not claimed:
            counts["claimed_elsewhere"] += 1
            continue
        items = (
            db.query(PushHeldItem)
            .filter(PushHeldItem.device_token_id == device_id, PushHeldItem.created_at <= now)
            .all()
        )
        fresh = _still_unread(db, items) if row.citizen_id is not None else list(items)
        counts["already_read"] += len(items) - len(fresh)
        if not fresh:
            db.query(PushHeldItem).filter(PushHeldItem.id.in_([i.id for i in items])).delete(
                synchronize_session=False)
            db.commit()
            continue
        message = build_message(row, fresh)
        result = send_push_messages([message])
        if row.token in result.invalid:
            db.query(PushHeldItem).filter(PushHeldItem.device_token_id == device_id).delete(
                synchronize_session=False)
            db.query(DeviceToken).filter(DeviceToken.id == device_id).delete(synchronize_session=False)
            db.commit()
            counts["pruned"] += 1
            continue
        if row.token not in result.sent:
            # Transient failure: keep everything for the next pass.
            _release(db, device_id, now, previous)
            counts["failed"] += 1
            continue
        db.query(PushHeldItem).filter(PushHeldItem.id.in_([i.id for i in items])).delete(
            synchronize_session=False)
        db.query(DeviceToken).filter(DeviceToken.id == device_id).update(
            {DeviceToken.last_push_at: now}, synchronize_session=False)
        db.commit()
        counts["summaries_sent"] += 1
        counts["updates_covered"] += len(fresh)
    if counts["summaries_sent"] or counts["failed"] or counts["pruned"]:
        logger.info("push summaries: %s", counts)
    return counts


# ── One-time migration ───────────────────────────────────────────────

def migrate_legacy_cadence(db) -> dict:
    """digest_cadence -> push_cadence in every stored prefs blob.
    'daily' (the silent default nobody chose) and anything other than
    'weekly' become 'realtime'; 'weekly' stays. Rows already converted
    have no digest_cadence, so a second run changes nothing."""
    from app.models.pages import CitizenAccount, DeviceToken

    out = {}
    for label, model, column in (("accounts", CitizenAccount, CitizenAccount.notification_prefs_json),
                                 ("devices", DeviceToken, DeviceToken.prefs_json)):
        tally = {"daily_to_realtime": 0, "weekly_kept": 0, "realtime_kept": 0, "other_to_realtime": 0}
        rows = db.query(model.id, column).filter(column.isnot(None), column.contains("digest_cadence")).all()
        for row_id, blob in rows:
            prefs = _parse_json_or_none(blob)
            if not isinstance(prefs, dict) or "digest_cadence" not in prefs:
                continue
            legacy = prefs.pop("digest_cadence")
            new = "weekly" if legacy == "weekly" else "realtime"
            if "push_cadence" not in prefs:
                prefs["push_cadence"] = new
            if legacy == "daily":
                tally["daily_to_realtime"] += 1
            elif legacy == "weekly":
                tally["weekly_kept"] += 1
            elif legacy == "realtime":
                tally["realtime_kept"] += 1
            else:
                tally["other_to_realtime"] += 1
            # Only if the row is unchanged since it was read, so a save
            # made a moment ago is never overwritten.
            db.query(model).filter(model.id == row_id, column == blob).update(
                {column: json.dumps(prefs, ensure_ascii=False)}, synchronize_session=False)
        db.commit()
        out[label] = tally
    if any(v for t in out.values() for v in t.values()):
        logger.info("push timing migration (digest_cadence -> push_cadence): %s", out)
    return out


def run_pass_with_session(first: bool = False) -> dict:
    """Loop entrypoint: own session and a cross-instance lock; never
    raises."""
    from app.db import SessionLocal
    from app.services.db_locks import AdvisoryLock

    lock = AdvisoryLock(LOCK_NAME)
    try:
        if not lock.try_acquire():
            return {"skipped": "another instance holds the lock"}
    except Exception:
        logger.exception("push summaries: lock failed; skipping this pass")
        return {"error": True}
    db = SessionLocal()
    try:
        result = {}
        if first:
            result["migration"] = migrate_legacy_cadence(db)
            from app.services.push_service import unsubscribe_announcements
            result["announcements_cleared"] = unsubscribe_announcements(db)
        result["summaries"] = run_summaries(db)
        return result
    except Exception:
        db.rollback()
        logger.exception("push summaries pass failed; it runs again at the next interval.")
        return {"error": True}
    finally:
        db.close()
        try:
            lock.release()
        except Exception:
            logger.debug("push summaries: lock release failed", exc_info=True)
