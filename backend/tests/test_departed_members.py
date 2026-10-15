"""Members who left Congress read as former members, and vacant seats as vacant.

Run:  cd backend && python3 tests/test_departed_members.py   (exit 0 = pass)

During the 119th Congress members resigned, died or joined the Cabinet,
but services/congress_service.py ended every member's latest stint with
"Present" and wrote their bio in the present tense, because it ignored
the end year Congress.gov puts on a finished term and its currentMember
flag. Appointed senators were reported as elected, and a district with
nobody seated showed "couldn't find the representative" instead of a
vacancy. No network: the API and roster calls are replaced with
fixtures in their real shapes.

  1. A departed member's last stint ends with its end year, not Present.
  2. currentMember false closes the stint even without an end year.
  3. A sitting member's latest stint still reads Present.
  4. Derived bios for departed House and Senate members are past tense.
  5. The detail payload of a departed member says former_member, with
     the year they left, and its experience is closed.
  6. A curated former_member in congress_profiles.json reaches the payload.
  7. A senator whose roster term says "how": "appointment" is marked
     appointed, with the oath date and how the appointment ends; a
     curated override still wins; everyone else stays elected.
  8. A district is vacant only when neither the member list nor the
     roster has anyone in it; an empty at-large seat is district 0.
  9. The offline fallback list holds no departed members, wrong ids,
     bills or votes.
"""
import asyncio
import os
import sys

_failures = []


# Failure details name only the fields a check compares. CodeQL's
# sensitive-data heuristic reads "appointment" as medical data, so the
# selection text (a public appointment date) is never printed.
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


# Congress.gov /member/{bioguide} term shapes.
HOUSE_DEPARTED = [  # resigned in 2026 (the shape of G000594)
    {"chamber": "House of Representatives", "startYear": 2021, "endYear": 2023, "district": 23,
     "stateCode": "TX", "stateName": "Texas"},
    {"chamber": "House of Representatives", "startYear": 2023, "endYear": 2025, "district": 23,
     "stateCode": "TX", "stateName": "Texas"},
    {"chamber": "House of Representatives", "startYear": 2025, "endYear": 2026, "district": 23,
     "stateCode": "TX", "stateName": "Texas"},
]
SENATE_DEPARTED = [  # House, then Senate, died in office (the shape of G000359)
    {"chamber": "House of Representatives", "startYear": 1995, "endYear": 2003, "district": 3,
     "stateCode": "SC", "stateName": "South Carolina"},
    {"chamber": "Senate", "startYear": 2003, "endYear": 2025, "stateCode": "SC", "stateName": "South Carolina"},
    {"chamber": "Senate", "startYear": 2025, "endYear": 2026, "stateCode": "SC", "stateName": "South Carolina"},
]
SITTING = [
    {"chamber": "House of Representatives", "startYear": 2023, "endYear": 2025, "district": 13,
     "stateCode": "FL", "stateName": "Florida"},
    {"chamber": "House of Representatives", "startYear": 2025, "district": 13,
     "stateCode": "FL", "stateName": "Florida"},
]


