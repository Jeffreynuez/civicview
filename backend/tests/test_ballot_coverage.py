# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""What the Elections tab says it doesn't cover yet (2026-10-24).

Run from backend/:  python tests/test_ballot_coverage.py   (exit 0 = pass)

A Florida ballot had state legislative, judicial and county contests and a
local measure that the data doesn't list yet. The tab only said races
"aren't listed yet" when a state had none, so the
partial list read as the whole ballot.

What it checks:
  Both payloads   the state payload and Your Ballot carry the same
                  coverage, read from the whole state file, whatever
                  address was matched.
  Florida         only some state legislative races; no judicial, county
                  or city races and no local measures; the statewide
                  amendments are listed.
  No races        a state with no legislative races or measures says none.
  Detection       judicial, county and local races and county measures
                  count once the data has them.
  Declarations    a file's "coverage" only ever says "some", for a known
                  part the data has.
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
logging.disable(logging.CRITICAL)

from app.services.elections_service import COVERAGE_PARTS, ElectionsService, _coverage  # noqa: E402


def main() -> int:
    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    svc = ElectionsService()

    # ── Florida, both payloads ───────────────────────────────────────
    fl_expected = {
        "state_legislative": "some",
        "judicial": "none",
        "county_local": "none",
        "statewide_measures": "listed",
        "local_measures": "none",
    }
    full = svc.get_elections("FL")
    check(full.get("coverage") == fl_expected, f"FL state payload coverage: {full.get('coverage')}")
    # A House district that isn't in the data (HD-1) and one that is
    # (HD-42): the same coverage either way.
    for hd in ("1", "42"):
        mine = svc.get_personalized_ballot("FL", county_name="Test", congressional_district="1",
                                           state_senate_district="1", state_house_district=hd)
        check(mine.get("coverage") == fl_expected, f"FL Your Ballot coverage (HD-{hd}): {mine.get('coverage')}")

    # ── A state with no legislative races or measures ────────────────
    found_bare = False
    for code in svc.list_states_with_elections():
        raw = svc._elections_by_state[code]
        races = raw.get("races") or []
        has_leg = any((r.get("chamber") or "").lower().startswith(("state senate", "state house", "state assembly"))
                      for r in races)
        bm = raw.get("ballot_measures") or {}
        if races and not has_leg and not bm.get("state") and not any((bm.get("counties") or {}).values()):
            cov = svc.get_elections(code)["coverage"]
            check(cov["state_legislative"] == "none" and cov["statewide_measures"] == "none"
                  and cov["local_measures"] == "none", f"{code}: nothing listed reads none: {cov}")
            found_bare = True
            break
    check(found_bare, "found a state with races but no legislative races or measures to check")

    # A state whose file lists legislative races and doesn't declare them
    # partial reads "listed".
    for code in svc.list_states_with_elections():
        raw = svc._elections_by_state[code]
        if code != "FL" and any((r.get("chamber") or "").lower().startswith("state senate") for r in raw.get("races") or []):
            cov = svc.get_elections(code)["coverage"]
            check(cov["state_legislative"] == "listed", f"{code}: legislative races listed: {cov}")
            break

    # ── Detection ────────────────────────────────────────────────────
    synthetic = {
        "races": [
            {"level": "judicial", "office": "Circuit Judge, 9th Judicial Circuit, Group 1"},
            {"level": "county", "office": "County Mayor"},
        ],
        "ballot_measures": {"state": [], "counties": {"Test": [{"id": "x", "title": "Library hours"}]}},
    }
    cov = _coverage(synthetic)
    check(cov["judicial"] == "listed" and cov["county_local"] == "listed" and cov["local_measures"] == "listed"
          and cov["statewide_measures"] == "none" and cov["state_legislative"] == "none", f"synthetic: {cov}")
    check(_coverage({"races": [{"level": "state", "office": "Justice of the Supreme Court"}]})["judicial"] == "listed",
          "a justice or judge office counts as judicial")
    check(_coverage({"races": [{"level": "county", "office": "Clerk of Courts"}]})["judicial"] == "none",
          "a clerk of courts is a county race, not a judicial one")
    check(_coverage({"races": [], "coverage": {"judicial": "some"}})["judicial"] == "none",
          "a declared 'some' with nothing in the data still reads none")
    check(set(_coverage({}).keys()) == set(COVERAGE_PARTS), "every part is always present")

    # ── Declarations in the data files ───────────────────────────────
    for code in svc.list_states_with_elections():
        raw = svc._elections_by_state[code]
        declared = raw.get("coverage")
        if declared is None:
            continue
        check(isinstance(declared, dict), f"{code}: coverage is an object")
        for part, value in (declared or {}).items():
            check(part in COVERAGE_PARTS, f"{code}: coverage.{part} is not a known part")
            check(value == "some", f"{code}: coverage.{part} may only say 'some', not {value!r}")
            check(_coverage(raw).get(part) == "some", f"{code}: coverage.{part} says some, but the data has none")
        check(bool(raw.get("_coverage_note")), f"{code}: a coverage declaration says why in _coverage_note")

    if failures:
        print("FAILED:")
        for f in failures:
            print("  -", f)
        return 1
    print("ALL CHECKS PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
