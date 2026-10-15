# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Congress Selection Metadata
Injects `selection_method`, `selection_detail`, and `normally_elected` onto
Congress-member payloads so the frontend can render an "ELECTED" / "APPOINTED"
badge consistently with state + local officials.

Defaults:
  - House: always "elected" (every sitting U.S. Representative won an election).
  - Senate: "elected" unless the bioguide_id is in the APPOINTED overrides map.

When a governor appoints a senator to fill a vacancy until the next election,
we mark them:
    selection_method   = "appointed"
    normally_elected   = True         # the seat is normally filled by voters
    selection_detail   = free-text explanation

Every other appointee is marked from the legislators-current roster
itself: its term entry carries "how": "appointment", with the start date
(the oath, matching senate.gov's "Appointed Senators" table) and how the
appointment ends ("end-type": "special-election", or the end of the
term). congress_service copies that onto the member as `appointment`.
Until 2026-10-15 only the one curated entry below existed, so Jon Husted
(OH), Alan Armstrong (OK) and Darline Graham (SC) were reported as
elected. The curated entries still win when present.
"""
import datetime as _dt

# Bioguide ID → override dict.
# Use UPPERCASE IDs — Congress.gov returns them uppercase.
APPOINTED_SENATORS: dict[str, dict] = {
    # Ashley Moody (R-FL): appointed by Gov. DeSantis to fill the seat Marco
    # Rubio vacated to become U.S. Secretary of State. senate.gov's
    # "Appointed Senators" table gives January 21, 2025 for both the
    # appointment and the oath, and moody.senate.gov says she "was sworn
    # into the United States Senate on January 21, 2025, after being
    # appointed by Governor Ron DeSantis" (checked 2026-10-15; the text
    # here used to say January 16, the day the choice was announced).
    "M001244": {
        "selection_method": "appointed",
        "normally_elected": True,
        "selection_detail": (
            "Appointed by Gov. Ron DeSantis and sworn in on January 21, 2025 "
            "to fill the seat vacated by Marco Rubio. Must stand in a special "
            "election in 2026 to keep the seat."
        ),
    },
}

# Secondary lookup: (state_code, last_name.lower()) → override dict.
# Used when we don't have a reliable bioguide ID for the appointee yet.
APPOINTED_BY_STATE_LAST: dict[tuple[str, str], dict] = {
    ("FL", "moody"): {
        "selection_method": "appointed",
        "normally_elected": True,
        "selection_detail": (
            "Appointed by Gov. Ron DeSantis in January 2025 to fill the "
            "seat vacated by Marco Rubio. Must stand in a special "
            "election in 2026 to keep the seat."
        ),
    },
}

_MONTHS = ("January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December")


def _long_date(iso: object) -> str:
    """'2026-03-24' -> 'March 24, 2026' ('' when it is not a date)."""
    try:
        d = _dt.date.fromisoformat(str(iso)[:10])
    except ValueError:
        return ""
    return f"{_MONTHS[d.month - 1]} {d.day}, {d.year}"


def appointment_detail(appointment: dict) -> str:
    """One factual sentence pair from the roster's appointment fields."""
    sworn = _long_date(appointment.get("start"))
    end = _long_date(appointment.get("end"))
    text = "Appointed to fill a vacancy" + (f" and sworn in on {sworn}." if sworn else ".")
    if end and appointment.get("end_type") == "special-election":
        text += f" The seat is filled by a special election on {end}."
    elif end:
        text += f" Serves until the term ends on {end}."
    return text


# Default selection_detail text for the common cases.
HOUSE_DEFAULT_DETAIL = (
    "Elected by voters in a congressional-district election every 2 years."
)
SENATE_DEFAULT_DETAIL = (
    "Elected statewide to a 6-year term (17th Amendment, 1913)."
)


def annotate_selection(member: dict) -> dict:
    """Mutate `member` in place adding selection_method / selection_detail /
    normally_elected. Returns the same dict for chaining.

    Safe to call multiple times — already-set fields win."""
    if not isinstance(member, dict):
        return member

    # Respect any already-set metadata (never overwrite).
    if member.get("selection_method"):
        return member

    chamber = (member.get("chamber") or "").lower()
    bioguide = (member.get("bioguide_id") or "").upper()
    state = (member.get("state") or "").upper()
    # Member name can be "First Last" or "Last, First". Pull the last word as
    # a cheap last-name heuristic — sufficient for the override map.
    name = (member.get("name") or "").strip()
    last_name = name.split(",")[0].strip().split()[-1].lower() if name else ""

    # Senate-specific overrides (appointments).
    if "senate" in chamber:
        override = APPOINTED_SENATORS.get(bioguide)
        if not override and state and last_name:
            override = APPOINTED_BY_STATE_LAST.get((state, last_name))
        if override:
            member["selection_method"] = override.get("selection_method", "appointed")
            member["selection_detail"] = override.get("selection_detail")
            member["normally_elected"] = override.get("normally_elected", True)
            return member
        appointment = member.get("appointment")
        if isinstance(appointment, dict):
            member["selection_method"] = "appointed"
            member["selection_detail"] = appointment_detail(appointment)
            member["normally_elected"] = True
            return member
        # No override — treat as elected.
        member["selection_method"] = "elected"
        member["selection_detail"] = SENATE_DEFAULT_DETAIL
        return member

    # House — always elected.
    if "house" in chamber:
        member["selection_method"] = "elected"
        member["selection_detail"] = HOUSE_DEFAULT_DETAIL
        return member

    # Unknown chamber — don't guess.
    return member


def annotate_members(members: list) -> list:
    """Apply `annotate_selection` to every item in a list. Returns the list."""
    for m in members or []:
        annotate_selection(m)
    return members
