# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Page-tag resolver — turn an `official_id` into a short label the
/polls feed renders next to each poll so the user can see where it
came from at a glance.

Examples of what we render:
  Byron Donalds (FL-19 House rep)    → "BD · FL-19"
  Bernie Sanders (VT Senate)         → "BS · VT"
  Donald J. Trump (President)        → "DT · EXEC"
  Mike Johnson (Speaker / LA)        → "MJ · HSE"
  Some SCOTUS justice                → "<initials> · SCOTUS"
  Byron Donalds (FL Gov candidate)   → "BD · CAND-FL"
  Generic CA candidate               → "<initials> · CAND-CA"
  Unknown / orphan official_id       → just "POLL" as a fallback

Three input sources are stitched together (in priority order):
  1. The DB rep_accounts table (claimed pages with owner_state /
     owner_district set on the row) — wins for any official_id with a
     row, because reps can edit their owner_* fields.
  2. The ElectionsService candidates registry — a curated dict of
     {candidate_id → full record}. Used for unclaimed candidate ids
     so polls on candidate pages get a recognizable chip even before
     candidate-account auth ships in Phase 3.
  3. The static officials_index (curated federal + state rep data).

Candidates emit "CAND-<state>" in the geo slot to disambiguate from
sitting reps. When candidate accounts ship in Phase 3+ and the
candidate has claimed their page, the DB row will take over and the
tag may shift to whatever owner_state the candidate set.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from sqlalchemy.orm import Session

from app.models.pages import RepAccount
from app.services.officials_index import lookup
from app.services.elections_service import ElectionsService

# Module-level singleton — same pattern the candidates router uses.
# Cheap to instantiate (just loads the static JSON registries) but
# we want it cached so every poll-feed render isn't re-parsing files.
_elections = ElectionsService()


logger = logging.getLogger(__name__)

# Map official_id prefixes (or exact ids) to a branch label. Order
# matters — more specific matches first.
_BRANCH_MAP = (
    ("us-pres-", "EXEC"),
    ("us-vp-", "EXEC"),
    ("us-cabinet-", "EXEC"),
    ("us-sec-", "EXEC"),
    ("us-scotus-", "SCOTUS"),
    ("us-sen-pres", "SEN"),   # Senate president / pres-pro-tem leadership ids
    ("us-sen-maj", "SEN"),
    ("us-sen-min", "SEN"),
    ("us-sen-", "SEN"),
    ("us-hse-speaker", "HSE"),
    ("us-hse-maj", "HSE"),
    ("us-hse-min", "HSE"),
    ("us-hse-", "HSE"),
)


def _initials_from_name(name: Optional[str]) -> str:
    """First letter of the first word + first letter of the LAST
    word. 'Donald J. Trump' → 'DT'; 'Bernie Sanders' → 'BS';
    'Donalds' (single word) → 'DO'; empty → ''.
    Strips honorifics so 'Sen. Bernie Sanders' → 'BS' not 'SS'.
    """
    if not name:
        return ""
    # Strip common honorifics so they don't grab the initial.
    name = re.sub(
        r"^(sen|rep|gov|pres|vp|hon|mr|mrs|ms|dr|justice|sec|secretary)\.?\s+",
        "",
        name.strip(),
        flags=re.IGNORECASE,
    )
    # Skip middle initials / suffixes by taking only the first and
    # last meaningful tokens.
    tokens = [t for t in re.split(r"\s+", name) if t and t.strip(".")]
    if not tokens:
        return ""
    if len(tokens) == 1:
        # Single name — use the first TWO letters so we still get a
        # two-character chip rather than a one-letter blob.
        word = tokens[0].strip(".")
        return word[:2].upper() if word else ""
    first, last = tokens[0], tokens[-1]
    return ((first[:1] or "") + (last[:1] or "")).upper()


def _branch_label(official_id: str) -> Optional[str]:
    for prefix, label in _BRANCH_MAP:
        if official_id.startswith(prefix):
            return label
    return None


def resolve_page_tag(db: Session, official_id: Optional[str]) -> Optional[str]:
    """Return a short page-tag for the given `official_id`, or None
    when the poll isn't tied to a rep page (standalone polls show a
    'Standalone' tag at the UI layer; that's a separate render path
    so we return None here rather than a hardcoded string).

    Tag shape: '<initials> · <geo or branch>'. Falls back to just
    the initials, or just 'POLL' for truly unresolvable ids — better
    than a missing chip in the UI.
    """
    if not official_id:
        return None

    # Display name + geography candidates.
    display_name: Optional[str] = None
    geo: Optional[str] = None

    # Prefer DB row when present — a rep who's claimed their page
    # may have edited owner_state / owner_district, which is more
    # current than the curated index.
    rep = (
        db.query(RepAccount)
        .filter(RepAccount.official_id == official_id)
        .first()
    )
    if rep is not None:
        display_name = rep.display_name
        if rep.owner_district:
            # owner_district is stored as full 'FL-19' or just '19'.
            # Normalize: if it looks like 'XX-NN' use as-is, else
            # prefix the state.
            d = rep.owner_district.strip()
            if re.match(r"^[A-Z]{2}-", d):
                geo = d
            elif rep.owner_state:
                geo = f"{rep.owner_state}-{d}"
            else:
                geo = d
        elif rep.owner_state:
            geo = rep.owner_state

    # Candidate registry — covers any official_id that resolves to a
    # candidate record in ElectionsService. Tagged "CAND-<state>" so
    # the poll feed can render a distinct candidate-page chip.
    is_candidate = False
    if not display_name or not geo:
        cand = _elections.get_candidate(official_id)
        if cand is not None:
            is_candidate = True
            if not display_name:
                display_name = cand.get("name")
            if not geo:
                # Candidate records carry hometown like "Naples, FL".
                # Pull the state code out of (in priority order):
                #   1. Curated state field if present
                #   2. The trailing 2-char state code from hometown
                #   3. The state prefix on the candidate id (e.g. fl-cand-…)
                state = cand.get("state")
                if not state:
                    home = (cand.get("hometown") or "").strip()
                    m = re.search(r",\s*([A-Z]{2})$", home)
                    if m:
                        state = m.group(1)
                if not state:
                    m = re.match(r"^([a-z]{2})-cand-", official_id)
                    if m:
                        state = m.group(1).upper()
                geo = f"CAND-{state}" if state else "CAND"

    # Fall back to the curated index for non-claimed pages.
    if not display_name or not geo:
        idx = lookup(official_id) or {}
        if not display_name:
            # The index doesn't carry display_name today; pulling it
            # in is a separate refactor. For now we fall through to
            # the branch label without a name.
            pass
        if not geo:
            if idx.get("district"):
                d = str(idx["district"])
                if re.match(r"^[A-Z]{2}-", d):
                    geo = d
                elif idx.get("state"):
                    geo = f"{idx['state']}-{d}"
            elif idx.get("state"):
                geo = idx["state"]

    initials = _initials_from_name(display_name)
    if not geo:
        geo = _branch_label(official_id)

    if initials and geo:
        return f"{initials} · {geo}"
    if initials:
        return initials
    if geo:
        return geo
    return "POLL"


def is_candidate_id(official_id: Optional[str]) -> bool:
    """Cheap predicate — does this official_id resolve to a candidate
    record in the ElectionsService registry? Used by the polls feed
    to support a 'candidate' kind filter without a full resolve_page_tag()
    call per row."""
    if not official_id:
        return False
    return _elections.get_candidate(official_id) is not None
