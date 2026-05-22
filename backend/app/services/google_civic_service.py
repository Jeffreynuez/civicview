# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Google Civic Information API v2 — thin proxy for the endpoints that
are still live as of April 2025+:

  • voterInfoQuery       — polling places, early-vote sites, contests
                           with candidates for a given address + election
  • elections            — the list of elections Google is currently
                           tracking (mostly federal general, some state)
  • divisionsByAddress   — OCD-IDs for an address; useful as join keys
                           against other datasets

The Representatives API was turned down on 2025-04-30, so we do NOT
wrap it here. If you need local officials, stay on the curated JSON
path or swap in Cicero/Ballotpedia later.

Pattern mirrors federal_live.py: load_dotenv at import, fail-open when
the key is unset (returns {} or [] rather than raising), in-memory TTL
cache. Normalization of response shapes is opinionated — we flatten
Google's nested structures into things that slot cleanly into the
existing Ballot tab without teaching the frontend a new schema.
"""
from __future__ import annotations

import os
import time
import logging
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

GOOGLE_CIVIC_BASE = "https://www.googleapis.com/civicinfo/v2"

# voterInfoQuery changes as election day approaches (polling places
# confirm late); keep the TTL short. Elections list and Divisions move
# slowly, so they get a longer TTL.
CACHE_TTL_VOTER    = 600    # 10 min
CACHE_TTL_ELECTIONS = 3600  # 60 min
CACHE_TTL_DIVISIONS = 86400 # 24 h

_cache: dict[str, tuple[float, object]] = {}


def _api_key() -> str:
    return os.getenv("GOOGLE_CIVIC_API_KEY", "").strip()


def is_enabled() -> bool:
    """True iff a key is configured. Routers can short-circuit with this."""
    return bool(_api_key())


def _get_cached(key: str, ttl: int):
    if key in _cache:
        ts, data = _cache[key]
        if time.time() - ts < ttl:
            return data
        _cache.pop(key, None)
    return None


def _set_cached(key: str, data):
    _cache[key] = (time.time(), data)


# ── voterInfoQuery ────────────────────────────────────────────────────
async def fetch_voter_info(
    address: str,
    election_id: Optional[int] = None,
    official_only: bool = False,
) -> dict:
    """Return polling places, drop-boxes, early-vote sites, and contests
    (with candidates) for a given address + election.

    If `election_id` is omitted, Google picks the next upcoming election
    it has data for. Passing `official_only=True` restricts to elections
    that have been officially certified by the state (fewer false-positive
    primaries/local elections in the response).

    Response shape (normalized):
      {
        "election": { id, name, day, ocd_id } | None,
        "normalized_address": { line1, city, state, zip } | None,
        "polling_locations": [ { name, address, hours, notes }, ... ],
        "early_vote_sites":  [ ... same shape ... ],
        "drop_off_locations": [ ... same shape ... ],
        "contests": [
          {
            "office": str,
            "level": str,      # "country" | "administrativeArea1" | ...
            "district": str,
            "candidates": [
              { "name", "party", "candidate_url",
                "phone", "email", "channels": [ {type, id} ] }
            ],
            "referendum_title": str | None,
            "referendum_subtitle": str | None,
            "referendum_url": str | None,
          }
        ]
      }
    """
    key = _api_key()
    if not key:
        logger.info("No GOOGLE_CIVIC_API_KEY — voter-info returns empty")
        return {}
    if not address or not address.strip():
        return {}

    cache_key = f"gc-voter::{address.strip().lower()}::{election_id}::{official_only}"
    cached = _get_cached(cache_key, CACHE_TTL_VOTER)
    if cached is not None:
        return cached

    params = {
        "key": key,
        "address": address.strip(),
        "officialOnly": "true" if official_only else "false",
        # Include contests + polling + candidate info but skip state/admin-body
        # metadata we don't render anywhere.
        "returnAllAvailableData": "true",
    }
    if election_id is not None:
        params["electionId"] = str(election_id)

    url = f"{GOOGLE_CIVIC_BASE}/voterinfo"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
    except Exception as e:
        logger.error("Google Civic voter-info request failed: %s", e)
        return {}

    if resp.status_code == 400:
        # Google returns 400 when there's no election matching the address
        # (e.g. off-season, no upcoming federal race). This is a normal
        # negative result, not a crash-worthy error.
        logger.info("Google Civic voter-info: no matching election for address")
        out = {"election": None, "contests": [], "polling_locations": [],
               "early_vote_sites": [], "drop_off_locations": []}
        _set_cached(cache_key, out)
        return out
    if resp.status_code != 200:
        logger.warning("Google Civic voter-info returned %s", resp.status_code)
        return {}

    try:
        data = resp.json() or {}
    except Exception:
        return {}

    out = _normalize_voter_info(data)
    _set_cached(cache_key, out)
    return out


def _normalize_voter_info(data: dict) -> dict:
    election = data.get("election") or {}
    norm_addr = data.get("normalizedInput") or {}

    def _loc(raw: dict) -> dict:
        addr = (raw.get("address") or {})
        return {
            "name": addr.get("locationName") or raw.get("name") or "",
            "address": ", ".join(filter(None, [
                addr.get("line1"), addr.get("line2"),
                addr.get("city"),
                f"{addr.get('state', '')} {addr.get('zip', '')}".strip(),
            ])),
            "hours": raw.get("pollingHours") or "",
            "notes": raw.get("notes") or "",
            "start_date": raw.get("startDate"),
            "end_date": raw.get("endDate"),
        }

    def _contest(raw: dict) -> dict:
        candidates = []
        for c in (raw.get("candidates") or []):
            channels = [{"type": ch.get("type"), "id": ch.get("id")}
                        for ch in (c.get("channels") or [])]
            candidates.append({
                "name": c.get("name"),
                "party": c.get("party"),
                "candidate_url": c.get("candidateUrl"),
                "phone": c.get("phone"),
                "email": c.get("email"),
                "photo_url": c.get("photoUrl"),
                "channels": channels,
            })
        return {
            "office": raw.get("office") or raw.get("referendumTitle"),
            "level": (raw.get("level") or [None])[0],
            "district": (raw.get("district") or {}).get("name"),
            "candidates": candidates,
            # Ballot measures come through the same `contests` array but
            # with `type == "Referendum"` and no candidates.
            "type": raw.get("type"),
            "referendum_title": raw.get("referendumTitle"),
            "referendum_subtitle": raw.get("referendumSubtitle"),
            "referendum_url": raw.get("referendumUrl"),
        }

    return {
        "election": {
            "id": election.get("id"),
            "name": election.get("name"),
            "day": election.get("electionDay"),
            "ocd_id": election.get("ocdDivisionId"),
        } if election else None,
        "normalized_address": {
            "line1": norm_addr.get("line1"),
            "city":  norm_addr.get("city"),
            "state": norm_addr.get("state"),
            "zip":   norm_addr.get("zip"),
        } if norm_addr else None,
        "polling_locations":  [_loc(x) for x in (data.get("pollingLocations") or [])],
        "early_vote_sites":   [_loc(x) for x in (data.get("earlyVoteSites") or [])],
        "drop_off_locations": [_loc(x) for x in (data.get("dropOffLocations") or [])],
        "contests":           [_contest(x) for x in (data.get("contests") or [])],
    }


# ── elections list ────────────────────────────────────────────────────
async def fetch_elections() -> list[dict]:
    """Return the list of elections Google is currently tracking.
    Useful for populating an 'upcoming' strip that's not limited to
    states we've curated seed data for.
    """
    key = _api_key()
    if not key:
        return []
    cache_key = "gc-elections"
    cached = _get_cached(cache_key, CACHE_TTL_ELECTIONS)
    if cached is not None:
        return cached

    url = f"{GOOGLE_CIVIC_BASE}/elections"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params={"key": key})
    except Exception as e:
        logger.error("Google Civic elections request failed: %s", e)
        return []

    if resp.status_code != 200:
        logger.warning("Google Civic elections returned %s", resp.status_code)
        return []
    data = resp.json() or {}
    out = [
        {
            "id": e.get("id"),
            "name": e.get("name"),
            "day": e.get("electionDay"),
            "ocd_id": e.get("ocdDivisionId"),
        }
        for e in (data.get("elections") or [])
    ]
    _set_cached(cache_key, out)
    return out


# ── divisionsByAddress ────────────────────────────────────────────────
async def fetch_divisions(address: str) -> dict:
    """Resolve an address to OCD-IDs. Returns
      { "normalized_address": {...}, "divisions": [ { ocd_id, name } ] }

    OCD-IDs are stable identifiers like
    `ocd-division/country:us/state:fl/place:miami` that you can use as
    join keys against curated data or other providers (OpenStates,
    Ballotpedia exports, etc.).
    """
    key = _api_key()
    if not key or not address or not address.strip():
        return {}
    cache_key = f"gc-div::{address.strip().lower()}"
    cached = _get_cached(cache_key, CACHE_TTL_DIVISIONS)
    if cached is not None:
        return cached

    url = f"{GOOGLE_CIVIC_BASE}/divisionsByAddress"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params={"key": key, "address": address.strip()})
    except Exception as e:
        logger.error("Google Civic divisions request failed: %s", e)
        return {}

    if resp.status_code != 200:
        logger.warning("Google Civic divisions returned %s", resp.status_code)
        return {}
    data = resp.json() or {}
    divisions = []
    for ocd_id, meta in (data.get("divisions") or {}).items():
        divisions.append({"ocd_id": ocd_id, "name": (meta or {}).get("name")})
    out = {
        "normalized_address": data.get("normalizedInput"),
        "divisions": divisions,
    }
    _set_cached(cache_key, out)
    return out
