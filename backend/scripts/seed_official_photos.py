# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
One-off script: fetch Wikipedia thumbnail URLs for each official in
backend/app/data/federal/federal_officials.json (executive branch +
judiciary + congressional leadership) and write the resulting
`photo_url` field back to the same file.

Why Wikipedia:
  • Free, no API key, no rate limits (above ~50 req/sec).
  • Stable URLs on upload.wikimedia.org — same images served to
    hundreds of millions of users every day.
  • Public domain or freely-licensed (CC) — Wikimedia explicitly
    permits hotlinking thumbnails. Attribution is included on the
    parent Wikipedia article we'd link to anyway.

How we resolve a name → photo:
  1. Hit the Wikipedia REST page-summary endpoint with the name as
     the article title (URL-encoded). If we get a 200 + a thumbnail
     URL, take it.
  2. Some officials have ambiguous names ("Robert F. Kennedy Jr."
     could be Sr. or Jr.) — for those we try the manual override
     map at the bottom of this file before falling through to
     Wikipedia's disambiguator.
  3. If still nothing, log a warning and leave photo_url unset —
     the Avatar component falls back to initials cleanly.

Run with:
    cd backend && python -m scripts.seed_official_photos

Output: federal_officials.json gets `photo_url` injected on each
executive / judiciary / leadership entry. Re-running is idempotent
and only fetches for entries missing a photo_url (so a successful
prior run doesn't re-hit Wikipedia).
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import urllib.parse
from pathlib import Path
from typing import Optional

import httpx

ROOT = Path(__file__).resolve().parents[1]
OFFICIALS_PATH = ROOT / "app" / "data" / "federal" / "federal_officials.json"

WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary"
WIKI_SEARCH = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "CivicView/1.0 (https://civicview.app) photo-seed-script"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("seed_photos")

# Manual overrides for names where Wikipedia's default resolution
# lands on the wrong article (ambiguous names, junior/senior, etc.).
# Add new entries here as we hit them in the wild.
NAME_OVERRIDES: dict[str, str] = {
    "Robert F. Kennedy Jr.":         "Robert F. Kennedy Jr.",
    "Howard Lutnick":                "Howard Lutnick",
    "Lori Chavez-DeRemer":           "Lori Chavez-DeRemer",
    "Brooke Rollins":                "Brooke Rollins",
    "Doug Burgum":                   "Doug Burgum",
    "Pam Bondi":                     "Pam Bondi",
    "Pete Hegseth":                  "Pete Hegseth",
    "Scott Bessent":                 "Scott Bessent",
    "Marco Rubio":                   "Marco Rubio",
    "Donald J. Trump":               "Donald Trump",
    "JD Vance":                      "JD Vance",
    # HUD Secretary — bare "Scott Turner" is a Wikipedia disambiguation
    # page (engineer, songwriter, multiple athletes…). The HUD secretary
    # lives under "Scott Turner (politician)".
    "Scott Turner":                  "Scott Turner (politician)",
    # VA Secretary — same problem: the bare "Doug Collins" page is a
    # disambiguation; the senator/Rep version is "Doug Collins (politician)".
    "Doug Collins":                  "Doug Collins (politician)",
}


async def fetch_thumbnail(client: httpx.AsyncClient, title: str) -> Optional[str]:
    """Hit /page/summary/{title} on the Wikipedia REST API and return
    the URL of the article's primary thumbnail (originalimage when
    available, otherwise thumbnail.source). Returns None on 404 / no
    image / non-person article."""
    if not title:
        return None
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = f"{WIKI_SUMMARY}/{encoded}"
    try:
        r = await client.get(url, headers={"User-Agent": USER_AGENT})
    except httpx.HTTPError as exc:
        logger.warning("HTTP error fetching %s: %s", title, exc)
        return None
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        logger.warning("Unexpected %d fetching %s", r.status_code, title)
        return None
    try:
        data = r.json()
    except json.JSONDecodeError:
        return None
    # Prefer the higher-resolution `originalimage` over the smaller
    # `thumbnail` since we want crisp avatars at 56-96px display sizes
    # on retina screens (and the avatar component scales down anyway).
    original = (data.get("originalimage") or {}).get("source")
    thumb = (data.get("thumbnail") or {}).get("source")
    return original or thumb


async def search_then_fetch(client: httpx.AsyncClient, name: str) -> Optional[str]:
    """Fallback: use Wikipedia's search API to find the most-relevant
    article for `name`, then fetch that page's summary thumbnail."""
    params = {
        "action": "opensearch",
        "search": name,
        "limit": "1",
        "namespace": "0",
        "format": "json",
    }
    try:
        r = await client.get(WIKI_SEARCH, params=params, headers={"User-Agent": USER_AGENT})
    except httpx.HTTPError as exc:
        logger.warning("Search HTTP error for %s: %s", name, exc)
        return None
    if r.status_code != 200:
        return None
    try:
        # OpenSearch returns [query, [titles], [descriptions], [urls]]
        result = r.json()
        titles = result[1] if len(result) > 1 else []
    except (json.JSONDecodeError, IndexError, TypeError):
        return None
    if not titles:
        return None
    return await fetch_thumbnail(client, titles[0])


async def resolve_photo(client: httpx.AsyncClient, name: str) -> Optional[str]:
    """Try the override map → direct name lookup → search-then-fetch.
    Returns the best Wikipedia thumbnail URL found, or None."""
    if not name:
        return None
    # 1. Manual override
    override = NAME_OVERRIDES.get(name)
    if override:
        url = await fetch_thumbnail(client, override)
        if url:
            return url
    # 2. Direct lookup
    url = await fetch_thumbnail(client, name)
    if url:
        return url
    # 3. Search fallback
    return await search_then_fetch(client, name)


async def annotate_officials(payload: dict) -> tuple[int, int]:
    """Walk the federal_officials.json structure and inject photo_url
    on entries that don't already have one. Returns (added, missing)
    counts for the run summary."""
    added = 0
    missing = 0
    targets: list[dict] = []

    exe = payload.get("executive") or {}
    if isinstance(exe.get("president"), dict):
        targets.append(exe["president"])
    if isinstance(exe.get("vice_president"), dict):
        targets.append(exe["vice_president"])
    for c in exe.get("cabinet") or []:
        if isinstance(c, dict):
            targets.append(c)

    # Judiciary: SCOTUS justices live under judiciary.scotus.[].justices
    jud = payload.get("judiciary") or {}
    scotus = jud.get("scotus") or {}
    for j in scotus.get("justices") or []:
        if isinstance(j, dict):
            targets.append(j)

    # Congressional leadership (Speaker, etc.) — also useful avatars
    cong = payload.get("congress") or {}
    for leader in cong.get("leadership") or []:
        if isinstance(leader, dict):
            targets.append(leader)

    async with httpx.AsyncClient(timeout=15.0) as client:
        for entry in targets:
            if entry.get("photo_url"):
                continue
            name = entry.get("name")
            if not name:
                continue
            url = await resolve_photo(client, name)
            if url:
                entry["photo_url"] = url
                added += 1
                logger.info("✓ %s → %s", name, url[:80])
            else:
                missing += 1
                logger.warning("✗ %s — no Wikipedia thumbnail found", name)

    return added, missing


async def main() -> int:
    if not OFFICIALS_PATH.exists():
        logger.error("Missing %s", OFFICIALS_PATH)
        return 1
    with OFFICIALS_PATH.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    added, missing = await annotate_officials(payload)

    with OFFICIALS_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")

    logger.info("Done. +%d photo_urls added, %d still missing.", added, missing)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
