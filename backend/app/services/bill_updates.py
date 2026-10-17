# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Bill updates (2026-10-17): a daily server pass over the federal bills
people track.

Until now a tracked bill was only re-checked in the browser, by hand or
when the home page loaded. Once a day this pass asks Congress.gov
(api.congress.gov v3, the official source) about every bill someone
tracks and tells its trackers when something new happened:

  * a status change: passed a chamber, sent to the President, signed,
    became law, vetoed, failed;
  * a recorded vote;
  * any other new action (referred, reported, a hearing).

Federal bills only (Jeffrey, 2026-10-17): state bills cannot be tracked
yet, so nothing here or in the app promises state bill alerts.

How:
  * One request per bill per pass (/bill/{congress}/{type}/{number}),
    however many people track it (bill_watch holds what the pass last
    saw), and one more (/actions) only for a bill whose latest action
    changed. Two requests at a time.
  * The first time the pass sees a bill it records its state and sends
    nothing (no backlog).
  * Each change becomes one bill_updates row listing up to three new
    actions. Each tracker gets it once: a bill_update_deliveries row is
    claimed (unique per update and person) before the bell row, the
    push and the email.
  * The notification settings decide (Bill updates row): bell and push
    by default, email if chosen. The push follows quiet hours and the
    "Push alerts" timing; a newer update on the same bill replaces the
    older one in the tray (tag bill-<key>). Email: one per pass per
    person listing every bill that changed, with a one-click
    unsubscribe that turns off only these emails.
  * The tracked bill's status in My Tracked is refreshed for everyone
    tracking it.

When: once a day after RUN_HOUR_ET (9 a.m. Eastern), claimed per day in
job_runs, in its own loop off the boot path, under a database advisory
lock. On by default in production only; BILL_UPDATES_ENABLED=true or
false overrides that. Needs CONGRESS_API_KEY (Render). Admin:
GET /api/admin/bill-updates shows what it watches and what it found;
POST /api/admin/bill-updates/run runs a pass now.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Awaitable, Callable, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)

ENV_FLAG = "BILL_UPDATES_ENABLED"
JOB = "bill-updates"
LOCK_NAME = "bill-updates"
RUN_HOUR_ET = 9
FIRST_PASS_DELAY_SECONDS = 180
LOOP_INTERVAL_SECONDS = 15 * 60
# Congress.gov allows 5,000 requests an hour; a pass uses one per bill,
# two for a bill that changed.
MAX_BILLS_PER_PASS = 1500
CONCURRENCY = 2
MAX_ACTIONS_LISTED = 3
NOTIFICATION_KIND = "bill_update"

_KEY_RE = re.compile(r"^(\d{2,3})-(hr|s|hjres|sjres|hconres|sconres|hres|sres)-(\d{1,5})$")
_PRETTY = {"HR": "H.R.", "S": "S.", "HJRES": "H.J.Res.", "SJRES": "S.J.Res.",
           "HCONRES": "H.Con.Res.", "SCONRES": "S.Con.Res.", "HRES": "H.Res.", "SRES": "S.Res."}
_SLUG = {"HR": "house-bill", "S": "senate-bill", "HJRES": "house-joint-resolution",
         "SJRES": "senate-joint-resolution", "HCONRES": "house-concurrent-resolution",
         "SCONRES": "senate-concurrent-resolution", "HRES": "house-resolution",
         "SRES": "senate-resolution"}
# A status change, read from Congress.gov's action text or type.
_STATUS_RE = re.compile(
    r"became (public|private) law|signed by (the )?president|presented to (the )?president"
    r"|vetoed|veto message|pocket veto|\bpassed\b|agreed to|\bfailed\b|resolving differences"
    r"|cleared for (the )?white house",
    re.IGNORECASE,
)
_STATUS_TYPES = {"BecameLaw", "President", "Veto"}
_KIND_ORDER = {"status": 3, "vote": 2, "action": 1}
_KIND_WORDS = {"status": "status change", "vote": "recorded vote", "action": "new action"}


