"""Offline unit tests for the federal rep-profile derivation in
congress_service.py (run: python3 tests/test_federal_profile_derivation.py).

Covers:
  * term-field extraction tolerant of the LIVE /member detail shape
    (startYear/stateCode/stateName) AND the older mock shape (start/state)
  * bio + experience derivation against both shapes
  * committee short-name + leadership-label helpers
  * the bioguide->parent-committees inverse index + display getter
  * the non-substantive policy-area filter in get_member_stats

No network: the two committee fetches and the stats fetches are monkeypatched
with trimmed fixtures mirroring the real Congress.gov / community JSON shapes.
"""
import asyncio
import importlib.util
from pathlib import Path

BASE = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(BASE.parent))  # backend/ so absolute `app.` imports resolve
import app.services.congress_service as cs

_failures = []
def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{'' if cond else ' -> ' + detail}")
    if not cond:
        _failures.append(name)

# ── Live-shape terms (what /member/{bioguide} actually returns) ──────────
LIVE_SENATE = [
    {"chamber": "Senate", "startYear": 2019, "endYear": 2025,
     "stateCode": "FL", "stateName": "Florida", "memberType": "Senator"},
    {"chamber": "Senate", "startYear": 2025, "endYear": None,
     "stateCode": "FL", "stateName": "Florida", "memberType": "Senator"},
]
LIVE_HOUSE = [
    {"chamber": "House of Representatives", "startYear": 2023, "endYear": 2025,
     "district": 13, "stateCode": "FL", "stateName": "Florida"},
    {"chamber": "House of Representatives", "startYear": 2025, "endYear": None,
     "district": 13, "stateCode": "FL", "stateName": "Florida"},
]
# Old mock shape, must still work (back-compat for fixtures/other callers)
MOCK_HOUSE = [{"chamber": "House", "start": "2021-01-03", "state": "TX", "district": 7}]

print("term-field extraction (live + mock shapes):")
check("startYear (live)", cs._term_start_year(LIVE_SENATE[0]) == "2019", cs._term_start_year(LIVE_SENATE[0]))
check("start (mock)", cs._term_start_year(MOCK_HOUSE[0]) == "2021", cs._term_start_year(MOCK_HOUSE[0]))
check("stateCode (live)", cs._term_state(LIVE_HOUSE[0]) == "FL", str(cs._term_state(LIVE_HOUSE[0])))
check("state (mock)", cs._term_state(MOCK_HOUSE[0]) == "TX", str(cs._term_state(MOCK_HOUSE[0])))

print("bio derivation (LIVE shape — the regression that was silently degrading):")
sen_bio = cs._derive_bio("Rick Scott", LIVE_SENATE)
check("senate bio has state", "Florida" in sen_bio, sen_bio)
check("senate bio has since-year", "2019" in sen_bio, sen_bio)
house_bio = cs._derive_bio("Anna Paulina Luna", LIVE_HOUSE)
check("house bio has district 13th", "13th" in house_bio, house_bio)
check("house bio has Florida", "Florida" in house_bio, house_bio)

print("experience derivation (LIVE shape):")
exp = cs._derive_experience(LIVE_HOUSE)
check("single collapsed stint", len(exp) == 1, str(exp))
check("role names state+district", exp and "Florida" in exp[0]["role"] and "13" in exp[0]["role"], str(exp))
check("from=2023 to=Present", exp and exp[0]["from"] == "2023" and exp[0]["to"] == "Present", str(exp))
hs = cs._derive_experience(LIVE_SENATE)
check("senate stint present", hs and hs[0]["to"] == "Present" and "Senator" in hs[0]["role"], str(hs))

