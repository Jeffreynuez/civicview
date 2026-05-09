# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Officials geography index — a fast, synchronous lookup that maps an
`official_id` to the geographic context of that office (state,
congressional district, city). Built once at startup from the
curated JSON data files and held in memory.

Used by the citizen-polls feature to figure out which scopes a poll
on an unclaimed rep page should support — Country/State/District
for a senator's page (state-only), Country/State/District for a
House rep's page (state + district), Country only for SCOTUS /
Cabinet / President / VP pages.

Data sources:

  • app/data/federal/federal_officials.json — President, VP,
    Cabinet, SCOTUS, Senate + House leadership.
  • app/data/<state_code>/state_officials.json — governor, state
    senate, state house, state judiciary (per state).
  • app/data/<state_code>/candidates.json — candidates for any
    office in the cycle (per state).

Every entry resolves to:
    {
      "state":    str | None,    # 2-letter, e.g. "FL"
      "district": str | None,    # "FL-19", or just digits like "19"
      "city":     str | None,    # only filled for mayors / city seats
    }

NOT in the index (lookup returns None → Country-only fallback):
  • Sitting U.S. Congress members not in the curated leadership
    list (their data lives behind the Congress API and is
    fetched async). For those, the citizen-polls scope filter
    surfaces Country only — better than guessing wrong.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Exposed in-memory index. Module-level so it's shared across requests.
_INDEX: dict[str, dict] = {}
_LOADED = False


def _safe_state(code: object) -> Optional[str]:
    """Normalize a state to its 2-letter code, or return None."""
    if not code:
        return None
    s = str(code).strip().upper()
    return s[:2] if s else None


def _district_from_seeking_office(text: object) -> Optional[str]:
    """Extract a 'FL-19' style district from a free-form office string.
    Covers patterns we see in candidates.json:
      "U.S. House FL-19"
      "Florida State Senate District 28"  → "28"
      "Governor of Florida"               → None
    Returns None when no district is clearly indicated.
    """
    if not text:
        return None
    s = str(text)
    # Match an "XX-NN" district code first (most explicit).
    m = re.search(r"\b([A-Z]{2})-(\d{1,2})\b", s)
    if m:
        return f"{m.group(1)}-{int(m.group(2))}"
    # Fall back to a bare "District NN" (state legislative seats).
    m = re.search(r"District\s+(\d{1,3})", s, re.I)
    if m:
        return m.group(1)
    return None


def _put(official_id: object, *, state=None, district=None, city=None) -> None:
    """Insert / overwrite an entry in the index. Coerces None and
    empty strings consistently so callers don't need to."""
    if not official_id:
        return
    key = str(official_id).strip()
    if not key:
        return
    _INDEX[key] = {
        "state": _safe_state(state),
        "district": (str(district).strip() if district else None) or None,
        "city": (str(city).strip() if city else None) or None,
    }


def _ingest_federal_officials(payload: dict) -> None:
    """Index president / VP / cabinet / SCOTUS / Senate + House
    leadership from the federal officials JSON."""
    if not isinstance(payload, dict):
        return

    exec_block = payload.get("executive") or {}
    # President / VP / cabinet members hold national office — no state
    # or district filtering applies. Indexing with state=None forces
    # Country-only on their pages.
    for k in ("president", "vice_president"):
        e = exec_block.get(k)
        if isinstance(e, dict):
            _put(e.get("id"))
    for m in exec_block.get("cabinet") or []:
        if isinstance(m, dict):
            _put(m.get("id"))

    jud = payload.get("judiciary") or {}
    for j in (jud.get("supreme_court") or {}).get("members") or []:
        if isinstance(j, dict):
            _put(j.get("id"))

    cong = payload.get("congress") or {}
    for s in (cong.get("senate") or {}).get("leadership") or []:
        if isinstance(s, dict):
            _put(s.get("id"), state=s.get("state"))
    for h in (cong.get("house") or {}).get("leadership") or []:
        if isinstance(h, dict):
            district = h.get("district")
            state = h.get("state")
            district_full = (
                f"{state}-{int(district)}"
                if state and district and str(district).isdigit()
                else district
            )
            _put(h.get("id"), state=state, district=district_full)


