"""Ballot guard + personalized-ballot checks.

Run from backend/:  python tests/test_ballot_guard.py

Covers the rules in ElectionsService._resolve_race and
get_personalized_ballot:
  * two nominees of any real party (not only R/D) mark a roster unresolved
  * "no party" labels (NPA, I) may repeat
  * top-two states allow at most two candidates, of any party
  * the same person listed twice marks a roster unresolved
  * write-ins never count toward any of this
  * after a concluded primary, an unchecked roster is flagged unverified
  * a U.S. Senate race is on every voter's personal ballot
  * every Florida race is a verified roster with resolvable candidates
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
logging.disable(logging.CRITICAL)

from app.services.elections_service import ElectionsService  # noqa: E402


def main() -> int:
    svc = ElectionsService()
    C = svc._candidates

    def add(cid, name, party, **extra):
        C[cid] = {"id": cid, "name": name, "party": party, **extra}
        return cid

    a = add("t-a", "Ann Alpha", "LPF")
    b = add("t-b", "Bob Beta", "LPF")
    n1 = add("t-n1", "Nia One", "NPA")
    n2 = add("t-n2", "Ned Two", "NPA")
    r = add("t-r", "Rae Red", "R")
    d = add("t-d", "Dee Blue", "D")
    d2 = add("t-d2", "Dan Blue", "D")
    dup = add("t-dup", 'Rae "Rocky" Red Jr.', "NPA")
    wi = add("t-wi", "Will Write", "WRI", write_in=True)
    wi2 = add("t-wi2", "Wanda Write", "R", write_in=True)

    def race(ids, **kw):
        return {"id": "t", "office": "Test", "general_candidates": ids, **kw}

    res = svc._resolve_race(race([r, d, a, b]))
    assert res["general_roster_unresolved"] and "LPF" in res["general_roster_unresolved_parties"], res
    print("[ok] two Libertarian nominees -> unresolved")

    res = svc._resolve_race(race([r, d, n1, n2]))
    assert not res["general_roster_unresolved"], res
    print("[ok] two NPA candidates -> fine")

    res = svc._resolve_race(race([d, d2]), state_code="CA")
    assert not res["general_roster_unresolved"], res
    print("[ok] top-two D vs D in CA -> fine")

    res = svc._resolve_race(race([r, d, d2]), state_code="CA")
    assert res["general_roster_unresolved"] and "top-two" in res["general_roster_unresolved_parties"], res
    print("[ok] three candidates in a top-two state -> unresolved")

    res = svc._resolve_race(race([r, d, dup]))
    assert res["general_roster_unresolved"] and "duplicate-person" in res["general_roster_unresolved_parties"], res
    print("[ok] same person listed twice -> unresolved")

    res = svc._resolve_race(race([r, d, wi, wi2], write_in_candidates=[wi]))
    assert not res["general_roster_unresolved"], res
    assert [c["id"] for c in res["write_in_candidates"]] == [wi], res["write_in_candidates"]
    print("[ok] write-ins never count, and resolve separately")

    res = svc._resolve_race(race([r, d]), primary_concluded=True)
    assert res["general_roster_unverified"], res
    res = svc._resolve_race(race([r, d], roster_status="verified_nominees"), primary_concluded=True)
    assert not res["general_roster_unverified"], res
    res = svc._resolve_race(race([r, d]), primary_concluded=False)
    assert not res["general_roster_unverified"], res
    print("[ok] unverified only after a concluded primary, cleared by verification")

    fl = svc.get_elections("FL")
    assert fl and fl["primary_status"]["concluded"], fl and fl.get("primary_status")
    for rr in fl["races"]:
        assert not rr["general_roster_unresolved"], rr["id"]
        assert not rr["general_roster_unverified"], rr["id"]
        assert rr.get("roster_status") == "verified_nominees", rr["id"]
    print(f"[ok] all {len(fl['races'])} Florida races are verified ballots")

    ballot = svc.get_personalized_ballot("FL", congressional_district="11")
    offices = [x["office"] for x in ballot["races"]]
    assert any(o.startswith("U.S. Senate") for o in offices), offices
    assert "U.S. House, FL-11" in offices, offices
    assert not any(o.startswith("U.S. House, FL-1") and o != "U.S. House, FL-11" for o in offices), offices
    print("[ok] personal ballot for FL-11 has the Senate race and only FL-11")

    measures = [m["number"] for m in ballot["ballot_measures"]]
    assert measures == ["Amendment 1", "Amendment 2", "Amendment 3"], measures
    assert all(m.get("source_url") for m in ballot["ballot_measures"])
    print("[ok] the three official amendments, each sourced")

    print("\nALL BALLOT GUARD CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
