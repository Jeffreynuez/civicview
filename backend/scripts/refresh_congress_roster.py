# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Rebuild the federal roster from the @unitedstates congress-legislators data.

Run from backend/:

    python scripts/refresh_congress_roster.py            # dry run: report only
    python scripts/refresh_congress_roster.py --write    # write the files

A dry run (the default) prints the report and writes nothing. Run it in
early January, after the new Congress is sworn in (noon Eastern on
January 3 of an odd year) and the @unitedstates project has published
the new members; docs/january-turnover.md has the whole checklist.

Source
------
legislators-current.yaml from https://github.com/unitedstates/congress-legislators
(served at unitedstates.github.io/congress-legislators), the roster the
app already reads at runtime. Its data is in the public domain (CC0).
--legislators reads a local copy instead of downloading it.

What it writes (--write)
------------------------
* app/data/federal/congress_roster.json, rebuilt wholesale: every
  sitting senator, representative and delegate with party, state,
  district, chamber, the start of their current continuous service in
  that seat, their current term, how they got it (election or
  appointment) and their photo (our override when there is one, else
  the @unitedstates image mirror); the party counts; and the House seats
  with nobody in them. Because it is rebuilt each time, the diff shows
  exactly who joined, who left and what changed.
* app/data/federal/congress_profiles.json, only where needed: a member
  who has left gets former_member: true (the profile then says so).
  Nothing curated is removed or rewritten: bios, Areas of Focus,
  experience and their sources stay as they are for every member.

What it reports
---------------
* New members with no profile: they need a short neutral bio and Areas
  of Focus with sources, in the style of the existing ones.
* Members who changed seat (chamber, state or district) in the sitting
  Congress, and members whose party changed: their bio, experience and
  Areas of Focus need a look.
* Departed members: their bio needs a past-tense rewrite (the date and
  how they left, from the House Clerk or senate.gov).
* Photos: overrides kept for members who have left, and (with
  --check-photos) new members the image mirror has no photo for.
* Party counts that differ from federal_officials.json, and vacant
  seats.

It refuses to write when the date says a new Congress is sitting but no
member in the roster has a term that started with it: the @unitedstates
data has not caught up yet, so wait a day and run it again (--force
overrides this check).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from collections import Counter
from pathlib import Path

import httpx
import yaml

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.services.citizen_geo import HOUSE_SEATS  # noqa: E402
from app.services.congress_calendar import congress_start, current_congress  # noqa: E402

DATA_DIR = BACKEND_DIR / "app" / "data"
ROSTER_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.yaml"
IMAGE_BASE = "https://unitedstates.github.io/images/congress/225x275"
PARTY_CODE = {"Republican": "R", "Democrat": "D", "Independent": "I"}
# DC and the five territories send one non-voting delegate each.
DELEGATE_AREAS = {"DC", "PR", "GU", "VI", "AS", "MP"}
# Two terms in the same seat count as one continuous stint when the next
# starts within this many days of the last one ending (House terms end
# and begin on January 3; a special election can leave a short gap).
CONTINUOUS_GAP_DAYS = 31


# ── helpers ──────────────────────────────────────────────────────────

def _date(value) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _seat(term: dict) -> tuple:
    chamber = "Senate" if term.get("type") == "sen" else "House"
    district = term.get("district") if chamber == "House" else None
    return chamber, term.get("state"), district


def _in_seat_since(terms: list) -> str | None:
    """Start of the member's current continuous run in their current seat."""
    if not terms:
        return None
    seat = _seat(terms[-1])
    start = terms[-1].get("start")
    for prev, nxt in zip(reversed(terms[:-1]), reversed(terms[1:])):
        if _seat(prev) != seat:
            break
        gap = (_date(nxt.get("start")) or dt.date.max) - (_date(prev.get("end")) or dt.date.min)
        if gap.days > CONTINUOUS_GAP_DAYS:
            break
        start = prev.get("start")
    return start


