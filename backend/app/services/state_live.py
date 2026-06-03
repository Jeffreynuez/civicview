# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
State-level live-data fetchers — thin proxies with in-memory caching for:
  • State legislator bills (OpenStates /bills, sponsor filter)
  • State legislator votes (OpenStates /votes, voter filter)
  • Governor actions (OpenStates /bills filtered to signed/vetoed)
  • State supreme-court opinions (CourtListener, per-state court code)

All endpoints degrade gracefully:
  - If `OPENSTATES_API_KEY` is unset → OpenStates calls return []
  - If `COURTLISTENER_TOKEN` is unset → CourtListener calls may return [] (401)
  - Any HTTP/parse error is logged and returns []
"""
from __future__ import annotations

import os
import json as _json
import time
import asyncio
import logging
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

OPENSTATES_API = "https://v3.openstates.org"
COURTLISTENER_API = "https://www.courtlistener.com/api/rest/v4"

# Map state code → CourtListener court code for the *supreme court* of that state.
# Extend as we add more states. Codes are CourtListener's `pk`-style slugs.
STATE_SUPREME_COURT_CODES = {
    "FL": "fla",
    "CA": "cal",
    "NY": "ny",
    "TX": "tex",
    "IL": "ill",
    "PA": "pa",
    "OH": "ohio",
    "GA": "ga",
    "NC": "nc",
    "MI": "mich",
    "VA": "va",
    "WA": "wash",
    "AZ": "ariz",
    "MA": "mass",
}

CACHE_TTL_SHORT = 900    # 15 min — live feeds (bills/votes/cases)
CACHE_TTL_LONG  = 3600   # 60 min — person-id lookups, slow-moving data
CACHE_TTL_XLONG = 86400  # 24 h — name→openstates-id resolution

_cache: dict[str, tuple[float, object]] = {}


def _get_cached(key: str, ttl: int):
    if key in _cache:
        ts, data = _cache[key]
        if time.time() - ts < ttl:
            return data
        _cache.pop(key, None)
    return None


def _set_cached(key: str, data):
    _cache[key] = (time.time(), data)


def _openstates_headers() -> dict:
    key = os.getenv("OPENSTATES_API_KEY", "").strip()
    return {"X-API-KEY": key} if key else {}


def _openstates_available() -> bool:
    return bool(os.getenv("OPENSTATES_API_KEY", "").strip())


# ── Resolve a seed legislator → OpenStates person id ─────────────────
async def resolve_openstates_person_id(
    state_code: str,
    name: str,
    chamber: Optional[str] = None,
    district: Optional[str] = None,
) -> Optional[str]:
    """Given a human name + state + chamber + district, return the
    matching OpenStates person id (ocd-person/...).  Cached 24h.

    We search by name in the jurisdiction and prefer a match with the
    same chamber + district when multiple hit. Returns None on failure
    or when no API key is configured.
    """
    if not _openstates_available() or not name or not state_code:
        return None

    key = f"os-resolve::{state_code.lower()}::{name.lower()}::{(chamber or '').lower()}::{district or ''}"
    cached = _get_cached(key, CACHE_TTL_XLONG)
    if cached is not None:
        return cached or None

    jurisdiction = f"ocd-jurisdiction/country:us/state:{state_code.lower()}/government"
    url = f"{OPENSTATES_API}/people"
    params = {
        "jurisdiction": jurisdiction,
        "name": name,
        "per_page": 10,
        "include": ["current_role"],
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params, headers=_openstates_headers())
            if resp.status_code != 200:
                logger.warning("OpenStates /people %s for %s/%s", resp.status_code, state_code, name)
                _set_cached(key, "")  # negative cache so we don't hammer
                return None
            data = resp.json() or {}
    except Exception as e:
        logger.error("OpenStates /people error: %s", e)
        return None

    results = data.get("results") or []
    if not results:
        _set_cached(key, "")
        return None

    # Prefer match on chamber + district when we have that hint.
    def score(p: dict) -> int:
        cr = p.get("current_role") or {}
        s = 0
        if chamber:
            org = (cr.get("org_classification") or "").lower()
            if chamber.lower().startswith("s") and "upper" in org:
                s += 2
            if chamber.lower().startswith("h") and "lower" in org:
                s += 2
        if district:
            if str(cr.get("district") or "").strip() == str(district).strip():
                s += 3
        return s

    results.sort(key=score, reverse=True)
    pid = results[0].get("id")
    _set_cached(key, pid or "")
    return pid or None


# ── State legislator bills (OpenStates) ──────────────────────────────
async def fetch_state_legislator_bills(
    state_code: str,
    name: str,
    chamber: Optional[str] = None,
    district: Optional[str] = None,
    limit: int = 15,
    openstates_id: Optional[str] = None,
) -> list[dict]:
    """Return recent bills sponsored by the named state legislator.

    When ``openstates_id`` is supplied (we store it on every imported
    legislator) we use it directly and skip the name-resolution call.
    """
    if not _openstates_available():
        return []
    pid = openstates_id or await resolve_openstates_person_id(state_code, name, chamber, district)
    if not pid:
        return []

    key = f"os-bills::{pid}::{limit}"
    cached = _get_cached(key, CACHE_TTL_SHORT)
    if cached is not None:
        return cached

    url = f"{OPENSTATES_API}/bills"
    params = {
        "jurisdiction": state_code.lower(),  # REQUIRED: the sponsor filter
        "sponsor": pid,                       # returns 0 results without it
        "sort": "updated_desc",
        "per_page": min(max(1, int(limit or 15)), 20),
        "include": ["sponsorships", "actions"],
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params=params, headers=_openstates_headers())
            if resp.status_code != 200:
                logger.warning("OpenStates /bills %s", resp.status_code)
                return []
            data = resp.json() or {}
    except Exception as e:
        logger.error("OpenStates /bills error: %s", e)
        return []

    out = []
    for b in (data.get("results") or []):
        la = b.get("latest_action") or {}
        out.append({
            "id": b.get("id"),
            "identifier": b.get("identifier"),
            "title": b.get("title"),
            "session": (b.get("session") or {}).get("identifier") if isinstance(b.get("session"), dict) else b.get("session"),
            "classification": b.get("classification") or [],
            "subject": b.get("subject") or [],
            "latest_action": la.get("description"),
            "latest_action_date": la.get("date"),
            "url": b.get("openstates_url") or b.get("url"),
        })
    _set_cached(key, out)
    return out


# ── State legislator votes (OpenStates) ──────────────────────────────
async def fetch_state_legislator_votes(
    state_code: str,
    name: str,
    chamber: Optional[str] = None,
    district: Optional[str] = None,
    limit: int = 15,
    openstates_id: Optional[str] = None,
) -> list[dict]:
    """Return recent vote events where the legislator cast a vote.

    When ``openstates_id`` is supplied we use it directly and skip the
    name-resolution call.
    """
    if not _openstates_available():
        return []
    pid = openstates_id or await resolve_openstates_person_id(state_code, name, chamber, district)
    if not pid:
        return []

    key = f"os-votes::{pid}::{limit}"
    cached = _get_cached(key, CACHE_TTL_SHORT)
    if cached is not None:
        return cached

    # OpenStates doesn't have a direct "voter" filter; we pull recent vote
    # events in the jurisdiction and filter client-side by vote record.
    jurisdiction = f"ocd-jurisdiction/country:us/state:{state_code.lower()}/government"
    url = f"{OPENSTATES_API}/vote_events"
    params = {
        "jurisdiction": jurisdiction,
        "sort": "newest",
        "per_page": 20,
        "include": ["votes", "bill"],
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params=params, headers=_openstates_headers())
            if resp.status_code != 200:
                logger.warning("OpenStates /vote_events %s", resp.status_code)
                return []
            data = resp.json() or {}
    except Exception as e:
        logger.error("OpenStates /vote_events error: %s", e)
        return []

    out = []
    for ve in (data.get("results") or []):
        my_vote = None
        for v in (ve.get("votes") or []):
            voter = v.get("voter") or {}
            if voter.get("id") == pid:
                my_vote = v.get("option")
                break
        if not my_vote:
            continue
        bill = ve.get("bill") or {}
        out.append({
            "id": ve.get("id"),
            "bill_id": bill.get("identifier"),
            "bill_title": bill.get("title"),
            "motion": ve.get("motion_text"),
            "result": ve.get("result"),
            "date": (ve.get("start_date") or "").split("T")[0],
            "my_vote": my_vote,
            "url": ve.get("openstates_url"),
        })
        if len(out) >= limit:
            break
    _set_cached(key, out)
    return out


# ── Governor actions (signed / vetoed bills) ─────────────────────────
async def fetch_governor_actions(
    state_code: str, action_type: str = "signed", limit: int = 15,
) -> list[dict]:
    """Return recent bills signed or vetoed by the governor of `state_code`.
    Uses the OpenStates /bills endpoint and filters by latest_action text.
    """
    if not _openstates_available():
        return []
    action = (action_type or "signed").lower()
    key = f"os-gov::{state_code.lower()}::{action}::{limit}"
    cached = _get_cached(key, CACHE_TTL_SHORT)
    if cached is not None:
        return cached

    jurisdiction = f"ocd-jurisdiction/country:us/state:{state_code.lower()}/government"
    url = f"{OPENSTATES_API}/bills"
    params = {
        "jurisdiction": jurisdiction,
        "sort": "latest_action_desc",
        "per_page": 20,
        "include": ["actions"],
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, params=params, headers=_openstates_headers())
            if resp.status_code != 200:
                logger.warning("OpenStates governor-actions %s", resp.status_code)
                return []
            data = resp.json() or {}
    except Exception as e:
        logger.error("OpenStates governor-actions error: %s", e)
        return []

    needle_words = {
        "signed":  ("signed by governor", "became law", "chapter"),
        "vetoed":  ("vetoed", "veto"),
    }
    needles = needle_words.get(action, ("signed",))

    out = []
    for b in (data.get("results") or []):
        la = b.get("latest_action") or {}
        text = (la.get("description") or "").lower()
        if not any(n in text for n in needles):
            continue
        out.append({
            "id": b.get("id"),
            "identifier": b.get("identifier"),
            "title": b.get("title"),
            "latest_action": la.get("description"),
            "latest_action_date": la.get("date"),
            "url": b.get("openstates_url") or b.get("url"),
        })
        if len(out) >= limit:
            break
    _set_cached(key, out)
    return out


# ── State supreme-court cases (CourtListener) ───────────────────────
async def fetch_state_supreme_court_cases(
    state_code: str, justice_name: Optional[str] = None, limit: int = 15,
) -> list[dict]:
    """Return the most recent state supreme-court opinion clusters."""
    court = STATE_SUPREME_COURT_CODES.get((state_code or "").upper())
    if not court:
        return []

    key = f"state-scotus::{court}::{justice_name or 'all'}::{limit}"
    cached = _get_cached(key, CACHE_TTL_SHORT)
    if cached is not None:
        return cached

    page_size = min(max(1, int(limit or 15)) * (3 if justice_name else 1), 50)
    url = f"{COURTLISTENER_API}/clusters/"
    params = {
        # v4 clusters filter is docket__court (plain ?court= returns HTTP 400)
        "docket__court": court,
        "order_by": "-date_filed",
        "page_size": page_size,
    }
    headers = {}
    cl_token = os.getenv("COURTLISTENER_TOKEN", "").strip()
    if cl_token:
        headers["Authorization"] = f"Token {cl_token}"

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                logger.warning(
                    "CourtListener %s for court=%s%s",
                    resp.status_code, court,
                    " (no token set)" if not cl_token else "",
                )
                return []
            data = resp.json() or {}
    except Exception as e:
        logger.error("CourtListener (%s) error: %s", court, e)
        return []

    results = data.get("results") or []
    needle = (justice_name or "").strip().lower() or None
    out = []
    for c in results:
        judges = (c.get("judges") or "").strip()
        if needle and needle not in judges.lower():
            continue
        out.append({
            "id": c.get("id"),
            "case_name": c.get("case_name")
                or c.get("case_name_short")
                or c.get("case_name_full"),
            "date_filed": c.get("date_filed"),
            "docket_number": c.get("docket_number"),
            "precedential_status": c.get("precedential_status"),
            "judges": judges or None,
            "absolute_url": c.get("absolute_url"),
            "url": f"https://www.courtlistener.com{c.get('absolute_url') or ''}"
                if c.get("absolute_url") else None,
            "syllabus": (c.get("syllabus") or "").strip() or None,
        })
        if len(out) >= limit:
            break
    _set_cached(key, out)
    return out


# ── Derived issue-areas for a state legislator (AI over bill titles) ──
_STATE_ISSUE_SYS = (
    "You are a neutral civic-data assistant for CivicView, a non-partisan "
    "platform. From a state legislator's sponsored-bill titles, identify the "
    "2-3 broad POLICY AREAS they most focus on. Use neutral, widely recognized "
    "issue-area names (e.g., Healthcare, Education, Public Safety, Taxation, "
    "Transportation, Environment, Housing, Agriculture). Describe ONLY the "
    "subject areas of their bills \u2014 never infer a political position, "
    "stance, or endorsement. Output ONLY a JSON array, no prose: "
    '[{"name": "<issue area, 1-4 words>", "blurb": "<one neutral factual sentence>"}]'
)


async def derive_state_legislator_issues(
    state_code: str,
    name: str,
    chamber: Optional[str] = None,
    district: Optional[str] = None,
    openstates_id: Optional[str] = None,
    source_url: Optional[str] = None,
) -> list[dict]:
    """Derive 2-3 neutral issue-areas for a state legislator from the titles
    of their sponsored bills, via the Haiku AI service. Returns [] when AI or
    OpenStates isn't configured, when the legislator has no bills, or on any
    parse error. Cached 24h. Labeled as derived, not stated positions."""
    from app.services import ai_service
    if not ai_service.is_configured():
        return []

    cache_key = f"state-issues::{openstates_id or (state_code + name)}"
    cached = _get_cached(cache_key, CACHE_TTL_XLONG)
    if cached is not None:
        return cached

    bills = await fetch_state_legislator_bills(
        state_code=state_code, name=name, chamber=chamber, district=district,
        limit=25, openstates_id=openstates_id,
    )
    titles = [b.get("title") for b in bills if b.get("title")]
    if not titles:
        return []

    last = (name or "").strip().split()[-1] if name else "this legislator"
    user = "Sponsored bill titles:\n- " + "\n- ".join(titles[:25])
    try:
        res = await asyncio.to_thread(
            ai_service.chat,
            system=_STATE_ISSUE_SYS,
            messages=[{"role": "user", "content": user}],
            max_tokens=400, temperature=0.2,
        )
    except Exception as e:
        logger.error("state-issues AI error: %s", e)
        return []
    if getattr(res, "error", None) or not getattr(res, "text", None):
        return []

    txt = res.text.strip()
    lo, hi = txt.find("["), txt.rfind("]")
    if lo == -1 or hi == -1:
        return []
    try:
        arr = _json.loads(txt[lo:hi + 1])
    except Exception:
        return []

    out = []
    for it in (arr or [])[:3]:
        if not isinstance(it, dict):
            continue
        nm = (it.get("name") or "").strip()
        if not nm:
            continue
        blurb = (it.get("blurb") or f"A frequent focus of {last}'s sponsored state legislation.").strip()
        out.append({
            "name": nm,
            "stance": blurb + " (Derived from sponsored bills \u2014 a focus area, not a stated position.)",
            "sources": [source_url] if source_url else [],
        })
    _set_cached(cache_key, out)
    return out