def main() -> int:
    os.environ["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    os.environ.pop("CONGRESS_API_KEY", None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.CRITICAL)
    import app.services.congress_service as cs
    from app.services.congress_selection import annotate_selection

    exp = cs._derive_experience(HOUSE_DEPARTED)
    check("1: departed House member's stint ends 2026",
          exp == [{"role": "U.S. Representative, Texas (District 23)", "from": "2021", "to": "2026"}], str(exp))
    exp = cs._derive_experience(SENATE_DEPARTED)
    check("1b: departed senator: Senate 2003 to 2026, House 1995 to 2003",
          [(e["from"], e["to"]) for e in exp] == [("2003", "2026"), ("1995", "2003")], str(exp))

    no_end = [dict(t, endYear=None) for t in HOUSE_DEPARTED[-1:]]
    exp = cs._derive_experience(no_end, current_member=False)
    check("2: currentMember false closes the stint", exp and exp[0]["to"] != "Present", str(exp))

    exp = cs._derive_experience(SITTING, current_member=True)
    check("3: sitting member still reads Present", exp and exp[0]["to"] == "Present", str(exp))
    check("3b: and without the flag", cs._derive_experience(SITTING)[0]["to"] == "Present")

    bio = cs._derive_bio("Tony Gonzales", HOUSE_DEPARTED)
    check("4: House bio is past tense with the years",
          bio == "Tony Gonzales represented Texas's 23rd congressional district in the "
                 "U.S. House of Representatives from 2021 to 2026.", bio)
    bio = cs._derive_bio("Lindsey Graham", SENATE_DEPARTED)
    check("4b: Senate bio is past tense with the Senate years",
          bio == "Lindsey Graham represented South Carolina in the United States Senate from 2003 to 2026.", bio)
    bio = cs._derive_bio("Anna Paulina Luna", SITTING)
    check("4c: sitting member's bio stays present tense", bio.startswith("Anna Paulina Luna represents"), bio)

    svc = cs.CongressService()

    async def fake_api_get(path, params=None):
        if path == "/member/G000594":
            return {"member": {"bioguideId": "G000594", "directOrderName": "Tony Gonzales",
                               "currentMember": False, "terms": HOUSE_DEPARTED,
                               "partyHistory": [{"partyName": "Republican"}]}}
        return None

    async def no_bills(_bg):
        return []

    async def no_committees(_bg):
        return []

    async def no_roster():
        return []

    svc._api_get = fake_api_get
    svc._fetch_member_bills = no_bills
    svc.get_member_committees = no_committees
    svc.get_all_members = no_roster
    svc._profiles_sidecar = {}
    detail = asyncio.run(svc._fetch_member_detail_from_api("G000594"))
    check("5: detail says former_member, left in 2026",
          detail and detail.get("former_member") is True and detail.get("left_office_year") == "2026",
          f"former_member={detail and detail.get('former_member')}, left_office_year={detail and detail.get('left_office_year')}")
    check("5b: detail experience is closed",
          detail and all(e["to"] != "Present" for e in detail["experience"]), str(detail and detail["experience"]))

    svc._profiles_sidecar = {"X000001": {"former_member": True}}
    merged = svc._merge_profile({"bioguide_id": "X000001", "name": "Someone"})
    check("6: curated former_member reaches the payload", merged.get("former_member") is True,
          f"former_member={merged.get('former_member')}")

    appointed = annotate_selection({
        "bioguide_id": "A000383", "name": "Alan Armstrong", "chamber": "Senate", "state": "OK",
        "appointment": {"start": "2026-03-24", "end": "2027-01-03", "end_type": None},
    })
    check("7: roster appointment marks the senator appointed",
          appointed["selection_method"] == "appointed" and appointed["normally_elected"] is True
          and appointed["selection_detail"] == "Appointed to fill a vacancy and sworn in on March 24, 2026. "
                                               "Serves until the term ends on January 3, 2027.",
          f"selection_method={appointed['selection_method']}, normally_elected={appointed['normally_elected']}; "
          "or the detail text differs")
    special = annotate_selection({
        "bioguide_id": "H001104", "name": "Jon Husted", "chamber": "Senate", "state": "OH",
        "appointment": {"start": "2025-01-21", "end": "2026-11-03", "end_type": "special-election"},
    })
    check("7b: a special-election appointment says so",
          special["selection_detail"].endswith("The seat is filled by a special election on November 3, 2026."),
          "the detail text does not end with the special-election sentence")
    moody = annotate_selection({
        "bioguide_id": "M001244", "name": "Ashley Moody", "chamber": "Senate", "state": "FL",
        "appointment": {"start": "2025-01-21", "end": "2026-11-03", "end_type": "special-election"},
    })
    check("7c: the curated override still wins", "DeSantis" in (moody.get("selection_detail") or ""),
          "the detail text is not the curated one")
    elected = annotate_selection({"bioguide_id": "S001217", "name": "Rick Scott", "chamber": "Senate", "state": "FL"})
    check("7d: a senator without an appointment stays elected", elected["selection_method"] == "elected",
          f"selection_method={elected['selection_method']}")

    async def roster_with(rows):
        async def _r():
            return rows
        svc.get_all_members = _r

    fl_members = [{"chamber": "House", "state": "FL", "district": d} for d in range(1, 29) if d != 20]
    asyncio.run(roster_with([]))
    check("8: FL-20 missing from both sources is vacant",
          asyncio.run(svc.get_house_vacancies("FL", fl_members)) == [20])
    asyncio.run(roster_with([{"chamber": "House", "state": "FL", "district": 20}]))
    check("8b: the roster having a member means not vacant",
          asyncio.run(svc.get_house_vacancies("FL", fl_members)) == [])
    asyncio.run(roster_with([]))
    check("8c: an empty at-large seat is district 0",
          asyncio.run(svc.get_house_vacancies("WY", [{"chamber": "Senate", "state": "WY"}])) == [0])
    check("8d: a filled at-large seat is not vacant",
          asyncio.run(svc.get_house_vacancies("WY", [{"chamber": "House", "state": "WY", "district": None}])) == [])

    sample = [m for block in cs.CongressService.SAMPLE_DATA.values() for m in block["congress"]]
    ids = {m["bioguide_id"] for m in sample}
    check("9: no departed members or misfiled ids in the fallback list",
          not ids & {"R000595", "G000596", "W000823", "C001129"}, str(sorted(ids)))
    check("9b: the fallback list carries no bills or votes",
          all(not m.get("bills") and not m.get("votes") for m in sample))

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
