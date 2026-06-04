# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
build_state_federal_candidates.py — generate per-state federal candidate
data (Task #96) from OpenFEC, mirroring the Florida files.

For a given state it produces two files under data/<state>/:
  • candidates.json  — {_note, _source, candidates:{id:{...}}}
  • elections.json   — {_note, _source, state, ..., races:[...], ballot_measures}

Depth (decided 2026-06-04): SKELETON for challengers (FEC-sourced facts only),
auto-ENRICHED for incumbents by joining the FEC candidate_id -> bioguide
crosswalk (data/_cache/legislators_current.json `id.fec`) -> the neutral,
already-sourced issue profiles in data/federal/congress_profiles.json.
Nothing about a challenger is invented: name/party/office/district/fundraising
come straight from the FEC; top_issues stays [] unless we have a sourced profile.

Requires OPEN_FEC_API_KEY in the environment. Run host-side where the key
lives, or in a session that has it. Writes nothing unless --write is passed.

Usage:
  python scripts/build_state_federal_candidates.py --state TX            # dry-run report
  python scripts/build_state_federal_candidates.py --state TX --write    # write files
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json
import re
import sys
from pathlib import Path

# Make `app...` importable when run from backend/.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.services import fec_service  # noqa: E402

DATA_DIR = BACKEND_ROOT / "app" / "data"
TODAY = _dt.date.today().isoformat()
CYCLE_DEFAULT = 2026

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}
# Census state FIPS — used by the personalized-ballot matcher.
STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "FL": "12", "GA": "13", "HI": "15", "ID": "16",
    "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22",
    "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28",
    "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33", "NJ": "34",
    "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40",
    "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46", "TN": "47",
    "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54",
    "WI": "55", "WY": "56",
}
PARTY_WORD = {
    "R": "Republican", "D": "Democratic", "I": "independent",
    "L": "Libertarian", "G": "Green", "C": "Constitution Party",
}


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return re.sub(r"-+", "-", s) or "candidate"


# ── Crosswalk: FEC candidate_id -> incumbent profile ───────────────────────

def load_crosswalk():
    """Return (fec_to_bioguide, profiles, legislators_by_bioguide)."""
    leg_path = DATA_DIR / "_cache" / "legislators_current.json"
    prof_path = DATA_DIR / "federal" / "congress_profiles.json"
    legislators = json.loads(leg_path.read_text(encoding="utf-8"))
    profiles = json.loads(prof_path.read_text(encoding="utf-8"))

    fec_to_bioguide: dict[str, str] = {}
    by_bioguide: dict[str, dict] = {}
    for m in legislators:
        bio = m.get("id", {}).get("bioguide")
        if not bio:
            continue
        by_bioguide[bio] = m
        for fec_id in m.get("id", {}).get("fec", []) or []:
            fec_to_bioguide[fec_id] = bio
    return fec_to_bioguide, profiles, by_bioguide


def _age_from_birthday(birthday: str | None) -> int | None:
    if not birthday:
        return None
    try:
        b = _dt.date.fromisoformat(birthday)
    except ValueError:
        return None
    t = _dt.date.today()
    return t.year - b.year - ((t.month, t.day) < (b.month, b.day))


def _latest_term(member: dict) -> dict:
    terms = member.get("terms") or []
    return terms[-1] if terms else {}


def _current_office(member: dict, state_name: str) -> str | None:
    term = _latest_term(member)
    ttype = term.get("type")
    if ttype == "sen":
        return f"U.S. Senator, {state_name}"
    if ttype == "rep":
        dist = term.get("district")
        if dist in (None, 0):
            return f"U.S. Representative, {state_name} (At-Large)"
        return f"U.S. Representative, {state_name}-{dist}"
    return None


# ── Record builders ────────────────────────────────────────────────────────

def _seeking_office(office: str, state_abbr: str, state_name: str, district) -> str:
    if office == "S":
        return f"U.S. Senate, {state_name}"
    if district in (None, 0):
        return f"U.S. House, {state_abbr} (At-Large)"
    return f"U.S. House, {state_abbr}-{district}"


