# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Stored official roll calls (2026-10-16): services/roll_call_store.py,
services/roll_call_sync.py, services/db_locks.py and the endpoints that
read them.

Run:  cd backend && python3 tests/test_roll_call_store.py   (exit 0 = pass)

Offline: every official source is replaced by fixtures or a fake, and the
legislators crosswalk is filled by hand.

  1. Parsers and categories: trimmed real House, Senate and senate.gov
     member files; the Clerk's "missing roll" answer; an election of the
     Speaker; the Congress.gov fallback; categorize_vote; values cut to
     their column sizes.
  2. Storing: one write per roll call, a second write is a no-op; the
     one re-check of a vote stored the day it was cast (every field
     compared); a provisional Congress.gov vote replaced by the Clerk's
     file; Speaker choices; members added with ON CONFLICT DO NOTHING; an
     integrity error that isn't a stored vote is raised.
  3. Per-member queries: recent, year and month modes, the row shape the
     frontend and the explainer use, available years.
  4. The party-line figure on a constructed example with a known answer;
     party switchers in each direction (R to D, D to R, I to D) counted
     only in their current party; R to I (the Kevin Kiley case) gets no
     figure; independents; Speaker elections left out; the minimum.
  5. The sync against fake sources: a first pass stores everything; a
     second pass fetches no stored roll call again; a finished session is
     marked complete and skipped; the House probe without Congress.gov,
     including a passing Clerk error page; a failing site left alone
     after five errors in a row; history that stops progressing goes back
     to the normal schedule; the re-check of a provisional vote; the
     advisory lock.
  6. Endpoints: /api/congress/members/{id}/votes and /stats (503 on a
     database error), the stored /api/votes/{id}/members, what a request
     may fetch (window, complete sessions, numbers far ahead), past
     sessions read from storage only, the explainer using the stored
     record.
  7. The schedule.
  8. (Only with CIVICVIEW_TEST_POSTGRES_URL set) the real Postgres
     advisory lock between two connections.