def updates_enabled() -> bool:
    """BILL_UPDATES_ENABLED=true / false when set; otherwise on in
    production only, like the roll-call sync, so a test or a local run
    never calls Congress.gov on its own."""
    raw = (os.getenv(ENV_FLAG) or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    from app.services.runtime_env import is_production

    return is_production()


def parse_key(key: str):
    """(congress, type, number) for a federal bill key, else None."""
    m = _KEY_RE.match((key or "").strip().lower())
    if not m:
        return None
    return int(m.group(1)), m.group(2), m.group(3)


def citation_for(bill_type: str, number) -> str:
    t = (bill_type or "").upper()
    return f"{_PRETTY.get(t, t)} {number}"


def public_url(congress: int, bill_type: str, number) -> Optional[str]:
    slug = _SLUG.get((bill_type or "").upper())
    if not slug:
        return None
    return f"https://www.congress.gov/bill/{congress}th-congress/{slug}/{number}"


def classify(action: dict) -> str:
    """status (passed, sent to the President, signed, became law,
    vetoed, failed) before vote (a recorded vote on anything else, such
    as cloture), before any other action."""
    if action.get("type") in _STATUS_TYPES or _STATUS_RE.search(action.get("text") or ""):
        return "status"
    if action.get("recordedVotes"):
        return "vote"
    return "action"


def _action_key(a: dict) -> str:
    return f"{a.get('actionDate') or ''}|{(a.get('text') or '').strip()}"


def new_actions(actions: list, last_date: Optional[str], seen: set) -> list:
    """Actions newer than what the pass last saw, newest first, one per
    date and text (Congress.gov lists an action once per chamber's
    record)."""
    out, keys = [], set()
    for a in actions or []:
        date = a.get("actionDate") or ""
        key = _action_key(a)
        if key in keys:
            continue
        if last_date and (date < last_date or (date == last_date and key in seen)):
            continue
        keys.add(key)
        out.append(a)
    out.sort(key=lambda a: a.get("actionDate") or "", reverse=True)
    return out


# ── Congress.gov ─────────────────────────────────────────────────────

_SERVICE = None


def _congress():
    global _SERVICE
    if _SERVICE is None:
        from app.services.congress_service import CongressService
        _SERVICE = CongressService()
    return _SERVICE


async def fetch_bill(congress: int, bill_type: str, number: str) -> Optional[dict]:
    """{title, latest_date, latest_text} from Congress.gov, or None."""
    data = await _congress()._api_get(f"/bill/{congress}/{bill_type}/{number}")
    if not data or "bill" not in data:
        return None
    b = data["bill"]
    action = b.get("latestAction") or {}
    return {"title": b.get("title") or "", "latest_date": action.get("actionDate") or "",
            "latest_text": action.get("text") or ""}


async def fetch_actions(congress: int, bill_type: str, number: str) -> list:
    data = await _congress()._api_get(f"/bill/{congress}/{bill_type}/{number}/actions", {"limit": 50})
    return list((data or {}).get("actions") or [])


Fetcher = Callable[[int, str, str], Awaitable[Optional[dict]]]
ActionsFetcher = Callable[[int, str, str], Awaitable[list]]


# ── The pass ─────────────────────────────────────────────────────────

def tracked_keys(db) -> list:
    """Every federal bill key at least one citizen tracks."""
    from app.models.pages import TrackedBill

    keys = {k.strip().lower() for (k,) in db.query(TrackedBill.bill_key).filter(
        TrackedBill.tracker_kind == "citizen").distinct() if k}
    return sorted(k for k in keys if parse_key(k))


def _watch_rows(db, keys: list) -> dict:
    from app.models.pages import BillWatch

    out = {}
    for i in range(0, len(keys), 900):
        for row in db.query(BillWatch).filter(BillWatch.bill_key.in_(keys[i:i + 900])):
            out[row.bill_key] = row
    return out


def _seen(row) -> set:
    try:
        val = json.loads(row.seen_json or "[]") if getattr(row, "seen_json", None) else []
    except (ValueError, TypeError):
        val = []
    return set(val) if isinstance(val, list) else set()


async def check_bills(keys_and_last: list, *, fetch: Fetcher = fetch_bill,
                      fetch_acts: ActionsFetcher = fetch_actions) -> dict:
    """Ask Congress.gov about each bill. keys_and_last: [(key, last
    latest date, last latest text, already seen action keys)]. Returns
    {key: {"bill": ..., "actions": [...] or None, "error": bool}}."""
    sem = asyncio.Semaphore(CONCURRENCY)
    results: dict = {}

    async def one(key, last_date, last_text):
        congress, bill_type, number = parse_key(key)
        async with sem:
            try:
                bill = await fetch(congress, bill_type, number)
            except Exception:
                logger.warning("bill updates: fetch failed for %s", key, exc_info=True)
                bill = None
            if bill is None:
                results[key] = {"error": True}
                return
            changed = (bill["latest_date"], bill["latest_text"]) != (last_date or "", last_text or "")
            actions = None
            if changed and last_date is not None:
                try:
                    actions = await fetch_acts(congress, bill_type, number)
                except Exception:
                    logger.warning("bill updates: actions failed for %s", key, exc_info=True)
                    actions = None
            results[key] = {"bill": bill, "actions": actions, "error": False}

    await asyncio.gather(*(one(k, d, t) for k, d, t, _s in keys_and_last))
    return results


def _now_et(now_utc: datetime) -> datetime:
    from zoneinfo import ZoneInfo
    from datetime import timezone
    return now_utc.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("America/New_York")).replace(tzinfo=None)


