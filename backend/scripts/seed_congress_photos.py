# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
One-off script: build a `congress_photo_overrides.json` mapping
bioguide_id → Wikipedia thumbnail URL for current congressional members
whose photo is missing from the community-maintained
`unitedstates.github.io/images/congress/225x275/<bioguide>.jpg` mirror.

Why this exists:
  The 119th Congress (sworn in Jan 2025) added ~70 new members, and
  mid-cycle appointees (e.g. Ashley Moody, M001244) keep arriving.
  The volunteer-maintained images repo doesn't always catch up.
  Without an override, those members render as initials in the roster.

How it works:
  1. Load backend/app/data/_cache/legislators_current.json — the
     unitedstates.io legislators_current.yaml mirror keyed by name.
  2. HEAD https://unitedstates.github.io/images/congress/225x275/<bioguide>.jpg
     to see whether GitHub has a photo today.
  3. For every 404, fetch a Wikipedia thumbnail via the same
     resolve_photo() logic used by seed_official_photos (direct
     summary lookup → name overrides → opensearch fallback).
  4. Write the resulting mapping to
     backend/app/data/federal/congress_photo_overrides.json. The
     congress_service consults this file before falling through to
     the GitHub URL.

Run with:
    cd backend && python -m scripts.seed_congress_photos

Idempotent — re-running re-checks GitHub for every member and only
fetches Wikipedia for entries still missing.

This script intentionally reuses the resolve helpers from
seed_official_photos so the Wikipedia logic stays in one place.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Optional

import httpx

# Reuse the Wikipedia resolver from the sibling script. Both scripts live
# in backend/scripts/ so the import is straightforward.
from scripts.seed_official_photos import resolve_photo, USER_AGENT

ROOT = Path(__file__).resolve().parents[1]
LEGISLATORS_PATH = ROOT / "app" / "data" / "_cache" / "legislators_current.json"
OVERRIDES_PATH = ROOT / "app" / "data" / "federal" / "congress_photo_overrides.json"
GITHUB_IMAGE_BASE = "https://unitedstates.github.io/images/congress/225x275"

# Manual name overrides specifically for congressional members where
# Wikipedia's default resolution lands on the wrong article. Add
# entries here as we hit them during runs.
CONGRESS_NAME_OVERRIDES: dict[str, str] = {
    # John James (R-MI) — bare name resolves to a 19th-century English
    # politician; sitting Rep lives under "John James (Michigan
    # politician)".
    "John James": "John James (Michigan politician)",
    # Adam Gray (D-CA) — disambiguation page; the congressman is
    # "Adam Gray (politician)".
    "Adam Gray": "Adam Gray (politician)",
    # Brian Jack (R-GA) — disambiguation; sitting Rep is currently
    # "Brian Jack (Georgia politician)".
    "Brian Jack": "Brian Jack (Georgia politician)",
    # Cleo Fields (D-LA) — straightforward but the bare title sometimes
    # routes to a state-senator-era stub.
    "Cleo Fields": "Cleo Fields",
    # Members whose direct-name lookup + opensearch fallback both
    # missed the right article on the first run. Each comment notes
    # why the bare name failed (disambiguation page, common name,
    # different living person, etc.).
    "Michael Lawler": "Mike Lawler",                       # disambiguation; well-known as "Mike Lawler"
    "Timothy M. Kennedy": "Tim Kennedy (politician)",      # common name shared with a UFC fighter
    "Nicholas J. Begich III": "Nick Begich III",           # commonly known as "Nick"
    "George Whitesides": "George Whitesides (politician)", # disambiguation; aerospace exec is also George Whitesides
    "Tom Barrett": "Tom Barrett (Michigan politician)",    # disambiguation; ex-Milwaukee mayor of same name
    "Mark Harris": "Mark Harris (American politician)",    # disambiguation; multiple Mark Harrises
    "Tim Moore": "Tim Moore (North Carolina politician)",  # disambiguation; NCC Speaker now in Congress
    "Herbert C. Conaway, Jr.": "Herb Conaway",             # commonly known as "Herb"
    "George Latimer": "George Latimer (New York politician)", # disambiguation; film editor of same name
    "Robert P. Bresnahan, Jr.": "Rob Bresnahan",           # commonly known as "Rob"
    "Julie Johnson": "Julie Johnson (politician)",         # disambiguation; sitting Rep is the politician article
    # Alan Armstrong (D-LA) — sworn-in special-election winner; the
    # bare title is a disambig page and the sitting Rep doesn't yet
    # have a dedicated Wikipedia article in mid-2026. Leave entry
    # absent so the frontend falls back to initials (the cleanest
    # behavior we have when no source can produce an image).
}


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("seed_congress_photos")


