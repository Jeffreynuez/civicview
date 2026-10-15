# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""The seat-id rule: a successor never inherits a predecessor's page (2026-10-15).

Run:  cd backend && python3 tests/test_seat_ids.py   (exit 0 = pass)

An id is a page: its posts, polls, followers and account. Legislators
get their own id (tx-sen-4-ligon); statewide offices were given the
seat's id (fl-exec-gov). When the person in any seat changes, the
outgoing person keeps the id as their former official's page, and the
newcomer gets a new id. No network: the refresh script runs on
Open States records in their real shape.

  1. service_years: the unbroken stretch in one seat; bad archive rows
     (end before start, degenerate duplicates) are ignored.
  2. former_record keeps the person's own record, never fills
     left_office_on (only an official source does), and records when
     the change was noticed.
  3. A governor change: the outgoing governor keeps fl-style seat id as
     a former record pointing at the successor; the successor gets a
     new id, never the seat's.
  4. A legislator who left: successors filled from who took the
     district in the same run; a vacant seat has none.
  5. new_id never reuses an id, even a retired one.
  6. _former_members and _retired_ids are written last.
  7. The data lint catches an id given to a different person (S-1), a
     former record that is also current, a missing successor, and a
     left_office_on without an official source (S-2).
  8. The real data passes the same checks.
