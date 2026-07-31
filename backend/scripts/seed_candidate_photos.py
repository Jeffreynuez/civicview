# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Seed portrait URLs onto candidate records from Wikipedia/Wikimedia.

WHY A SEPARATE SCRIPT FROM seed_official_photos.py
That one seeds sitting federal officials, who are unambiguous: there is
exactly one "Marco Rubio" article and it is the right one. Candidates are
the opposite. A Florida ballot carries people named Matt Taylor, Bobby
Williams and James Shaw, and Wikipedia has articles about several of
each. Grabbing the wrong face and printing it on a candidate's profile
is a worse error than showing initials, and it is the kind of error
nobody notices until a voter does. So this script VALIDATES before it
writes, and prefers no photo over a plausible one.

WHO THIS COVERS
Only candidates with no photo_url AND no bioguide_id. Anyone who has
served in Congress already resolves to a public-domain congressional
portrait at request time (services/candidate_enrichment.py) — running
Wikipedia lookups for them would replace a public-domain image with a
CC-BY-SA one that carries an attribution obligation, which is strictly
worse. This fills the gap those candidates leave: governors,
lieutenant governors, state legislators, and first-time candidates.

LICENSING
Wikimedia images are usually CC-BY-SA and REQUIRE visible attribution.
Every record written here gets photo_source="wikimedia" and a
photo_credit the UI renders under the portrait. Do not strip that field;
it is the licence compliance, not decoration.

Run with:
    cd backend && python -m scripts.seed_candidate_photos --state fl
    cd backend && python -m scripts.seed_candidate_photos --state fl --office "Governor of Florida"
    cd backend && python -m scripts.seed_candidate_photos --state fl --write

Dry-run by default. Nothing is written without --write.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Optional

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.seed_official_photos import to_thumbnail_url  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed_candidate_photos")

DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "data"
SUMMARY_API = "https://en.wikipedia.org/api/rest_v1/page/summary/"
CREDIT = "Wikimedia Commons"

STATE_NAMES = {
    "fl": "Florida", "ca": "California", "ny": "New York",
    "pa": "Pennsylvania", "tx": "Texas",
}

# An article must look like it is about THIS person in THIS state's
# politics. Cheap, but it is the difference between a portrait and a
# libel-adjacent mistake.
POLITICAL_MARKERS = (
    "politician", "senator", "representative", "governor", "attorney general",
    "commissioner", "mayor", "congressman", "congresswoman", "legislator",
    "candidate", "republican", "democrat", "lieutenant governor",
)

# Wikipedia disambiguation pages are never a person.
DISAMBIGUATION_MARKERS = ("may refer to", "disambiguation")


def candidate_titles(name: str, state_name: str) -> list[str]:
    """Article titles to try, most-specific first. The parenthetical
    forms are Wikipedia's own disambiguation convention, so trying them
    BEFORE the bare name avoids landing on a footballer who happens to
    share a state legislator's name."""
    return [
        f"{name} ({state_name} politician)",
        f"{name} (politician)",
        name,
    ]


def looks_like_this_person(summary: dict, name: str, state_name: str, office: str) -> tuple[bool, str]:
    """Validate an article before trusting its thumbnail.

    Returns (ok, reason). We require, in order:
      1. Not a disambiguation page.
      2. The article title shares a surname with the candidate — guards
         against Wikipedia's search redirecting to something unrelated.
      3. The extract mentions the state OR the office, AND reads as
         political. A person can be notable for something else entirely
         and still match a name.
    """
    extract = (summary.get("extract") or "").lower()
    title = (summary.get("title") or "").lower()
    desc = (summary.get("description") or "").lower()
    blob = f"{extract} {desc}"

    if summary.get("type") == "disambiguation" or any(m in blob for m in DISAMBIGUATION_MARKERS):
        return False, "disambiguation page"

    surname = name.strip().split()[-1].lower()
    if surname and surname not in title:
        return False, f"title '{summary.get('title')}' does not contain surname '{surname}'"

    geo_ok = state_name.lower() in blob
    office_word = (office or "").split()[0].lower()
    office_ok = bool(office_word) and office_word in blob
    if not (geo_ok or office_ok):
        return False, f"no mention of {state_name} or {office!r}"

    if not any(m in blob for m in POLITICAL_MARKERS):
        return False, "article does not read as political"

    return True, "ok"


def resolve(client: httpx.Client, name: str, state_name: str, office: str) -> Optional[tuple[str, str]]:
    """Return (thumbnail_url, article_url) or None."""
    for title in candidate_titles(name, state_name):
        url = SUMMARY_API + urllib.parse.quote(title.replace(" ", "_"), safe="")
        try:
            r = client.get(url, timeout=15.0)
        except httpx.HTTPError as e:
            logger.warning("    %s → network error: %s", title, e)
            continue
        if r.status_code != 200:
            continue
        try:
            data = r.json()
        except ValueError:
            continue

        thumb = (data.get("thumbnail") or {}).get("source")
        if not thumb:
            continue

        ok, reason = looks_like_this_person(data, name, state_name, office)
        if not ok:
            logger.info("    rejected '%s': %s", title, reason)
            continue

        article = ((data.get("content_urls") or {}).get("desktop") or {}).get("page") or ""
        return to_thumbnail_url(thumb), article
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True, help="State dir, e.g. fl")
    ap.add_argument("--office", default=None, help="Only candidates whose seeking_office contains this")
    ap.add_argument("--write", action="store_true", help="Persist changes (default: dry run)")
    ap.add_argument("--sleep", type=float, default=0.2, help="Courtesy delay between requests")
    args = ap.parse_args()

    state = args.state.lower()
    state_name = STATE_NAMES.get(state, state.upper())
    path = DATA_DIR / state / "candidates.json"
    if not path.exists():
        logger.error("No candidates.json at %s", path)
        return 1

    with path.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)
    cands = raw.get("candidates", {})

    targets = []
    for cid, rec in cands.items():
        if (rec.get("photo_url") or "").strip():
            continue
        # Congress members already resolve to a public-domain portrait.
        if (rec.get("bioguide_id") or "").strip():
            continue
        if args.office and args.office.lower() not in (rec.get("seeking_office") or "").lower():
            continue
        targets.append((cid, rec))

    logger.info("%d candidate(s) to resolve in %s%s\n",
                len(targets), state.upper(),
                f" (office contains {args.office!r})" if args.office else "")

    found = 0
    headers = {"User-Agent": "CivicView/1.0 (https://civicview.app; civicview@civicview.app)"}
    with httpx.Client(headers=headers, follow_redirects=True) as client:
        for cid, rec in targets:
            name = rec.get("name") or ""
            office = rec.get("seeking_office") or ""
            logger.info("  %s — %s", name, office)
            hit = resolve(client, name, state_name, office)
            if hit:
                thumb, article = hit
                found += 1
                logger.info("    ✓ %s", thumb)
                if args.write:
                    rec["photo_url"] = thumb
                    rec["photo_source"] = "wikimedia"
                    rec["photo_credit"] = CREDIT
                    if article:
                        rec["photo_source_url"] = article
            else:
                logger.info("    · no confident match — leaving initials")
            time.sleep(args.sleep)

    logger.info("\nResolved %d/%d.", found, len(targets))
    if args.write and found:
        with path.open("w", encoding="utf-8") as fh:
            json.dump(raw, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        logger.info("Wrote %s", path)
    elif found:
        logger.info("Dry run — re-run with --write to persist.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