def due_run_key(db, now_utc: Optional[datetime] = None) -> Optional[str]:
    """Today's run key (the Eastern date) when today's pass is due and
    not yet claimed, else None."""
    from app.models.pages import JobRun

    now_et = _now_et(now_utc or datetime.utcnow())
    if now_et.hour < RUN_HOUR_ET:
        return None
    key = now_et.date().isoformat()
    done = db.query(JobRun.id).filter(JobRun.job == JOB, JobRun.run_key == key).first()
    return None if done else key


def claim_run(db, run_key: str) -> Optional[int]:
    from app.models.pages import JobRun

    row = JobRun(job=JOB, run_key=run_key)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return row.id


def _finish_run(db, run_id: Optional[int], summary: dict) -> None:
    from app.models.pages import JobRun

    if run_id is None:
        return
    db.query(JobRun).filter(JobRun.id == run_id).update(
        {JobRun.finished_at: datetime.utcnow(), JobRun.summary_json: json.dumps(summary)},
        synchronize_session=False)
    db.commit()


def plan(db) -> list:
    """[(key, last date, last text, seen)] for the bills to check this
    pass, least recently checked first."""
    keys = tracked_keys(db)
    watch = _watch_rows(db, keys)

    def order(k):
        row = watch.get(k)
        return (row is not None, (row.checked_at or datetime.min) if row is not None else datetime.min)

    out = []
    for k in sorted(keys, key=order)[:MAX_BILLS_PER_PASS]:
        row = watch.get(k)
        if row is None:
            out.append((k, None, None, set()))
        else:
            out.append((k, row.latest_action_date or "", row.latest_action_text or "", _seen(row)))
    return out


def _trackers(db, key: str) -> list:
    from app.models.pages import CitizenAccount, TrackedBill

    ids = {tid for (tid,) in db.query(TrackedBill.tracker_id).filter(
        TrackedBill.tracker_kind == "citizen", func.lower(TrackedBill.bill_key) == key)}
    if not ids:
        return []
    return sorted(cid for (cid,) in db.query(CitizenAccount.id).filter(
        CitizenAccount.id.in_(list(ids)),
        CitizenAccount.is_active.is_(True),
        CitizenAccount.suspended_at.is_(None),
        CitizenAccount.self_deleted_at.is_(None),
    ))


def _refresh_snapshots(db, key: str, info: dict) -> None:
    """My Tracked shows the bill's latest action for everyone tracking it."""
    from app.models.pages import TrackedBill

    for row in db.query(TrackedBill).filter(func.lower(TrackedBill.bill_key) == key):
        try:
            snap = json.loads(row.snapshot_json or "{}")
        except (ValueError, TypeError):
            snap = {}
        if not isinstance(snap, dict):
            snap = {}
        snap.update({
            "latest_action": info["latest_text"],
            "latest_action_date": info["latest_date"],
            "last_change_seen_at": datetime.utcnow().isoformat(),
        })
        row.snapshot_json = json.dumps(snap, ensure_ascii=False)


def headline(update: dict) -> str:
    return f"{update['citation']}: {_KIND_WORDS[update['change_kind']]}"