"""
import asyncio
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()
os.environ["ROLL_CALL_SYNC_ENABLED"] = "false"  # no background loop in the app under test
FIX = Path(__file__).resolve().parent / "fixtures"
check = fh.Checks()


def _prime_crosswalk():
    """Fill the legislators crosswalk by hand so nothing is fetched."""
    from app.services.official_votes_service import _LEGIS

    _LEGIS._loaded = True
    _LEGIS._historical_loaded = True
    for bio, lis, name, state, party, chamber in [
        ("A000370", None, "Alma S. Adams", "NC", "D", "house"),
        ("A000055", None, "Robert B. Aderholt", "AL", "R", "house"),
        ("A000382", "S428", "Angela D. Alsobrooks", "MD", "D", "senate"),
        ("B001230", "S354", "Tammy Baldwin", "WI", "D", "senate"),
        ("B000001", "S1", "Senator One", "AA", "R", "senate"),
        ("B000002", "S2", "Senator Two", "BB", "D", "senate"),
    ]:
        _LEGIS._bio2meta[bio] = {"bioguide": bio, "name": name, "last": name.split()[-1],
                                 "state": state, "party": party, "chamber": chamber}
        if lis:
            _LEGIS._lis2bio[lis] = bio


# ── builders for constructed votes ─────────────────────────────────────
def house_xml(congress, session, roll, day, question, vtype, legis, desc, members):
    word = "2nd" if session == 2 else "1st"
    totals = {"Yea": 0, "Nay": 0, "Present": 0, "Not Voting": 0}
    by_party = {}
    rows = []
    for bio, party, state, vote in members:
        totals[vote] += 1
        by_party.setdefault(party, {"Yea": 0, "Nay": 0, "Present": 0, "Not Voting": 0})[vote] += 1
        rows.append(f'<recorded-vote><legislator name-id="{bio}" party="{party}" state="{state}" '
                    f'role="legislator">{bio}</legislator><vote>{vote}</vote></recorded-vote>')
    pname = {"R": "Republican", "D": "Democratic", "I": "Independent"}
    party_rows = "".join(
        f"<totals-by-party><party>{pname[p]}</party><yea-total>{c['Yea']}</yea-total>"
        f"<nay-total>{c['Nay']}</nay-total><present-total>{c['Present']}</present-total>"
        f"<not-voting-total>{c['Not Voting']}</not-voting-total></totals-by-party>"
        for p, c in by_party.items())
    return (
        '<?xml version="1.0" encoding="utf-8"?><rollcall-vote><vote-metadata>'
        f"<congress>{congress}</congress><session>{word}</session><rollcall-num>{roll}</rollcall-num>"
        f"<legis-num>{legis}</legis-num><vote-question>{question}</vote-question>"
        f"<vote-type>{vtype}</vote-type><vote-result>Passed</vote-result>"
        f"<action-date>{day.day}-{day.strftime('%b')}-{day.year}</action-date><vote-desc>{desc}</vote-desc>"
        f"<vote-totals>{party_rows}<totals-by-vote><yea-total>{totals['Yea']}</yea-total>"
        f"<nay-total>{totals['Nay']}</nay-total><present-total>{totals['Present']}</present-total>"
        f"<not-voting-total>{totals['Not Voting']}</not-voting-total></totals-by-vote></vote-totals>"
        f"</vote-metadata><vote-data>{''.join(rows)}</vote-data></rollcall-vote>"
    )


def senate_xml(congress, session, num, day, question, members):
    rows = "".join(
        f"<member><member_full>X ({party}-{state})</member_full><last_name>X</last_name>"
        f"<first_name>Y</first_name><party>{party}</party><state>{state}</state>"
        f"<vote_cast>{vote}</vote_cast><lis_member_id>{lis}</lis_member_id></member>"
        for lis, party, state, vote in members)
    yeas = sum(1 for m in members if m[3] == "Yea")
    nays = sum(1 for m in members if m[3] == "Nay")
    return (
        '<?xml version="1.0" encoding="UTF-8"?><roll_call_vote>'
        f"<congress>{congress}</congress><session>{session}</session><vote_number>{num}</vote_number>"
        f"<vote_date>{day.strftime('%B')} {day.day}, {day.year},  02:00 PM</vote_date>"
        f"<vote_question_text>{question}</vote_question_text><question>{question}</question>"
        f"<vote_result>Agreed to</vote_result><document><document_type>S.</document_type>"
        f"<document_number>{num}</document_number><document_title>A bill.</document_title></document>"
        f"<count><yeas>{yeas}</yeas><nays>{nays}</nays><present/><absent>0</absent></count>"
        f"<members>{rows}</members></roll_call_vote>"
    )


def senate_menu(congress, session, numbers):
    votes = "".join(f"<vote><vote_number>{n:05d}</vote_number><vote_date>01-Feb</vote_date>"
                    f"<question>On Passage of the Bill</question><result>Agreed to</result>"
                    f"<vote_tally><yeas>2</yeas><nays>1</nays></vote_tally><title>t</title></vote>"
                    for n in numbers)
    return (f"<vote_summary><congress>{congress}</congress><session>{session}</session>"
            f"<congress_year>{1789 + 2 * (congress - 1) + session - 1}</congress_year>"
            f"<votes>{votes}</votes></vote_summary>")


def record(chamber, congress, session, number, day, question, members, by_party, *, legis="H R 1",
           desc="A bill", vtype="YEA-AND-NAY"):
    """A record for store_roll_call built directly (positions: (bio, Yea|Nay|..., party))."""
    from app.services import roll_call_store as store

    parsed = {
        "chamber": "house" if chamber == "h" else "senate",
        "congress": congress, "session": session, "rollcall": number,
        "date": day.isoformat(), "question": question, "vote_type": vtype, "result": "Passed",
        "legis_num": legis, "title": desc,
        "bill": {"type": "S.", "number": str(number), "title": desc} if chamber == "s" else None,
        "totals": {"yea": 0, "nay": 0, "present": 0, "not_voting": 0},
        "by_party": by_party,
        "members": [{"bioguide_id": b, "position": p, "party": party, "name": b, "state": "AA"}
                    for b, p, party in members],
    }
    return store.record_from_parsed(parsed)


def split(r_yea, r_nay, d_yea, d_nay):
    return {"R": {"yea": r_yea, "nay": r_nay, "present": 0, "not_voting": 0},
            "D": {"yea": d_yea, "nay": d_nay, "present": 0, "not_voting": 0}}


def main() -> int:
    from app.db import SessionLocal, init_db

    init_db()
    _prime_crosswalk()
    from app.services import official_votes_service as ov
    from app.services import roll_call_store as store

    # ── 1. parsers and categories ──────────────────────────────────────
    print("1. parsers and categories")
    h = ov.parse_house_roll((FIX / "house_roll_2026_314.xml").read_text())
    check("house category suspension", h["category"] == "passage_suspension", h["category"])
    rec = store.record_from_parsed(h)
    check("house record id/date", rec["vote_id"] == "h-119-2-314" and rec["vote_date"] == date(2026, 9, 16),
          f"{rec['vote_id']} {rec['vote_date']}")
    check("house legis split S / 2403", (rec["doc_type"], rec["doc_number"]) == ("S", "2403"),
          f"{rec['doc_type']} {rec['doc_number']}")
    check("house description is vote-desc", rec["description"] == "Retire through Ownership Act", str(rec["description"]))
    check("house positions are letters", rec["positions"][0] == ("A000370", "Y", "D"), str(rec["positions"][0]))
    check("house by_party from the official totals", rec["by_party"]["R"]["nay"] == 14, str(rec["by_party"]))

    s = ov.parse_senate_vote((FIX / "senate_vote_119_2_00256.xml").read_text())
    srec = store.record_from_parsed(s)
    check("senate nomination category", srec["category"] == "nomination", srec["category"])
    check("senate question_text kept", srec["question_text"] == "On the Nomination PN1129", str(srec["question_text"]))
    check("senate lis mapped (Alsobrooks)", ("A000382", "N", "D") in srec["positions"], str(srec["positions"]))
    check("senate unmapped members skipped, not guessed", len(srec["skipped"]) == 3, str(srec["skipped"]))
    a = ov.parse_senate_vote((FIX / "senate_vote_119_2_00249.xml").read_text())
    arec = store.record_from_parsed(a)
    check("senate amendment names its bill S. 4668", (arec["doc_type"], arec["doc_number"]) == ("S.", "4668"),
          f"{arec['doc_type']} {arec['doc_number']}")
    check("senate amendment category", arec["category"] == "amendment", arec["category"])
    check("'No short title on file' dropped", "short title" not in (arec["question_text"] or ""), arec["question_text"])

    sp = ov.parse_house_roll((FIX / "house_roll_2025_002_speaker.xml").read_text())
    sprec = store.record_from_parsed(sp)
    check("speaker election category", sprec["category"] == "leadership", sprec["category"])
    check("speaker votes stored as choices, not Not Voting",
          sorted(sprec["positions"]) == [("A000055", "C", "R"), ("A000370", "C", "D"), ("M001184", "C", "R")],
          str(sprec["positions"]))
    check("speaker choices as recorded, for every name",
          sorted(sprec["choices"]) == [("A000055", "Johnson (LA)"), ("A000370", "Jeffries"), ("M001184", "Emmer")],
          str(sprec["choices"]))
    check("speaker result kept", sprec["result"] == "Johnson (LA)", sprec["result"])
    check("member_position: Present stays Present in an election",
          ov.member_position("Present", True) == ("Present", None) and ov.member_position("Not Voting", True)
          == ("Not Voting", None) and ov.member_position("Jeffries", False) == ("Not Voting", None))
    cg = ov.parse_house_vote_members({"houseRollCallVoteMemberVotes": {
        "congress": 119, "sessionNumber": 1, "rollCallNumber": 2, "voteQuestion": "Election of the Speaker",
        "startDate": "2025-01-03T14:33:00-05:00", "result": "Johnson (LA)",
        "results": [{"bioguideID": "A000370", "voteCast": "Jeffries", "voteParty": "D", "voteState": "NC"},
                    {"bioguideID": "A000055", "voteCast": "Present", "voteParty": "R", "voteState": "AL"}]}})
    cgrec = store.record_from_parsed(cg)
    check("Congress.gov fallback: choice kept and marked provisional",
          cgrec["source"] == "congress.gov" and ("A000370", "Jeffries") in cgrec["choices"]
          and ("A000055", "P", "R") in cgrec["positions"] and cgrec["present"] == 1, str(cgrec["positions"]))
    long = store.record_from_parsed({
        "chamber": "house", "congress": 119, "session": 2, "rollcall": 77, "date": "2026-03-03",
        "question": "On Passage", "vote_type": "V" * 90, "result": "R" * 300, "legis_num": ("X" * 40) + " " + ("9" * 40),
        "title": "t", "members": [{"bioguide_id": "A000370", "position": "Yea", "party": "Democrat",
                                   "state": "North Carolina", "name": "N" * 300}]})
    check("values cut to their column sizes",
          (len(long["vote_type"]), len(long["result"]), len(long["doc_type"]), len(long["doc_number"]))
          == (64, 160, 24, 32) and long["positions"][0][2] == "D" and long["members"][0][2] == "No"
          and len(long["members"][0][1]) == 160, f"{long['positions']} {long['members'][0][2]}")

    check("clerk missing-roll body detected", ov.house_roll_missing((FIX / "clerk_missing_roll.xml").read_text()))
    check("real roll not missing", not ov.house_roll_missing((FIX / "house_roll_2026_314.xml").read_text()))
    check("empty answer is missing", ov.house_roll_missing(""))
    n = ov._LEGIS.add_senate_members((FIX / "senate_cvc_member_data.xml").read_text())
    check("senate.gov member file maps lis -> bioguide", n == 3 and ov._LEGIS.lis_to_bioguide("S440") == "A000383",
          f"{n} {ov._LEGIS.lis_to_bioguide('S440')}")

    # Several threads store votes at once; all must wait for one
    # historical load instead of reading a half-filled crosswalk.
    import threading
    import time as _time
    loads = []

    def slow_fetch(url):
        loads.append(url)
        _time.sleep(0.4)
        return [{"id": {"bioguide": "Z000009", "lis": "S909"}, "name": {"first": "Former", "last": "Senator"},
                 "terms": [{"type": "sen", "state": "ZZ", "party": "Democrat"}]}]

    real_fetch = ov._LEGIS._fetch
    ov._LEGIS._fetch = slow_fetch
    ov._LEGIS._historical_loaded = False
    ov._LEGIS._historical_failed_at = 0.0
    parsed_votes = [{"chamber": "senate", "members": [{"lis_member_id": "S909", "bioguide_id": None, "name": "X"}]}
                    for _ in range(6)]
    results = []
    threads = [threading.Thread(target=lambda pv=pv: results.append(ov.remap_senators(pv))) for pv in parsed_votes]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    ov._LEGIS._fetch = real_fetch
    check("concurrent remaps all map the former senator", results == [0] * 6
          and all(pv["members"][0]["bioguide_id"] == "Z000009" for pv in parsed_votes), str(results))
    check("historical file read once", len(loads) == 1, str(len(loads)))

    cases = [
        ("house", "On Motion to Suspend the Rules and Pass, as Amended", "2/3 YEA-AND-NAY", "", "passage_suspension"),
        ("house", "On Passage", "YEA-AND-NAY", "", "passage"),
        ("house", "On Agreeing to the Amendment", "RECORDED VOTE", "", "amendment"),
        ("house", "On Ordering the Previous Question", "YEA-AND-NAY", "", "procedural"),
        ("house", "On Agreeing to the Resolution", "RECORDED VOTE", "Providing for consideration of the bill", "procedural"),
        ("house", "On Agreeing to the Resolution", "RECORDED VOTE", "Impeaching Jane Doe", "impeachment"),
        ("house", "On Agreeing to the Resolution", "RECORDED VOTE", "Expressing support", "passage"),
        ("house", "On Motion to Recommit", "YEA-AND-NAY", "", "procedural"),
        ("house", "On Motion to Table the Motion to Discharge Committee", "YEA-AND-NAY", "", "procedural"),
        ("house", "On Motion to Concur in the Senate Amendments", "YEA-AND-NAY", "", "passage"),
        ("house", "Call by States", "QUORUM", "", "quorum"),
        ("house", "Election of the Speaker", "ELECTION", "", "leadership"),
        ("house", "On Passage, Objections of the President Not Withstanding", "YEA-AND-NAY", "", "veto_override"),
        ("house", "On Agreeing to the Conference Report", "YEA-AND-NAY", "", "conference"),
        ("house", "On Retaining Division A", "YEA-AND-NAY", "", "amendment"),
        ("senate", "On the Cloture Motion", "", "", "cloture"),
        ("senate", "On Cloture on the Motion to Proceed", "", "", "cloture"),
        ("senate", "On the Nomination", "", "", "nomination"),
        ("senate", "On the Motion to Table", "", "", "procedural"),
        ("senate", "On the Motion to Proceed", "", "", "procedural"),
        ("senate", "On the Amendment", "", "", "amendment"),
        ("senate", "On the Joint Resolution", "", "", "passage"),
        ("senate", "On Passage of the Bill", "", "", "passage"),
        ("senate", "On the Resolution of Ratification", "", "", "treaty"),
        ("senate", "On Overriding the Veto", "", "", "veto_override"),
        ("senate", "Guilty or Not Guilty", "", "", "conviction"),
        ("senate", "On the Point of Order (Is the Point of Order Against the Articles of Impeachment Well Taken?)", "", "", "procedural"),
    ]
    for chamber, q, vt, desc, want in cases:
        got = ov.categorize_vote(chamber, q, vt, desc)
        check(f"category {chamber}: {q[:45]} -> {want}", got == want, got)
    check("dates: House, Senate, ISO",
          store.parse_official_date("6-Jan-2026") == date(2026, 1, 6)
          and store.parse_official_date("September 30, 2026,  09:29 PM") == date(2026, 9, 30)
          and store.parse_official_date("2026-05-20T13:00:00-04:00") == date(2026, 5, 20))

    # ── 2. storing ─────────────────────────────────────────────────────
    print("2. storing")
    db = SessionLocal()
    check("first store adds", store.store_roll_call(db, rec) == "added")
    check("second store is a no-op", store.store_roll_call(db, rec) == "exists")
    from app.models.pages import RollCall, RollCallMember, RollCallPosition
    check("six positions stored once", db.query(RollCallPosition).count() == 6, str(db.query(RollCallPosition).count()))
    adams = db.get(RollCallMember, "A000370")
    check("member name from the crosswalk", adams and adams.name == "Alma S. Adams", str(adams and adams.name))
    check("old vote stored confirmed", db.query(RollCall).filter_by(vote_id="h-119-2-314").one().confirmed_at is not None)
    fresh_day = date.today()
    fresh = record("h", 119, 2, 900, fresh_day, "On Passage", [("A000370", "Yea", "D")], split(0, 0, 1, 0))
    store.store_roll_call(db, fresh, now=datetime.combine(fresh_day, datetime.min.time()) + timedelta(hours=20))
    check("vote stored the day it was cast awaits its re-check",
          db.query(RollCall).filter_by(vote_id="h-119-2-900").one().confirmed_at is None)
    pending = store.unconfirmed(db, now=datetime.combine(fresh_day, datetime.min.time()) + timedelta(days=2))
    check("listed for the re-check", ("h", 119, 2, 900) in pending, str(pending))
    changed = record("h", 119, 2, 900, fresh_day, "On Passage", [("A000370", "Nay", "D")], split(0, 0, 0, 1))
    check("re-check sees a changed file", store.confirm_roll_call(db, changed) == "changed")
    pos = db.query(RollCallPosition).join(RollCall).filter(RollCall.vote_id == "h-119-2-900").one()
    check("re-check replaced the position", pos.position == "N", pos.position)
    check("re-check happens once", store.unconfirmed(db, older_than=timedelta(0)) == [])

    # The re-check compares every stored field, not only the tally.
    day2 = date.today()
    first = record("s", 119, 2, 901, day2, "On the Motion", [("B000001", "Yea", "R")], split(1, 0, 0, 0), desc="Old text")
    store.store_roll_call(db, first, now=datetime.combine(day2, datetime.min.time()) + timedelta(hours=2))
    second = record("s", 119, 2, 901, day2, "On the Motion", [("B000001", "Yea", "R")], split(1, 0, 0, 0), desc="New text")
    check("re-check sees a changed description", store.confirm_roll_call(db, second) == "changed")
    check("description replaced", db.query(RollCall).filter_by(vote_id="s-119-2-901").one().description == "New text")

    # A provisional House vote from Congress.gov (the Clerk's file couldn't
    # be read) waits for the Clerk's file, even when it is old.
    prov = dict(record("h", 119, 1, 50, date(2025, 3, 4), "On Agreeing to the Resolution",
                       [("A000370", "Yea", "D"), ("A000055", "Yea", "R")], split(1, 0, 1, 0), desc=""))
    prov["description"], prov["source"], prov["category"] = None, "congress.gov", "passage"
    store.store_roll_call(db, prov, now=datetime(2026, 1, 1))
    prow = db.query(RollCall).filter_by(vote_id="h-119-1-50").one()
    check("provisional vote stored unconfirmed", prow.confirmed_at is None and prow.source == "congress.gov")
    check("provisional vote listed for the re-check", ("h", 119, 1, 50) in store.unconfirmed(db, now=datetime(2026, 1, 2)))
    clerk = record("h", 119, 1, 50, date(2025, 3, 4), "On Agreeing to the Resolution",
                   [("A000370", "Yea", "D"), ("A000055", "Yea", "R")], split(1, 0, 1, 0),
                   desc="Providing for consideration of the bill (H.R. 1)")
    check("Clerk's file replaces the provisional vote", store.confirm_roll_call(db, clerk) == "changed")
    db.expire_all()
    prow = db.query(RollCall).filter_by(vote_id="h-119-1-50").one()
    check("rule vote now categorized from the Clerk's description",
          prow.category == "procedural" and prow.source is None and prow.confirmed_at is not None,
          f"{prow.category} {prow.source} {prow.confirmed_at}")

    # Speaker choices.
    check("speaker election stored", store.store_roll_call(db, sprec) == "added")
    from app.models.pages import RollCallChoice
    check("three choices stored", db.query(RollCallChoice).count() == 3, str(db.query(RollCallChoice).count()))
    srow = store.member_votes(db, "M001184", limit=1)[0]
    check("Votes tab: 'Voted for {name}'", srow["position"] == "Voted for Emmer" and srow["choice"] == "Emmer", str(srow))
    adams_el = [r for r in store.member_votes(db, "A000370", year=2025) if r["vote_id"] == "h-119-1-2"]
    check("same wording for every name", [r["position"] for r in adams_el] == ["Voted for Jeffries"], str(adams_el))
    sdet = store.vote_detail(db, "h-119-1-2")
    check("seat-chart detail carries the choice",
          {m["bioguide_id"]: m["position"] for m in sdet["members"]}["A000055"] == "Voted for Johnson (LA)", str(sdet["members"]))

    # Members: a member already known is not inserted twice (ON CONFLICT
    # DO NOTHING), whoever else wrote the row first.
    from app.services.roll_call_store import _insert_ignore
    _insert_ignore(db, RollCallMember.__table__, [{"bioguide_id": "A000370", "name": "X", "state": "NC"}], ["bioguide_id"])
    db.commit()
    check("insert of a known member ignored", db.get(RollCallMember, "A000370").name == "Alma S. Adams")

    # An integrity error that isn't "this vote is already stored" is raised.
    from sqlalchemy.exc import IntegrityError
    broken = dict(record("h", 119, 2, 950, date(2026, 3, 9), "On Passage", [("A000370", "Yea", "D")], split(0, 0, 1, 0)))
    broken["positions"] = [("A000370", "Y", "D"), ("A000370", "N", "D")]
    try:
        store.store_roll_call(db, broken)
        raised = False
    except IntegrityError:
        raised = True
    check("other integrity errors raised, not reported as 'exists'",
          raised and db.query(RollCall).filter_by(vote_id="h-119-2-950").count() == 0)
    db.query(RollCallChoice).delete()
    db.query(RollCallPosition).delete()
    db.query(RollCall).delete()
    db.commit()

    # ── 3 + 4. queries and the party-line figure ───────────────────────
    print("3. per-member queries")
    R1, R2, D1, I1 = "R000001", "R000002", "D000001", "I000001"
    votes = []
    n = 0

    def add(day, question, members, by_party, chamber="h", **kw):
        nonlocal n
        n += 1
        votes.append(record(chamber, 119, day.year - 2024, n, day, question, members, by_party, **kw))

    # Ten party-split votes (R majority Yea, D majority Nay): R1 sides with
    # the Republicans on 8 and with the Democrats on 2.
    for i in range(10):
        add(date(2026, 3, 1) + timedelta(days=i), "On Passage",
            [(R1, "Yea" if i < 8 else "Nay", "R"), (D1, "Nay", "D"), (I1, "Yea", "I")], split(200, 10, 5, 205))
    # Excluded: two bipartisan votes, one with the Republicans tied, one R1 missed.
    add(date(2026, 4, 1), "On Passage", [(R1, "Yea", "R"), (D1, "Yea", "D")], split(210, 0, 200, 5))
    add(date(2026, 4, 2), "On Passage", [(R1, "Nay", "R"), (D1, "Nay", "D")], split(3, 200, 1, 200))
    add(date(2026, 4, 3), "On Passage", [(R1, "Yea", "R"), (D1, "Nay", "D")], split(100, 100, 0, 210))
    add(date(2026, 4, 4), "On Passage", [(R1, "Not Voting", "R"), (D1, "Nay", "D")], split(200, 5, 0, 210))
    # A vote from 2025 (the 119th's first session, bipartisan so not
    # counted) and a party-split one from the 118th.
    add(date(2025, 6, 1), "On Agreeing to the Amendment", [(R1, "Nay", "R")], split(10, 200, 9, 200))
    votes.append(record("h", 118, 2, 1, date(2024, 5, 1), "On Passage", [(R1, "Yea", "R")], split(200, 1, 1, 200)))
    # Party switchers. Every vote here is party-split: most Republicans Yea,
    # most Democrats Nay.
    # R2, D to R: a Democrat on four votes (with the Democrats), then a
    # Republican on ten, with the Republicans on nine of them.
    for i in range(14):
        as_dem = i < 4
        add(date(2026, 5, 1) + timedelta(days=i), "On Passage",
            [(R2, "Nay" if as_dem or i == 13 else "Yea", "D" if as_dem else "R")], split(200, 10, 5, 205))
    # DR, R to D: a Republican on five votes (with the Republicans), then a
    # Democrat on eleven, with the Democrats on nine of them.
    DR, KI, ID = "D000002", "K000401", "I000002"
    for i in range(16):
        as_rep = i < 5
        pos = "Yea" if as_rep or i in (14, 15) else "Nay"
        add(date(2026, 6, 1) + timedelta(days=i), "On Passage", [(DR, pos, "R" if as_rep else "D")],
            split(200, 10, 5, 205))
    # KI, R to I (Kevin Kiley's record): "R" on twelve 2025 roll calls,
    # "I" on three in September 2026.
    for i in range(12):
        add(date(2025, 5, 1) + timedelta(days=i), "On Passage", [(KI, "Yea", "R")], split(200, 10, 5, 205))
    for i in range(3):
        add(date(2026, 9, 1) + timedelta(days=i), "On Passage", [(KI, "Yea", "I")], split(200, 10, 5, 205))
    # ID, I to D: an independent on three votes, then a Democrat on ten,
    # with the Democrats on all ten.
    for i in range(13):
        add(date(2026, 7, 1) + timedelta(days=i), "On Passage",
            [(ID, "Yea" if i < 3 else "Nay", "I" if i < 3 else "D")], split(200, 10, 5, 205))
    # SP: ten party-split votes with the Republicans, and an election of
    # the Speaker (a choice, never Yea or Nay) that must not count.
    SP = "S000002"
    for i in range(10):
        add(date(2026, 8, 1) + timedelta(days=i), "On Passage", [(SP, "Yea", "R")], split(200, 10, 5, 205))
    el = record("h", 119, 2, 999, date(2026, 8, 20), "Election of the Speaker",
                [(SP, "Nay", "R")], split(200, 10, 5, 205), vtype="ELECTION")
    votes.append(el)
    for v in votes:
        store.store_roll_call(db, v)

    recent = store.member_votes(db, R1, limit=3)
    check("recent: newest first", [r["date"] for r in recent] == ["2026-04-04", "2026-04-03", "2026-04-02"],
          str([r["date"] for r in recent]))
    row = recent[0]
    need = {"vote_id", "question", "chamber", "congress", "result", "category", "date", "position", "url", "bill"}
    check("row has the explainer/frontend keys", need <= set(row), str(sorted(row)))
    check("position spelled out", row["position"] == "Not Voting", row["position"])
    check("official House roll-call URL", row["url"].startswith("https://clerk.house.gov/Votes/2026"), row["url"])
    check("bill display H.R. 1", row["bill"]["display_number"] == "H.R. 1", str(row["bill"]))
    check("year mode", len(store.member_votes(db, R1, year=2026)) == 14, str(len(store.member_votes(db, R1, year=2026))))
    check("month mode", len(store.member_votes(db, R1, year=2026, month=4)) == 4)
    check("empty month", store.member_votes(db, R1, year=2026, month=12) == [])
    check("available years newest first", store.member_vote_years(db, R1) == [2026, 2025, 2024],
          str(store.member_vote_years(db, R1)))
    check("unknown member has no years", store.member_vote_years(db, "Z999999") == [])

    print("4. party-line figure")
    pl = store.party_line(db, R1, 119)
    check("constructed example: 8 of 10 party-split votes = 80%", (pl["pct"], pl["analyzed"]) == (80, 10), str(pl))
    check("118th vote not counted in the 119th", store.party_line(db, R1, 118)["analyzed"] == 1)
    pl_d = store.party_line(db, D1, 119)
    # D1 is also on the vote R1 missed (party-split, D1 with the Democrats).
    check("Democrat: same method, 100% of 11", (pl_d["pct"], pl_d["analyzed"]) == (100, 11), str(pl_d))
    pl_s = store.party_line(db, R2, 119)
    check("switcher D to R: only the 10 votes as a Republican, 9 of 10 = 90%",
          (pl_s["pct"], pl_s["analyzed"], pl_s["party"]) == (90, 10, "R"), str(pl_s))
    pl_dr = store.party_line(db, DR, 119)
    check("switcher R to D: only the 11 votes as a Democrat, 9 of 11 = 82%",
          (pl_dr["pct"], pl_dr["analyzed"], pl_dr["party"]) == (82, 11, "D"), str(pl_dr))
    pl_k = store.party_line(db, KI, 119)
    check("switcher R to I (Kiley): no figure", pl_k["pct"] is None and pl_k["reason"] == "independent"
          and pl_k["party"] == "I", str(pl_k))
    pl_id = store.party_line(db, ID, 119)
    check("switcher I to D: only the 10 votes as a Democrat, 100%",
          (pl_id["pct"], pl_id["analyzed"]) == (100, 10), str(pl_id))
    pl_sp = store.party_line(db, SP, 119)
    check("election of the Speaker left out", (pl_sp["pct"], pl_sp["analyzed"]) == (100, 10), str(pl_sp))
    check("independent: no figure", store.party_line(db, I1, 119)["reason"] == "independent")
    check("no votes", store.party_line(db, "Z999999", 119)["reason"] == "no_votes")
    db.query(RollCallPosition).filter(RollCallPosition.bioguide_id == R1,
                                      RollCallPosition.roll_call_id == db.query(RollCall.id).filter_by(vote_id="h-119-2-1").scalar_subquery()).delete(synchronize_session=False)
    db.commit()
    short = store.party_line(db, R1, 119)
    check("under 10 party-split votes: not enough", short["pct"] is None and short["reason"] == "not_enough"
          and short["analyzed"] == 9, str(short))

    # ── 6. endpoints ───────────────────────────────────────────────────
    print("6. endpoints")
    from fastapi.testclient import TestClient
    import app.main as m

    client = TestClient(m.app)
    client.__enter__()
    resp = client.get(f"/api/congress/members/{R1}/votes", params={"limit": 2})
    body = resp.json()
    check("votes endpoint 200", resp.status_code == 200, str(resp.status_code))
    check("votes endpoint available_years", body.get("available_years") == [2026, 2025, 2024], str(body.get("available_years")))
    check("votes endpoint count", body.get("count") == 2, str(body.get("count")))
    body = client.get(f"/api/congress/members/{R1}/votes", params={"year": 2026, "month": 3}).json()
    check("votes endpoint month", body["count"] == 9, str(body["count"]))
    st = client.get(f"/api/congress/members/{D1}/stats").json()
    check("stats endpoint figure + basis", st.get("party_line_pct") == 100 and st.get("votes_analyzed") == 11
          and st.get("party_line_method") == "party_split" and st.get("party_line_congress") == 119, str(st))
    st_i = client.get(f"/api/congress/members/{I1}/stats").json()
    check("stats endpoint independent", st_i.get("party_line_reason") == "independent", str(st_i))
    st_k = client.get(f"/api/congress/members/{KI}/stats").json()
    check("stats endpoint: Kiley case, no figure, current party I",
          st_k.get("party_line_pct") is None and st_k.get("party_line_reason") == "independent"
          and st_k.get("party_line_party") == "I", str(st_k))
    real_pl = store.party_line

    def broken_pl(*a, **k):
        raise RuntimeError("database down")

    store.party_line = broken_pl
    st_err = client.get(f"/api/congress/members/{D1}/stats")
    store.party_line = real_pl
    check("database error: 503, not 'not enough votes'", st_err.status_code == 503, str(st_err.status_code))

    store.store_roll_call(db, rec)  # the real House roll 314
    det = client.get("/api/votes/h-119-2-314/members").json()
    check("stored seat-chart detail", det.get("stored") is True and len(det.get("members", [])) == 6
          and det.get("legis_num") == "S 2403" and det.get("date") == "16-Sep-2026", str({k: det.get(k) for k in ("stored", "legis_num", "date")}))
    payload = {"vote_id": "h-119-2-314", "question": "tampered", "category": "cloture", "result": "Failed",
               "position": "Yea", "bill": {"display_number": "H.R. 666", "title": "Fake"}}
    ex = client.post("/api/votes/explain", json=payload).json()
    check("explainer uses the stored category", ex.get("category") == "passage_suspension", str(ex.get("category")))
    check("explainer uses the stored bill", "S. 2403" in ex.get("what_was_voted", ""), ex.get("what_was_voted", "")[:80])
    from app.routers.votes import VoteExplainRequest, _canonical
    from app.services.vote_explainer_service import source_hash
    p1 = _canonical(VoteExplainRequest(**payload), db).model_dump()
    p2 = _canonical(VoteExplainRequest(vote_id="h-119-2-314", question="On Passage", position="Nay"), db).model_dump()
    check("profile and /bills payloads share one cache key", source_hash(p1) == source_hash(p2))
    # What a request may fetch from the official sites.
    import app.services.official_http as http
    from app.models.pages import RollCallSyncState
    from app.services.official_votes_service import get_service
    real_http_fetch, real_congress_api = http.fetch, http.congress_api
    net = []

    async def no_net(url, *a, **k):
        net.append(url)
        return http.FetchResult(500)

    async def no_api(url, *a, **k):
        net.append(url)
        return None

    http.fetch, http.congress_api = no_net, no_api
    svc = get_service()
    svc._detail.clear()
    svc._missed.clear()
    client.get("/api/votes/h-119-2-314/members")
    check("stored vote not kept in the in-memory cache", "h-119-2-314" not in svc._detail, str(list(svc._detail)))
    r_out = client.get("/api/votes/h-100-1-5/members")
    check("vote outside the stored window: 404, nothing fetched", r_out.status_code == 404 and net == [],
          f"{r_out.status_code} {net}")
    db.add(RollCallSyncState(chamber="h", congress=118, session=2, official_count=5, stored_count=5,
                             completed_at=datetime(2026, 1, 1)))
    db.commit()
    r_done = client.get("/api/votes/h-118-2-7/members")
    check("unstored vote of a complete session: 404, nothing fetched", r_done.status_code == 404 and net == [],
          f"{r_done.status_code} {net}")
    r_far = client.get("/api/votes/h-119-2-5000/members")
    check("vote number far beyond the highest stored: 404, nothing fetched", r_far.status_code == 404 and net == [],
          f"{r_far.status_code} {net}")
    r_try = client.get("/api/votes/h-119-2-320/members")
    tried = len(net)
    client.get("/api/votes/h-119-2-320/members")
    check("a vote the site couldn't give is fetched once, then not again for a while",
          r_try.status_code == 502 and tried >= 1 and len(net) == tried, f"{r_try.status_code} {tried} {len(net)}")
    net.clear()
    check("recent: congress outside the window is 404", client.get(
        "/api/votes/recent", params={"chamber": "house", "congress": 100, "session": 1}).status_code == 404)
    check("recent: session 3 refused", client.get(
        "/api/votes/recent", params={"chamber": "senate", "congress": 119, "session": 3}).status_code == 422)
    past = client.get("/api/votes/recent", params={"chamber": "house", "congress": 119, "session": 1, "limit": 5})
    check("recent: a past session read from storage only", past.status_code == 200 and net == [],
          f"{past.status_code} {net}")
    past_s = client.get("/api/votes/recent", params={"chamber": "senate", "congress": 118, "session": 2})
    check("recent: past Senate session, no request either", past_s.status_code == 200 and net == [], str(net))
    http.fetch, http.congress_api = real_http_fetch, real_congress_api
    db.query(RollCallSyncState).delete()
    db.commit()

    other = client.post("/api/votes/explain", json={"vote_id": "h-999-1-1", "question": "On Passage",
                                                    "category": "passage", "result": "Passed"}).json()
    check("unstored vote_id falls back to the request", other.get("category") == "passage", str(other.get("category")))
    admin = client.get("/api/admin/roll-calls")
    check("admin view needs an admin", admin.status_code in (401, 403), str(admin.status_code))
    admin = client.get("/api/admin/roll-calls", headers=fh.admin_headers(db))
    view = admin.json() if admin.status_code == 200 else {}
    check("admin view for an admin", admin.status_code == 200 and view.get("roll_calls", 0) >= 1
          and "per_session" in view and "added_recently" in view and view.get("enabled") is False,
          f"{admin.status_code} {sorted(view)[:8]}")

    # ── 5. the sync against fake sources ───────────────────────────────
    print("5. sync")
    asyncio.run(_sync_checks(db))

    # ── 7. schedule ────────────────────────────────────────────────────
    print("7. schedule")
    from zoneinfo import ZoneInfo
    from app.services.roll_call_sync import seconds_until_next_pass as nxt
    et = ZoneInfo("America/New_York")
    check("weekday 10am: hourly", nxt(datetime(2026, 10, 14, 10, 0, tzinfo=et)) == 3600)
    check("weekday 11:30pm: hourly", nxt(datetime(2026, 10, 14, 23, 30, tzinfo=et)) == 3600)
    check("Saturday noon: 6 hours", nxt(datetime(2026, 10, 17, 12, 0, tzinfo=et)) == 6 * 3600)
    check("Monday 2am: until 5:15", nxt(datetime(2026, 10, 19, 2, 0, tzinfo=et)) == 3.25 * 3600)
    check("Monday 7am: until 9am", nxt(datetime(2026, 10, 19, 7, 0, tzinfo=et)) == 2 * 3600)
    check("history filling: 5 minutes", nxt(datetime(2026, 10, 17, 12, 0, tzinfo=et), backfill_pending=True) == 300)
    from app.services.roll_call_sync import seconds_after_pass as after
    sat = datetime(2026, 10, 17, 12, 0, tzinfo=et)
    check("pass skipped for the lock: short pause", after({"skipped": "locked"}, sat) == 300)
    check("pass that failed: short pause", after({"failed": True}, sat) == 300)
    check("history stalled: normal schedule", after({"backfill_pending": True, "history_stalled": True}, sat) == 6 * 3600)
    from app.services import roll_call_sync as rcs_mod
    os.environ.pop("ROLL_CALL_BACKFILL_CONGRESSES", None)
    check("stored window: ten years", rcs_mod.stored_window((119, 2)) == (115, 119))
    check("in window", rcs_mod.in_window(115, 1, (119, 2)) and not rcs_mod.in_window(114, 2, (119, 2))
          and not rcs_mod.in_window(119, 3, (119, 2)) and not rcs_mod.in_window(120, 1, (119, 2)))
    for env_val, want in (("", False), ("true", True), ("false", False)):
        os.environ["ROLL_CALL_SYNC_ENABLED"] = env_val
        check(f"sync enabled with ROLL_CALL_SYNC_ENABLED={env_val!r} outside production",
              rcs_mod.sync_enabled() is want)
    os.environ["RENDER"] = "true"
    os.environ["ROLL_CALL_SYNC_ENABLED"] = ""
    check("sync on by default in production", rcs_mod.sync_enabled() is True)
    os.environ["ROLL_CALL_SYNC_ENABLED"] = "false"
    check("production can turn it off", rcs_mod.sync_enabled() is False)
    os.environ.pop("RENDER", None)

    # ── 8. the real Postgres advisory lock (optional) ──────────────────
    pg = os.getenv("CIVICVIEW_TEST_POSTGRES_URL")
    if pg:
        print("8. Postgres advisory lock")
        from sqlalchemy import create_engine
        from app.services.db_locks import AdvisoryLock
        e1, e2 = create_engine(pg), create_engine(pg)
        l1, l2 = AdvisoryLock("civicview.test", engine=e1), AdvisoryLock("civicview.test", engine=e2)
        check("pg: first holder gets it", l1.try_acquire())
        check("pg: second instance is refused", not l2.try_acquire())
        l1.release()
        check("pg: free again after release", l2.try_acquire())
        l2.release()

        # Writing on Postgres, in a throwaway schema so no table outside it
        # is touched, whatever database the URL names.
        import threading
        from sqlalchemy import text
        from sqlalchemy.exc import IntegrityError as PgIntegrityError
        from sqlalchemy.orm import sessionmaker
        from app.models.pages import RollCallChoice, RollCallSyncState
        schema = "civicview_roll_call_test"
        with e1.begin() as conn:
            conn.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
            conn.execute(text(f"CREATE SCHEMA {schema}"))
        e3 = create_engine(pg, connect_args={"options": f"-csearch_path={schema}"})
        tables = [t.__table__ for t in (RollCall, RollCallPosition, RollCallChoice, RollCallMember, RollCallSyncState)]
        for t in tables:
            t.create(e3)
        PgSession = sessionmaker(bind=e3)
        pdb = PgSession()
        check("pg: speaker election stored with its choices", store.store_roll_call(pdb, sprec) == "added"
              and pdb.query(RollCallChoice).count() == 3)
        check("pg: second store is a no-op", store.store_roll_call(pdb, sprec) == "exists")
        check("pg: 'Voted for {name}'", store.member_votes(pdb, "M001184")[0]["position"] == "Voted for Emmer")

        def race(recs):
            outcomes, gate = [], threading.Barrier(len(recs))

            def writer(r):
                sess = PgSession()
                gate.wait()
                try:
                    outcomes.append(store.store_roll_call(sess, r))
                except Exception as exc:
                    outcomes.append(type(exc).__name__)
                finally:
                    sess.close()

            threads = [threading.Thread(target=writer, args=(r,)) for r in recs]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            return sorted(outcomes)

        same = record("h", 119, 2, 77, date(2026, 3, 3), "On Passage",
                      [("N000001", "Yea", "D"), ("N000002", "Nay", "R")], split(0, 1, 1, 0))
        got = race([same, dict(same)])
        check("pg: two writers, same vote: one adds, one finds it stored", got == ["added", "exists"], str(got))
        a = record("h", 119, 2, 78, date(2026, 3, 4), "On Passage", [("N000003", "Yea", "D")], split(0, 0, 1, 0))
        b = record("s", 119, 2, 78, date(2026, 3, 4), "On Passage", [("N000003", "Yea", "D")], split(0, 0, 1, 0))
        got = race([a, b])
        check("pg: two votes sharing a new member, stored at once: both added", got == ["added", "added"], str(got))
        check("pg: the member exists once", pdb.query(RollCallMember).filter_by(bioguide_id="N000003").count() == 1)
        broken = dict(record("h", 119, 2, 79, date(2026, 3, 5), "On Passage", [("N000004", "Yea", "D")], split(0, 0, 1, 0)))
        broken["positions"] = [("N000004", "Y", "D"), ("N000004", "N", "D")]
        try:
            store.store_roll_call(pdb, broken)
            raised = False
        except PgIntegrityError:
            raised = True
        check("pg: other integrity errors raised", raised and pdb.query(RollCall).filter_by(vote_id="h-119-2-79").count() == 0)
        pdb.rollback()
        for i in range(12):
            store.store_roll_call(pdb, record("h", 119, 1, 100 + i, date(2025, 5, 1) + timedelta(days=i), "On Passage",
                                              [("K000401", "Yea", "R")], split(200, 10, 5, 205)))
        store.store_roll_call(pdb, record("h", 119, 2, 200, date(2026, 9, 2), "On Passage",
                                          [("K000401", "Yea", "I")], split(200, 10, 5, 205)))
        check("pg: Kiley case, no figure", store.party_line(pdb, "K000401", 119)["reason"] == "independent")
        pdb.close()
        e3.dispose()
        with e1.begin() as conn:
            conn.execute(text(f"DROP SCHEMA {schema} CASCADE"))
    else:
        print("8. Postgres advisory lock: skipped (set CIVICVIEW_TEST_POSTGRES_URL to run it)")

    db.close()
    return check.exit_code()


async def _sync_checks(db):
    import app.services.official_http as http
    from app.models.pages import RollCall, RollCallSyncState
    from app.services import roll_call_store as store
    from app.services import roll_call_sync as rcs
    from app.services.db_locks import AdvisoryLock
    from app.services.official_http import FetchResult

    db.query(RollCall).delete()
    db.commit()
    os.environ["ROLL_CALL_BACKFILL_CONGRESSES"] = "1"
    os.environ["CONGRESS_API_KEY"] = "test-key"
    day = date(2026, 2, 1)
    hm = [("A000370", "D", "NC", "Yea"), ("A000055", "R", "AL", "Nay")]
    sm = [("S1", "R", "AA", "Yea"), ("S2", "D", "BB", "Nay")]
    house = {(2026, r): house_xml(119, 2, r, day, "On Passage", "YEA-AND-NAY", f"H R {r}", f"Bill {r}", hm)
             for r in (1, 2, 3)}
    house.update({(2025, r): house_xml(119, 1, r, date(2025, 3, 1), "On Passage", "YEA-AND-NAY", "H R 9", "B", hm)
                  for r in (1, 2)})
    senate = {(2, n): senate_xml(119, 2, n, day, "On Passage of the Bill", sm) for n in (1, 2)}
    senate[(1, 1)] = senate_xml(119, 1, 1, date(2025, 3, 2), "On Passage of the Bill", sm)
    counts = {(119, 2): 3, (119, 1): 2}
    calls = []
    flaky = {"house:2026:5": 1}  # a passing Clerk error page for roll 5 in the probe test

    async def fake_fetch(url, *, params=None, headers=None, etag=None, last_modified=None, **kw):
        calls.append(url)
        if "clerk.house.gov/evs/" in url:
            year = int(url.split("/evs/")[1].split("/")[0])
            roll = int(url.rsplit("roll", 1)[1].split(".")[0])
            key = f"house:{year}:{roll}"
            if flaky.get(key):
                flaky[key] -= 1
                return FetchResult(200, (FIX / "clerk_missing_roll.xml").read_text())
            text = house.get((year, roll))
            return FetchResult(200, text or (FIX / "clerk_missing_roll.xml").read_text())
        if "vote_menu_119_" in url:
            sess = int(url.rsplit("_", 1)[1].split(".")[0])
            nums = sorted(n for (s_, n) in senate if s_ == sess)
            tag = f'"menu-{sess}-{len(nums)}"'  # changes when the menu does
            if etag == tag:
                return FetchResult(304, None, {})
            return FetchResult(200, senate_menu(119, sess, nums), {"etag": tag})
        if "roll_call_votes/vote119" in url:
            sess = int(url.split("vote119")[1][0])
            num = int(url.rsplit("_", 1)[1].split(".")[0])
            text = senate.get((sess, num))
            return FetchResult(200, text) if text else FetchResult(404)
        if "cvc_member_data" in url:
            return FetchResult(200, (FIX / "senate_cvc_member_data.xml").read_text())
        return FetchResult(404)

    async def fake_congress(url, params=None):
        calls.append(url)
        if not os.getenv("CONGRESS_API_KEY"):
            return None
        parts = url.rstrip("/").split("/")
        if parts[-3] == "house-vote":
            return {"pagination": {"count": counts[(int(parts[-2]), int(parts[-1]))]}, "houseRollCallVotes": []}
        return None

    http.fetch = fake_fetch
    http.congress_api = fake_congress

    r1 = await rcs.run_pass()
    check("pass 1 adds House 5 and Senate 3", (r1["added_house"], r1["added_senate"]) == (5, 3), str(r1))
    check("pass 1 no errors", r1["errors"] == [], str(r1["errors"]))
    states = {(s.chamber, s.congress, s.session): s for s in db.query(RollCallSyncState).all()}
    db.expire_all()
    check("finished session (119-1) marked complete",
          states[("h", 119, 1)].completed_at is not None and states[("s", 119, 1)].completed_at is not None)
    check("current session never complete", states[("h", 119, 2)].completed_at is None)
    vote_urls_1 = [u for u in calls if "/evs/2026/roll00" in u and not u.endswith(("roll004.xml", "roll005.xml"))]
    check("each House roll fetched once", sorted(vote_urls_1) == sorted(set(vote_urls_1)) and len(vote_urls_1) == 3,
          str(vote_urls_1))

    calls.clear()
    r2 = await rcs.run_pass()
    check("pass 2 adds nothing", (r2["added_house"], r2["added_senate"]) == (0, 0), str(r2))
    refetched = [u for u in calls if any(f"roll00{r}.xml" in u for r in (1, 2, 3)) or "roll_call_votes" in u]
    check("pass 2 fetches no stored roll call again", refetched == [], str(refetched))
    check("pass 2 skips the complete session entirely", not any("/evs/2025/" in u or "119_1" in u for u in calls),
          str([u for u in calls if "2025" in u or "119_1" in u]))
    check("unchanged Senate menu is a 304", sum("vote_menu_119_2" in u for u in calls) == 1)

    # New votes arrive: Congress.gov lags the Clerk by one roll.
    house[(2026, 4)] = house_xml(119, 2, 4, day, "On Passage", "YEA-AND-NAY", "H R 4", "Bill 4", hm)
    senate[(2, 3)] = senate_xml(119, 2, 3, day, "On Passage of the Bill", sm)
    r3 = await rcs.run_pass()
    check("new House roll beyond the Congress.gov count found by the probe", "h-119-2-4" in r3["added"], str(r3["added"]))
    check("new Senate vote found from the changed menu", "s-119-2-3" in r3["added"], str(r3["added"]))

    # Probe without Congress.gov, through a passing Clerk error page.
    del os.environ["CONGRESS_API_KEY"]
    for r in range(5, 9):
        house[(2026, r)] = house_xml(119, 2, r, day, "On Passage", "YEA-AND-NAY", f"H R {r}", "B", hm)
    flaky["house:2026:5"] = 1
    summary = rcs.PassSummary()
    highest, finished = await rcs._probe_up(119, 2, 5, summary, None, batch_size=1)
    check("probe reaches the true end despite a passing error page", (highest, finished) == (8, True),
          f"{highest} {finished}")
    stored = store.stored_numbers(db, "h", 119, 2)
    check("probe stored every roll", stored == set(range(1, 9)), str(sorted(stored)))

    # A site that keeps failing is left alone after five errors in a row.
    os.environ["CONGRESS_API_KEY"] = "test-key"
    counts[(119, 2)] = 20  # rolls 9..20 unstored; the Clerk refuses them
    clerk_calls = []
    real_fake = http.fetch

    async def refusing(url, **kw):
        if "clerk.house.gov/evs/2026/" in url and int(url.rsplit("roll", 1)[1].split(".")[0]) >= 9:
            clerk_calls.append(url)
            return FetchResult(403)
        return await real_fake(url, **kw)

    http.fetch = refusing
    r4 = await rcs.run_pass()
    # Exact comparisons (not substring checks on a host name, which
    # CodeQL reads as URL sanitizing).
    stop_why = f"{rcs.HOST_ERROR_LIMIT} errors in a row, last status 403"
    check("failing site left alone after five errors in a row",
          r4["sites_stopped"] == {rcs._HOSTS["h"]: stop_why} and len(clerk_calls) <= rcs.FETCH_BATCH,
          f"{len(clerk_calls)} {r4['sites_stopped']}")
    check("the Senate kept going", r4["added_senate"] == 0, str(r4))
    h_state = db.query(RollCallSyncState).filter_by(chamber="h", congress=119, session=2).one()
    db.refresh(h_state)
    check("the stop is recorded for the admin view",
          h_state.last_error == f"stopped: {rcs._HOSTS['h']} gave {stop_why}", str(h_state.last_error))
    http.fetch = real_fake
    counts[(119, 2)] = 3

    # History that stops progressing goes back to the normal schedule.
    real_incomplete = rcs._history_incomplete
    rcs._history_incomplete = lambda db_, now_cs, kept: True
    rcs._NO_PROGRESS["passes"] = 0
    stalls = [(await rcs.run_pass())["history_stalled"] for _ in range(rcs.NO_PROGRESS_LIMIT)]
    check("three passes without progress: stalled on the third", stalls == [False, False, True], str(stalls))
    rcs._history_incomplete = real_incomplete
    r5 = await rcs.run_pass()
    check("progress (here: history complete) clears the stall", not r5["history_stalled"]
          and rcs._NO_PROGRESS["passes"] == 0, str(r5))

    # A provisional vote (Congress.gov) is re-checked from the Clerk only.
    prov = store.record_from_parsed({
        "chamber": "house", "congress": 119, "session": 2, "rollcall": 3, "date": "2026-02-01",
        "question": "On Passage", "vote_type": "YEA-AND-NAY", "result": "Passed", "legis_num": "H R 3",
        "source": "congress.gov",
        "members": [{"bioguide_id": "A000370", "position": "Yea", "party": "D"},
                    {"bioguide_id": "A000055", "position": "Nay", "party": "R"}],
        "by_party": {"D": {"yea": 1, "nay": 0, "present": 0, "not_voting": 0},
                     "R": {"yea": 0, "nay": 1, "present": 0, "not_voting": 0}}})
    db.query(RollCall).filter_by(vote_id="h-119-2-3").delete()
    db.commit()
    store.store_roll_call(db, prov, now=datetime(2026, 2, 1))
    calls.clear()

    async def clerk_down(url, **kw):
        calls.append(url)
        return FetchResult(503)

    http.fetch = clerk_down
    summary = rcs.PassSummary()
    await rcs.recheck_unconfirmed(summary)
    check("Clerk still down: no Congress.gov stand-in on the re-check",
          not any("house-vote" in u for u in calls), str(calls))
    db.expire_all()
    check("still provisional", db.query(RollCall).filter_by(vote_id="h-119-2-3").one().source == "congress.gov")
    http.fetch = real_fake
    summary = rcs.PassSummary()
    await rcs.recheck_unconfirmed(summary)
    db.expire_all()
    fixed = db.query(RollCall).filter_by(vote_id="h-119-2-3").one()
    check("Clerk back: provisional vote replaced and confirmed",
          fixed.source is None and fixed.confirmed_at is not None and fixed.description == "Bill 3",
          f"{fixed.source} {fixed.confirmed_at} {fixed.description}")

    calls.clear()
    await rcs.probe_house_session(119, 1)
    check("probe of a past session sends nothing", calls == [], str(calls))

    # The advisory lock: a pass while another holder has it does nothing.
    holder = AdvisoryLock(rcs.LOCK_NAME)
    check("lock taken by another instance", holder.try_acquire())
    blocked = await rcs.run_pass()
    check("pass skipped while locked", blocked == {"skipped": "locked"}, str(blocked))
    holder.release()
    again = AdvisoryLock(rcs.LOCK_NAME)
    check("lock free again", again.try_acquire())
    again.release()


if __name__ == "__main__":
    raise SystemExit(main())
