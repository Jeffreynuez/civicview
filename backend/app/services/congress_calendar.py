# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Which Congress, and which session of it, is sitting on a given day.

Under the Twentieth Amendment a Congress begins at noon on January 3 of
an odd-numbered year and runs two years, and each yearly session begins
on January 3 unless Congress sets another day by law. The 119th Congress
began on January 3, 2025; the 120th begins at noon Eastern on January
3, 2027. Every January the switch happens here, from the date, so no
hard-coded number has to be changed by hand.

Noon Eastern on January 3 is 17:00 UTC (January is always standard
time), so the boundary needs no time zone database. A plain `date`
counts January 3 as the first day of the new session.

frontend/lib/congress.js mirrors these rules for the browser.
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Optional, Union

FIRST_CONGRESS_YEAR = 1789
# Noon Eastern Standard Time on January 3, in UTC.
_SWEARING_IN_HOUR_UTC = 17

When = Optional[Union[date, datetime]]


def _now() -> datetime:
    """The current time in UTC. Tests replace this to stand on either
    side of a January 3."""
    return datetime.now(UTC)


def _session_year(when: When = None) -> int:
    """The calendar year whose session is sitting on `when`: the
    previous year until the new session opens on January 3."""
    if when is None:
        when = _now()
    if isinstance(when, datetime):
        if when.tzinfo is not None:
            when = when.astimezone(UTC).replace(tzinfo=None)
        opened = (when.month, when.day, when.hour) >= (1, 3, _SWEARING_IN_HOUR_UTC)
    else:
        opened = (when.month, when.day) >= (1, 3)
    return when.year if opened else when.year - 1


def current_congress(when: When = None) -> int:
    """The number of the Congress sitting on `when` (default: now)."""
    return (_session_year(when) - FIRST_CONGRESS_YEAR) // 2 + 1


def current_congress_session(when: When = None) -> tuple[int, int]:
    """(congress, session) sitting on `when`: session 1 in the odd
    year, session 2 in the even year."""
    year = _session_year(when)
    return (year - FIRST_CONGRESS_YEAR) // 2 + 1, (1 if year % 2 == 1 else 2)


def congress_start(congress: int) -> date:
    """The day a Congress is seated (January 3 of its first year)."""
    return date(FIRST_CONGRESS_YEAR + 2 * (int(congress) - 1), 1, 3)


def ordinal(n: int) -> str:
    """119 -> "119th", 121 -> "121st", as Census layer names spell it."""
    n = int(n)
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
