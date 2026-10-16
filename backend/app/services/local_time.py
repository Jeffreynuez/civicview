# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Times in the recipient's own clock (2026-10-16).

Event pushes and the weekly digest used to print times in UTC. They now
use the recipient's tz_offset_minutes (minutes east of UTC, which the
app sends with their notification settings) and, when there is none,
Eastern time with "ET" after the time so nobody reads it as their own.

Wording matches the election reminders: "Sat, Oct 17, 6 p.m.",
"Sat, Oct 17, 6:30 p.m. ET", "noon".
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional, Union

EASTERN = "America/New_York"


def tz_offset(prefs: Union[dict, str, None]) -> Optional[int]:
    """A usable tz_offset_minutes from a prefs dict or JSON blob."""
    if isinstance(prefs, str):
        try:
            prefs = json.loads(prefs)
        except (ValueError, TypeError):
            return None
    if not isinstance(prefs, dict):
        return None
    tz = prefs.get("tz_offset_minutes")
    if isinstance(tz, int) and not isinstance(tz, bool) and abs(tz) <= 14 * 60:
        return tz
    return None


def parse_utc(value) -> Optional[datetime]:
    """A naive UTC datetime from a datetime (naive = UTC) or an ISO
    string ("2026-10-17T22:00:00.000Z", "+00:00" or naive)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def to_local(dt_utc: datetime, prefs) -> tuple:
    """(local naive datetime, zone label): the label is "" for the
    person's own offset and "ET" for the Eastern fallback."""
    tz = tz_offset(prefs)
    if tz is not None:
        return dt_utc + timedelta(minutes=tz), ""
    from zoneinfo import ZoneInfo
    local = dt_utc.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(EASTERN)).replace(tzinfo=None)
    return local, "ET"


def clock(local: datetime) -> str:
    h, m = local.hour, local.minute
    if h == 12 and m == 0:
        return "noon"
    suffix = "a.m." if h < 12 else "p.m."
    h12 = h % 12 or 12
    return f"{h12} {suffix}" if m == 0 else f"{h12}:{m:02d} {suffix}"


def date_label(local: datetime) -> str:
    return f"{local.strftime('%a, %b')} {local.day}"


def format_when(value, prefs, *, with_time: bool = True) -> str:
    """"Sat, Oct 17, 6 p.m." in the recipient's time, "... ET" when it
    is the Eastern fallback; the date alone when with_time is False.
    An unparseable value comes back as it was."""
    dt = parse_utc(value)
    if dt is None:
        return str(value or "")
    local, zone = to_local(dt, prefs)
    if not with_time:
        return date_label(local)
    text = f"{date_label(local)}, {clock(local)}"
    return f"{text} {zone}" if zone else text
