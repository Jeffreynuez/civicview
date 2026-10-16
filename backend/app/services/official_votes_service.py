# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Official roll-call vote ingestion (House Clerk + Senate LIS).

Source of truth for every federal vote CivicView shows: the /bills page,
member profile Votes tabs, Compare and the party-line figure. Votes are
stored once fetched (services/roll_call_store.py, filled by
services/roll_call_sync.py), and nothing here depends on GovTrack
(retired 2026-10-16 after it started refusing our requests).

Data sources (validated 2026-05-30 and 2026-10-16, see docs/bills-data-spike.md):
  • House per-roll XML — https://clerk.house.gov/evs/{year}/roll{NNN}.xml
        legislator @name-id IS the bioguide id (direct map, no crosswalk).
        A roll that doesn't exist answers HTTP 200 with a short error
        body, so house_roll_missing() checks the body, not the status.
  • House enumeration: Congress.gov /house-vote/{congress}/{session}
        (needs CONGRESS_API_KEY; answers for the 115th Congress onward as
        of 2026-10-16); without it, roll numbers are probed upward on the
        Clerk.
  • Senate recent index — vote_menu_{congress}_{session}.xml (ready-made list).
  • Senate per-vote XML — vote_{congress}_{session}_{NNNNN}.xml
        member carries lis_member_id → bioguide, mapped through senate.gov's
        own member file, then legislators-current.json, then (only for an
        id still unmapped, i.e. a senator who has left)
        legislators-historical.json.

Design notes:
  • httpx is imported lazily inside the async fetchers so the pure parsers
    (parse_house_roll / parse_senate_vote / parse_senate_menu) import and run
    with the stdlib alone — they are unit-tested against fixtures offline.
  • Every request goes through services/official_http.py (User-Agent with a
    contact, two requests at a time per host, retries with backoff).
  • Roll-call results are immutable once recorded, so a vote is read from
    the database when stored and fetched (then stored) only when not.
  • /bills shows passage + nominations only (classify_* helpers). Member
    Votes tabs show every vote, labeled by categorize_vote().

vote_id scheme:  h-{congress}-{session}-{rollnum}  /  s-{congress}-{session}-{votenum}
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Optional
# defusedxml guards against XML bombs / external-entity attacks in the
# Clerk + Senate XML we fetch. The payloads come from house.gov /
# senate.gov, but a compromised upstream or MITM'd response shouldn't
# be able to OOM the worker. Unconditional import — it's pinned in
# requirements.txt (a try/except stdlib fallback would defeat both the
# protection and Bandit's ability to verify it).
from defusedxml import ElementTree as ET

logger = logging.getLogger(__name__)

# --- data sources -----------------------------------------------------------
_LEGIS_CACHE = (
    Path(__file__).resolve().parent.parent / "data" / "_cache" / "legislators_current.json"
)
_LEGIS_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
# Only read when a senator's LIS id is in neither senate.gov's member file
# nor legislators-current.json (someone who has left the Senate).
_LEGIS_HISTORICAL_URL = "https://unitedstates.github.io/congress-legislators/legislators-historical.json"
# senate.gov's own list of sitting senators, with lis_member_id and bioguideId.
SENATE_MEMBERS_URL = "https://www.senate.gov/legislative/LIS_MEMBER/cvc_member_data.xml"

HOUSE_ROLL_URL = "https://clerk.house.gov/evs/{year}/roll{roll:03d}.xml"
SENATE_MENU_URL = (
    "https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml"
)
SENATE_VOTE_URL = (
    "https://www.senate.gov/legislative/LIS/roll_call_votes/"
    "vote{congress}{session}/vote_{congress}_{session}_{num:05d}.xml"
)

# Congress.gov House roll-call vote API (official). Beta endpoint; it
# answers for the 115th Congress onward as of 2026-10-16. Requires an api key (CONGRESS_API_KEY); without one the
# House list is built from stored votes plus a probe of Clerk roll numbers.
CONGRESS_API_BASE = "https://api.congress.gov/v3"
HOUSE_VOTE_LIST_URL = CONGRESS_API_BASE + "/house-vote/{congress}/{session}"
HOUSE_VOTE_MEMBERS_URL = CONGRESS_API_BASE + "/house-vote/{congress}/{session}/{num}/members"

RECENT_TTL = 600  # 10 minutes — new votes land during a session
RECENT_EMPTY_TTL = 60  # an empty list: a quiet session, or a passing failure

# --- normalization ----------------------------------------------------------
_YEA = {"yea", "aye", "yes", "guilty"}
_NAY = {"nay", "no", "not guilty"}
_PRESENT = {"present", "present (giving live pair)"}
_PARTY = {"democrat": "D", "democratic": "D", "republican": "R", "independent": "I"}


def normalize_position(raw: Optional[str]) -> str:
    """Map any chamber's vote-cast string to Yea | Nay | Present | Not Voting."""
    if not raw:
        return "Not Voting"
    k = raw.strip().lower()
    if k in _YEA:
        return "Yea"
    if k in _NAY:
        return "Nay"
    if k in _PRESENT:
        return "Present"
    return "Not Voting"  # "Not Voting", "Absent", anything else


def is_election(question: Optional[str]) -> bool:
    """True for an election of the Speaker, where each member's vote is a
    name ("Jeffries", "Johnson (LA)"), not Yea or Nay."""
    return " ".join((question or "").lower().split()).startswith("election of")