def _bio_sentence(name: str, party: str, seeking: str, incumbent: bool,
                  current_office: str | None) -> str:
    pw = PARTY_WORD.get(party)
    party_clause = f"{pw} " if pw else ""
    if incumbent and current_office:
        return (f"{name} is a {party_clause}candidate for {seeking}, "
                f"currently serving as {current_office}.")
    if incumbent:
        return f"{name} is a {party_clause}candidate for {seeking}, currently the incumbent."
    return f"{name} is a {party_clause}candidate for {seeking}."


def build_candidate(fec_rec: dict, state_abbr: str, state_name: str,
                    crosswalk, district_override=None) -> dict:
    fec_to_bioguide, profiles, by_bioguide = crosswalk
    fec_id = fec_rec.get("fec_id")
    name = fec_rec.get("name") or "Unknown"
    party = fec_rec.get("party") or "I"
    office_code = "S" if "Senate" in (fec_rec.get("office") or "") else "H"
    district = district_override if district_override is not None else fec_rec.get("district")
    seeking = _seeking_office(office_code, state_abbr, state_name, district)

    bioguide = fec_to_bioguide.get(fec_id)
    profile = profiles.get(bioguide) if bioguide else None
    member = by_bioguide.get(bioguide) if bioguide else None
    # Trust FEC's incumbency flag; enrich only when we actually have the profile.
    incumbent = bool(fec_rec.get("incumbent"))
    enrich = bool(profile and member)

    current_office = _current_office(member, state_name) if member else None
    age = _age_from_birthday((member or {}).get("bio", {}).get("birthday")) if member else None

    if enrich:
        incumbent = True  # crosswalk to a sitting member is authoritative
        # Prefer the authoritative roster name over the FEC string cleaner
        # ("CORNYN, JOHN SEN" -> "John Cornyn", not "John Sen Cornyn").
        official = (member.get("name", {}) or {}).get("official_full")
        if official:
            name = official
        top_issues = profile.get("top_issues", []) or []
        experience = profile.get("experience")
        if not experience and current_office:
            term = _latest_term(member)
            start = str(term.get("start", ""))[:4] or None
            experience = [{"role": current_office, "from": start, "to": "Present"}]
        data_status = "enriched"
        data_source = "OpenFEC + congress_profiles.json (crosswalk via legislators_current id.fec)"
    else:
        top_issues = []
        experience = []
        data_status = "skeleton"
        data_source = "OpenFEC (active FEC committee; not verified vs state ballot)"

    return {
        "name": name,
        "party": party,
        "seeking_office": seeking,
        "incumbent": incumbent,
        "current_office": current_office,
        "bioguide_id": bioguide,
        "fec_id": fec_id,
        "hometown": None,
        "age": age,
        "website": None,
        "social": {},
        "photo_url": None,
        "bio": _bio_sentence(name, party, seeking, incumbent, current_office),
        "top_issues": top_issues,
        "endorsements": [],
        "fundraising": fec_rec.get("fundraising"),
        "experience": experience or [],
        "data_status": data_status,
        "data_source": data_source,
        "data_observed": TODAY,
        "_office_code": office_code,
        "_district": district,
    }


# ── Main build ──────────────────────────────────────────────────────────────