def _ingest_state_officials(state_code: str, payload: dict) -> None:
    """Index governor + lieutenant governor + state legislators +
    state judges from a single state's officials JSON."""
    if not isinstance(payload, dict):
        return
    state_code = _safe_state(state_code) or _safe_state(payload.get("state"))
    if not state_code:
        return

    exec_block = payload.get("executive") or {}
    # Statewide executives (governor, lt gov, AG) — state scope only.
    for k in ("governor", "lt_governor", "lieutenant_governor",
              "secretary_of_state", "attorney_general"):
        e = exec_block.get(k)
        if isinstance(e, dict):
            _put(e.get("id"), state=state_code)
    for o in exec_block.get("other") or []:
        if isinstance(o, dict):
            _put(o.get("id"), state=state_code)

    # State senate / house — district-level.
    senate = payload.get("state_senate") or {}
    for m in senate.get("members") or []:
        if isinstance(m, dict):
            _put(m.get("id"), state=state_code, district=m.get("district"))
    house = payload.get("state_house") or {}
    for m in house.get("members") or []:
        if isinstance(m, dict):
            _put(m.get("id"), state=state_code, district=m.get("district"))

    # State judiciary — typically appointed statewide; treat as state-scope.
    jud = payload.get("judiciary") or {}
    for j in jud.get("members") or []:
        if isinstance(j, dict):
            _put(j.get("id"), state=state_code)


def _ingest_candidates(state_code: str, payload: dict) -> None:
    """Index candidates from a single state's candidates JSON.
    Candidate scope falls out of `seeking_office`."""
    if not isinstance(payload, dict):
        return
    state_code = _safe_state(state_code)
    if not state_code:
        return
    cands = payload.get("candidates")
    items = (
        list(cands.values()) if isinstance(cands, dict)
        else cands if isinstance(cands, list)
        else []
    )
    for c in items:
        if not isinstance(c, dict):
            continue
        seeking = c.get("seeking_office") or ""
        district = _district_from_seeking_office(seeking)
        # Senate / governor / statewide → state-scope only.
        # Congressional / state-legislative seats → state + district.
        _put(c.get("id"), state=state_code, district=district)


def build_index() -> None:
    """Load every curated data file once. Idempotent — re-calling on
    an already-loaded index re-builds from disk (useful in tests)."""
    global _LOADED
    _INDEX.clear()

    fed_path = DATA_DIR / "federal" / "federal_officials.json"
    if fed_path.exists():
        try:
            _ingest_federal_officials(json.loads(fed_path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("officials_index: failed to load %s: %s", fed_path, e)

    # Walk every state subdir for state_officials.json + candidates.json.
    if DATA_DIR.exists():
        for sub in DATA_DIR.iterdir():
            if not sub.is_dir() or sub.name == "federal":
                continue
            state_code = sub.name.upper()
            for filename, ingestor in (
                ("state_officials.json", _ingest_state_officials),
                ("candidates.json", _ingest_candidates),
            ):
                p = sub / filename
                if not p.exists():
                    continue
                try:
                    ingestor(state_code, json.loads(p.read_text(encoding="utf-8")))
                except (OSError, json.JSONDecodeError) as e:
                    logger.warning("officials_index: failed to load %s: %s", p, e)

    _LOADED = True
    logger.info("officials_index: built (%d entries)", len(_INDEX))


def lookup(official_id: str) -> Optional[dict]:
    """Return `{state, district, city}` for the official, or None
    if not in the curated set. Lazily builds the index on first
    call so import order doesn't matter."""
    if not _LOADED:
        build_index()
    if not official_id:
        return None
    return _INDEX.get(str(official_id).strip())


def allowed_scopes_for_official(official_id: str) -> list[str]:
    """Return the list of geographic scopes the official's office
    supports — same shape `_allowed_scopes_for_owner` returns for a
    RepAccount. Country is always included; state / district / city
    are added only when the index has the corresponding field."""
    scopes = ["country"]
    geo = lookup(official_id)
    if not geo:
        return scopes
    if geo.get("state"):
        scopes.append("state")
    if geo.get("district"):
        scopes.append("district")
    if geo.get("city"):
        scopes.append("city")
    return scopes


def scope_labels_for_official(official_id: str) -> dict[str, str]:
    """Human-readable label for each scope. Drives the chip text in
    the UI: country=United States, state=FL, district=FL-19."""
    geo = lookup(official_id) or {}
    out: dict[str, str] = {"country": "United States"}
    if geo.get("state"):
        out["state"] = geo["state"]
    if geo.get("district"):
        out["district"] = geo["district"]
    if geo.get("city"):
        out["city"] = geo["city"]
    return out