def deliver(db, update_row, update: dict, emails: dict) -> dict:
    """Claim, bell row and push for each tracker; collect emails."""
    from app.models.pages import BillUpdateDelivery, Notification
    from app.services import alert_settings
    from app.services.push_service import push_to_citizens

    counts = {"claimed": 0, "already": 0, "bell": 0, "pushed_devices": 0}
    trackers = _trackers(db, update["bill_key"])
    bell_ids = alert_settings.wanting(db, trackers, "bills", alert_settings.BELL)
    push_ids = alert_settings.wanting(db, trackers, "bills", alert_settings.PUSH) & bell_ids
    email_ids = alert_settings.wanting(db, trackers, "bills", alert_settings.EMAIL) & bell_ids
    payload = json.dumps({k: update[k] for k in (
        "bill_key", "citation", "title", "change_kind", "action", "action_date", "more", "url")},
        ensure_ascii=False)
    notification_ids = {}
    for cid in sorted(bell_ids):
        claim = BillUpdateDelivery(update_id=update_row.id, citizen_id=cid)
        db.add(claim)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            counts["already"] += 1
            continue
        counts["claimed"] += 1
        note = Notification(recipient_kind="citizen", recipient_id=cid, kind=NOTIFICATION_KIND,
                            payload_json=payload)
        db.add(note)
        db.flush()
        claim.notification_id = note.id
        db.commit()
        notification_ids[cid] = note.id
        counts["bell"] += 1
        if cid in email_ids:
            emails.setdefault(cid, []).append((claim.id, update))
    to_push = sorted(cid for cid in push_ids if cid in notification_ids)
    if to_push:
        body = update["action"]
        if update["more"]:
            body += f" (and {update['more']} more)"
        counts["pushed_devices"] = push_to_citizens(
            db, to_push, title=headline(update), body=body,
            data={"kind": NOTIFICATION_KIND, "bill_key": update["bill_key"]},
            channel="bills", tag=f"bill-{update['bill_key']}",
            official_name=update["citation"], notification_ids=notification_ids, timing=True,
        )
    return counts


def apply_results(db, checked: list, results: dict, now: Optional[datetime] = None) -> tuple:
    """Record what Congress.gov said and deliver the changes. Returns
    (summary, emails) where emails is {citizen_id: [(claim id, update)]}."""
    from app.models.pages import BillUpdate, BillWatch

    now = now or datetime.utcnow()
    summary = {"checked": 0, "errors": 0, "seeded": 0, "unchanged": 0, "updates": 0,
               "bell": 0, "pushed_devices": 0}
    emails: dict = {}
    watch = _watch_rows(db, [k for k, *_rest in checked])
    for key, last_date, _last_text, seen in checked:
        res = results.get(key) or {"error": True}
        row = watch.get(key)
        if res.get("error"):
            summary["errors"] += 1
            if row is not None:
                row.error_count = (row.error_count or 0) + 1
                row.checked_at = now
                db.commit()
            continue
        summary["checked"] += 1
        info = res["bill"]
        congress, bill_type, number = parse_key(key)
        citation = citation_for(bill_type, number)
        if row is None:
            # First look: record, send nothing (no backlog).
            row = BillWatch(bill_key=key, citation=citation, title=info["title"][:2000],
                            latest_action_date=info["latest_date"], latest_action_text=info["latest_text"],
                            url=public_url(congress, bill_type, number), checked_at=now, error_count=0)
            row.seen_json = json.dumps([f"{info['latest_date']}|{info['latest_text'].strip()}"])
            db.add(row)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()  # another instance seeded it a moment ago
            summary["seeded"] += 1
            continue
        row.checked_at = now
        row.error_count = 0
        if (info["latest_date"], info["latest_text"]) == (last_date or "", _last_text or ""):
            db.commit()
            summary["unchanged"] += 1
            continue
        actions = res.get("actions")
        fresh = new_actions(actions, last_date, seen) if actions else []
        if not fresh:
            fresh = [{"actionDate": info["latest_date"], "text": info["latest_text"]}]
        kinds = [classify(a) for a in fresh]
        change_kind = max(kinds, key=lambda k: _KIND_ORDER[k])
        newest = fresh[0]
        listed = fresh[:MAX_ACTIONS_LISTED]
        update = {
            "bill_key": key,
            "citation": citation,
            "title": (info["title"] or row.title or "")[:300],
            "change_kind": change_kind,
            "action": (newest.get("text") or "").strip()[:300],
            "action_date": newest.get("actionDate") or "",
            "actions": [{"date": a.get("actionDate") or "", "text": (a.get("text") or "").strip()[:300],
                         "kind": classify(a)} for a in listed],
            "more": max(0, len(fresh) - 1),
            "url": row.url or public_url(congress, bill_type, number),
        }
        row.title = info["title"][:2000] or row.title
        row.latest_action_date = info["latest_date"]
        row.latest_action_text = info["latest_text"]
        row.changed_at = now
        same_day = {_action_key(a) for a in (actions or fresh) if (a.get("actionDate") or "") == info["latest_date"]}
        same_day.add(f"{info['latest_date']}|{info['latest_text'].strip()}")
        row.seen_json = json.dumps(sorted(same_day)[:50])
        _refresh_snapshots(db, key, info)
        update_row = BillUpdate(bill_key=key, change_kind=change_kind, action_date=update["action_date"],
                                payload_json=json.dumps(update, ensure_ascii=False))
        db.add(update_row)
        db.commit()
        summary["updates"] += 1
        got = deliver(db, update_row, update, emails)
        summary["bell"] += got["bell"]
        summary["pushed_devices"] += got["pushed_devices"]
    return summary, emails