print("committee name + leadership helpers:")
check("strip House Committee on", cs._short_committee_name("House Committee on Foreign Affairs") == "Foreign Affairs")
check("strip Senate Committee on", cs._short_committee_name("Senate Committee on Armed Services") == "Armed Services")
check("strip Permanent Select", cs._short_committee_name("House Permanent Select Committee on Intelligence") == "Intelligence")
check("strip Joint Committee on", cs._short_committee_name("Joint Committee on Taxation") == "Taxation")
check("chair label", cs._committee_leadership_label("Chairman") == "Chair")
check("ranking label", cs._committee_leadership_label("Ranking Member") == "Ranking Member")
check("vice chair label", cs._committee_leadership_label("Vice Chair") == "Vice Chair")
check("rank-and-file -> None", cs._committee_leadership_label("") is None)

# ── Committee inverse index (monkeypatched fetches) ─────────────────────
FIX_COMMITTEES = [
    {"thomas_id": "HSFA", "name": "House Committee on Foreign Affairs", "type": "house",
     "subcommittees": [{"thomas_id": "14", "name": "Sub A"}]},
    {"thomas_id": "HSGO", "name": "House Committee on Oversight and Government Reform", "type": "house",
     "subcommittees": [{"thomas_id": "06", "name": "Sub B"}]},
    {"thomas_id": "SSAS", "name": "Senate Committee on Armed Services", "type": "senate", "subcommittees": []},
]
FIX_MEMBERSHIP = {
    "HSFA": [{"bioguide": "L000596", "name": "Anna Paulina Luna", "rank": 22, "party": "majority"},
             {"bioguide": "X000001", "name": "Chair Person", "rank": 1, "title": "Chairman", "party": "majority"}],
    "HSGO": [{"bioguide": "L000596", "name": "Anna Paulina Luna", "rank": 19, "party": "majority"}],
    "HSFA14": [{"bioguide": "L000596", "name": "Anna Paulina Luna", "rank": 6, "party": "majority"}],  # sub — must be skipped
    "SSAS": [{"bioguide": "Y000002", "name": "Ranking Sen", "rank": 1, "title": "Ranking Member", "party": "minority"}],
}

def _make_service():
    svc = cs.CongressService()
    async def fake_committees():
        return FIX_COMMITTEES
    async def fake_membership():
        return FIX_MEMBERSHIP
    svc._fetch_committees_current = fake_committees
    svc._fetch_committee_membership = fake_membership
    return svc

print("committee inverse index + display getter:")
svc = _make_service()
luna = asyncio.run(svc.get_member_committees("L000596"))
check("Luna parents only (no sub)", set(luna) == {"Foreign Affairs", "Oversight and Government Reform"}, str(luna))
chair = asyncio.run(svc.get_member_committees("X000001"))
check("chair annotated", chair == ["Foreign Affairs (Chair)"], str(chair))
ranking = asyncio.run(svc.get_member_committees("Y000002"))
check("ranking annotated", ranking == ["Armed Services (Ranking Member)"], str(ranking))
missing = asyncio.run(svc.get_member_committees("Z999999"))
check("unknown member -> []", missing == [], str(missing))

# ── Issue-area noise filter in get_member_stats ─────────────────────────
print("issue-area derivation excludes non-substantive policy areas:")
svc2 = cs.CongressService()
async def fake_party(bg, party):
    return {"pct": None, "analyzed": 0}
async def fake_leg(bg, seg, key, limit):
    if "cosponsored" in seg:
        return []
    return [
        {"policy_area": "Congress"},          # noise — must be dropped
        {"policy_area": "Congress"},          # noise
        {"policy_area": "Private Legislation"},  # noise
        {"policy_area": "Taxation"},
        {"policy_area": "Health"},
        {"policy_area": "Health"},
        {"policy_area": ""},                   # empty — dropped
    ]
svc2._compute_party_line = fake_party
svc2._fetch_legislation = fake_leg
stats = asyncio.run(svc2.get_member_stats("L000596", party="R"))
names = [i["name"] for i in stats["top_issues"]]
check("Congress excluded", "Congress" not in names, str(names))
check("Private Legislation excluded", "Private Legislation" not in names, str(names))
check("substantive kept", set(names) == {"Health", "Taxation"}, str(names))
check("Health weighted highest", names and names[0] == "Health", str(names))

print()
if _failures:
    print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
    raise SystemExit(1)
print("ALL PASSED")
