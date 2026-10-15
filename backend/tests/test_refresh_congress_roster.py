"""scripts/refresh_congress_roster.py rebuilds the roster and keeps every curated field.

Run:  cd backend && python3 tests/test_refresh_congress_roster.py   (exit 0 = pass)

Offline: a four-person legislators-current.yaml and a scratch data
folder stand in for the real ones, with the clock on January 4, 2027
(the 120th Congress).

  1. A dry run writes nothing.
  2. The report lists the new member, the member who changed seat, and
     the member who left.
  3. --write creates congress_roster.json with each member's party,
     seat, start dates and photo, and the counts and vacancies.
  4. --write marks the departed member former_member and leaves every
     curated field (bio, Areas of Focus, experience, sources) as it was;
     the new member gets no empty profile.
  5. A second --write changes nothing.
  6. If no member's term starts with the new Congress, --write refuses
     (exit 1) and writes nothing.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path

_failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


YAML = """
- id: {bioguide: A000001}
  name: {first: Ann, last: Able, official_full: Ann Able}
  terms:
  - {type: rep, start: '2023-01-03', end: '2025-01-03', state: OH, district: 3, party: Republican}
  - {type: rep, start: '2025-01-03', end: '2027-01-03', state: OH, district: 3, party: Republican}
  - {type: rep, start: '2027-01-03', end: '2029-01-03', state: OH, district: 3, party: Republican}
- id: {bioguide: C000003}
  name: {first: Cal, last: Cole, official_full: Cal Cole}
  terms:
  - {type: rep, start: '2025-01-03', end: '2027-01-03', state: NV, district: 2, party: Democrat}
  - {type: sen, start: '2027-01-03', end: '2033-01-03', state: NV, party: Democrat}
- id: {bioguide: D000004}
  name: {first: Dee, last: Dunn, official_full: Dee Dunn}
  terms:
  - {type: rep, start: '2027-01-03', end: '2029-01-03', state: WY, district: 0, party: Independent}
- id: {bioguide: E000005}
  name: {first: Eve, last: Esse, official_full: Eve Esse}
  terms:
  - {type: sen, start: '2026-03-24', end: '2027-01-03', state: OK, party: Republican, how: appointment}
"""

PROFILES = {
    "A000001": {"bio": "Ann Able represents Ohio's 3rd congressional district.",
                "bio_sources": ["https://clerk.house.gov/"],
                "top_issues": [{"name": "Energy", "stance": "Sponsored the Grid Act.",
                                "sources": ["https://www.congress.gov/bill/119th-congress/house-bill/1"]}],
                "experience": [{"role": "U.S. Representative, Ohio", "from": "2023", "to": "Present"}]},
    "B000002": {"bio": "Bo Bell represents Utah in the U.S. Senate.",
                "top_issues": [{"name": "Water", "stance": "Sponsors water bills.", "sources": []}]},
    "C000003": {"top_issues": [{"name": "Mining", "stance": "Sponsors mining bills.", "sources": []}]},
}


def run(script, argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = script.main(argv)
    return code, out.getvalue()


def main() -> int:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import refresh_congress_roster as script

    tmp = Path(tempfile.mkdtemp())
    fed = tmp / "app" / "data" / "federal"
    fed.mkdir(parents=True)
    yaml_path = tmp / "legislators-current.yaml"
    yaml_path.write_text(YAML, encoding="utf-8")
    (fed / "congress_profiles.json").write_text(json.dumps(PROFILES, indent=2) + "\n", encoding="utf-8")
    (fed / "congress_photo_overrides.json").write_text(json.dumps({"D000004": "https://example.gov/d.jpg"}), encoding="utf-8")
    (fed / "federal_officials.json").write_text(json.dumps({"congress": {}}), encoding="utf-8")
    base = ["--legislators", str(yaml_path), "--as-of", "2027-01-04", "--data-dir", str(tmp / "app" / "data")]
    profiles_before = (fed / "congress_profiles.json").read_text(encoding="utf-8")

    code, out = run(script, base)
    check("1: dry run writes nothing",
          code == 0 and not (fed / "congress_roster.json").exists()
          and (fed / "congress_profiles.json").read_text(encoding="utf-8") == profiles_before, out[-300:])
    check("2: new member listed", "D000004 Dee Dunn (I, House, WY-AL)" in out, out)
    check("2b: seat change listed", "C000003 Cal Cole: House, NV-2 -> Senate, NV" in out, out)
    check("2c: departure listed", "B000002 B000002: marked former_member" in out, out)
    check("2d: the unchanged member is not listed", "A000001" not in out.split("Vacant seats")[0], out)

    code, out = run(script, base + ["--write"])
    roster = json.loads((fed / "congress_roster.json").read_text(encoding="utf-8"))
    a = roster["members"].get("A000001", {})
    e = roster["members"].get("E000005", {})
    check("3: roster written with every member", code == 0 and set(roster["members"]) == {
        "A000001", "C000003", "D000004", "E000005"}, out[-300:])
    check("3b: seat, party and start dates",
          a.get("party") == "R" and a.get("district") == 3 and a.get("in_seat_since") == "2023-01-03"
          and a.get("term_start") == "2027-01-03", str(a))
    check("3c: appointment and override photo carried",
          e.get("how") == "appointment" and roster["members"]["D000004"]["photo_source"] == "override"
          and roster["members"]["D000004"]["district"] == 0, str(roster["members"]))
    check("3d: counts and congress",
          roster["congress"] == 120 and roster["counts"]["senate"] == {"D": 1, "R": 1}
          and roster["counts"]["house"]["R"] == 1 and roster["counts"]["house"]["I"] == 1, str(roster["counts"]))
    check("3e: an empty seat is a vacancy",
          {"chamber": "House", "state": "OH", "district": 1} in roster["vacancies"]
          and {"chamber": "House", "state": "WY", "district": 0} not in roster["vacancies"])

    prof = json.loads((fed / "congress_profiles.json").read_text(encoding="utf-8"))
    check("4: departed member marked former_member", prof["B000002"].get("former_member") is True, str(prof["B000002"]))
    check("4b: curated fields untouched",
          prof["A000001"] == PROFILES["A000001"] and prof["C000003"] == PROFILES["C000003"]
          and prof["B000002"]["bio"] == PROFILES["B000002"]["bio"], str(prof))
    check("4c: no empty profile for the new member", "D000004" not in prof)

    code, out = run(script, base + ["--write"])
    check("5: a second write changes nothing", code == 0 and "Wrote: nothing (no change)" in out, out[-200:])

    stale = tmp / "stale.yaml"
    stale.write_text(YAML.replace("2027-01-03", "2026-12-01"), encoding="utf-8")
    (fed / "congress_roster.json").unlink()
    code, out = run(script, ["--legislators", str(stale), "--as-of", "2027-01-04",
                             "--data-dir", str(tmp / "app" / "data"), "--write"])
    check("6: refuses to write before the roster catches up",
          code == 1 and not (fed / "congress_roster.json").exists() and "Refusing to write" in out, out[-300:])

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
