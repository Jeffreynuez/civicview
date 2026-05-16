# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
One-off script: pre-fetch CRS summaries for every sponsored bill we
expect users to see in the early days, and write them to a JSON seed
file the backend loads on first boot.

The point: the user gets instant bill summaries on day one without
spending a cent on LLM calls (CRS summaries are free, professionally
written, and the canonical "what does this bill do" reference). The
on-demand path stays available for newer / less-trafficked bills.

Scope (today):
  • Florida House delegation (29 reps in the 119th Congress)
  • Federal leadership: Speaker, Majority/Minority leaders, etc. — the
    bills they sponsor get featured on home-page surfaces
  • All sponsored bills returned by /member/{bioguide}/sponsored-legislation

Run with:
    cd backend
    python -m scripts.seed_bill_summaries

Output: backend/app/data/bill_summaries_seed.json — committed alongside
the code so production loads it on first boot. Re-run periodically to
refresh the seed; the backend's init pass diffs against the existing
table so no duplicates land.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Optional

# Allow `python -m scripts.seed_bill_summaries` from the backend dir.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Load env BEFORE importing anything that reads CONGRESS_API_KEY.
from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / ".env")

from app.services.congress_service import CongressService  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("seed_bill_summaries")

OUTPUT_PATH = ROOT / "app" / "data" / "bill_summaries_seed.json"
LEGISLATORS_CACHE = ROOT / "app" / "data" / "_cache" / "legislators_current.json"

# Cap the bills we pull per rep — the Congress.gov endpoint can return
# many years of history. 25 is enough to cover the active legislative
# session without ballooning the seed file.
PER_REP_LIMIT = 25
# Pause between Congress.gov calls so we don't trip the rate limiter.
INTER_CALL_DELAY_S = 0.15


def load_florida_bioguides() -> list[str]:
    """Pull bioguide IDs for the Florida House + Senate delegation
    from the local legislators-current cache."""
    if not LEGISLATORS_CACHE.exists():
        logger.warning("Missing %s — run the backend at least once to populate the cache", LEGISLATORS_CACHE)
        return []
    with LEGISLATORS_CACHE.open() as f:
        legislators = json.load(f)
    out: list[str] = []
    for entry in legislators:
        terms = entry.get("terms") or []
        if not terms:
            continue
        cur = terms[-1]
        if cur.get("state") != "FL":
            continue
        bg = (entry.get("id") or {}).get("bioguide")
        if bg:
            out.append(bg)
    return out


# Federal leadership we want covered even if not in FL. Pulled by name
# from the curated federal_officials.json — keep this list short, the
# point is "bills these people sponsor get featured on the home page."
LEADERSHIP_BIOGUIDES: list[str] = [
    # Speaker / leader bioguides — augment as the leadership rotates.
    # If unknown the script skips silently.
    "J000299",  # Speaker Mike Johnson (LA-04)
    "S001209",  # Senate Majority Leader Schumer (placeholder — update when leadership shifts)
    "T000476",  # Senate Minority Leader Thune
    "J000288",  # Senator Ron Johnson (example leadership rotation member)
]


async def fetch_sponsored_bills(svc: CongressService, bioguide: str) -> list[dict]:
    """Fetch sponsored bills for a rep via the existing service. Returns
    the same shape ProfileView.js consumes."""
    try:
        bundle = await svc.get_member_bills(bioguide, limit=PER_REP_LIMIT)
        return (bundle or {}).get("sponsored") or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sponsored-bills fetch failed for %s: %s", bioguide, exc)
        return []


async def fetch_crs(svc: CongressService, bill: dict) -> Optional[dict]:
    """Fetch the CRS summary for one bill. Returns None when no
    summary is on file yet (very common for newly-introduced bills)."""
    congress = bill.get("congress")
    bill_type = bill.get("type")
    number = bill.get("number")
    if not (congress and bill_type and number):
        return None
    try:
        return await svc.get_bill_summary(int(congress), str(bill_type), str(number))
    except Exception as exc:  # noqa: BLE001
        logger.warning("CRS fetch failed for %s %s %s: %s", congress, bill_type, number, exc)
        return None


def normalize_triple(congress, bill_type, number) -> tuple[int, str, str]:
    return (
        int(congress),
        str(bill_type).upper(),
        str(number).lstrip("0") or "0",
    )


async def main() -> int:
    if not os.getenv("CONGRESS_API_KEY"):
        logger.error("CONGRESS_API_KEY not set — set it in backend/.env or as a shell env var")
        return 1

    svc = CongressService()

    bioguides = load_florida_bioguides()
    logger.info("Florida delegation: %d bioguides", len(bioguides))
    bioguides = list(dict.fromkeys(bioguides + LEADERSHIP_BIOGUIDES))
    logger.info("Total reps to process (FL + leadership): %d", len(bioguides))

    # bills we've already seen — keyed by (congress, type, number) so we
    # don't re-fetch the same bill if multiple reps cosponsored it.
    seen: dict[tuple[int, str, str], dict] = {}

    # Pre-load the existing seed file so reruns are merge-not-replace.
    if OUTPUT_PATH.exists():
        try:
            with OUTPUT_PATH.open() as f:
                existing = json.load(f).get("items") or []
            for entry in existing:
                key = normalize_triple(entry["congress"], entry["bill_type"], entry["number"])
                seen[key] = entry
            logger.info("Loaded %d existing seed entries (will merge, not overwrite)", len(seen))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Couldn't read existing seed at %s — starting fresh: %s", OUTPUT_PATH, exc)

    new_summaries = 0

    def flush() -> None:
        """Write the current `seen` map to disk so partial progress
        survives an interrupt. Called after each rep + at the end."""
        items = sorted(
            seen.values(),
            key=lambda x: (x["congress"], x["bill_type"], int(x["number"])),
        )
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with OUTPUT_PATH.open("w") as f:
            json.dump({"items": items}, f, indent=2)

    for i, bg in enumerate(bioguides, start=1):
        logger.info("[%d/%d] Fetching sponsored bills for %s", i, len(bioguides), bg)
        bills = await fetch_sponsored_bills(svc, bg)
        await asyncio.sleep(INTER_CALL_DELAY_S)
        for b in bills:
            key = normalize_triple(b.get("congress"), b.get("type"), b.get("number"))
            if not all(key):
                continue

            entry = seen.get(key) or {
                "congress": key[0],
                "bill_type": key[1],
                "number": key[2],
                "title": b.get("title"),
                "latest_action": b.get("latest_action"),
                "crs_summary": None,
            }
            if b.get("title"):
                entry["title"] = b["title"]
            if b.get("latest_action"):
                entry["latest_action"] = b["latest_action"]

            # Fetch CRS only if we don't already have one cached on
            # this entry. Saves a Congress.gov call on every rerun.
            if entry.get("crs_summary"):
                seen[key] = entry
                continue

            crs = await fetch_crs(svc, b)
            await asyncio.sleep(INTER_CALL_DELAY_S)
            if crs:
                entry["crs_summary"] = crs.get("text")
                new_summaries += 1
            seen[key] = entry

        # Incremental flush after each rep so a kill / timeout
        # doesn't lose the bills we already processed.
        flush()
        logger.info(
            "  flushed: %d bills total, %d with CRS, +%d new this run",
            len(seen),
            sum(1 for v in seen.values() if v.get("crs_summary")),
            new_summaries,
        )

    flush()
    crs_count = sum(1 for v in seen.values() if v.get("crs_summary"))
    logger.info(
        "Done. Wrote %s — %d total bills, %d with CRS summaries (+%d new this run)",
        OUTPUT_PATH, len(seen), crs_count, new_summaries,
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
