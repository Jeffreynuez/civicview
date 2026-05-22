# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Optional

import httpx

# Cap stored URLs to this width. The Avatar displays at 40-88px;
# 2x retina is 176px. 250px gives crisp pixels with headroom for
# the largest hero we render.
#
# Why 250 specifically: Wikipedia's thumbor service rejects arbitrary
# widths with HTTP 400 — it only generates from a small bucket of
# known sizes (250, 330, 500, 640, ...). Widths like 200/220/256/320
# get rejected for some files. 250 has worked universally in testing
# and matches the default "thumbnail" size the Wikipedia REST API
# returns when it returns one. Bumping above 250 means picking from
# the next bucket up (330) which is fine but uses ~2x the bytes
# without visible improvement at our display sizes.
THUMB_WIDTH = 250


def to_thumbnail_url(url: str, width: int = THUMB_WIDTH) -> str:
    """Transform any upload.wikimedia.org URL into a width-bounded
    thumbnail. Wikipedia's URL scheme for sized thumbnails:

        https://upload.wikimedia.org/wikipedia/commons/thumb/<h1>/<h2>/<file>/<W>px-<file>

    Where <h1>/<h2> is the 1-char / 2-char MD5 prefix Wikipedia uses
    to shard storage. We need to support two input shapes:

    1. Already-thumbnailed: ".../thumb/X/XX/Foo.jpg/3840px-Foo.jpg"
       → swap the leading "3840" for our target width.

    2. Original file: ".../commons/X/XX/Foo.jpg"
       → insert "/thumb/" and append "/<W>px-Foo.jpg".

    Any URL that doesn't match either shape (or isn't on
    upload.wikimedia.org at all) is returned unchanged.

    Query strings (e.g. ?utm_source=...) are stripped — they're added
    by Wikipedia's REST API for analytics and offer no functional
    value here.
    """
    if not url:
        return url
    base = url.split("?", 1)[0]

    # Shape 1: already a /thumb/ URL.
    m = re.match(
        r"^(https://upload\.wikimedia\.org/wikipedia/commons/thumb/[^/]+/[^/]+/[^/]+)/(\d+)px-(.+)$",
        base,
    )
    if m:
        prefix, _, suffix = m.groups()
        return f"{prefix}/{width}px-{suffix}"

    # Shape 2: direct file URL.
    m = re.match(
        r"^(https://upload\.wikimedia\.org/wikipedia/commons)/([^/]+)/([^/]+)/([^/?]+\.(?:jpg|jpeg|png|gif|webp))$",
        base,
        flags=re.IGNORECASE,
    )
    if m:
        host, h1, h2, filename = m.groups()
        return f"{host}/thumb/{h1}/{h2}/{filename}/{width}px-{filename}"

    return base

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
    # Prefer the `originalimage` URL so we know the canonical filename,
    # then transform to a bounded thumbnail. The raw thumbnail field
    # is sometimes already small (~320px), sometimes weirdly large
    # (3840px for some entries) — normalizing through to_thumbnail_url
    # gives us deterministic ~256px output regardless of which the
    # API chose to return today.
    original = (data.get("originalimage") or {}).get("source")
    thumb = (data.get("thumbnail") or {}).get("source")
    chosen = original or thumb
    return to_thumbnail_url(chosen) if chosen else None


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

    # Judiciary: SCOTUS justices. The actual JSON path is
    # judiciary.supreme_court.members[] (not .scotus.justices as an
    # earlier guess assumed). The Chief Justice + 8 associate
    # justices each get their own portrait.
    jud = payload.get("judiciary") or {}
    sc = jud.get("supreme_court") or {}
    for j in sc.get("members") or []:
        if isinstance(j, dict):
            targets.append(j)

    # Congressional leadership: Senate (President pro tem, leaders,
    # whips) and House (Speaker, leaders, whips, caucus chairs) live
    # in two separate arrays under congress.senate.leadership and
    # congress.house.leadership. Both want photos for the home-page
    # leadership cards.
    cong = payload.get("congress") or {}
    for leader in (cong.get("senate") or {}).get("leadership") or []:
        if isinstance(leader, dict):
            targets.append(leader)
    for leader in (cong.get("house") or {}).get("leadership") or []:
        if isinstance(leader, dict):
            targets.append(leader)

    shrunk = 0
    async with httpx.AsyncClient(timeout=15.0) as client:
        for entry in targets:
            existing = entry.get("photo_url")
            if existing:
                # Retroactively normalize an existing URL to a small
                # thumbnail. Cheap (string transform) and idempotent —
                # a URL that's already at THUMB_WIDTH comes out
                # unchanged. Earlier runs of this script stored
                # 3840px-wide originals; this resizes them in place
                # without re-fetching from Wikipedia.
                shrunk_url = to_thumbnail_url(existing)
                if shrunk_url != existing:
                    entry["photo_url"] = shrunk_url
                    shrunk += 1
                    logger.info("↻ %s → resized to %dpx", entry.get("name"), THUMB_WIDTH)
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

    if shrunk:
        logger.info("Resized %d existing photo URLs to %dpx", shrunk, THUMB_WIDTH)
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
