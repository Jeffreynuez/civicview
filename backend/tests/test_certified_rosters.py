"""Certified general election rosters (Part 2 of the elections work order).

Run from backend/:  python tests/test_certified_rosters.py

Covers:
  * every general list is alphabetical by last name (one rule everywhere)
  * a race with no candidates listed carries no "not confirmed" warning
  * the "On ballot" badge counts only people on a verified, printed list:
    not withdrawn, eliminated, ended or duplicate records, and not an
    unopposed race; a stale active_candidacy in an officials file is dropped
  * a campaign ended with no official reason (not_on_ballot) reads
    neutrally in every notice and refusal, never as a loss
  * every verified race passes the one nominee per party guard, and an
    open primary (Louisiana's November ballot for U.S. House) may list
    several candidates of one party without tripping it
  * every candidate on a verified race carries the party label exactly as
    the list prints it, an empty one when the list prints none
  * one sitting member of Congress is linked to one candidate only
  * Your Ballot finds the U.S. House race for an at-large state and for a
    district written "7", "07" or "CA-7"
  * ranked choice is marked only where the state's own page says so:
    every Alaska race, and Maine's federal races but not its Governor
"""
import logging
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
logging.disable(logging.CRITICAL)

from app.services import ballot_status  # noqa: E402
from app.services import page_lifecycle as pl  # noqa: E402
from app.services import page_lifecycle_job as job  # noqa: E402
from app.services.elections_service import ElectionsService, _sort_key  # noqa: E402
from app.services.state_officials_service import StateOfficialsService  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def main() -> int:
    svc = ElectionsService()

    # 1. Alphabetical by last name in every race in every state.
    out_of_order = []
    empty_flagged = []
    for st in svc.list_states_with_elections():
        for race in svc.get_elections(st)["races"]:
            general = race["general_candidates"]
            keys = [_sort_key(c) for c in general]
            if keys != sorted(keys):
                out_of_order.append(race["id"])
            for party, rows in (race.get("primary_candidates") or {}).items():
                pk = [_sort_key(c) for c in rows]
                if pk != sorted(pk):
                    out_of_order.append(f"{race['id']} primary {party}")
            if not general and race.get("general_roster_unverified"):
                empty_flagged.append(race["id"])
    check("1 every general and primary list is alphabetical by last name", not out_of_order, str(out_of_order[:5]))
    check("1 sort_name wins over the last word", _sort_key({"name": "Madeleine Dean", "sort_name": "Dean Cunnane, Madeleine"})[0] == "dean cunnane")
    check("1 suffixes and accents do not change the order",
          _sort_key({"name": "Robert J Harvie Jr."})[0] == "harvie" and _sort_key({"name": "Lauren B. Peña"})[0] == "pena")

    # 2. Empty races say nothing they cannot back.
    check("2 a race with no candidates listed is not flagged unverified", not empty_flagged, str(empty_flagged[:5]))

    # 3. The badge.
    on = ballot_status.on_ballot_ids()
    cands = svc._candidates
    bad = [cid for cid in on if cands.get(cid, {}).get("withdrawn") or cands.get(cid, {}).get("eliminated")
           or cands.get(cid, {}).get("duplicate_of")]
    check("3 no withdrawn, eliminated or duplicate record is on the ballot", not bad, str(bad[:5]))
    ended = [cid for cid, c in cands.items() if c.get("ended_reason") == "not_on_ballot"]
    check("3 there are not_on_ballot records to test", bool(ended))
    check("3 a not_on_ballot record has no badge", ended and not any(ballot_status.is_on_ballot(c) for c in ended))
    unopposed = [cid for st in svc.list_states_with_elections() for r in svc._elections_by_state[st]["races"]
                 if r.get("uncontested_general") for cid in r.get("general_candidates") or []]
    check("3 an unopposed race (not printed) gives no badge",
          not any(ballot_status.is_on_ballot(c) for c in unopposed), str(unopposed[:3]))
    listed = [cid for st in svc.list_states_with_elections() for r in svc._elections_by_state[st]["races"]
              if r.get("roster_status") == "verified_nominees" and not r.get("uncontested_general")
              for cid in r.get("general_candidates") or []]
    check("3 every candidate on a verified printed list has the badge",
          listed and all(ballot_status.is_on_ballot(c) for c in listed))
    so = StateOfficialsService()
    stale = []

    def walk(node, st):
        if isinstance(node, dict):
            ac = node.get("active_candidacy")
            if isinstance(ac, dict) and not ballot_status.is_on_ballot(ac.get("candidate_id")):
                stale.append((st, ac.get("candidate_id")))
            for v in node.values():
                walk(v, st)
        elif isinstance(node, list):
            for v in node:
                walk(v, st)
    for st in list(so._by_state):
        walk(so.get_state_officials(st), st)
    check("3 no served official carries a badge for someone not on the ballot", not stale, str(stale[:5]))

    # 4. Neutral wording for a campaign ended with no official reason.
    t = pl.Transition(page_id="x-cand-test", page_kind="candidate", event="not_on_ballot",
                      recorded_on=date(2026, 10, 16), office_label="U.S. House, Texas District 2",
                      election_year="2026", display_name="Pat Test", state="TX")
    today = date(2026, 10, 20)
    texts = {
        "date_line": t.date_line() or "",
        "tracker": job.tracker_text(t, "Pat Test", today),
        "person": job.person_left_text(t, today),
        "ended": pl._ended_sentence(t),
    }
    for name, text in texts.items():
        check(f"4 {name} says the person isn't on the ballot",
              "isn't on the 2026 general election ballot" in text or "aren't on the 2026 general election ballot" in text, text)
        lowered = text.lower()
        check(f"4 {name} never claims a loss or a withdrawal",
              not any(w in lowered for w in ("lost", "defeat", "withdrew", "primary result")), text)
        check(f"4 {name} has no em or en dash", "\u2013" not in text and "\u2014" not in text, text)
    check("4 the title is the same Former candidate title as any ended campaign",
          t.title(today) == "Former candidate for U.S. House, Texas District 2 (2026)", t.title(today))
    check("4 the page is not stuck read-only: it archives three months after the recorded date",
          t.archive_on == date(2027, 1, 16), str(t.archive_on))

    # 5. The guard on every verified race; open primaries.
    flagged, open_primaries = [], []
    for st in svc.list_states_with_elections():
        for race in svc.get_elections(st)["races"]:
            if race.get("roster_status") == "verified_nominees" and race.get("general_roster_unresolved"):
                flagged.append(race["id"])
            if race.get("open_primary"):
                open_primaries.append(race)
    check("5 no verified race trips the one nominee per party guard", not flagged, str(flagged[:5]))
    crowded = [r for r in open_primaries
               if max([sum(1 for c in r["general_candidates"] if c.get("party") == p) for p in ("R", "D")] or [0]) > 1]
    check("5 an open primary lists several candidates of one party", bool(crowded))
    raw = next(r for r in svc._elections_by_state["LA"]["races"] if r["id"] == "la-2026-us-house-5")
    closed = dict(raw)
    closed.pop("open_primary")
    check("5 the same list without open_primary would be flagged",
          svc._resolve_race(closed, state_code="LA")["general_roster_unresolved"]
          and not svc._resolve_race(raw, state_code="LA")["general_roster_unresolved"])

    # 6. Party labels as printed.
    no_label = [c["id"] for st in svc.list_states_with_elections() for r in svc.get_elections(st)["races"]
                if r.get("roster_status") == "verified_nominees" for c in r["general_candidates"]
                if not isinstance(c.get("party_label"), str)]
    check("6 every candidate on a verified race has the list's party label", not no_label, str(no_label[:5]))
    oh4 = {c["name"]: c.get("party_label") for c in next(
        r for r in svc.get_elections("OH")["races"] if r["id"] == "oh-2026-us-house-4")["general_candidates"]}
    check("6 a candidate the list prints with no party keeps an empty label",
          oh4.get("Tracy L. Tackett") == "" and oh4.get("Jim Jordan") == "Republican", str(oh4))

    # 7. One member, one candidate.
    by_member = {}
    for st in svc.list_states_with_elections():
        for race in svc._elections_by_state[st]["races"]:
            if race.get("roster_status") != "verified_nominees":
                continue
            for cid in race.get("general_candidates") or []:
                bg = cands.get(cid, {}).get("bioguide_id")
                if bg:
                    by_member.setdefault(bg, []).append(cid)
    twice = {bg: ids for bg, ids in by_member.items() if len(ids) > 1}
    check("7 no sitting member is linked to two candidates", not twice, str(twice))
    check("7 the incumbent Dan S. Sullivan has the member link, not Daniel J. Sullivan Jr.",
          by_member.get("S001198") == ["ak-cand-dan-s-sullivan-sen"], str(by_member.get("S001198")))
    check("7 Trever Nehls is not linked to Rep. Troy Nehls",
          not cands["tx-cand-trever-nehls-h22"].get("bioguide_id"))

    # 8. Your Ballot matches the district however it is written.
    def house_races(st, cd):
        return [r["id"] for r in svc.get_personalized_ballot(st, congressional_district=cd)["races"]
                if "us-house" in r["id"]]
    for cd in ("At-Large", "WY-AL", "AL"):
        check(f"8 Wyoming's at-large House race is on Your Ballot for {cd!r}",
              house_races("WY", cd) == ["wy-2026-us-house-AL"], str(house_races("WY", cd)))
    for cd in ("7", "07", "CA-7"):
        check(f"8 California District 7 is on Your Ballot for {cd!r}",
              house_races("CA", cd) == ["ca-2026-us-house-7"], str(house_races("CA", cd)))

    # 9. Ranked choice where the state says so, and only there.
    ranked = sorted(r["id"] for st in svc.list_states_with_elections()
                    for r in svc._elections_by_state[st]["races"] if r.get("ranked_choice"))
    check("9 ranked choice: Alaska's three races and Maine's federal races only",
          ranked == ["ak-2026-gov", "ak-2026-us-house-AL", "ak-2026-us-senate",
                     "me-2026-us-house-1", "me-2026-us-house-2", "me-2026-us-senate"], str(ranked))

    print()
    if FAILS:
        print(f"{len(FAILS)} FAILED")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