# ── Email ────────────────────────────────────────────────────────────

EMAIL_FOOTER = ("You get this email because you chose email for Bill updates in your CivicView notification "
                "settings. Change it there, or turn these emails off with one click:")


def render_email(updates: list, unsubscribe_url: Optional[str] = None,
                 app_url: str = "https://civicview.app") -> tuple:
    """(subject, html, text) for one person's bill updates of one pass."""
    if len(updates) == 1:
        subject = f"Update on {updates[0]['citation']}"
    else:
        subject = f"Updates on {len(updates)} bills you track"
    lines_text, lines_html = [], []
    for u in updates:
        head = f"{u['citation']}: {u['title']}" if u.get("title") else u["citation"]
        lines_text.append(head)
        items_html = []
        for a in u.get("actions") or [{"date": u["action_date"], "text": u["action"]}]:
            when = f"{a['date']}: " if a.get("date") else ""
            lines_text.append(f"  {when}{a['text']}")
            items_html.append(f"<li>{html.escape(when + a['text'])}</li>")
        if u.get("more", 0) + 1 > len(u.get("actions") or []):
            lines_text.append("  More actions on Congress.gov.")
        if u.get("url"):
            lines_text.append(f"  {u['url']}")
        lines_text.append("")
        link = (f' <a href="{html.escape(u["url"])}" style="color:#2d6a4f;">Congress.gov</a>'
                if u.get("url") else "")
        lines_html.append(
            f'<div style="margin:0 0 16px;"><div style="font-weight:700;color:#1b263b;">{html.escape(head)}</div>'
            f'<ul style="margin:6px 0 0 18px;padding:0;color:#374151;">{"".join(items_html)}</ul>'
            f'<div style="font-size:13px;margin-top:4px;">{link}</div></div>'
        )
    tracked_url = f"{app_url}/?open=tracked"
    text = ("New on the bills you track, from Congress.gov:\n\n" + "\n".join(lines_text)
            + f"See them in My Tracked: {tracked_url}\n\n{EMAIL_FOOTER} {unsubscribe_url or ''}\n")
    unsub = (f' <a href="{html.escape(unsubscribe_url)}" style="color:#9ca3af;">Unsubscribe</a>.'
             if unsubscribe_url else "")
    body = (
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827;">'
        '<p style="font-size:15px;">New on the bills you track, from Congress.gov:</p>'
        + "".join(lines_html)
        + f'<p><a href="{tracked_url}" style="color:#2d6a4f;font-weight:700;">See them in My Tracked</a></p>'
        f'<p style="font-size:12px;color:#9ca3af;">{html.escape(EMAIL_FOOTER)}{unsub}</p></div>'
    )
    return subject, body, text


