# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
build_state_federal_candidates.py — generate per-state election data (Task #96)
from OpenFEC + the Open States current-members roster, mirroring Florida.

For a given state it writes data/<state>/:
  • candidates.json  — {_note, _source, candidates:{id:{...}}}
  • elections.json   — {_note, _source, state, key_dates, races:[...],
                        ballot_measures, _measures_note, ...}

Depth (decided 2026-06-04 with Jeffrey):
  • FEDERAL (US Senate / US House) — OpenFEC. Non-incumbents = SKELETON
    (FEC-sourced facts only). Incumbents = ENRICHED from the neutral, already
    sourced congress_profiles.json via the FEC->bioguide crosswalk
    (_cache/legislators_current.json `id.fec`). Both the primary and general
    cards are populated from the active-committee roster; the general carries a
    "verify against the Secretary of State" note (FEC != ballot qualification).
  • STATE LEGISLATURE (State Senate / State House) — INCUMBENT-ONLY records
    built from data/<state>/state_officials.json (real sitting members, sourced
    from Open States). Challenger rosters are not in any free source, so they
    are left out and flagged pending a certified source (#98). Nothing about a
    challenger is ever invented.

Ballot measures are state-specific and NOT auto-derived; per-state notes live
in STATE_BALLOT_NOTE (e.g. Texas has no statewide propositions in even years).

Requires OPEN_FEC_API_KEY in the environment. Writes nothing unless --write.

Usage:
  python scripts/build_state_federal_candidates.py --state TX            # dry run
  python scripts/build_state_federal_candidates.py --state TX --write    # persist
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import json
import re
import sys
from pathlib import Path

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

# Per-state election calendar. Sourced from each state's Secretary of State /
# election authority. Add states as they are built. Missing => federal-only
# behavior (no primary/general dates -> single card).
STATE_KEY_DATES = {
    "TX": {
        "primary": "2026-03-03",
        "primary_runoff": "2026-05-26",
        "general": "2026-11-03",
        "voter_registration_deadline_primary": "2026-02-02",
        "voter_registration_deadline_general": "2026-10-05",
        "early_voting_window_general": "2026-10-19 to 2026-10-30",
    },
    "CA": {
        # California holds a top-two (nonpartisan) primary; June 2 already ran.
        "primary": "2026-06-02",
        "general": "2026-11-03",
        "voter_registration_deadline_primary": "2026-05-18",
        "voter_registration_deadline_general": "2026-10-19",
    },
}
# Per-state ballot-measure reality. TX puts statewide constitutional amendments
# on ODD-year ballots (all 17 were decided Nov 2025), so there are none in 2026.
STATE_BALLOT_NOTE = {
    "TX": ("Texas places statewide constitutional amendments on odd-year ballots — "
           "all 17 statewide propositions were decided in November 2025. There are "
           "no statewide ballot propositions on the November 2026 ballot. Local and "
           "municipal measures are not yet integrated (pending a certified source)."),
    "CA": ("California decides statewide ballot propositions at the November general "
           "election. The certified 2026 proposition list (numbers, titles, and "
           "official summaries) is not yet integrated — pending the California "
           "Secretary of State's official measures list. Local/municipal measures "
           "are also not yet integrated."),
}



# States with a regularly-scheduled or special U.S. Senate election by cycle.
# 2026 = Class 2 regular seats + known specials (FL: Rubio seat, OH: Vance seat).
# Gates out spurious Senate races for states with no seat up (e.g. CA/NY/PA in
# 2026, where stray FEC committees would otherwise surface a phantom race).
SENATE_RACE_STATES = {
    2026: {
        "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS", "KY", "LA",
        "ME", "MA", "MI", "MN", "MS", "MT", "NE", "NH", "NJ", "NM", "NC", "OK",
        "OR", "RI", "SC", "SD", "TN", "TX", "VA", "WV", "WY", "FL", "OH",
    },
}


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return re.sub(r"-+", "-", s) or "candidate"


# ── Crosswalk: FEC candidate_id -> incumbent profile ───────────────────────

def load_crosswalk():
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


# ── Federal record builder ───────────────────────────────────────────────

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


def build_candidate(fec_rec: dict, state_abbr: str, state_name: str, crosswalk) -> dict:
    fec_to_bioguide, profiles, by_bioguide = crosswalk
    fec_id = fec_rec.get("fec_id")
    name = fec_rec.get("name") or "Unknown"
    party = fec_rec.get("party") or "I"
    office_code = "S" if "Senate" in (fec_rec.get("office") or "") else "H"
    district = fec_rec.get("district")
    seeking = _seeking_office(office_code, state_abbr, state_name, district)

    bioguide = fec_to_bioguide.get(fec_id)
    profile = profiles.get(bioguide) if bioguide else None
    member = by_bioguide.get(bioguide) if bioguide else None
    incumbent = bool(fec_rec.get("incumbent"))
    enrich = bool(profile and member)

    current_office = _current_office(member, state_name) if member else None
    age = _age_from_birthday((member or {}).get("bio", {}).get("birthday")) if member else None

    if enrich:
        incumbent = True
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
        "name": name, "party": party, "seeking_office": seeking,
        "incumbent": incumbent, "current_office": current_office,
        "bioguide_id": bioguide, "fec_id": fec_id,
        "hometown": None, "age": age, "website": None, "social": {},
        "photo_url": None,
        "bio": _bio_sentence(name, party, seeking, incumbent, current_office),
        "top_issues": top_issues, "endorsements": [],
        "fundraising": fec_rec.get("fundraising"), "experience": experience or [],
        "data_status": data_status, "data_source": data_source,
        "data_observed": TODAY,
        "_office_code": office_code, "_district": district,
    }


# ── State-legislature incumbent builder ────────────────────────────────────

def build_state_leg(state_abbr: str, state_name: str):
    """Incumbent-only state-leg candidates + races from state_officials.json.
    Chamber name / role / body name are taken from the roster so states whose
    lower house is an Assembly (CA, NY, WI, NV) are labeled accurately. Nothing
    invented: only the sitting member is listed; challengers flagged pending a
    certified roster."""
    path = DATA_DIR / state_abbr.lower() / "state_officials.json"
    if not path.exists():
        return {}, [], {"state_senate": 0, "state_house": 0}
    so = json.loads(path.read_text(encoding="utf-8"))
    cands: dict[str, dict] = {}
    races: list[dict] = []
    counts = {"state_senate": 0, "state_house": 0}
    sos = f"{state_name} Secretary of State"

    # (body_key, district field used by the personalized-ballot matcher, term years)
    bodies = (
        ("state_senate", "state_senate_district", 4),
        ("state_house", "state_house_district", 2),
    )
    for body_key, dist_field, term_yrs in bodies:
        body = so.get(body_key) or {}
        members = body.get("members", []) or []
        default_chamber = "State Senate" if body_key == "state_senate" else "State House"
        body_name = body.get("body_name") or f"{state_name} {default_chamber}"
        for m in members:
            dist = str(m.get("district") or "").strip()
            if not dist:
                continue
            name = m.get("name") or "Unknown"
            party = (m.get("party") or "I").strip().upper()[:1] or "I"
            pw = PARTY_WORD.get(party)
            chamber = m.get("chamber") or default_chamber  # "State Senate"/"State House"/"State Assembly"
            role_word = m.get("role") or ("State Senator" if body_key == "state_senate"
                                          else "State Representative")
            seat_abbr = ("SD" if body_key == "state_senate"
                         else ("AD" if "assembly" in chamber.lower() else "HD"))
            cid = f"{state_abbr.lower()}-cand-{slugify(name)}-{seat_abbr.lower()}{dist}"
            seeking = f"{body_name}, Dist. {dist}"
            current = f"{role_word}, District {dist}"
            contact = m.get("contact") or {}
            cands[cid] = {
                "name": name, "party": party, "seeking_office": seeking,
                "incumbent": True, "current_office": current,
                "bioguide_id": None, "openstates_id": m.get("openstates_id"),
                "fec_id": None, "hometown": None, "age": None,
                "website": contact.get("official_website"), "social": {},
                "photo_url": m.get("photo_url"),
                "bio": (f"{name} is the incumbent "
                        f"{(pw + ' ') if pw else ''}{role_word} for District {dist}."),
                "top_issues": [], "endorsements": [], "fundraising": None,
                "experience": [], "data_status": "incumbent_only",
                "data_source": ("Open States current officeholder "
                                "(state_officials.json); challenger roster + ballot "
                                f"qualification pending a certified {sos} source"),
                "data_observed": TODAY,
            }
            note = ("Only the sitting incumbent is shown (Open States current-members "
                    f"roster). Challenger filings and the certified ballot must be "
                    f"verified against the {sos}; FEC/federal data does not cover "
                    "state races.")
            if body_key == "state_senate":
                note += (f" {state_name} Senate seats have staggered {term_yrs}-year "
                         "terms — only a subset is up in 2026; confirm which against "
                         f"the {sos}.")
            race = {
                "id": f"{state_abbr.lower()}-2026-{chamber.lower().replace(' ', '-')}-{dist}",
                "office": seeking, "level": "state",
                "jurisdiction": f"{state_abbr}-{seat_abbr}-{dist}", "chamber": chamber,
                dist_field: dist, "seat_type": "legislative",
                "term_length_years": term_yrs, "open_seat": False,
                "incumbent_candidate_id": cid,
                "primary_candidates": {party: [cid]},
                "general_candidates": [cid],
                "general_candidates_note": note,
                "notes": (f"Auto-generated {TODAY} from the Open States current-members "
                          "roster. Incumbent-only; challengers pending a certified source."),
                "_roster_source": "Open States current members (state_officials.json)",
            }
            races.append(race)
            counts[body_key] += 1
    return cands, races, counts


# ── Main build ──────────────────────────────────────────────────────────────

async def build_state(state_abbr: str, cycle: int):
    state_abbr = state_abbr.upper()
    state_name = STATE_NAMES[state_abbr]
    crosswalk = load_crosswalk()
    fips = STATE_FIPS[state_abbr]

    # Only fetch a Senate roster when the state actually has a Senate seat up
    # this cycle (otherwise OpenFEC's stray committees would invent a phantom race).
    senate_up = state_abbr in SENATE_RACE_STATES.get(cycle, {state_abbr})
    senate = await fec_service.fetch_state_federal_candidates(state_abbr, cycle, "S") if senate_up else []
    house = await fec_service.fetch_state_federal_candidates(state_abbr, cycle, "H")

    candidates: dict[str, dict] = {}
    used_ids: set[str] = set()
    name_offices: dict[str, set] = {}

    def assign_id(rec: dict, office_code: str, district) -> str:
        base = f"{state_abbr.lower()}-cand-{slugify(rec['name'])}"
        suffix = "sen" if office_code == "S" else f"h{district if district not in (None, 0) else 'al'}"
        cid = f"{base}-{suffix}"
        if cid in used_ids:
            cid = f"{cid}-{(rec.get('fec_id') or '').lower()[-4:]}"
        used_ids.add(cid)
        return cid

    seen_fec: dict[str, str] = {}
    senate_ids: list[str] = []
    house_by_district: dict[int, list[str]] = {}
    incumbent_by_seat: dict[str, str] = {}

    for office_code, rows in (("S", senate), ("H", house)):
        for fec_rec in rows:
            fec_id = fec_rec.get("fec_id")
            cand = build_candidate(fec_rec, state_abbr, state_name, crosswalk)
            district = cand["_district"]
            if fec_id and fec_id in seen_fec:
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
            elif district:
                house_by_district.setdefault(district, []).append(cid)
                if cand["incumbent"] and cand["data_status"] == "enriched":
                    incumbent_by_seat[f"H-{district}"] = cid

    races: list[dict] = []

    def party_groups(ids: list[str]) -> dict[str, list[str]]:
        groups: dict[str, list[str]] = {}
        for cid in ids:
            groups.setdefault(candidates[cid]["party"], []).append(cid)
        return groups

    sos = f"{state_name} Secretary of State"
    fed_general_note = (
        "Both cards are populated from active FEC committees for the cycle, grouped "
        f"by party. The certified general-election ballot must be verified against the "
        f"{sos}; FEC committee status does not equal ballot qualification, and "
        "primary/runoff results are not reflected here.")

    if senate_ids:
        races.append({
            "id": f"{state_abbr.lower()}-{cycle}-us-senate",
            "office": f"U.S. Senate, {state_name}", "level": "federal",
            "jurisdiction": state_abbr, "state_fips": fips,
            "seat_type": "legislative", "term_length_years": 6,
            "open_seat": "S" not in incumbent_by_seat,
            "incumbent_candidate_id": incumbent_by_seat.get("S"),
            "primary_candidates": party_groups(senate_ids),
            "general_candidates": list(senate_ids),
            "general_candidates_note": fed_general_note,
            "notes": (f"Auto-generated from OpenFEC on {TODAY}. Skeleton records for "
                      "non-incumbents (FEC facts only); incumbent enriched from "
                      "congress_profiles.json. Verify against the state ballot."),
            "_roster_source": "OpenFEC /candidates/totals/ (cycle active committees)",
        })

    for district in sorted(house_by_district):
        ids = house_by_district[district]
        seat_key = f"H-{district}"
        races.append({
            "id": f"{state_abbr.lower()}-{cycle}-us-house-{district}",
            "office": f"U.S. House, {state_abbr}-{district}", "level": "federal",
            "jurisdiction": f"{state_abbr}-{district}", "state_fips": fips,
            "congressional_district": str(district), "seat_type": "legislative",
            "term_length_years": 2, "open_seat": seat_key not in incumbent_by_seat,
            "incumbent_candidate_id": incumbent_by_seat.get(seat_key),
            "primary_candidates": party_groups(ids),
            "general_candidates": list(ids),
            "general_candidates_note": fed_general_note,
            "notes": (f"Auto-generated from OpenFEC on {TODAY}. Non-incumbents skeleton "
                      "(FEC facts only); incumbent enriched from congress_profiles.json."),
            "_roster_source": "OpenFEC /candidates/totals/ (cycle active committees)",
        })

    # State-legislature incumbent races
    leg_cands, leg_races, leg_counts = build_state_leg(state_abbr, state_name)
    candidates.update(leg_cands)
    races.extend(leg_races)

    for c in candidates.values():
        c.pop("_office_code", None)
        c.pop("_district", None)

    key_dates = STATE_KEY_DATES.get(state_abbr, {})
    measures_note = STATE_BALLOT_NOTE.get(state_abbr)

    candidates_doc = {
        "_note": (
            f"Candidate registry for {state_name} {cycle}, auto-generated on {TODAY} "
            "(Task #96). FEDERAL candidates (US Senate/House) come from OpenFEC: "
            "non-incumbents are SKELETON (FEC facts only — nothing invented); "
            "incumbents are ENRICHED with neutral, sourced top_issues + experience "
            "from federal/congress_profiles.json via the FEC->bioguide crosswalk in "
            "_cache/legislators_current.json. STATE-LEG candidates are INCUMBENT-ONLY "
            "from state_officials.json (Open States); challengers pending a certified "
            "source. Fundraising is a static OpenFEC snapshot — re-run to refresh."),
        "_source": (
            "OpenFEC api.open.fec.gov + congress_profiles.json (federal) + Open States "
            f"state_officials.json (state-leg incumbents). FEC/roster status != "
            f"certified ballot qualification; verify against the {sos}."),
        "candidates": candidates,
    }
    elections_doc = {
        "_note": (
            f"Races for {state_name} {cycle}, auto-generated on {TODAY} (Task #96). "
            "candidate_ids point into candidates.json. Federal races from OpenFEC; "
            "state-legislature races are incumbent-only from the Open States roster. "
            "Statewide executive + local races and challenger rosters remain "
            "Tasks #98/#99."),
        "_source": (
            "OpenFEC + Open States state_officials.json. Replace/augment with the "
            f"{sos} certified ballot + Ballotpedia when funded."),
        "state": state_abbr, "state_name": state_name, "cycle": cycle,
        "closed_primary": False,  # open-primary state unless overridden
        "key_dates": key_dates,
        "races": races,
        "ballot_measures": {"state": [], "counties": {}},
        "_measures_note": measures_note,
        "_personalization_hints": {
            "match_keys": {
                "state": ["level=state"],
                "congressional_district": ["congressional_district=<user.district>"],
                "state_senate_district": ["state_senate_district=<user.state_senate_district>"],
                "state_house_district": ["state_house_district=<user.state_house_district>"],
            },
            "notes": ("US House matches on congressional_district; state-leg races "
                      "match on state_senate_district / state_house_district; the US "
                      "Senate race is statewide."),
        },
    }
    report = {
        "state": state_abbr, "cycle": cycle,
        "senate_candidates": len(senate_ids),
        "house_candidates": sum(len(v) for v in house_by_district.values()),
        "house_districts": len(house_by_district),
        "state_senate_seats": leg_counts["state_senate"],
        "state_house_seats": leg_counts["state_house"],
        "total_candidates": len(candidates),
        "enriched_incumbents": sum(1 for c in candidates.values() if c["data_status"] == "enriched"),
        "skeleton": sum(1 for c in candidates.values() if c["data_status"] == "skeleton"),
        "state_leg_incumbents": sum(1 for c in candidates.values() if c["data_status"] == "incumbent_only"),
        "federal_incumbents_matched": list(incumbent_by_seat.keys()),
        "cross_office_name_collisions": {
            n: sorted(o) for n, o in name_offices.items() if len(o) > 1},
        "total_races": len(races),
        "key_dates_present": bool(key_dates),
        "measures_note_present": bool(measures_note),
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
