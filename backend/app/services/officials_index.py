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
import os
import re
from pathlib import Path
from typing import Optional

import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
# Disk cache for the legislators-current.json fetch — re-used across
# restarts so we only pay the network round-trip on the first boot.
LEGISLATORS_CACHE_PATH = DATA_DIR / "_cache" / "legislators_current.json"
LEGISLATORS_URL = (
    "https://unitedstates.github.io/congress-legislators/legislators-current.json"
)
# Max age (seconds) before we re-fetch on the next boot. 7 days — the
# data changes rarely, and stale state/district info just degrades
# scope filtering, never breaks anything.
LEGISLATORS_CACHE_TTL = 7 * 24 * 3600

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


def _ingest_sitting_congress(legislators: list) -> None:
    """Index every sitting U.S. Senator and Representative from the
    legislators-current.json roster. Each member's bioguide_id maps
    to {state, district} so a citizen-poll page on, say, Senator Rick
    Scott (S001227) gets country+state scope chips, and Rep. Maxwell
    Frost (F000475) gets country+state+district.
    """
    if not isinstance(legislators, list):
        return
    count = 0
    for entry in legislators:
        try:
            bioguide = (entry.get("id") or {}).get("bioguide")
            if not bioguide:
                continue
            terms = entry.get("terms") or []
            if not terms:
                continue
            latest = terms[-1] or {}
            state = latest.get("state")
            chamber = latest.get("type")  # 'sen' or 'rep'
            district = None
            if chamber == "rep":
                d = latest.get("district")
                if d is not None:
                    district = (
                        f"{state}-{int(d)}"
                        if state and isinstance(d, (int, str)) and str(d).isdigit()
                        else None
                    )
            _put(bioguide, state=state, district=district)
            count += 1
        except Exception:
            # Don't let one malformed entry kill the whole import.
            continue
    if count:
        logger.info("officials_index: ingested %d sitting Congress members", count)


def _ingest_sample_congress() -> None:
    """Fallback: ingest CongressService.SAMPLE_DATA so well-known
    members (Rick Scott, Marco Rubio, etc.) work even when the live
    legislators-current.json fetch isn't available — common during
    cold starts on free-tier hosting and in offline dev.
    """
    try:
        # Local import to avoid a circular at module load.
        from app.services.congress_service import CongressService
    except Exception:
        return
    sample = getattr(CongressService, "SAMPLE_DATA", None)
    if not isinstance(sample, dict):
        return
    count = 0
    for state_code, block in sample.items():
        if not isinstance(block, dict):
            continue
        for m in block.get("congress") or []:
            bioguide = m.get("bioguide_id")
            if not bioguide:
                continue
            d = m.get("district")
            district = (
                f"{state_code}-{int(d)}"
                if d is not None and str(d).isdigit() else None
            )
            _put(bioguide, state=state_code, district=district)
            count += 1
    if count:
        logger.info("officials_index: ingested %d sample-data Congress members", count)


def _load_legislators_current_synchronously() -> Optional[list]:
    """One-shot synchronous fetch of legislators-current.json with a
    disk cache. Network errors and parse errors are swallowed —
    we just return None and the caller falls back to sample data.
    Skipped entirely when CIVICVIEW_SKIP_LEGISLATORS_FETCH is truthy
    (used in CI / offline dev to avoid the cold-start penalty).
    """
    if os.getenv("CIVICVIEW_SKIP_LEGISLATORS_FETCH", "").strip().lower() in {"1", "true", "yes"}:
        return None
    # Try the disk cache first.
    try:
        if LEGISLATORS_CACHE_PATH.exists():
            mtime = LEGISLATORS_CACHE_PATH.stat().st_mtime
            import time
            if (time.time() - mtime) < LEGISLATORS_CACHE_TTL:
                return json.loads(LEGISLATORS_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        pass

    try:
        with urllib.request.urlopen(LEGISLATORS_URL, timeout=10) as resp:
            payload = resp.read().decode("utf-8")
        data = json.loads(payload)
        try:
            LEGISLATORS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            LEGISLATORS_CACHE_PATH.write_text(payload, encoding="utf-8")
        except OSError:
            # Read-only filesystem (e.g. some serverless platforms) is
            # fine — we just won't cache to disk this run.
            pass
        return data
    except (urllib.error.URLError, OSError, json.JSONDecodeError, TimeoutError) as e:
        logger.info("officials_index: legislators fetch unavailable (%s) — using sample fallback", e)
        # Stale cache is better than nothing.
        try:
            if LEGISLATORS_CACHE_PATH.exists():
                return json.loads(LEGISLATORS_CACHE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
        return None


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
            if not sub.is_dir() or sub.name in {"federal", "_cache"}:
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

    # Sitting Congress: try the live roster first, fall back to the
    # CongressService SAMPLE_DATA so well-known members (Rick Scott,
    # Marco Rubio, etc.) always resolve.
    legislators = _load_legislators_current_synchronously()
    if legislators:
        _ingest_sitting_congress(legislators)
    else:
        _ingest_sample_congress()

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
