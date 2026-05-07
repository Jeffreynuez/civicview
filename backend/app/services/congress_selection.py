# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
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

The map below is intentionally small. Add entries as vacancies are filled.
Sources to double-check before shipping: Senate.gov "Appointed Senators" table.
"""

# Bioguide ID → override dict.
# Use UPPERCASE IDs — Congress.gov returns them uppercase.
APPOINTED_SENATORS: dict[str, dict] = {
    # Ashley Moody (R-FL): appointed by Gov. DeSantis on Jan 16, 2025 to fill
    # the seat Marco Rubio vacated to become U.S. Secretary of State. She is
    # expected to run in a 2026 special election.
    "M001234": {  # Placeholder — real bioguide is resolved by last-name match below
        "selection_method": "appointed",
        "normally_elected": True,
        "selection_detail": (
            "Appointed by Gov. Ron DeSantis on Jan 16, 2025 to fill the "
            "seat vacated by Marco Rubio. Must stand in a special election "
            "in 2026 to keep the seat."
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