def member_position(raw: Optional[str], election: bool) -> tuple[str, Optional[str]]:
    """(position, choice). In an election of the Speaker a vote for a person
    is ("Choice", the name as recorded), the same for every name; Present
    and Not Voting stay as they are. Otherwise (normalize_position, None)."""
    position = normalize_position(raw)
    text = " ".join((raw or "").split())
    if election and position == "Not Voting" and text and text.lower() not in ("not voting", "absent"):
        return "Choice", text[:80]
    return position, None


def party_letter(raw: Optional[str]) -> Optional[str]:
    """Normalize a party string/letter to R | D | I (or None)."""
    if not raw:
        return None
    k = raw.strip().lower()
    if k in ("r", "d", "i"):
        return k.upper()
    return _PARTY.get(k)


# --- v1 vote-type classification (passage + nominations only) ---------------
def classify_senate_question(question: Optional[str]) -> Optional[str]:
    """Return 'passage' | 'nomination' for in-scope Senate votes, else None."""
    q = (question or "").lower()
    if "on the nomination" in q:
        return "nomination"
    if "on passage" in q or "passage of the bill" in q:
        return "passage"
    if "on the joint resolution" in q or "passage of the joint resolution" in q:
        return "passage"
    if "passage of the resolution" in q:
        return "passage"
    return None  # cloture / motion to proceed / amendment / table / point of order


def classify_house_vote(vote_type: Optional[str], question: Optional[str]) -> Optional[str]:
    """Return 'passage' for in-scope House votes, else None. (House casts no
    nomination votes.)"""
    if (vote_type or "").upper() == "QUORUM":
        return None
    q = (question or "").lower()
    if "on passage" in q or "passage of the bill" in q:
        return "passage"
    if "suspend the rules and pass" in q:
        return "passage"
    if "on motion to concur" in q and "amendment" not in q:
        return "passage"
    return None


# --- full category for every vote (member Votes tabs, explainer) ----------
# The vote explainer's templates and the Votes tab's filters use these
# names: passage, passage_suspension, cloture, conference, veto_override,
# treaty, amendment, nomination, conviction, impeachment, procedural,
# quorum, leadership, unknown. Worked out from the official question text
# and vote type (and, for House resolutions, the measure's own name).
_PROCEDURAL_MARKERS = (
    "previous question", "motion to table", "to table", "recommit", "motion to commit",
    "adjourn", "reconsider", "consideration of the resolution", "question of consideration",
    "motion to instruct", "discharge", "motion to refer", "to refer", "postpone",
    "appeal", "ruling of the chair", "decision of the chair", "point of order",
    "motion to proceed", "motion to rise", "close the doors", "attendance", "waive",
    "motion to concur in the senate amendment with an amendment",
)


def categorize_vote(
    chamber: Optional[str],
    question: Optional[str],
    vote_type: Optional[str] = None,
    description: Optional[str] = None,
) -> str:
    """Category of any House or Senate roll call (see the list above)."""
    q = " ".join((question or "").lower().split())
    vt = (vote_type or "").upper()
    desc = (description or "").lower()
    house = (chamber or "").lower().startswith("h")

    if vt == "QUORUM" or "call of the house" in q or "call by states" in q or q.startswith("quorum"):
        return "quorum"
    if "election of the speaker" in q or q.startswith("election of"):
        return "leadership"
    if "cloture" in q:
        return "cloture"
    # Before the topic checks: "On the Motion to Table" a nomination, or to
    # refer a veto message, is a motion about the matter, not a vote on it.
    if any(m in q for m in _PROCEDURAL_MARKERS):
        return "procedural"
    if "guilty or not guilty" in q or "article of impeachment" in q or "articles of impeachment" in q:
        return "conviction" if not house else "impeachment"
    if "nomination" in q or q.startswith("on the confirmation"):
        return "nomination"
    if "resolution of ratification" in q or "treaty" in q:
        return "treaty"
    if "objections of the president" in q or "overrid" in q or "veto" in q:
        return "veto_override"
    if "conference report" in q:
        return "conference"
    if "suspend the rules" in q:
        return "passage_suspension"
    if ("amendment" in q and "concur" not in q) or "retaining division" in q:
        return "amendment"  # "On Retaining Division A": part of a divided amendment
    passage_like = (
        "on passage" in q or "passage of the bill" in q or q.startswith("on the bill")
        or "on the joint resolution" in q or "on the concurrent resolution" in q
        or "on the resolution" in q or "agreeing to the resolution" in q
        or "agreeing to the concurrent resolution" in q or "motion to concur" in q
        or "on agreeing to the senate amendment" in q
    )
    if passage_like:
        if house and desc.startswith(("providing for consideration", "providing for the adoption",
                                      "waiving a requirement", "providing for proceedings")):
            return "procedural"  # a special rule from the Rules Committee
        if house and desc.startswith("impeaching"):
            return "impeachment"
        return "passage"
    if q.startswith("on motion") or q.startswith("on the motion"):
        return "procedural"
    return "unknown"


def house_roll_missing(xml_text: Optional[str]) -> bool:
    """True when the Clerk's answer is not a roll call: no body, or the short
    error document it returns (with HTTP 200) for a roll that doesn't exist."""
    if not xml_text:
        return True
    return "<rollcall-vote" not in xml_text[:2000]


def bill_code(type_code: Optional[str]) -> Optional[str]:
    """Any source's measure type (H R / H.R. / HR / S.J.Res.) as a bill code
    (HR, SJRES, ...), or None when it isn't a bill or resolution."""
    code = (type_code or "").upper().replace(".", "").replace(" ", "")
    return code if code in _BILL_SLUG else None


