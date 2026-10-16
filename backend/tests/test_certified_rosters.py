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

    print()
    if FAILS:
        print(f"{len(FAILS)} FAILED")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
