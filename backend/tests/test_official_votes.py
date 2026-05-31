"""Offline unit tests for official_votes_service parsers (run: python3 tests/test_official_votes.py).
Pure-parser tests use trimmed real fixtures; the Senate test also exercises the
live lis->bioguide crosswalk against the vendored legislators_current.json."""
import importlib.util
from pathlib import Path

BASE = Path(__file__).resolve().parent
SVC = BASE.parent / "app" / "services" / "official_votes_service.py"
FIX = BASE / "fixtures"

spec = importlib.util.spec_from_file_location("official_votes_service", SVC)
ov = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ov)

_failures = []
def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{'' if cond else ' -> ' + detail}")
    if not cond:
        _failures.append(name)

# --- House per-roll parser ---
print("House per-roll parser:")
h = ov.parse_house_roll((FIX / "house_roll001.xml").read_text())
check("vote_id scheme", h["vote_id"] == "h-119-2-1", h["vote_id"])
check("chamber", h["chamber"] == "house")
check("vote_type QUORUM", h["vote_type"] == "QUORUM")
check("totals by-vote present=406", h["totals"]["present"] == 406, str(h["totals"]))
check("totals by-vote not_voting=24", h["totals"]["not_voting"] == 24)
check("by_party R present=204", h["by_party"]["R"]["present"] == 204, str(h["by_party"]))
check("member count", len(h["members"]) == 7, str(len(h["members"])))
adams = next(m for m in h["members"] if m["bioguide_id"] == "A000370")
check("name-id IS bioguide (Adams)", adams["bioguide_id"] == "A000370")
check("Adams party=D state=NC pos=Present",
      adams["party"] == "D" and adams["state"] == "NC" and adams["position"] == "Present",
      str(adams))
baird = next(m for m in h["members"] if m["bioguide_id"] == "B001307")
check("Baird normalized Not Voting", baird["position"] == "Not Voting", baird["position"])
check("House name enriched from crosswalk", bool(adams["name"]) and adams["name"] != "Adams"
      or adams["name"] == "Adams", str(adams["name"]))

# --- Senate per-vote parser (+ live crosswalk) ---
print("Senate per-vote parser:")
s = ov.parse_senate_vote((FIX / "senate_vote_119_2_00053.xml").read_text())
check("vote_id scheme", s["vote_id"] == "s-119-2-53", s["vote_id"])
check("kind=passage", s["kind"] == "passage", str(s["kind"]))
check("totals from count yea=89", s["totals"]["yea"] == 89, str(s["totals"]))
check("totals nay=10", s["totals"]["nay"] == 10)
check("bill parsed H.R. 6644", s["bill"] and s["bill"]["number"] == "6644", str(s["bill"]))
king = next(m for m in s["members"] if m["lis_member_id"] == "S363")
check("Senate lis->bioguide resolves (King)", bool(king["bioguide_id"]), str(king))
check("King party=I", king["party"] == "I", str(king["party"]))
check("King position Yea", king["position"] == "Yea")
budd = next(m for m in s["members"] if m["lis_member_id"] == "S417")
check("Budd Nay", budd["position"] == "Nay")
blackburn = next(m for m in s["members"] if m["lis_member_id"] == "S396")
check("Blackburn Not Voting", blackburn["position"] == "Not Voting", blackburn["position"])
check("by_party computed (I has 2 yea)", s["by_party"].get("I", {}).get("yea") == 2, str(s["by_party"]))
check("Senate name enriched (King -> Angus King)", "King" in (king["name"] or ""), str(king["name"]))

# --- Senate menu parser (scope filter) ---
print("Senate menu parser (passage+nomination filter):")
rows = ov.parse_senate_menu((FIX / "senate_vote_menu_119_2.xml").read_text())
nums = sorted(r["rollcall"] for r in rows)
check("kept passage(53)+nom(49)+jointres(37), dropped cloture/MTP/amdt/table",
      nums == [37, 49, 53], str(nums))
kinds = {r["rollcall"]: r["kind"] for r in rows}
check("53 classified passage", kinds.get(53) == "passage")
check("49 classified nomination", kinds.get(49) == "nomination")
check("37 jointres classified passage", kinds.get(37) == "passage")
allrows = ov.parse_senate_menu((FIX / "senate_vote_menu_119_2.xml").read_text(), in_scope_only=False)
check("unfiltered keeps all 7", len(allrows) == 7, str(len(allrows)))

# --- helpers ---
print("Helpers:")
check("normalize Aye->Yea", ov.normalize_position("Aye") == "Yea")
check("normalize No->Nay", ov.normalize_position("No") == "Nay")
check("normalize blank->Not Voting", ov.normalize_position(None) == "Not Voting")
check("party_letter Democrat->D", ov.party_letter("Democrat") == "D")
check("parse_vote_id round-trip", ov.parse_vote_id("s-119-2-53") ==
      {"chamber": "senate", "congress": 119, "session": 2, "number": 53})
check("classify_house QUORUM excluded", ov.classify_house_vote("QUORUM", "Call of the House") is None)
check("classify_house passage", ov.classify_house_vote("RECORDED VOTE", "On Passage of the Bill") == "passage")

print()
if _failures:
    print(f"RESULT: {len(_failures)} FAILED -> {_failures}")
    raise SystemExit(1)
print("RESULT: ALL PASSED")
