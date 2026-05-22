# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Federal live-data fetchers — thin proxies with in-memory caching for:
  • Executive orders (Federal Register API, public, no key)
  • Presidential actions on bills (Congress.gov /law/{congress})
  • SCOTUS opinions (CourtListener REST API, public)

The frontend calls our FastAPI routes; this module keeps the fetch
logic and caching so the endpoint handlers stay simple.
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

FEDREG_API = "https://www.federalregister.gov/api/v1/documents.json"
CONGRESS_API_BASE = "https://api.congress.gov/v3"
COURTLISTENER_API = "https://www.courtlistener.com/api/rest/v4"

CACHE_TTL_SHORT = 900    # 15 min — for live, frequently-updated feeds
CACHE_TTL_LONG  = 3600   # 60 min — slow-moving data (laws already enacted)

_cache: dict[str, tuple[float, object]] = {}


def _public_bill_url(congress, bill_type, number) -> Optional[str]:
    """Build the human-facing congress.gov bill URL.

    Mirrors CongressService._public_bill_url. The Congress.gov API
    returns a `url` field on every bill, but it points at the API
    endpoint (api.congress.gov/v3/bill/...) which requires a key
    and serves JSON. Visitors need the public URL — congress.gov/
    bill/<congress>th-congress/<chamber>-<type>/<number> — which
    renders the human-readable page with text, summary, vote
    history, and committee actions.

    Returns None when inputs are insufficient (missing congress
    number, unknown bill type) so the caller can drop the field.
    """
    if not (congress and bill_type and number):
        return None
    slug_map = {
        "HR":      "house-bill",
        "S":       "senate-bill",
        "HJRES":   "house-joint-resolution",
        "SJRES":   "senate-joint-resolution",
        "HCONRES": "house-concurrent-resolution",
        "SCONRES": "senate-concurrent-resolution",
        "HRES":    "house-resolution",
        "SRES":    "senate-resolution",
    }
    slug = slug_map.get(str(bill_type).upper())
    if not slug:
        return None
    return f"https://www.congress.gov/bill/{congress}th-congress/{slug}/{number}"


def _get_cached(key: str, ttl: int):
    if key in _cache:
        ts, data = _cache[key]
        if time.time() - ts < ttl:
            return data
        _cache.pop(key, None)
    return None


def _set_cached(key: str, data):
    _cache[key] = (time.time(), data)