"""
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "scripts"))
sys.path.insert(0, str(HERE))

failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        failures.append(name)


def gov_person(oid, name, family, start, end=None, file=None):
    role = {"type": "governor", "start_date": start}
    if end:
        role["end_date"] = end
    p = {"id": oid, "name": name, "family_name": family, "given_name": name.split()[0], "_folder": "executive",
         "roles": [role], "party": [{"name": "Independent"}]}
    if file:
        p["_file"] = file
    return p


def main() -> int:
    import refresh_state_officials as rso

    # ── 1. service_years ──────────────────────────────────────────
    person = {"roles": [
        {"type": "upper", "district": "4", "start_date": "2019-01-08", "end_date": "2023-01-03"},
        {"type": "upper", "district": "4", "start_date": "2023-01-10", "end_date": "2027-01-12"},
        {"type": "upper", "district": "4", "start_date": "2022-01-01", "end_date": "2018-01-01"},  # bad row
        {"type": "lower", "district": "12", "start_date": "2011-01-01", "end_date": "2019-01-01"},
    ]}
    check("1: unbroken service in one seat", rso.service_years(person, chamber="state_senate", district="4") == ("2019", "2027"),
          str(rso.service_years(person, chamber="state_senate", district="4")))
    gap = {"roles": [
        {"type": "upper", "district": "4", "start_date": "2009-01-01", "end_date": "2013-01-01"},
        {"type": "upper", "district": "4", "start_date": "2019-01-08", "end_date": "2027-01-12"}]}
    check("1: a break starts a new stretch", rso.service_years(gap, chamber="state_senate", district="4") == ("2019", "2027"))
    check("1: no record, no years", rso.service_years(None, chamber="state_senate", district="4") == (None, None))

    # ── 2. former_record ─────────────────────────────────────────
    rec = {"id": "tx-sen-4-ligon", "name": "Pat Ligon", "party": "R", "chamber": "upper", "district": "4",
           "role": "State Senator", "openstates_id": "ocd-person/abc", "email": "x@senate.texas.gov"}
    person["_file"] = "data/tx/retired/Pat-Ligon.yml"
    fr = rso.former_record(rec, person, recorded_on="2026-10-15", reason="left office", chamber="state_senate")
    check("2: keeps the person's own record", fr["id"] == "tx-sen-4-ligon" and fr["name"] == "Pat Ligon"
          and "email" not in fr, str(fr))
    check("2: years from Open States, with the file as the source",
          fr["served_from"] == "2019" and fr["served_to"] == "2027"
          and fr["years_source"] == rso.PEOPLE_FILE_URL + "data/tx/retired/Pat-Ligon.yml", str(fr))
    check("2: left_office_on is left for an official source",
          fr["left_office_on"] is None and fr["left_office_source"] is None and fr["recorded_on"] == "2026-10-15")
    moved = rso.former_record(rec, None, recorded_on="2026-10-15", reason="moved to tx-sen-5-ligon")
    check("2: a move records the new id", moved.get("now_id") == "tx-sen-5-ligon")

    # ── 3. a governor change ─────────────────────────────────────
    doc = {"state": "zz", "executive": {"governor": {"id": "zz-exec-gov", "name": "Alex Oldgov",
                                                     "openstates_id": "ocd-person/old", "party": "I",
                                                     "role": "Governor", "website": "https://gov.zz.gov"}},
           "state_senate": {"members": []}, "state_house": {"members": []}}
    people = {
        "ocd-person/old": gov_person("ocd-person/old", "Alex Oldgov", "Oldgov", "2019-01-08", "2027-01-05",
                                     file="data/zz/retired/Alex-Oldgov.yml"),
        "ocd-person/new": gov_person("ocd-person/new", "Blair Newgov", "Newgov", "2027-01-05"),
    }
    r = rso.StateRefresher("zz", doc, people, seats={}, today="2027-01-06", photos=None, client=None, use_api=False)
    r._original_members = {"state_senate": [], "state_house": []}
    r.refresh_executive()
    r.fill_successors()
    new_gov = doc["executive"]["governor"]
    former = {f["id"]: f for f in r.former_out}
    check("3: the successor never gets the seat's id", new_gov["id"] != "zz-exec-gov" and new_gov["name"] == "Blair Newgov",
          str(new_gov))
    check("3: the successor's id is their own", new_gov["id"] == "zz-exec-gov-newgov", new_gov["id"])
    check("3: the outgoing governor keeps the seat id as a former page",
          former.get("zz-exec-gov", {}).get("name") == "Alex Oldgov"
          and former["zz-exec-gov"]["successor_ids"] == [new_gov["id"]], str(former))
    check("3: their years come from the governor role", (former["zz-exec-gov"]["served_from"],
                                                         former["zz-exec-gov"]["served_to"]) == ("2019", "2027"))

    # ── 4. a legislator who left ─────────────────────────────────
    doc2 = {"state": "zz", "executive": {}, "state_senate": {"members": [
        {"id": "zz-sen-4-ligon", "name": "Pat Ligon", "district": "4", "openstates_id": "ocd-person/abc"},
        {"id": "zz-sen-5-vale", "name": "Robin Vale", "district": "5", "openstates_id": "ocd-person/def"}]},
        "state_house": {"members": []}}
    r2 = rso.StateRefresher("zz", doc2, {"ocd-person/abc": person}, seats={}, today="2027-01-13",
                            photos=None, client=None, use_api=False)
    r2._original_members = {ch: list(doc2[ch]["members"]) for ch in ("state_senate", "state_house")}
    left, vac = doc2["state_senate"]["members"][0], doc2["state_senate"]["members"][1]
    r2.retire(left, "left office", chamber="state_senate")
    r2.retire(vac, "left office", chamber="state_senate")
    new_member = {"id": r2.new_id("zz-sen-4", {"family_name": "Moreno"}), "name": "Dana Moreno", "district": "4",
                  "openstates_id": "ocd-person/ghi"}
    doc2["state_senate"]["members"] = [new_member]
    r2.fill_successors()
    f2 = {f["id"]: f for f in r2.former_out}
    check("4: the newcomer in the district is the successor", f2["zz-sen-4-ligon"]["successor_ids"] == ["zz-sen-4-moreno"],
          str(f2["zz-sen-4-ligon"]))
    check("4: a vacant seat has no successor", f2["zz-sen-5-vale"]["successor_ids"] == [])

    # ── 5. ids are never reused ──────────────────────────────────
    r3 = rso.StateRefresher("zz", {"_retired_ids": [{"id": "zz-sen-6-park"}], "executive": {},
                                   "state_senate": {"members": [{"id": "zz-sen-6-park-2", "name": "X"}]}},
                            {}, seats={}, today="2027-01-13", photos=None, client=None, use_api=False)
    check("5: a retired id and a taken id are skipped", r3.new_id("zz-sen-6", {"family_name": "Park"}) == "zz-sen-6-park-3")

    # ── 6. key order ─────────────────────────────────────────────
    out = rso.order_keys({"_retired_ids": [], "_former_members": [], "state": "zz", "_note": "n", "executive": {}})
    check("6: _former_members and _retired_ids last", list(out)[-2:] == ["_former_members", "_retired_ids"], str(list(out)))

    # ── 7. the lint ──────────────────────────────────────────────
    import test_data_lint as dl
    tmp = Path(tempfile.mkdtemp())
    (tmp / "zz").mkdir()
    (tmp / "id_holders.json").write_text(json.dumps({"holders": {
        "zz-exec-gov": ["Alex Oldgov", "11111111"], "zz-sen-1-a": ["Ann A", None]}}))
    bad = {"executive": {"governor": {"id": "zz-exec-gov", "name": "Blair Newgov", "openstates_id": "ocd-person/22222222-x"}},
           "state_senate": {"members": [{"id": "zz-sen-1-a", "name": "Ann A"}]},
           "_former_members": [
               {"id": "zz-sen-1-a", "name": "Ann A", "recorded_on": "2026-10-15", "successor_ids": ["zz-nobody"]},
               {"id": "zz-old", "name": "Old", "recorded_on": "not a date", "left_office_on": "2026-01-01",
                "left_office_source": "https://news.example.com/story"}]}
    path = tmp / "zz" / "state_officials.json"
    path.write_text(json.dumps(bad))
    dl.DATA = tmp
    dl.problems.clear()
    dl.lint_id_holders([path])
    dl.lint_former(path)
    got = "\n".join(dl.problems)
    check("7: S-1 an id given to a different person", "S-1" in got and "belongs to Alex Oldgov, not Blair Newgov" in got, got)
    check("7: S-2 both current and former", "is both a current record and a former one" in got, got)
    check("7: S-2 successor not in the file", "successor zz-nobody is not a record" in got, got)
    check("7: S-2 recorded_on must be a date", "recorded_on 'not a date' is not a date" in got, got)
    check("7: S-2 news is not an official source", "needs an official https left_office_source" in got, got)
    check("7: official sources", dl._official("https://www.flsenate.gov/x") and dl._official("https://clerk.house.gov/x")
          and dl._official("https://dos.myflorida.com/x") and not dl._official("http://clerk.house.gov/x")
          and not dl._official("https://www.nytimes.com/x"))

    # ── 8. the real data ─────────────────────────────────────────
    import importlib
    dl = importlib.reload(dl)
    files = sorted(p for p in dl.DATA.glob("*/state_officials.json")) + [dl.DATA / "federal" / "federal_officials.json"]
    dl.problems.clear()
    dl.lint_id_holders(files)
    for p in files:
        dl.lint_former(p)
    check("8: the real data keeps the rule", not dl.problems, "\n".join(dl.problems[:10]))

    if failures:
        print(f"\nFAILED ({len(failures)}): " + ", ".join(failures))
        return 1
    print("\nALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