async def build_state(state_abbr: str, cycle: int):
    state_abbr = state_abbr.upper()
    state_name = STATE_NAMES[state_abbr]
    crosswalk = load_crosswalk()

    senate = await fec_service.fetch_state_federal_candidates(state_abbr, cycle, "S")
    house = await fec_service.fetch_state_federal_candidates(state_abbr, cycle, "H")

    candidates: dict[str, dict] = {}
    used_ids: set[str] = set()
    name_offices: dict[str, set] = {}  # collision report

    def assign_id(rec: dict, office_code: str, district) -> str:
        base = f"{state_abbr.lower()}-cand-{slugify(rec['name'])}"
        suffix = "sen" if office_code == "S" else f"h{district if district not in (None, 0) else 'al'}"
        cid = f"{base}-{suffix}"
        if cid in used_ids:  # extremely rare same-name same-seat: tail the fec id
            cid = f"{cid}-{(rec.get('fec_id') or '').lower()[-4:]}"
        used_ids.add(cid)
        return cid

    seen_fec: dict[str, str] = {}  # fec_id -> first cid (cross-office dedup)
    senate_ids: list[str] = []
    house_by_district: dict[int, list[str]] = {}
    incumbent_by_seat: dict[str, str] = {}  # seat-key -> cid

    for office_code, rows in (("S", senate), ("H", house)):
        for fec_rec in rows:
            fec_id = fec_rec.get("fec_id")
            cand = build_candidate(fec_rec, state_abbr, state_name, crosswalk)
            district = cand["_district"]
            if fec_id and fec_id in seen_fec:
                # same committee already placed (e.g. dupe across office fetch)
                continue
            cid = assign_id(cand, office_code, district)
            if fec_id:
                seen_fec[fec_id] = cid
            candidates[cid] = cand
            name_offices.setdefault(cand["name"].lower(), set()).add(
                "S" if office_code == "S" else f"H-{district}")
            if office_code == "S":
                senate_ids.append(cid)
                if cand["incumbent"] and cand["data_status"] == "enriched":
                    incumbent_by_seat["S"] = cid
            else:
                if district:
                    house_by_district.setdefault(district, []).append(cid)
                    if cand["incumbent"] and cand["data_status"] == "enriched":
                        incumbent_by_seat[f"H-{district}"] = cid

    # ── Build races ──
    fips = STATE_FIPS[state_abbr]
    races: list[dict] = []

    def party_groups(ids: list[str]) -> dict[str, list[str]]:
        groups: dict[str, list[str]] = {}
        for cid in ids:
            groups.setdefault(candidates[cid]["party"], []).append(cid)
        return groups

    if senate_ids:
        races.append({
            "id": f"{state_abbr.lower()}-{cycle}-us-senate",
            "office": f"U.S. Senate, {state_name}",
            "level": "federal",
            "jurisdiction": state_abbr,
            "state_fips": fips,
            "seat_type": "legislative",
            "term_length_years": 6,
            "open_seat": "S" not in incumbent_by_seat,
            "incumbent_candidate_id": incumbent_by_seat.get("S"),
            "primary_candidates": party_groups(senate_ids),
            "general_candidates": [],
            "general_candidates_note": (
                "Candidates listed are those with active FEC committees for the "
                f"{cycle} cycle, grouped by party. The general-election ballot must "
                "be verified against the state's certified candidate list; FEC "
                "committee status does not equal ballot qualification."),
            "notes": (
                f"Auto-generated from OpenFEC on {TODAY}. Skeleton records for "
                "non-incumbents (FEC-sourced facts only); incumbents enriched from "
                "neutral congress_profiles.json. Verify against the state Secretary "
                "of State before treating as a certified ballot."),
            "_roster_source": "OpenFEC /candidates/totals/ (cycle active committees)",
        })

    for district in sorted(house_by_district):
        ids = house_by_district[district]
        seat_key = f"H-{district}"
        races.append({
            "id": f"{state_abbr.lower()}-{cycle}-us-house-{district}",
            "office": f"U.S. House, {state_abbr}-{district}",
            "level": "federal",
            "jurisdiction": f"{state_abbr}-{district}",
            "state_fips": fips,
            "congressional_district": str(district),
            "seat_type": "legislative",
            "term_length_years": 2,
            "open_seat": seat_key not in incumbent_by_seat,
            "incumbent_candidate_id": incumbent_by_seat.get(seat_key),
            "primary_candidates": party_groups(ids),
            "general_candidates": [],
            "general_candidates_note": (
                "Active-FEC-committee filers grouped by party; verify the certified "
                "general-election ballot against the state Secretary of State."),
            "notes": (
                f"Auto-generated from OpenFEC on {TODAY}. Non-incumbents are skeleton "
                "(FEC facts only); incumbent enriched from congress_profiles.json."),
            "_roster_source": "OpenFEC /candidates/totals/ (cycle active committees)",
        })

    # strip private helper keys from candidate records
    for c in candidates.values():
        c.pop("_office_code", None)
        c.pop("_district", None)

    candidates_doc = {
        "_note": (
            f"Federal candidate registry for {state_name} {cycle}, auto-generated "
            f"from OpenFEC on {TODAY} (Task #96). Candidate IDs are stable kebab "
            "slugs referenced by elections.json. SKELETON records carry only "
            "FEC-sourced facts (name, party, office, district, fundraising); nothing "
            "is invented. ENRICHED incumbent records pull neutral, sourced top_issues "
            "+ experience from federal/congress_profiles.json via the FEC->bioguide "
            "crosswalk in _cache/legislators_current.json (id.fec). Fundraising is a "
            "static OpenFEC snapshot — re-run this script to refresh."),
        "_source": (
            "OpenFEC api.open.fec.gov /candidates/totals/ + congress_profiles.json. "
            "FEC committee status != certified ballot qualification; verify the "
            "general-election ballot against the state Secretary of State."),
        "candidates": candidates,
    }
    elections_doc = {
        "_note": (
            f"Federal races for {state_name} {cycle}, auto-generated from OpenFEC on "
            f"{TODAY} (Task #96). candidate_ids point into candidates.json. Only "
            "federal races (US Senate / US House) are present — the FEC has no state "
            "or local candidates (those remain Tasks #98 / #99)."),
        "_source": (
            "OpenFEC /candidates/totals/ active committees. Replace/augment with the "
            "state Secretary of State certified ballot + Ballotpedia when funded."),
        "state": state_abbr,
        "state_name": state_name,
        "cycle": cycle,
        "closed_primary": False,
        "key_dates": {},
        "races": races,
        "ballot_measures": {"state": [], "counties": {}},
        "_personalization_hints": {
            "match_keys": {
                "state": ["level=state"],
                "congressional_district": ["congressional_district=<user.district>"],
            },
            "notes": ("Federal-only payload: US House races match on "
                      "congressional_district; the US Senate race is statewide."),
        },
    }
    report = {
        "state": state_abbr, "cycle": cycle,
        "senate_candidates": len(senate_ids),
        "house_candidates": sum(len(v) for v in house_by_district.values()),
        "house_districts": len(house_by_district),
        "total_candidates": len(candidates),
        "enriched": sum(1 for c in candidates.values() if c["data_status"] == "enriched"),
        "skeleton": sum(1 for c in candidates.values() if c["data_status"] == "skeleton"),
        "incumbents_matched": list(incumbent_by_seat.keys()),
        "cross_office_name_collisions": {
            n: sorted(o) for n, o in name_offices.items() if len(o) > 1},
        "races": len(races),
    }
    return candidates_doc, elections_doc, report


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True)
    ap.add_argument("--cycle", type=int, default=CYCLE_DEFAULT)
    ap.add_argument("--write", action="store_true", help="write files (default: dry run)")
    args = ap.parse_args()

    if not fec_service.is_configured():
        print("ERROR: OPEN_FEC_API_KEY is not set in the environment.", file=sys.stderr)
        sys.exit(2)

    cand_doc, elec_doc, report = await build_state(args.state, args.cycle)
    print(json.dumps(report, indent=2))

    if args.write:
        out_dir = DATA_DIR / args.state.lower()
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "candidates.json").write_text(
            json.dumps(cand_doc, indent=1, ensure_ascii=False), encoding="utf-8")
        (out_dir / "elections.json").write_text(
            json.dumps(elec_doc, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"\nWROTE {out_dir / 'candidates.json'}")
        print(f"WROTE {out_dir / 'elections.json'}")
    else:
        print("\n(dry run — pass --write to persist)")


if __name__ == "__main__":
    asyncio.run(main())