# ── Executive orders (Federal Register) ───────────────────────────────
async def fetch_executive_orders(
    president_slug: str, limit: int = 20
) -> list[dict]:
    """Return the most recent executive orders signed by the named
    president. `president_slug` is the Federal Register slug
    (e.g. 'donald-trump', 'joseph-r-biden', 'barack-obama')."""
    if not president_slug:
        return []
    key = f"eo::{president_slug}::{limit}"
    cached = _get_cached(key, CACHE_TTL_SHORT)
    if cached is not None:
        return cached

    params = {
        "conditions[type]": "PRESDOCU",
        "conditions[presidential_document_type]": "executive_order",
        "conditions[correction]": "0",
        "conditions[president]": president_slug,
        "order": "newest",
        "per_page": min(max(1, int(limit or 20)), 100),
        "fields[]": [
            "document_number",
            "title",
            "executive_order_number",
            "signing_date",
            "publication_date",
            "citation",
            "html_url",
            "pdf_url",
            "abstract",
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(FEDREG_API, params=params)
            if resp.status_code != 200:
                logger.warning("Federal Register %s for %s", resp.status_code, president_slug)
                return []
            data = resp.json() or {}
    except Exception as e:
        logger.error("Federal Register error for %s: %s", president_slug, e)
        return []

    results = data.get("results") or []
    out = [
        {
            "document_number": r.get("document_number"),
            "title": r.get("title"),
            "eo_number": r.get("executive_order_number"),
            "signing_date": r.get("signing_date"),
            "publication_date": r.get("publication_date"),
            "citation": r.get("citation"),
            "url": r.get("html_url"),
            "pdf_url": r.get("pdf_url"),
            "abstract": r.get("abstract"),
        }
        for r in results
    ]
    _set_cached(key, out)
    return out


# ── Presidential actions on bills (Congress.gov) ──────────────────────
async def fetch_presidential_actions(
    congress: int = 119,
    action_type: str = "signed",
    limit: int = 20,
) -> list[dict]:
    """Return bills that became law ('signed') or were vetoed during the
    given congress. Uses the /law/{congress} endpoint for enacted laws.
    Requires CONGRESS_API_KEY; returns [] if unset.

    For veto data, this is a best-effort filter over recent bills whose
    `latestAction.text` mentions 'Vetoed'. Many presidencies have no
    vetoes in a given congress, which is fine.
    """
    api_key = os.getenv("CONGRESS_API_KEY", "")
    if not api_key:
        logger.info("No CONGRESS_API_KEY — presidential-actions returns []")
        return []

    action = (action_type or "signed").lower()
    key = f"pa::{congress}::{action}::{limit}"
    cached = _get_cached(key, CACHE_TTL_LONG)
    if cached is not None:
        return cached

    base_params = {
        "api_key": api_key,
        "format": "json",
        "limit": min(max(1, int(limit or 20)), 100),
        "sort": "updateDate desc",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            if action == "signed":
                # Enacted laws, Congress.gov `/law/{congress}`
                url = f"{CONGRESS_API_BASE}/law/{int(congress)}"
                resp = await client.get(url, params=base_params)
                if resp.status_code != 200:
                    logger.warning("Congress /law/%s returned %s", congress, resp.status_code)
                    return []
                data = resp.json() or {}
                bills = data.get("bills") or []
                out = []
                for b in bills:
                    laws = b.get("laws") or []
                    law_number = laws[0].get("number") if laws else None
                    out.append({
                        "congress": b.get("congress"),
                        "type": b.get("type"),
                        "number": b.get("number"),
                        "citation": f"{b.get('type','')} {b.get('number','')}".strip(),
                        "title": b.get("title"),
                        "latest_action": (b.get("latestAction") or {}).get("text"),
                        "latest_action_date": (b.get("latestAction") or {}).get("actionDate"),
                        "law_number": law_number,
                        "url": _public_bill_url(b.get("congress"), b.get("type"), b.get("number")),
                    })
                _set_cached(key, out)
                return out

            if action in ("vetoed", "veto"):
                # /bill/{congress} with action-date filter, then filter client-side.
                url = f"{CONGRESS_API_BASE}/bill/{int(congress)}"
                resp = await client.get(url, params=base_params)
                if resp.status_code != 200:
                    return []
                data = resp.json() or {}
                bills = data.get("bills") or []
                out = []
                for b in bills:
                    la = (b.get("latestAction") or {}).get("text", "").lower()
                    if "veto" in la:
                        out.append({
                            "congress": b.get("congress"),
                            "type": b.get("type"),
                            "number": b.get("number"),
                            "citation": f"{b.get('type','')} {b.get('number','')}".strip(),
                            "title": b.get("title"),
                            "latest_action": (b.get("latestAction") or {}).get("text"),
                            "latest_action_date": (b.get("latestAction") or {}).get("actionDate"),
                            "url": _public_bill_url(b.get("congress"), b.get("type"), b.get("number")),
                        })
                _set_cached(key, out)
                return out
    except Exception as e:
        logger.error("Congress presidential-actions error: %s", e)
        return []

    return []


# ── SCOTUS cases (CourtListener) ──────────────────────────────────────
async def fetch_scotus_cases(
    justice_name: Optional[str] = None,
    limit: int = 15,
) -> list[dict]:
    """Return the most recent Supreme Court opinion clusters. If
    `justice_name` is given (e.g. 'Roberts', 'Jackson'), results are
    filtered to clusters whose panel/judges includes that surname.

    The CourtListener v4 REST endpoint is public and does not require an
    API key for reads at low volume.
    """
    key = f"scotus::{justice_name or 'all'}::{limit}"
    cached = _get_cached(key, CACHE_TTL_SHORT)
    if cached is not None:
        return cached

    # Pull more rows than requested if filtering by justice so the
    # post-filter set still has ~limit entries.
    page_size = min(max(1, int(limit or 15)) * (3 if justice_name else 1), 50)
    url = f"{COURTLISTENER_API}/clusters/"
    params = {
        "court": "scotus",
        "order_by": "-date_filed",
        "page_size": page_size,
    }
    # CourtListener now requires auth for most v4 endpoints; include the
    # token if set so users who drop one into `.env` get live results.
    headers = {}
    cl_token = os.getenv("COURTLISTENER_TOKEN", "").strip()
    if cl_token:
        headers["Authorization"] = f"Token {cl_token}"
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                logger.warning(
                    "CourtListener %s for court=scotus%s",
                    resp.status_code,
                    " (no token set)" if not cl_token else "",
                )
                return []
            data = resp.json() or {}
    except Exception as e:
        logger.error("CourtListener error: %s", e)
        return []

    results = data.get("results") or []
    out = []
    needle = (justice_name or "").strip().lower() or None
    for c in results:
        judges = (c.get("judges") or "").strip()
        if needle and needle not in judges.lower():
            continue
        out.append({
            "id": c.get("id"),
            "case_name": c.get("case_name")
                or c.get("case_name_short")
                or c.get("case_name_full"),
            "citation": c.get("citation_count") and c.get("citation_count") or None,
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


# Convenience: map our seed IDs → Federal Register president slugs.
# Extend as we add historical presidents.
PRESIDENT_FEDREG_SLUGS = {
    "us-pres-trump":   "donald-trump",
    "us-pres-biden":   "joseph-r-biden",
    "us-pres-obama":   "barack-obama",
    "us-pres-wbush":   "george-w-bush",
    "us-pres-clinton": "william-j-clinton",
}