def best_display_name(entry: dict) -> str:
    """Pick the most-recognizable name for a Wikipedia lookup. Prefer
    `official_full` when present (Wikipedia article titles usually use
    the full official name), otherwise build from first/last."""
    name = entry.get("name") or {}
    full = name.get("official_full")
    if full:
        return full
    first = name.get("first") or ""
    last = name.get("last") or ""
    return f"{first} {last}".strip()


async def github_has_photo(client: httpx.AsyncClient, bioguide: str) -> bool:
    """HEAD the unitedstates.github.io photo URL and return True iff
    the file exists today. Treats network errors as 'present' (we
    don't want a transient failure to bloat the overrides file)."""
    if not bioguide:
        return True
    url = f"{GITHUB_IMAGE_BASE}/{bioguide}.jpg"
    try:
        r = await client.head(url, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
    except httpx.HTTPError as exc:
        logger.warning("HEAD failed for %s: %s — treating as present", bioguide, exc)
        return True
    return r.status_code == 200


async def resolve_with_overrides(client: httpx.AsyncClient, name: str) -> Optional[str]:
    """Apply our congress-specific name overrides before falling
    through to the shared resolver. Returns a Wikipedia thumbnail
    URL or None."""
    override_title = CONGRESS_NAME_OVERRIDES.get(name)
    if override_title:
        # resolve_photo will hit the override title directly via its
        # own internal lookup chain — we pass the override as the
        # name so the first attempt is the disambiguated title.
        url = await resolve_photo(client, override_title)
        if url:
            return url
    return await resolve_photo(client, name)


async def main() -> int:
    if not LEGISLATORS_PATH.exists():
        logger.error("Missing %s — run the legislators cache refresh first", LEGISLATORS_PATH)
        return 1
    with LEGISLATORS_PATH.open("r", encoding="utf-8") as f:
        legislators = json.load(f)

    # Load any pre-existing overrides so a partial re-run is cheap.
    existing: dict[str, str] = {}
    if OVERRIDES_PATH.exists():
        try:
            with OVERRIDES_PATH.open("r", encoding="utf-8") as f:
                existing = json.load(f) or {}
        except json.JSONDecodeError:
            logger.warning("Existing overrides file was malformed — starting fresh.")
            existing = {}

    added = 0
    kept = 0
    cleared = 0
    missing = 0
    overrides: dict[str, str] = {}

    async with httpx.AsyncClient(timeout=15.0) as client:
        for entry in legislators:
            ids = entry.get("id") or {}
            bioguide = ids.get("bioguide")
            if not bioguide:
                continue
            # Skip if GitHub serves a photo for them today. Re-checking
            # every run means an entry stops being an override the
            # moment GitHub catches up — keeps the file small.
            if await github_has_photo(client, bioguide):
                if bioguide in existing:
                    cleared += 1
                continue

            # GitHub 404. Reuse a prior Wikipedia URL if we already
            # have one cached — Wikipedia thumbnail URLs are stable
            # for a given filename / width, so there's no reason to
            # re-fetch when we already resolved it. Saves bandwidth
            # on a re-run.
            cached = existing.get(bioguide)
            if cached:
                overrides[bioguide] = cached
                kept += 1
                continue

            name = best_display_name(entry)
            if not name:
                missing += 1
                continue
            url = await resolve_with_overrides(client, name)
            if url:
                overrides[bioguide] = url
                added += 1
                logger.info("✓ %s (%s) → %s", name, bioguide, url[:80])
            else:
                missing += 1
                logger.warning("✗ %s (%s) — no Wikipedia thumbnail found", name, bioguide)

    OVERRIDES_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Sort keys for stable diffs.
    with OVERRIDES_PATH.open("w", encoding="utf-8") as f:
        json.dump(dict(sorted(overrides.items())), f, indent=2, ensure_ascii=False)
        f.write("\n")

    logger.info(
        "Done. +%d new, %d kept from prior run, %d cleared (GitHub now has them), %d still missing. "
        "Total overrides in file: %d",
        added, kept, cleared, missing, len(overrides),
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
