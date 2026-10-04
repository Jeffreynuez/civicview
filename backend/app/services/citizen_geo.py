# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
A citizen's state and congressional district: the one format every
part of the app stores and compares (2026-10-03).

Jeffrey: "no one that creates a demo account should not have a state
and district. The only thing they can forgo is not having their city
or county." So every citizen account carries a state and a House
district in that state, and engagement waits until it does
(entitlements.require_location).

The format
    "FL-17"  a numbered House seat: state, dash, the number (no zero pad)
    "WY-AL"  the one seat of an at-large state, and the delegate of DC
             and each territory

Before this module, at-large seats had three spellings: the sign-up
form stored "WY-1", the officials index built "WY-0" from the
legislators roster, and the address lookup returned "At-Large". A
citizen and their own representative never matched. normalize_district
reads all of those and returns the one canonical form.

HOUSE_SEATS is the 119th Congress apportionment. The frontend keeps the
same table in frontend/lib/usStates.js; change both together after the
2030 census.
"""
from __future__ import annotations

import re
from typing import Optional

AT_LARGE = "AL"

HOUSE_SEATS: dict[str, int] = {
    "AL": 7, "AK": 1, "AZ": 9, "AR": 4, "CA": 52, "CO": 8, "CT": 5, "DE": 1,
    "FL": 28, "GA": 14, "HI": 2, "ID": 2, "IL": 17, "IN": 9, "IA": 4, "KS": 4,
    "KY": 6, "LA": 6, "ME": 2, "MD": 8, "MA": 9, "MI": 13, "MN": 8, "MS": 4,
    "MO": 8, "MT": 2, "NE": 3, "NV": 4, "NH": 2, "NJ": 12, "NM": 3, "NY": 26,
    "NC": 14, "ND": 1, "OH": 15, "OK": 5, "OR": 6, "PA": 17, "RI": 2, "SC": 7,
    "SD": 1, "TN": 9, "TX": 38, "UT": 4, "VT": 1, "VA": 11, "WA": 10, "WV": 2,
    "WI": 8, "WY": 1,
    # DC and the territories each send one non-voting delegate, elected
    # by the whole jurisdiction: the same shape as an at-large state.
    "DC": 1, "AS": 1, "GU": 1, "MP": 1, "PR": 1, "VI": 1,
}

VALID_STATES = frozenset(HOUSE_SEATS)

# Spellings of "the whole state" seen across the app's data sources:
# the address lookup ("At-Large"), the Census geocoder ("00", "98" for a
# delegate), the legislators roster (0), and the old sign-up form ("1").
_AT_LARGE_TOKENS = frozenset({"AL", "AT-LARGE", "ATLARGE", "AT LARGE", "0", "00", "98"})

_DIGITS = re.compile(r"^\d{1,3}$")


def normalize_state(raw: object) -> Optional[str]:
    """Two-letter code for a state, DC or territory, or None."""
    code = str(raw or "").strip().upper()
    return code if code in VALID_STATES else None


def is_at_large(state: object) -> bool:
    """True when the state elects its whole House delegation as one seat."""
    code = normalize_state(state)
    return bool(code) and HOUSE_SEATS[code] == 1


def normalize_district(state: object, raw: object) -> Optional[str]:
    """The canonical district for `raw` in `state`, or None when it is
    not a real House seat there.

        ("FL", "17") -> "FL-17"      ("FL", "fl-07") -> "FL-7"
        ("WY", "1")  -> "WY-AL"      ("WY", "WY-0") -> "WY-AL"
        ("WY", "At-Large") -> "WY-AL"
        ("FL", "29") -> None         ("FL", "GA-3") -> None
    """
    st = normalize_state(state)
    if not st:
        return None
    s = re.sub(r"\s+", " ", str(raw or "").strip().upper())
    if not s:
        return None
    if s in _AT_LARGE_TOKENS or _DIGITS.match(s):
        rest = s
    elif "-" in s:
        prefix, rest = s.split("-", 1)
        if prefix.strip() != st:
            return None
        rest = rest.strip()
    else:
        return None

    seats = HOUSE_SEATS[st]
    if seats == 1:
        if rest in _AT_LARGE_TOKENS or rest in ("1", "01", "001"):
            return f"{st}-{AT_LARGE}"
        return None
    if _DIGITS.match(rest):
        n = int(rest)
        if 1 <= n <= seats:
            return f"{st}-{n}"
    return None


def house_district(state: object, number: object) -> Optional[str]:
    """District for a House member from a data source that gives a
    number (the legislators roster uses 0 for at-large seats)."""
    st = normalize_state(state)
    if not st:
        return None
    if HOUSE_SEATS[st] == 1:
        return f"{st}-{AT_LARGE}"
    return normalize_district(st, number)


def needs_location(citizen) -> bool:
    """True when the account has no valid state and district yet.
    Such an account can browse but not engage until it picks one."""
    if citizen is None:
        return False
    state = getattr(citizen, "state", None)
    return normalize_district(state, getattr(citizen, "congressional_district", None)) is None