def send_emails(db, emails: dict) -> int:
    """One email per person for the pass. Never to a demo address."""
    from app.models.pages import BillUpdateDelivery, CitizenAccount
    from app.services import email_unsubscribe
    from app.services.digest_service import is_demo_email
    from app.services.email_service import get_email_service

    if not emails:
        return 0
    svc = get_email_service()
    sent = 0
    for cid, items in emails.items():
        acct = db.get(CitizenAccount, cid)
        address = (getattr(acct, "email", None) or "").strip()
        if not address or is_demo_email(address):
            continue
        unsub = email_unsubscribe.links("citizen", cid, "bill_updates")
        subject, html_body, text_body = render_email([u for _c, u in items], unsubscribe_url=unsub["page_url"])
        if svc.send(to=address, subject=subject, text_body=text_body, html_body=html_body,
                    headers=unsub["headers"]):
            sent += 1
            db.query(BillUpdateDelivery).filter(BillUpdateDelivery.id.in_([c for c, _u in items])).update(
                {BillUpdateDelivery.email_sent_at: datetime.utcnow()}, synchronize_session=False)
            db.commit()
    return sent


LAST_PASS: dict = {}


async def run_pass(*, force: bool = False, now_utc: Optional[datetime] = None,
                   fetch: Fetcher = fetch_bill, fetch_acts: ActionsFetcher = fetch_actions) -> dict:
    """One pass when today's is due (or force=True, the admin's Run
    now). Never raises. Returns a summary."""
    from app.db import SessionLocal
    from app.services.db_locks import AdvisoryLock

    if fetch is fetch_bill and not os.getenv("CONGRESS_API_KEY"):
        return {"skipped": "CONGRESS_API_KEY is not set"}
    lock = AdvisoryLock(LOCK_NAME)
    try:
        if not lock.try_acquire():
            return {"skipped": "another instance holds the lock"}
    except Exception:
        logger.exception("bill updates: lock failed; skipping this pass")
        return {"error": True}
    db = SessionLocal()
    run_id = None
    try:
        now = now_utc or datetime.utcnow()
        if force:
            run_key = "manual-" + datetime.utcnow().strftime("%Y%m%dT%H%M%S%f")
        else:
            run_key = due_run_key(db, now)
            if run_key is None:
                return {"skipped": "not due"}
        run_id = claim_run(db, run_key)
        if run_id is None:
            return {"skipped": "already run"}
        checked = plan(db)
        results = await check_bills([(k, d, t, s) for k, d, t, s in checked], fetch=fetch, fetch_acts=fetch_acts)
        summary, emails = await asyncio.to_thread(_apply_with_session, checked, results, now)
        summary["emails_sent"] = await asyncio.to_thread(_emails_with_session, emails)
        summary["run_key"] = run_key
        _finish_run(db, run_id, summary)
        LAST_PASS.clear()
        LAST_PASS.update({"at": now.isoformat(), **summary})
        logger.info("bill updates pass: %s", summary)
        return summary
    except Exception:
        db.rollback()
        logger.exception("bill updates pass failed; tomorrow's pass carries on")
        return {"error": True}
    finally:
        db.close()
        try:
            lock.release()
        except Exception:
            logger.debug("bill updates: lock release failed", exc_info=True)


def _apply_with_session(checked, results, now):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        return apply_results(db, checked, results, now)
    finally:
        db.close()


def _emails_with_session(emails):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        return send_emails(db, emails)
    finally:
        db.close()


def status(db) -> dict:
    """For the admin: what is watched and what the last passes found."""
    from app.models.pages import BillUpdate, BillWatch, JobRun

    runs = (db.query(JobRun).filter(JobRun.job == JOB).order_by(JobRun.id.desc()).limit(7).all())
    recent = (db.query(BillUpdate).order_by(BillUpdate.id.desc()).limit(20).all())
    since = datetime.utcnow() - timedelta(days=7)
    return {
        "enabled": updates_enabled(),
        "api_key_set": bool(os.getenv("CONGRESS_API_KEY")),
        "run_hour_et": RUN_HOUR_ET,
        "tracked_bills": len(tracked_keys(db)),
        "watched_bills": db.query(func.count(BillWatch.id)).scalar() or 0,
        "updates_last_7_days": db.query(func.count(BillUpdate.id)).filter(BillUpdate.created_at >= since).scalar() or 0,
        "runs": [{"run_key": r.run_key, "started_at": r.started_at.isoformat() if r.started_at else None,
                  "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                  "summary": json.loads(r.summary_json) if r.summary_json else None} for r in runs],
        "recent_updates": [{"bill_key": u.bill_key, "change_kind": u.change_kind, "action_date": u.action_date,
                            "created_at": u.created_at.isoformat() if u.created_at else None,
                            "action": (json.loads(u.payload_json or "{}").get("action") or "")}
                           for u in recent],
    }