def bill_cite(code: Optional[str], number) -> str:
    return _congress_house_cite(code, number)


# --- legislators crosswalk (lis→bioguide, bioguide→meta) --------------------
class _Legislators:
    """Lazy singleton over the legislators crosswalk. Builds two indexes:
    lis_member_id → bioguide (Senate mapping) and bioguide → {name, state,
    party, chamber} for enrichment.

    Sources, in order: legislators-current.json (loaded on first use);
    senate.gov's own member file (add_senate_members, loaded by the
    roll-call sync); legislators-historical.json, read only when an id is
    in neither (ensure_historical), i.e. someone who has left Congress."""

    def __init__(self) -> None:
        self._loaded = False
        self._historical_loaded = False
        self._historical_failed_at = 0.0
        # Votes are stored from several threads at once; the lock makes the
        # others wait for a load in progress instead of reading a
        # half-filled crosswalk (a 2025 Senate vote was once rejected that way).
        self._lock = threading.RLock()
        self._lis2bio: dict[str, str] = {}
        self._bio2meta: dict[str, dict] = {}

    def _load_data(self) -> Optional[list]:
        try:
            if _LEGIS_CACHE.exists():
                return json.loads(_LEGIS_CACHE.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - disk read guard
            logger.warning("legislators cache read failed: %s", exc)
        return self._fetch(_LEGIS_URL)

    @staticmethod
    def _fetch(url: str) -> Optional[list]:
        try:
            import httpx

            from app.services.official_http import USER_AGENT

            resp = httpx.get(url, timeout=30.0, headers={"User-Agent": USER_AGENT})
            if resp.status_code == 200:
                return resp.json()
            logger.warning("legislators fetch %s returned %s", url.rsplit("/", 1)[-1], resp.status_code)
        except Exception as exc:  # pragma: no cover - network guard
            logger.error("legislators remote fetch failed: %s", exc)
        return None

    def _index(self, data: list, overwrite: bool) -> None:
        for entry in data:
            ids = entry.get("id", {}) or {}
            bio = ids.get("bioguide")
            lis = ids.get("lis")
            terms = entry.get("terms") or [{}]
            term = terms[-1] if terms else {}
            name = entry.get("name", {}) or {}
            meta = {
                "bioguide": bio,
                "name": name.get("official_full")
                or " ".join(p for p in (name.get("first"), name.get("last")) if p),
                "last": name.get("last"),
                "state": term.get("state"),
                "party": party_letter(term.get("party")),
                "chamber": "senate" if term.get("type") == "sen" else "house",
            }
            if bio and (overwrite or bio not in self._bio2meta):
                self._bio2meta[bio] = meta
            if lis and bio and (overwrite or lis not in self._lis2bio):
                self._lis2bio[lis] = bio

    def _ensure(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            data = self._load_data()
            if data:
                self._index(data, overwrite=True)
            else:
                logger.error("legislators dataset unavailable; Senate id mapping degraded")
            self._loaded = True

    def ensure_historical(self) -> None:
        """Read legislators-historical.json once (about 13 MB), for members
        who have left Congress. Current entries keep precedence. After a
        failed download it is tried again, at most every 10 minutes."""
        self._ensure()
        if self._historical_loaded:
            return
        with self._lock:
            if self._historical_loaded or time.time() - self._historical_failed_at < 600:
                return
            data = self._fetch(_LEGIS_HISTORICAL_URL)
            if data:
                self._index(data, overwrite=False)
                self._historical_loaded = True
                logger.info("legislators-historical loaded for former members")
            else:
                self._historical_failed_at = time.time()

    def add_senate_members(self, xml_text: str) -> int:
        """Index senate.gov's cvc_member_data.xml (lis_member_id → bioguideId).
        Returns how many senators it mapped."""
        self._ensure()
        try:
            root = ET.fromstring(xml_text)
        except Exception as exc:
            logger.warning("senate member file unreadable: %s", exc)
            return 0
        with self._lock:
            return self._add_senators(root)

    def _add_senators(self, root) -> int:
        n = 0
        for sen in root.findall("senator"):
            lis = (sen.get("lis_member_id") or "").strip()
            bio = (sen.findtext("bioguideId") or "").strip()
            if lis and bio:
                self._lis2bio[lis] = bio
                n += 1
                if bio not in self._bio2meta:
                    first = (sen.findtext("name/first") or "").strip()
                    last = (sen.findtext("name/last") or "").strip()
                    self._bio2meta[bio] = {
                        "bioguide": bio, "name": " ".join(p for p in (first, last) if p), "last": last,
                        "state": (sen.findtext("state") or "").strip() or None,
                        "party": party_letter(sen.findtext("party")), "chamber": "senate",
                    }
        return n

    def has_bioguide(self, bioguide: Optional[str]) -> bool:
        self._ensure()
        return bool(bioguide) and bioguide in self._bio2meta

    def lis_to_bioguide(self, lis: Optional[str]) -> Optional[str]:
        if not lis:
            return None
        self._ensure()
        return self._lis2bio.get(lis)

    def meta(self, bioguide: Optional[str]) -> dict:
        if not bioguide:
            return {}
        self._ensure()
        return self._bio2meta.get(bioguide, {})


_LEGIS = _Legislators()


# --- pure parsers (testable offline) ----------------------------------------
def _enrich_name(bioguide: Optional[str], fallback: Optional[str]) -> Optional[str]:
    meta = _LEGIS.meta(bioguide)
    return meta.get("name") or (fallback.strip() if fallback else None)


def parse_house_roll(xml_text: str) -> dict:
    """Parse a House Clerk per-roll XML document into a normalized vote dict."""
    root = ET.fromstring(xml_text)
    meta = root.find("vote-metadata")
    if meta is None:
        raise ValueError("house roll xml: missing <vote-metadata>")

    def mt(tag: str) -> Optional[str]:
        el = meta.find(tag)
        return el.text if el is not None else None

    totals_el = meta.find("vote-totals/totals-by-vote")
    totals = {"yea": 0, "nay": 0, "present": 0, "not_voting": 0}
    if totals_el is not None:
        totals = {
            "yea": int(totals_el.findtext("yea-total") or 0),
            "nay": int(totals_el.findtext("nay-total") or 0),
            "present": int(totals_el.findtext("present-total") or 0),
            "not_voting": int(totals_el.findtext("not-voting-total") or 0),
        }

    election = is_election(mt("vote-question"))
    if election:
        # An election has <totals-by-candidate> instead: keep its Present
        # and Not Voting counts (a vote for a person is neither Yea nor Nay).
        for tc in meta.findall("vote-totals/totals-by-candidate"):
            cand = (tc.findtext("candidate") or "").strip().lower()
            if cand in ("present", "not voting"):
                totals["present" if cand == "present" else "not_voting"] = int(tc.findtext("candidate-total") or 0)

    by_party: dict[str, dict] = {}
    for tp in meta.findall("vote-totals/totals-by-party"):
        letter = party_letter(tp.findtext("party"))
        if not letter:
            continue
        by_party[letter] = {
            "yea": int(tp.findtext("yea-total") or 0),
            "nay": int(tp.findtext("nay-total") or 0),
            "present": int(tp.findtext("present-total") or 0),
            "not_voting": int(tp.findtext("not-voting-total") or 0),
        }

    members = []
    for rv in root.findall("vote-data/recorded-vote"):
        leg = rv.find("legislator")
        if leg is None:
            continue
        bio = leg.get("name-id")
        position, choice = member_position(rv.findtext("vote"), election)
        row = {
            "bioguide_id": bio,
            "name": _enrich_name(bio, leg.text),
            "state": leg.get("state"),
            "party": party_letter(leg.get("party")),
            "position": position,
        }
        if choice:
            row["choice"] = choice
        members.append(row)

    rollnum = int(mt("rollcall-num") or 0)
    congress = int(mt("congress") or 0)
    session = (mt("session") or "").strip()
    legis = (mt("legis-num") or "").strip()
    _toks = legis.split()
    source_url = (
        congress_bill_url(congress, "".join(_toks[:-1]), _toks[-1])
        if len(_toks) >= 2 and _toks[-1].isdigit()
        else None
    )
    return {
        "vote_id": f"h-{congress}-{_session_num(session)}-{rollnum}",
        "chamber": "house",
        "congress": congress,
        "session": session,
        "rollcall": rollnum,
        "legis_num": legis,
        "question": (mt("vote-question") or "").strip(),
        "vote_type": (mt("vote-type") or "").strip(),
        "result": (mt("vote-result") or "").strip(),
        "date": (mt("action-date") or "").strip(),
        # Clerk EVS <vote-desc> is the human-readable bill name (e.g.
        # "Removing Barriers to Work for Disabled Americans Act") —
        # surfaced as `title` so the /bills page can show WHAT was
        # voted on, not just the citation (2026-07-25, user feedback:
        # bill numbers alone weren't identifiable).
        "title": (mt("vote-desc") or "").strip(),
        "category": categorize_vote("house", mt("vote-question"), mt("vote-type"), mt("vote-desc")),
        "source_url": source_url,
        "totals": totals,
        "by_party": by_party,
        "members": members,
    }


def parse_senate_vote(xml_text: str) -> dict:
    """Parse a Senate LIS per-vote XML document into a normalized vote dict."""
    root = ET.fromstring(xml_text)

    def rt(tag: str) -> Optional[str]:
        el = root.find(tag)
        return el.text if el is not None else None

    count = root.find("count")
    totals = {"yea": 0, "nay": 0, "present": 0, "not_voting": 0}
    if count is not None:
        totals = {
            "yea": int(count.findtext("yeas") or 0),
            "nay": int(count.findtext("nays") or 0),
            "present": int(count.findtext("present") or 0),
            "not_voting": int(count.findtext("absent") or 0),
        }

    members = []
    by_party: dict[str, dict] = {}
    for m in root.findall("members/member"):
        lis = m.findtext("lis_member_id")
        bio = _LEGIS.lis_to_bioguide(lis)
        letter = party_letter(m.findtext("party"))
        position = normalize_position(m.findtext("vote_cast"))
        full = m.findtext("member_full")
        first_last = " ".join(
            p.strip() for p in (m.findtext("first_name"), m.findtext("last_name")) if p and p.strip()
        )
        name = _enrich_name(bio, None) or first_last or (full.split(" (")[0] if full else None)
        members.append(
            {
                "bioguide_id": bio,
                "lis_member_id": lis,
                "name": name,
                "state": m.findtext("state"),
                "party": letter,
                "position": position,
            }
        )
        if letter:
            bucket = by_party.setdefault(
                letter, {"yea": 0, "nay": 0, "present": 0, "not_voting": 0}
            )
            key = {"Yea": "yea", "Nay": "nay", "Present": "present"}.get(
                position, "not_voting"
            )
            bucket[key] += 1

    congress = int(rt("congress") or 0)
    session = int(rt("session") or 0)
    num = int(rt("vote_number") or 0)
    doc = root.find("document")
    bill = None
    if doc is not None and (doc.findtext("document_number") or "").strip():
        bill = {
            "type": (doc.findtext("document_type") or "").strip(),
            "number": (doc.findtext("document_number") or "").strip(),
            "title": (doc.findtext("document_title") or "").strip(),
            "short_title": (doc.findtext("document_short_title") or "").strip(),
        }
    question = (rt("question") or "").strip()
    # An amendment vote names its bill under <amendment>, not <document>.
    amendment_to = (root.findtext("amendment/amendment_to_document_number") or "").strip()
    amendment_to_title = (root.findtext("amendment/amendment_to_document_short_title") or "").strip()
    if amendment_to_title.lower() == "no short title on file":
        amendment_to_title = ""
    return {
        "vote_id": f"s-{congress}-{session}-{num}",
        "chamber": "senate",
        "congress": congress,
        "session": session,
        "rollcall": num,
        "question": question,
        # The fuller wording, e.g. "On the Nomination PN1129", and what
        # the vote was on in words ("Keith Sonderling, of Florida, to be
        # Secretary of Labor"). Older files may lack both.
        "question_text": (rt("vote_question_text") or "").replace("(No short title on file)", "").strip(),
        "document_text": (rt("vote_document_text") or "").strip(),
        "amendment_to": amendment_to,
        "amendment_to_title": amendment_to_title,
        "vote_type": (rt("majority_requirement") or "").strip(),
        "kind": classify_senate_question(question),
        "category": categorize_vote("senate", question),
        "result": (rt("vote_result") or "").strip(),
        "date": (rt("vote_date") or "").strip(),
        "title": (rt("vote_title") or "").strip(),
        "bill": bill,
        "source_url": congress_bill_url(congress, bill["type"], bill["number"]) if bill else None,
        "totals": totals,
        "by_party": by_party,
        "members": members,
    }


def parse_senate_menu(xml_text: str, in_scope_only: bool = True) -> list[dict]:
    """Parse the Senate recent-votes menu into a list of vote summaries.
    When in_scope_only, keep passage + nomination votes only (v1 scope)."""
    root = ET.fromstring(xml_text)
    congress = int(root.findtext("congress") or 0)
    session = int(root.findtext("session") or 0)
    cyear = (root.findtext("congress_year") or "").strip()  # the menu omits the year on each row
    out = []
    for v in root.findall("votes/vote"):
        question = (v.findtext("question") or "").strip()
        kind = classify_senate_question(question)
        if in_scope_only and kind is None:
            continue
        try:
            num = int(v.findtext("vote_number") or 0)
        except ValueError:
            continue
        tally = v.find("vote_tally")
        vdate = (v.findtext("vote_date") or "").strip()
        if vdate and cyear and not vdate.endswith(cyear):
            vdate = f"{vdate}-{cyear}"  # "12-Mar" -> "12-Mar-2026" (year-aware; avoids JS defaulting to 2001)
        out.append(
            {
                "vote_id": f"s-{congress}-{session}-{num}",
                "chamber": "senate",
                "congress": congress,
                "session": session,
                "rollcall": num,
                "date": vdate,
                "issue": (v.findtext("issue") or "").strip(),
                "question": question,
                "kind": kind,
                "result": (v.findtext("result") or "").strip(),
                "title": (v.findtext("title") or "").strip(),
                "tally": {
                    "yea": int(tally.findtext("yeas") or 0) if tally is not None else 0,
                    "nay": int(tally.findtext("nays") or 0) if tally is not None else 0,
                },
            }
        )
    return out


def _session_num(session: str) -> int:
    """Map a House <session> value ('1st'/'2nd') to 1/2."""
    s = (session or "").lower()
    if s.startswith("2"):
        return 2
    return 1


def parse_vote_id(vote_id: str) -> dict:
    """h-119-2-1 / s-119-2-53 → {chamber, congress, session, number}."""
    parts = (vote_id or "").split("-")
    if len(parts) != 4 or parts[0] not in ("h", "s"):
        raise ValueError(f"bad vote_id: {vote_id!r}")
    return {
        "chamber": "house" if parts[0] == "h" else "senate",
        "congress": int(parts[1]),
        "session": int(parts[2]),
        "number": int(parts[3]),
    }


# --- congress/session derivation + Congress.gov House parsers ---------------
def current_congress_session() -> tuple[int, int]:
    """(congress, session) sitting now. Congress N spans years
    [1789 + 2*(N-1) .. +1]; session 1 = odd (first) year, 2 = even year,
    and each one opens on January 3 (services/congress_calendar.py)."""
    from app.services.congress_calendar import current_congress_session as _ccs

    return _ccs()


def year_for(congress: int, session: int) -> int:
    """Calendar year for a congress + session (House Clerk EVS paths)."""
    return 1789 + 2 * (congress - 1) + (session - 1)


_HOUSE_BILL_TYPES = {
    "HR", "HJRES", "HCONRES", "HRES",  # House-originated measures
    "S", "SJRES", "SCONRES", "SRES",   # Senate bills voted on the House floor
}
_HOUSE_CITE = {
    "HR": "H.R.", "HJRES": "H.J.Res.", "HCONRES": "H.Con.Res.", "HRES": "H.Res.",
    "S": "S.", "SJRES": "S.J.Res.", "SCONRES": "S.Con.Res.", "SRES": "S.Res.",
}


def _congress_house_cite(leg_type: Optional[str], leg_num) -> str:
    """Congress.gov legislation code -> display cite (HR 1041 -> H.R. 1041)."""
    pre = _HOUSE_CITE.get((leg_type or "").upper(), (leg_type or "").upper())
    return (pre + " " + str(leg_num)).strip() if leg_num not in (None, "") else pre


_BILL_SLUG = {
    "HR": "house-bill", "S": "senate-bill",
    "HJRES": "house-joint-resolution", "SJRES": "senate-joint-resolution",
    "HCONRES": "house-concurrent-resolution", "SCONRES": "senate-concurrent-resolution",
    "HRES": "house-resolution", "SRES": "senate-resolution",
}


def congress_bill_url(congress, type_code, number) -> Optional[str]:
    """Public 'source of the bill' link — the congress.gov bill page. Accepts
    type codes in any form (HR / H R / H.R.); returns None for non-bill votes."""
    code = (type_code or "").upper().replace(".", "").replace(" ", "")
    slug = _BILL_SLUG.get(code)
    if not slug or number in (None, "") or not congress:
        return None
    return f"https://www.congress.gov/bill/{int(congress)}th-congress/{slug}/{number}"


def parse_house_vote_list(payload: dict, congress: int, session: int) -> list[dict]:
    """Parse a Congress.gov /house-vote/{c}/{s} list response into recent rows,
    newest first. Keeps legislative votes (bill types, not amendments). The list
    level carries no vote question or tally — those are filled lazily from the
    per-vote detail (see _enrich_house_row)."""
    votes = (payload or {}).get("houseRollCallVotes") or []
    rows = []
    for v in votes:
        if v.get("amendmentType") or v.get("amendmentNumber"):
            continue  # amendment votes are out of v1 scope
        leg_type = (v.get("legislationType") or "").upper()
        if leg_type and leg_type not in _HOUSE_BILL_TYPES:
            continue
        num = v.get("rollCallNumber")
        if num is None:
            continue
        rows.append(
            {
                "vote_id": f"h-{congress}-{session}-{int(num)}",
                "chamber": "house",
                "congress": congress,
                "session": session,
                "rollcall": int(num),
                "date": (v.get("startDate") or "")[:10],
                "issue": _congress_house_cite(leg_type, v.get("legislationNumber")),
                "question": "",
                "kind": "passage",
                "result": (v.get("result") or "").strip(),
            }
        )
    rows.sort(key=lambda r: r["rollcall"], reverse=True)
    return rows


def parse_house_vote_members(payload: dict) -> Optional[dict]:
    """Parse a Congress.gov /house-vote/{c}/{s}/{num}/members response into the
    normalized per-vote dict (same shape as parse_house_roll). Tolerant of the
    JSON wrapping variants Congress.gov uses for the members list."""
    root = (payload or {}).get("houseRollCallVoteMemberVotes") or payload or {}
    results = root.get("results")
    if isinstance(results, dict):
        items = results.get("item") or results.get("results") or []
    elif isinstance(results, list):
        items = results
    else:
        items = root.get("votes") or []
    if not items:
        return None
    congress = int(root.get("congress") or 0)
    session = int(root.get("sessionNumber") or root.get("session") or 0)
    rollcall = int(root.get("rollCallNumber") or 0)
    members = []
    by_party: dict[str, dict] = {}
    totals = {"yea": 0, "nay": 0, "present": 0, "not_voting": 0}
    election = is_election(root.get("voteQuestion"))
    for m in items:
        bio = m.get("bioguideId") or m.get("bioguideID")
        letter = party_letter(m.get("voteParty"))
        position, choice = member_position(m.get("voteCast"), election)
        full = " ".join(p for p in (m.get("firstName"), m.get("lastName")) if p)
        row = {
            "bioguide_id": bio,
            "name": _enrich_name(bio, full or None),
            "state": m.get("voteState"),
            "party": letter,
            "position": position,
        }
        if choice:
            row["choice"] = choice
        members.append(row)
        if position == "Choice":
            continue  # a vote for a person is neither Yea nor Nay
        key = {"Yea": "yea", "Nay": "nay", "Present": "present"}.get(position, "not_voting")
        totals[key] += 1
        if letter:
            b = by_party.setdefault(letter, {"yea": 0, "nay": 0, "present": 0, "not_voting": 0})
            b[key] += 1
    leg_type = (root.get("legislationType") or "").upper()
    return {
        "vote_id": f"h-{congress}-{session}-{rollcall}",
        "chamber": "house",
        "congress": congress,
        "session": session,
        "rollcall": rollcall,
        "legis_num": _congress_house_cite(leg_type, root.get("legislationNumber")),
        "source_url": root.get("legislationUrl") or congress_bill_url(congress, leg_type, root.get("legislationNumber")),
        "question": (root.get("voteQuestion") or "").strip(),
        "vote_type": (root.get("voteType") or "").strip(),
        "result": (root.get("result") or "").strip(),
        "date": (root.get("startDate") or "").strip(),
        "totals": totals,
        "by_party": by_party,
        "members": members,
        # No Clerk description or Speaker choices here: stored as
        # provisional and fetched again from the Clerk later.
        "source": "congress.gov",
    }


# --- async service (network) ------------------------------------------------
class OfficialVotesService:
    """Fetch + cache wrapper around the pure parsers. A vote's detail comes
    from the database when stored (roll_call_store, a few milliseconds);
    otherwise it is fetched once, stored, and kept in a small in-memory
    cache. Recent lists are cached with a short TTL.

    What a public request may fetch from the official sites is limited
    (review of 2026-10-16), so nobody can make CivicView crawl them: the
    recent list of a past session is read from stored votes only, and an
    unstored vote is fetched only inside the stored window, for a
    session not yet found complete, and not far above the highest stored
    number (roll_call_sync.may_fetch); a vote the site couldn't give is
    not asked for again for MISS_TTL seconds."""

    DETAIL_CACHE_MAX = 128
    MISS_TTL = 600
    MISS_MAX = 1024

    def __init__(self) -> None:
        self._detail: "OrderedDict[str, dict]" = OrderedDict()
        self._missed: "OrderedDict[str, float]" = OrderedDict()
        self._recent: dict[str, tuple[float, list]] = {}

    async def _get(self, url: str) -> Optional[str]:
        from app.services.official_http import fetch

        res = await fetch(url)
        return res.text if res.ok else None

    async def fetch_allowed(self, vote_id: str) -> bool:
        """Whether an unstored vote may be fetched from the official site."""
        from app.services import roll_call_store as store
        from app.services.roll_call_sync import may_fetch

        ref = parse_vote_id(vote_id)
        try:
            return await asyncio.to_thread(
                store.with_session, may_fetch, ref["chamber"][0], ref["congress"], ref["session"], ref["number"])
        except Exception:
            logger.exception("sync state unavailable for %s", vote_id)
            return False

    # ---- per-vote member detail (seat-chart backbone) ----
    async def get_vote_members(self, vote_id: str) -> Optional[dict]:
        ref = parse_vote_id(vote_id)
        stored = await _stored_detail(vote_id)
        if stored is not None:
            return stored
        hit = self._detail.get(vote_id)
        if hit is not None:
            self._detail.move_to_end(vote_id)
            return hit
        missed = self._missed.get(vote_id)
        if missed is not None and time.time() - missed < self.MISS_TTL:
            return None
        if not await self.fetch_allowed(vote_id):
            return None
        data = await fetch_vote(ref["chamber"], ref["congress"], ref["session"], ref["number"])
        if data is None:
            self._missed[vote_id] = time.time()
            self._missed.move_to_end(vote_id)
            while len(self._missed) > self.MISS_MAX:
                self._missed.popitem(last=False)
        else:
            await _store_parsed(data)
            # Kept in memory too, in case storing it failed.
            self._detail[vote_id] = data
            while len(self._detail) > self.DETAIL_CACHE_MAX:
                self._detail.popitem(last=False)
        return data

    # ---- recent lists ----
    async def get_recent(
        self, chamber: str, congress: int, session: int, limit: int = 20
    ) -> list[dict]:
        cache_key = f"{chamber}:{congress}:{session}:{limit}"
        hit = self._recent.get(cache_key)
        if hit and time.time() - hit[0] < (RECENT_TTL if hit[1] else RECENT_EMPTY_TTL):
            return hit[1]

        if (congress, session) != current_congress_session():
            # A past session: stored votes only, no request to any site.
            rows = await self._recent_stored("h" if chamber == "house" else "s", congress, session, limit)
        elif chamber == "senate":
            url = SENATE_MENU_URL.format(congress=congress, session=session)
            text = await self._get(url)
            rows = await asyncio.to_thread(parse_senate_menu, text) if text else []
            rows = rows[:limit]
        else:
            rows = await self._house_recent(congress, session, limit)

        # Cached even when empty (for RECENT_EMPTY_TTL, since an empty list
        # can also mean the source failed), so repeated requests for a
        # quiet session don't each reach the official site.
        self._recent[cache_key] = (time.time(), rows)
        return rows

    async def _congress_get_json(self, url: str, params: Optional[dict] = None):
        """GET a Congress.gov API endpoint as JSON. Returns None when the key
        is unset or the call fails (caller falls back)."""
        from app.services.official_http import congress_api

        return await congress_api(url, params)

    async def _house_members_congress(self, congress: int, session: int, num: int) -> Optional[dict]:
        url = HOUSE_VOTE_MEMBERS_URL.format(congress=congress, session=session, num=num)
        payload = await self._congress_get_json(url)
        return parse_house_vote_members(payload) if payload else None

    async def _enrich_house_row(self, rows: list[dict]) -> None:
        """Fill house recent rows from their per-vote details.

        v1 enriched only the lead row (tally for the home Bills card).
        2026-07-25: ALL rows now get `title` (+ question fill) so the
        /bills page can show bill NAMES, not just citations; user
        feedback was that numbers alone weren't identifiable. Per-vote
        details come from the database once stored, so only votes new
        since the last pass reach the network; official_http keeps that
        to two requests at a time."""
        if not rows:
            return

        async def fill(idx: int, row: dict) -> None:
            detail = await self.get_vote_members(row["vote_id"])
            if not detail:
                return
            if idx == 0:
                t = detail.get("totals") or {}
                row["tally"] = {"yea": t.get("yea", 0), "nay": t.get("nay", 0)}
            if detail.get("question") and not row.get("question"):
                row["question"] = detail["question"]
            if detail.get("title") and not row.get("title"):
                row["title"] = detail["title"]

        await asyncio.gather(*(fill(i, r) for i, r in enumerate(rows)))

    async def _house_recent(self, congress: int, session: int, limit: int) -> list[dict]:
        """Enumerate recent House legislative votes. Primary source is the
        official Congress.gov house-vote list. Without it (no key, or the
        call fails) the list is built from stored roll calls, after
        probing the Clerk for any roll newer than the highest stored.

        The beta list returns OLDEST-first and ignores ?sort, so we page to the
        end (via pagination.count) to surface the newest votes."""
        url = HOUSE_VOTE_LIST_URL.format(congress=congress, session=session)
        page = 250  # api max page size
        first = await self._congress_get_json(url, params={"limit": page, "offset": 0})
        if not first:
            return await self._house_recent_clerk(congress, session, limit)
        count = (first.get("pagination") or {}).get("count") or 0
        payload = first
        if count > page:
            tail = await self._congress_get_json(
                url, params={"limit": page, "offset": max(0, count - page)}
            )
            if tail:
                payload = tail
        rows = parse_house_vote_list(payload, congress, session)  # sorted newest-first
        rows = rows[:limit]
        await self._enrich_house_row(rows)
        return rows

    async def _house_recent_clerk(self, congress: int, session: int, limit: int) -> list[dict]:
        """No Congress.gov list: probe the Clerk for new rolls (current
        session only), then list the stored legislative votes."""
        from app.services.roll_call_sync import probe_house_session

        try:
            await probe_house_session(congress, session)
        except Exception:
            logger.exception("house clerk probe failed for %s-%s", congress, session)
        return await self._recent_stored("h", congress, session, limit)

    async def _recent_stored(self, chamber: str, congress: int, session: int, limit: int) -> list[dict]:
        """Stored in-scope votes (the same filter /bills uses: passage, and
        nominations in the Senate), newest first, in the recent-list shape."""
        from app.services import roll_call_store as store

        try:
            recs = await asyncio.to_thread(
                store.with_session, store.latest_numbers, chamber, congress, session, max(limit * 6, 60)
            )
        except Exception:
            logger.exception("stored votes unavailable")
            return []
        rows = []
        for rc in recs:
            if chamber == "h":
                kind = classify_house_vote(rc.vote_type, rc.question)
            else:
                kind = classify_senate_question(rc.question)
            if kind is None:
                continue
            code = bill_code(rc.doc_type)
            if code:
                issue = bill_cite(code, rc.doc_number)
            else:
                issue = " ".join(x for x in (rc.doc_type, rc.doc_number) if x)
            rows.append({
                "vote_id": rc.vote_id,
                "chamber": "house" if chamber == "h" else "senate",
                "congress": congress,
                "session": session,
                "rollcall": rc.number,
                "date": rc.vote_date.isoformat(),
                "issue": issue,
                "question": rc.question,
                "kind": kind,
                "result": rc.result,
                "title": (rc.description if chamber == "h" else rc.title) or "",
                "tally": {"yea": rc.yea, "nay": rc.nay},
            })
            if len(rows) >= limit:
                break
        return rows


async def fetch_vote(chamber: str, congress: int, session: int, number: int) -> Optional[dict]:
    """Fetch and parse one roll call from the official source (no database).

    House: the Clerk's XML, then Congress.gov's members endpoint when the
    Clerk has no file or fails. Senate: the per-vote XML. Returns None
    when the vote can't be read."""
    from app.services.official_http import fetch

    if chamber == "house":
        url = HOUSE_ROLL_URL.format(year=year_for(congress, session), roll=number)
        res = await fetch(url)
        data = None
        if res.ok and not house_roll_missing(res.text):
            try:
                data = await asyncio.to_thread(parse_house_roll, res.text)
            except Exception as exc:
                logger.warning("house roll %s-%s-%s unreadable: %s", congress, session, number, exc)
        if data is None:
            url = HOUSE_VOTE_MEMBERS_URL.format(congress=congress, session=session, num=number)
            from app.services.official_http import congress_api

            payload = await congress_api(url)
            data = parse_house_vote_members(payload) if payload else None
        return data

    url = SENATE_VOTE_URL.format(congress=congress, session=session, num=number)
    res = await fetch(url)
    if not res.ok:
        return None
    try:
        return await asyncio.to_thread(parse_senate_vote, res.text)
    except Exception as exc:
        logger.warning("senate vote %s-%s-%s unreadable: %s", congress, session, number, exc)
        return None


def remap_senators(parsed: dict) -> int:
    """Fill the bioguide id of any senator the first lookup missed, reading
    legislators-historical.json if needed (blocking; call off the event
    loop). Returns how many members are still unmapped."""
    if parsed.get("chamber") != "senate":
        return 0
    missing = [m for m in parsed.get("members") or [] if not m.get("bioguide_id") and m.get("lis_member_id")]
    if not missing:
        return 0
    _LEGIS.ensure_historical()
    still = 0
    for m in missing:
        bio = _LEGIS.lis_to_bioguide(m["lis_member_id"])
        if bio:
            m["bioguide_id"] = bio
            m["name"] = _enrich_name(bio, m.get("name"))
        else:
            still += 1
    return still


async def _stored_detail(vote_id: str) -> Optional[dict]:
    try:
        from app.services import roll_call_store as store

        return await asyncio.to_thread(store.with_session, store.vote_detail, vote_id)
    except Exception:
        logger.exception("stored vote lookup failed for %s", vote_id)
        return None


async def _store_parsed(data: dict) -> None:
    """Keep a vote fetched on a request, so it is never fetched again."""
    try:
        from app.services import roll_call_store as store

        if await asyncio.to_thread(remap_senators, data):
            logger.warning("vote %s has senators with no bioguide id; not stored", data.get("vote_id"))
            return
        rec = store.record_from_parsed(data)
        await asyncio.to_thread(store.with_session, store.store_roll_call, rec)
    except Exception:
        logger.exception("could not store vote %s", data.get("vote_id"))


_SERVICE: Optional[OfficialVotesService] = None


def get_service() -> OfficialVotesService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = OfficialVotesService()
    return _SERVICE