def _load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _dump(path: Path, data) -> None:
    """Write the way the data files are written (2-space indent, UTF-8,
    trailing newline), through a temporary file."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    json.loads(tmp.read_text(encoding="utf-8"))
    os.replace(tmp, path)


def load_legislators(source: str | None) -> list:
    if source:
        text = Path(source).read_text(encoding="utf-8")
    else:
        resp = httpx.get(ROSTER_URL, timeout=60.0, follow_redirects=True)
        resp.raise_for_status()
        text = resp.text
    loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
    data = yaml.load(text, Loader=loader)  # nosec B506 - SafeLoader
    if not isinstance(data, list) or not data:
        raise SystemExit("legislators-current.yaml: no members found")
    return data


# ── the roster ───────────────────────────────────────────────────────

def build_roster(legislators: list, overrides: dict, as_of: dt.date) -> dict:
    members: dict[str, dict] = {}
    for entry in legislators:
        bioguide = (entry.get("id") or {}).get("bioguide")
        terms = entry.get("terms") or []
        if not bioguide or not terms:
            continue
        term = terms[-1]
        chamber, state, district = _seat(term)
        name = entry.get("name") or {}
        party_name = term.get("party") or ""
        rec = {
            "name": name.get("official_full") or f"{name.get('first', '')} {name.get('last', '')}".strip(),
            "party": PARTY_CODE.get(party_name, party_name or None),
            "chamber": chamber,
            "state": state,
            "district": district,
            "delegate": chamber == "House" and state in DELEGATE_AREAS,
            "in_seat_since": _in_seat_since(terms),
            "term_start": term.get("start"),
            "term_end": term.get("end"),
            "how": term.get("how") or "election",
            "photo_url": overrides.get(bioguide) or f"{IMAGE_BASE}/{bioguide}.jpg",
            "photo_source": "override" if overrides.get(bioguide) else "mirror",
        }
        if term.get("end-type"):
            rec["term_ends_by"] = term["end-type"]
        members[bioguide] = rec

    counts = {"senate": Counter(), "house": Counter(), "delegates": Counter()}
    held: set = set()
    senators: Counter = Counter()
    for rec in members.values():
        if rec["chamber"] == "Senate":
            counts["senate"][rec["party"]] += 1
            senators[rec["state"]] += 1
        elif rec["delegate"]:
            counts["delegates"][rec["party"]] += 1
            held.add((rec["state"], 0))
        else:
            counts["house"][rec["party"]] += 1
            held.add((rec["state"], 0 if HOUSE_SEATS.get(rec["state"]) == 1 else rec["district"]))
    vacancies = []
    for state, seats in sorted(HOUSE_SEATS.items()):
        for d in ([0] if seats == 1 else range(1, seats + 1)):
            if (state, d) not in held:
                vacancies.append({"chamber": "House", "state": state, "district": d})
    for state in sorted({s for s, n in HOUSE_SEATS.items() if s not in DELEGATE_AREAS}):
        for _ in range(2 - senators.get(state, 0)):
            vacancies.append({"chamber": "Senate", "state": state})
    house_vacant = sum(1 for v in vacancies if v["chamber"] == "House" and v["state"] not in DELEGATE_AREAS)

    return {
        "_note": ("Rebuilt by scripts/refresh_congress_roster.py from the @unitedstates "
                  "legislators-current.yaml; do not edit by hand. Curated profiles live in "
                  "congress_profiles.json. district 0 is an at-large seat."),
        "_source": ROSTER_URL,
        "_as_of": as_of.isoformat(),
        "congress": current_congress(as_of),
        "counts": {
            "senate": dict(sorted(counts["senate"].items())),
            "house": {**dict(sorted(counts["house"].items())), "vacant": house_vacant},
            "delegates": dict(sorted(counts["delegates"].items())),
        },
        "vacancies": vacancies,
        "members": dict(sorted(members.items())),
    }


# ── reconciliation ───────────────────────────────────────────────────

def reconcile(roster: dict, legislators: list, profiles: dict, previous: dict | None,
              overrides: dict, federal: dict) -> tuple[dict, dict]:
    """(updated profiles, report). Nothing curated is removed."""
    current = roster["members"]
    report: dict[str, list] = {k: [] for k in (
        "new_needs_bio", "seat_changed", "party_changed", "departed", "returned",
        "photo_overrides_for_departed", "counts_differ", "vacancies", "notes")}
    updated = json.loads(json.dumps(profiles))

    def seat_label(rec: dict) -> str:
        if rec["chamber"] == "Senate":
            return f"Senate, {rec['state']}"
        return f"House, {rec['state']}-{'AL' if not rec['district'] else rec['district']}"

    for bg, rec in current.items():
        if bg not in profiles:
            report["new_needs_bio"].append(f"{bg} {rec['name']} ({rec['party']}, {seat_label(rec)})")
        elif profiles[bg].get("former_member"):
            report["returned"].append(
                f"{bg} {rec['name']}: in the roster again but marked former_member; "
                f"remove the flag and update the bio by hand")

    # Seat changes in the sitting Congress, from each member's own terms.
    opened = congress_start(roster["congress"]).isoformat()
    by_bg = {(e.get("id") or {}).get("bioguide"): e for e in legislators}
    for bg, rec in current.items():
        terms = (by_bg.get(bg) or {}).get("terms") or []
        if len(terms) >= 2 and str(terms[-1].get("start")) >= opened and _seat(terms[-1]) != _seat(terms[-2]):
            before = dict(zip(("chamber", "state", "district"), _seat(terms[-2])))
            report["seat_changed"].append(
                f"{bg} {rec['name']}: {seat_label(before)} -> {seat_label(rec)}; review the bio, "
                f"experience and Areas of Focus")
    if previous:
        for bg, rec in current.items():
            old = (previous.get("members") or {}).get(bg)
            if not old:
                continue
            if (old.get("chamber"), old.get("state"), old.get("district")) != (rec["chamber"], rec["state"], rec["district"]):
                line = f"{bg} {rec['name']}: {seat_label(old)} -> {seat_label(rec)}; review the bio, experience and Areas of Focus"
                if not any(x.startswith(f"{bg} ") for x in report["seat_changed"]):
                    report["seat_changed"].append(line)
            if old.get("party") != rec["party"]:
                report["party_changed"].append(
                    f"{bg} {rec['name']}: party {old.get('party')} -> {rec['party']}; confirm it on the "
                    f"House Clerk or senate.gov member list")

    # Departures: anyone we carried as sitting who is not in the roster.
    carried = set((previous or {}).get("members") or {}) | {
        bg for bg, p in profiles.items() if not p.get("former_member")}
    for bg in sorted(carried - set(current)):
        name = ((previous or {}).get("members") or {}).get(bg, {}).get("name") or bg
        if bg in updated:
            if not updated[bg].get("former_member"):
                updated[bg]["former_member"] = True
                report["departed"].append(
                    f"{bg} {name}: marked former_member. Rewrite the bio in the past tense with the "
                    f"date and how they left (House Clerk vacancies page or senate.gov), close "
                    f"the 'to Present' in experience, and drop stances that describe a current role")
        else:
            report["departed"].append(f"{bg} {name}: left; no profile to update")
    for bg in sorted(set(overrides) - set(current)):
        report["photo_overrides_for_departed"].append(
            f"{bg}: kept (their profile still shows it); remove it only if the profile goes")

    for chamber in ("senate", "house"):
        ours = (federal.get("congress") or {}).get(chamber, {}).get("party_breakdown") or {}
        theirs = roster["counts"][chamber]
        for key in sorted({*ours, *theirs} - {"_note"}):
            if ours.get(key, 0) != theirs.get(key, 0):
                report["counts_differ"].append(
                    f"{chamber} {key}: federal_officials.json {ours.get(key, 0)}, roster {theirs.get(key, 0)}")
    for v in roster["vacancies"]:
        where = v["state"] if v["chamber"] == "Senate" else f"{v['state']}-{'AL' if not v['district'] else v['district']}"
        report["vacancies"].append(f"{v['chamber']} {where}")
    return updated, report


def check_photos(roster: dict, report: dict) -> None:
    """New-to-us members with no override: is there a mirror photo?"""
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        for bg, rec in roster["members"].items():
            if rec["photo_source"] != "mirror":
                continue
            try:
                status = client.head(rec["photo_url"]).status_code
            except httpx.HTTPError as exc:
                report["notes"].append(f"{bg}: photo check failed ({exc.__class__.__name__})")
                continue
            if status != 200:
                report.setdefault("photo_missing", []).append(
                    f"{bg} {rec['name']}: no mirror photo yet ({status}); add an official portrait to "
                    f"congress_photo_overrides.json and run scripts/build_photo_credits.py --write")


def print_report(roster: dict, report: dict, outcome: str) -> None:
    c = roster["counts"]
    print(f"Roster as of {roster['_as_of']} ({roster['congress']}th Congress): "
          f"{len(roster['members'])} members")
    print(f"  Senate {c['senate']}  House {c['house']}  Delegates {c['delegates']}")
    titles = {
        "new_needs_bio": "New members with no profile (write a neutral bio and Areas of Focus with sources)",
        "seat_changed": "Changed seat in this Congress",
        "party_changed": "Party changes",
        "departed": "Departed",
        "returned": "Back in the roster",
        "photo_missing": "Photos missing",
        "photo_overrides_for_departed": "Photo overrides for members no longer sitting",
        "counts_differ": "Party counts that differ from federal_officials.json (update them by hand)",
        "vacancies": "Vacant seats",
        "notes": "Notes",
    }
    for key, title in titles.items():
        items = report.get(key) or []
        print(f"\n{title}: {len(items)}")
        for line in items:
            print(f"  {line}")
    print()
    print(outcome)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="report only (the default)")
    mode.add_argument("--write", action="store_true", help="write congress_roster.json and congress_profiles.json")
    ap.add_argument("--legislators", help="local copy of legislators-current.yaml (skips the download)")
    ap.add_argument("--as-of", help="treat this date (YYYY-MM-DD) as today")
    ap.add_argument("--check-photos", action="store_true", help="check the image mirror for members without an override")
    ap.add_argument("--force", action="store_true", help="write even if the roster has not caught up with the new Congress")
    ap.add_argument("--report-json", help="also write the report as JSON to this path")
    ap.add_argument("--data-dir", default=str(DATA_DIR), help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    data_dir = Path(args.data_dir)
    fed_dir = data_dir / "federal"
    roster_path = fed_dir / "congress_roster.json"
    profiles_path = fed_dir / "congress_profiles.json"
    as_of = dt.date.fromisoformat(args.as_of) if args.as_of else dt.date.today()

    legislators = load_legislators(args.legislators)
    overrides = _load_json(fed_dir / "congress_photo_overrides.json", {})
    profiles = _load_json(profiles_path, {})
    previous = _load_json(roster_path, None)
    federal = _load_json(fed_dir / "federal_officials.json", {})

    roster = build_roster(legislators, overrides, as_of)
    updated, report = reconcile(roster, legislators, profiles, previous, overrides, federal)
    if args.check_photos:
        check_photos(roster, report)

    opened = congress_start(roster["congress"]).isoformat()
    caught_up = any(str(r.get("term_start")) >= opened for r in roster["members"].values())
    if not caught_up:
        report["notes"].append(
            f"No member's term starts on or after {opened}, when the {roster['congress']}th Congress "
            f"was seated: legislators-current.yaml has not been updated for it yet.")

    wrote: list = []
    if args.write:
        if not caught_up and not args.force:
            print_report(roster, report,
                         "Refusing to write: the roster has not caught up with the new Congress (see Notes). "
                         "Nothing written. Wait for @unitedstates to update, or pass --force.")
            return 1
        old = {k: v for k, v in (previous or {}).items() if k != "_as_of"}
        new = {k: v for k, v in roster.items() if k != "_as_of"}
        if old != new:
            _dump(roster_path, roster)
            wrote.append(str(roster_path.relative_to(data_dir.parent.parent)))
        if updated != profiles:
            _dump(profiles_path, updated)
            wrote.append(str(profiles_path.relative_to(data_dir.parent.parent)))
    if args.write:
        outcome = "Wrote: " + (", ".join(wrote) if wrote else "nothing (no change)")
    else:
        outcome = "Dry run: nothing written. Run with --write to save."
    print_report(roster, report, outcome)
    if args.report_json:
        Path(args.report_json).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
