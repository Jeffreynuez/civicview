# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
OpenFEC (api.open.fec.gov) — federal candidate rosters + campaign-finance
totals. FEDERAL only (US House / Senate / President); the FEC has no state
or local candidates.

Fail-open: when OPEN_FEC_API_KEY is unset, all calls return [] / None so the
backend boots and serves curated data unchanged. In-memory TTL cache.
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

OPENFEC_BASE = "https://api.open.fec.gov/v1"
CACHE_TTL = 6 * 3600  # finance totals update at most a few times a quarter
_cache: dict[str, tuple[float, object]] = {}

_PARTY = {"REP": "R", "DEM": "D", "IND": "I", "LIB": "L", "GRE": "G",
          "NPA": "I", "CON": "C", "DFL": "D"}
_SUFFIX = {"jr", "sr", "ii", "iii", "iv", "v", "md", "phd", "esq"}


def _key() -> str:
    return os.getenv("OPEN_FEC_API_KEY", "").strip()


def is_configured() -> bool:
    return bool(_key())


def _get_cached(k: str):
    if k in _cache:
        ts, v = _cache[k]
        if time.time() - ts < CACHE_TTL:
            return v
        _cache.pop(k, None)
    return None


def _set_cached(k: str, v):
    _cache[k] = (time.time(), v)


def _titlecase_name(raw: str) -> str:
    """OpenFEC 'LAST, FIRST MIDDLE [SUFFIX]' -> 'First Last [Suffix]'. Drops
    honorifics (Mr/Ms/Dr), moves suffixes (Jr/Sr/III) to the end."""
    raw = (raw or "").strip()
    if not raw:
        return raw
    HON = {"mr", "ms", "mrs", "dr", "miss", "mx", "the"}
    SUF = {"jr": "Jr.", "sr": "Sr.", "ii": "II", "iii": "III", "iv": "IV", "v": "V"}
    if "," in raw:
        last_part, rest = raw.split(",", 1)
        last_tokens = last_part.split()
        given_tokens = rest.split()
    else:
        toks = raw.split()
        last_tokens, given_tokens = ([toks[-1]] if toks else []), toks[:-1]
    suffix = None
    given = []
    for tk in given_tokens:
        low = tk.lower().strip(".")
        if low in HON:
            continue
        if low in SUF:
            suffix = SUF[low]
            continue
        given.append(tk)
    cleaned_last = []
    for tk in last_tokens:
        low = tk.lower().strip(".")
        if low in SUF:
            suffix = SUF[low]
            continue
        cleaned_last.append(tk)

    def cap(p):
        if "-" in p:
            return "-".join(w.capitalize() for w in p.split("-"))
        if "'" in p:
            i = p.index("'")
            return p[:i + 1].capitalize() + p[i + 1:].capitalize()
        return p.capitalize()

    name = " ".join(cap(p) for p in (given + cleaned_last))
    return f"{name} {suffix}" if suffix else name


def _party(code: str) -> str:
    return _PARTY.get((code or "").upper().strip(), "I")


def _num(v):
    if v is None or v == "":
        return None
    try:
        return round(float(v))
    except (TypeError, ValueError):
        return None


def _finance(row: dict) -> Optional[dict]:
    rec = _num(row.get("receipts"))
    dis = _num(row.get("disbursements"))
    coh = _num(row.get("cash_on_hand_end_period"))
    if rec is None and dis is None and coh is None:
        return None
    return {
        "total_raised": rec,
        "total_spent": dis,
        "cash_on_hand": coh,
        "as_of": row.get("coverage_end_date"),
    }


async def fetch_state_federal_candidates(
    state: str, cycle: int = 2026, office: str = "H",
) -> list[dict]:
    """Return real, actively-fundraising federal candidates for a state +
    office ('H' or 'S') in a cycle, with finance totals, via OpenFEC
    /candidates/totals/. Filters out paper/inactive/zero-dollar filers.

    Each item:
      {fec_id, name, party, office, district, incumbent, fundraising, status}
    """
    if not is_configured():
        return []
    ck = f"fec::{state}::{cycle}::{office}"
    cached = _get_cached(ck)
    if cached is not None:
        return cached

    out: list[dict] = []
    page = 1
    while page <= 6:
        params = {
            "api_key": _key(), "state": state.upper(), "cycle": cycle,
            "office": office, "per_page": 100, "page": page, "sort": "-receipts",
        }
        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                resp = await client.get(f"{OPENFEC_BASE}/candidates/totals/", params=params)
            if resp.status_code != 200:
                logger.warning("OpenFEC totals %s for %s/%s", resp.status_code, state, office)
                break
            data = resp.json() or {}
        except Exception as e:
            logger.error("OpenFEC totals error: %s", e)
            break

        results = data.get("results") or []
        for r in results:
            # Quality filter: active statutory candidate that actually raised money.
            if (r.get("candidate_status") or "") != "C":
                continue
            if r.get("candidate_inactive"):
                continue
            if not r.get("has_raised_funds"):
                continue
            office_full = "U.S. Senate" if (r.get("office") or office).upper() == "S" else "U.S. House"
            dist = r.get("district_number") or r.get("district")
            try:
                dist = int(dist) if dist not in (None, "", "00") else None
            except (ValueError, TypeError):
                dist = None
            out.append({
                "fec_id": r.get("candidate_id"),
                "name": _titlecase_name(r.get("name")),
                "party": _party(r.get("party")),
                "office": office_full,
                "district": dist,
                "incumbent": (r.get("incumbent_challenge") or "").upper() == "I",
                "fundraising": _finance(r),
                "status": r.get("candidate_status"),
            })
        pg = data.get("pagination") or {}
        if page >= (pg.get("pages") or 1):
            break
        page += 1

    _set_cached(ck, out)
    logger.info("OpenFEC %s %s %s -> %d real candidates", state, cycle, office, len(out))
    return out
