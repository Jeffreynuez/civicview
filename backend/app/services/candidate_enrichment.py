# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Candidate record enrichment — applied once at load time by
ElectionsService, so every consumer (profile, ballot, compare, race
listings) sees the same enriched shape without each one re-deriving it.

Two jobs:

1. PHOTO RESOLUTION. Candidate records are hand-curated JSON and almost
   never carry a photo_url, so the UI falls back to initials. But most
   candidates who have held federal office carry a bioguide_id, and the
   sitting-rep path has resolved photos from that for months
   (congress_service._resolve_image_url). This module applies the same
   fallback on the candidate side. We deliberately do NOT import
   congress_service — it pulls httpx, dotenv and an async client stack
   that has no business loading just to build a URL string — so the
   image base and the overrides file are read directly here. If the
   overrides format ever changes, both readers must change together;
   the path is asserted in tests rather than duplicated by hand.

2. FUNDRAISING NORMALIZATION. See normalize_fundraising for the full
   rationale. Short version: a Florida statewide candidate raises money
   through a campaign depository account AND one or more affiliated
   political committees, the state publishes them as unlinked records,
   and any single "total raised" is therefore an editorial aggregation.
   We keep the components and label the sum rather than pretending the
   state published one number.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Public-domain congressional portraits. Same constant as
# congress_service.IMAGE_BASE — see the module docstring for why it is
# repeated rather than imported.
CONGRESS_IMAGE_BASE = "https://unitedstates.github.io/images/congress/225x275"
CONGRESS_PHOTO_CREDIT = "unitedstates.github.io congressional portrait (public domain)"

_PHOTO_OVERRIDES_PATH = DATA_DIR / "federal" / "congress_photo_overrides.json"
_PHOTO_OVERRIDES_CACHE: Optional[dict] = None


def _load_photo_overrides() -> dict:
    """Lazy singleton over the bioguide→Wikipedia-thumbnail overrides
    that seed_congress_photos.py generates. Missing file is not an
    error: it only means nobody has re-seeded, and the base-URL
    fallback below still produces a working portrait for most members.
    """
    global _PHOTO_OVERRIDES_CACHE
    if _PHOTO_OVERRIDES_CACHE is None:
        try:
            with _PHOTO_OVERRIDES_PATH.open("r", encoding="utf-8") as fh:
                loaded = json.load(fh)
            _PHOTO_OVERRIDES_CACHE = loaded if isinstance(loaded, dict) else {}
        except (json.JSONDecodeError, OSError):
            logger.info(
                "candidate_enrichment: no photo overrides at %s — using base URLs only.",
                _PHOTO_OVERRIDES_PATH,
            )
            _PHOTO_OVERRIDES_CACHE = {}
    return _PHOTO_OVERRIDES_CACHE


def resolve_candidate_photo(record: dict) -> dict:
    """Return {photo_url, photo_source, photo_credit} for one candidate.

    A curated photo_url ALWAYS wins — hand curation is how we cover
    candidates who never held federal office, and an automated fallback
    must never overwrite a human's choice. We only fill the gap.

    photo_source / photo_credit exist because the licence differs by
    origin and some origins require visible attribution:
      - 'congress'  → public domain, no attribution required
      - 'wikimedia' → usually CC-BY-SA, attribution REQUIRED
      - 'official'  → state government page, varies
      - 'campaign'  → copyright of the campaign or its photographer
    A curated record that sets photo_url without photo_source gets
    'curated', which is honest about the fact that nobody recorded one.
    """
    existing = (record.get("photo_url") or "").strip() or None
    if existing:
        return {
            "photo_url": existing,
            "photo_source": record.get("photo_source") or "curated",
            "photo_credit": record.get("photo_credit"),
        }

    bioguide = (record.get("bioguide_id") or "").strip() or None
    if bioguide:
        override = _load_photo_overrides().get(bioguide)
        if override:
            return {
                "photo_url": override,
                "photo_source": "wikimedia",
                # Attribution is required for CC-BY-SA. The override file
                # doesn't record per-image licence detail, so we credit the
                # source generically and link out rather than assert a
                # specific licence we haven't verified per file.
                "photo_credit": "Wikimedia Commons",
            }
        return {
            "photo_url": f"{CONGRESS_IMAGE_BASE}/{bioguide}.jpg",
            "photo_source": "congress",
            "photo_credit": CONGRESS_PHOTO_CREDIT,
        }

    return {"photo_url": None, "photo_source": None, "photo_credit": None}


def normalize_fundraising(fund: Optional[dict]) -> Optional[dict]:
    """Normalize a fundraising block, deriving totals from components.

    WHY THIS EXISTS — the Florida problem, stated once:

    A Florida statewide candidate raises through a campaign depository
    account AND one or more affiliated political committees ("Friends of
    X"). The Division of Elections publishes both, but its Affiliates
    field is EMPTY for candidate-aligned committees — there is no
    machine-readable link between a candidate and their PC. Every
    "total raised" figure in the press is therefore an editorial join
    that a human made, not a number the state published.

    So: when a record lists `accounts`, we sum them AND set
    is_aggregate=True and keep the components, so the UI can show the
    headline number with the committees that compose it visible
    underneath. A single-account record is not an aggregate and gets
    no such label. An explicitly-provided total always wins over the
    derived one — a curator who has a filed cover-page figure should
    not have it silently recomputed.

    CASH ON HAND is separate on purpose. Florida's public query
    interface exposes contributions and expenditures only; cash on hand
    lives on report cover pages. It is therefore usually null here, and
    a null is the honest answer rather than raised-minus-spent, which
    would ignore prior-cycle carryover and produce a confidently wrong
    war-chest number. (Verified case: one committee spent $9.35M
    against $3.90M raised this cycle because it started with a
    balance.)
    """
    if not fund or not isinstance(fund, dict):
        return None

    accounts = fund.get("accounts")
    if not isinstance(accounts, list) or not accounts:
        # Legacy / FEC-sourced shape: flat totals, single filer.
        return {**fund, "is_aggregate": False}

    def _sum(key: str) -> Optional[float]:
        vals = [a.get(key) for a in accounts if isinstance(a, dict) and a.get(key) is not None]
        return round(sum(vals), 2) if vals else None

    derived_raised = _sum("raised")
    derived_spent = _sum("spent")

    out = {**fund}
    if out.get("total_raised") is None:
        out["total_raised"] = derived_raised
    if out.get("total_spent") is None:
        out["total_spent"] = derived_spent
    out["is_aggregate"] = len(accounts) > 1
    return out


def enrich_candidate(record: dict) -> dict:
    """Apply every enrichment to one candidate record. Pure and
    idempotent — safe to call twice, which matters because
    ElectionsService may reload."""
    if not isinstance(record, dict):
        return record
    out = {**record, **resolve_candidate_photo(record)}
    out["fundraising"] = normalize_fundraising(record.get("fundraising"))
    return out
