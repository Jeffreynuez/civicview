# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Official roll-call vote ingestion (House Clerk + Senate LIS).

Source-of-truth for the federal Bills & Votes feature (Phase A). Replaces
nothing — it sits alongside the existing GovTrack-backed per-member vote
path in congress_service. This module provides the *inverse* shape:
all members' positions on a SINGLE roll-call, plus chamber-wide recent
lists, which the /bills page + seat chart consume.

Data sources (validated 2026-05-30, see docs/bills-data-spike.md):
  • House per-roll XML — https://clerk.house.gov/evs/{year}/roll{NNN}.xml
        legislator @name-id IS the bioguide id (direct map, no crosswalk).
  • Senate recent index — vote_menu_{congress}_{session}.xml (ready-made list).
  • Senate per-vote XML — vote_{congress}_{session}_{NNNNN}.xml
        member carries lis_member_id → bioguide via legislators-current.json.

Design notes:
  • httpx is imported lazily inside the async fetchers so the pure parsers
    (parse_house_roll / parse_senate_vote / parse_senate_menu) import and run
    with the stdlib alone — they are unit-tested against fixtures offline.
  • Roll-call results are immutable once recorded, so per-vote member data is
    cached indefinitely; the recent-list cache uses a short TTL.
  • v1 scope = passage + nominations only (cloture / motions / amendments
    excluded). See classify_* helpers.

vote_id scheme:  h-{congress}-{session}-{rollnum}  /  s-{congress}-{session}-{votenum}
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)

# --- data sources -----------------------------------------------------------
_LEGIS_CACHE = (
    Path(__file__).resolve().parent.parent / "data" / "_cache" / "legislators_current.json"
)
_LEGIS_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"

HOUSE_ROLL_URL = "https://clerk.house.gov/evs/{year}/roll{roll:03d}.xml"
SENATE_MENU_URL = (
    "https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml"
)
SENATE_VOTE_URL = (
    "https://www.senate.gov/legislative/LIS/roll_call_votes/"
    "vote{congress}{session}/vote_{congress}_{session}_{num:05d}.xml"
)
GOVTRACK_VOTE_LIST = "https://www.govtrack.us/api/v2/vote"

# Congress.gov House roll-call vote API (official; replaces the GovTrack
# enumeration stopgap). Beta endpoint, 118th Congress onward. Requires an
# api key (CONGRESS_API_KEY); falls back to GovTrack when unset/unavailable.
CONGRESS_API_BASE = "https://api.congress.gov/v3"
HOUSE_VOTE_LIST_URL = CONGRESS_API_BASE + "/house-vote/{congress}/{session}"
HOUSE_VOTE_MEMBERS_URL = CONGRESS_API_BASE + "/house-vote/{congress}/{session}/{num}/members"

RECENT_TTL = 600  # 10 minutes — new votes land during a session

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


# --- legislators crosswalk (lis→bioguide, bioguide→meta) --------------------
class _Legislators:
    """Lazy singleton over the vendored legislators-current dataset. Builds
    two indexes: lis_member_id → bioguide (Senate mapping) and bioguide →
    {name, state, party, chamber} for enrichment."""

    def __init__(self) -> None:
        self._loaded = False
        self._lis2bio: dict[str, str] = {}
        self._bio2meta: dict[str, dict] = {}

    def _load_data(self) -> Optional[list]:
        try:
            if _LEGIS_CACHE.exists():
                return json.loads(_LEGIS_CACHE.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - disk read guard
            logger.warning("legislators cache read failed: %s", exc)
        try:
            import httpx

            resp = httpx.get(_LEGIS_URL, timeout=20.0)
            if resp.status_code == 200:
                return resp.json()
            logger.warning("legislators fetch returned %s", resp.status_code)
        except Exception as exc:  # pragma: no cover - network guard
            logger.error("legislators remote fetch failed: %s", exc)
        return None

    def _ensure(self) -> None:
        if self._loaded:
            return
        data = self._load_data()
        if data:
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
                if bio:
                    self._bio2meta[bio] = meta
                if lis and bio:
                    self._lis2bio[lis] = bio
        else:
            logger.error("legislators dataset unavailable — Senate id mapping degraded")
        self._loaded = True

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
        members.append(
            {
                "bioguide_id": bio,
                "name": _enrich_name(bio, leg.text),
                "state": leg.get("state"),
                "party": party_letter(leg.get("party")),
                "position": normalize_position(rv.findtext("vote")),
            }
        )

    rollnum = int(mt("rollcall-num") or 0)
    congress = int(mt("congress") or 0)
    session = (mt("session") or "").strip()
    return {
        "vote_id": f"h-{congress}-{_session_num(session)}-{rollnum}",
        "chamber": "house",
        "congress": congress,
        "session": session,
        "rollcall": rollnum,
        "legis_num": (mt("legis-num") or "").strip(),
        "question": (mt("vote-question") or "").strip(),
        "vote_type": (mt("vote-type") or "").strip(),
        "result": (mt("vote-result") or "").strip(),
        "date": (mt("action-date") or "").strip(),
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
        name = _enrich_name(bio, None) or (full.split(" (")[0] if full else None)
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
        }
    question = (rt("question") or "").strip()
    return {
        "vote_id": f"s-{congress}-{session}-{num}",
        "chamber": "senate",
        "congress": congress,
        "session": session,
        "rollcall": num,
        "question": question,
        "kind": classify_senate_question(question),
        "result": (rt("vote_result") or "").strip(),
        "date": (rt("vote_date") or "").strip(),
        "title": (rt("vote_title") or "").strip(),
        "bill": bill,
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
        out.append(
            {
                "vote_id": f"s-{congress}-{session}-{num}",
                "chamber": "senate",
                "congress": congress,
                "session": session,
                "rollcall": num,
                "date": (v.findtext("vote_date") or "").strip(),
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
    """Derive (congress, session) from today's date. Congress N spans years
    [1789 + 2*(N-1) .. +1]; session 1 = odd (first) year, 2 = even year."""
    import datetime as _dt

    y = _dt.date.today().year
    return (y - 1789) // 2 + 1, (1 if y % 2 == 1 else 2)


def year_for(congress: int, session: int) -> int:
    """Calendar year for a congress + session (House Clerk EVS paths)."""
    return 1789 + 2 * (congress - 1) + (session - 1)


_HOUSE_BILL_TYPES = {"HR", "HJRES", "HCONRES", "HRES"}
_HOUSE_CITE = {
    "HR": "H.R.", "HJRES": "H.J.Res.", "HCONRES": "H.Con.Res.", "HRES": "H.Res.",
}


def _congress_house_cite(leg_type: Optional[str], leg_num) -> str:
    """Congress.gov legislation code -> display cite (HR 1041 -> H.R. 1041)."""
    pre = _HOUSE_CITE.get((leg_type or "").upper(), (leg_type or "").upper())
    return (pre + " " + str(leg_num)).strip() if leg_num not in (None, "") else pre


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
    for m in items:
        bio = m.get("bioguideId") or m.get("bioguideID")
        letter = party_letter(m.get("voteParty"))
        position = normalize_position(m.get("voteCast"))
        full = " ".join(p for p in (m.get("firstName"), m.get("lastName")) if p)
        members.append(
            {
                "bioguide_id": bio,
                "name": _enrich_name(bio, full or None),
                "state": m.get("voteState"),
                "party": letter,
                "position": position,
            }
        )
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
        "question": (root.get("voteQuestion") or "").strip(),
        "vote_type": (root.get("voteType") or "").strip(),
        "result": (root.get("result") or "").strip(),
        "date": (root.get("startDate") or "").strip(),
        "totals": totals,
        "by_party": by_party,
        "members": members,
    }


# --- async service (network) ------------------------------------------------
class OfficialVotesService:
    """Fetch + cache wrapper around the pure parsers. Per-vote detail cached
    indefinitely (immutable); recent lists cached with a short TTL."""

    def __init__(self) -> None:
        self._detail: dict[str, dict] = {}
        self._recent: dict[str, tuple[float, list]] = {}

    async def _get(self, url: str, timeout: float = 20.0) -> Optional[str]:
        import httpx

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, headers={"User-Agent": "CivicView/1.0"})
                if resp.status_code == 200:
                    return resp.text
                logger.warning("official votes fetch %s -> %s", url, resp.status_code)
        except Exception as exc:
            logger.error("official votes fetch failed %s: %s", url, exc)
        return None

    # ---- per-vote member detail (seat-chart backbone) ----
    async def get_vote_members(self, vote_id: str) -> Optional[dict]:
        if vote_id in self._detail:
            return self._detail[vote_id]
        ref = parse_vote_id(vote_id)
        if ref["chamber"] == "house":
            # Primary: official House Clerk EVS XML (legislator name-id = bioguide).
            year = year_for(ref["congress"], ref["session"])
            url = HOUSE_ROLL_URL.format(year=year, roll=ref["number"])
            text = await self._get(url)
            data = parse_house_roll(text) if text else None
            if data is None:
                # Fallback: official Congress.gov members endpoint.
                data = await self._house_members_congress(
                    ref["congress"], ref["session"], ref["number"]
                )
        else:
            url = SENATE_VOTE_URL.format(
                congress=ref["congress"], session=ref["session"], num=ref["number"]
            )
            text = await self._get(url)
            data = parse_senate_vote(text) if text else None
        if data is not None:
            self._detail[vote_id] = data  # immutable — cache forever
        return data

    # ---- recent lists ----
    async def get_recent(
        self, chamber: str, congress: int, session: int, limit: int = 20
    ) -> list[dict]:
        cache_key = f"{chamber}:{congress}:{session}:{limit}"
        hit = self._recent.get(cache_key)
        if hit and time.time() - hit[0] < RECENT_TTL:
            return hit[1]

        if chamber == "senate":
            url = SENATE_MENU_URL.format(congress=congress, session=session)
            text = await self._get(url)
            rows = parse_senate_menu(text) if text else []
            rows = rows[:limit]
        else:
            rows = await self._house_recent(congress, session, limit)

        if rows:
            self._recent[cache_key] = (time.time(), rows)
        return rows

    async def _congress_get_json(self, url: str, params: Optional[dict] = None):
        """GET a Congress.gov API endpoint as JSON. Returns None when the key
        is unset or the call fails (caller falls back)."""
        import httpx

        key = os.getenv("CONGRESS_API_KEY")
        if not key:
            return None
        p = dict(params or {})
        p["api_key"] = key
        p.setdefault("format", "json")
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(url, params=p, headers={"User-Agent": "CivicView/1.0"})
                if resp.status_code == 200:
                    return resp.json()
                logger.warning("congress.gov %s -> %s", url, resp.status_code)
        except Exception as exc:
            logger.error("congress.gov fetch failed %s: %s", url, exc)
        return None

    async def _house_members_congress(self, congress: int, session: int, num: int) -> Optional[dict]:
        url = HOUSE_VOTE_MEMBERS_URL.format(congress=congress, session=session, num=num)
        payload = await self._congress_get_json(url)
        return parse_house_vote_members(payload) if payload else None

    async def _enrich_house_row(self, rows: list[dict]) -> None:
        """Fill the lead row's tally + question from its per-vote detail (the
        list level carries neither). Bounded to one extra fetch — that lead row
        is the only one that needs a tally (the home Bills card)."""
        if not rows:
            return
        detail = await self.get_vote_members(rows[0]["vote_id"])
        if detail:
            t = detail.get("totals") or {}
            rows[0]["tally"] = {"yea": t.get("yea", 0), "nay": t.get("nay", 0)}
            if detail.get("question") and not rows[0].get("question"):
                rows[0]["question"] = detail["question"]

    async def _house_recent(self, congress: int, session: int, limit: int) -> list[dict]:
        """Enumerate recent House legislative votes. Primary source is the
        official Congress.gov house-vote list; GovTrack (deprecated API) is the
        last-resort fallback."""
        url = HOUSE_VOTE_LIST_URL.format(congress=congress, session=session)
        payload = await self._congress_get_json(
            url, params={"limit": min(max(limit * 2, 40), 250)}
        )
        rows = parse_house_vote_list(payload, congress, session) if payload else []
        if rows:
            rows = rows[:limit]
            await self._enrich_house_row(rows)
            return rows
        return await self._house_recent_govtrack(congress, session, limit)

    async def _house_recent_govtrack(self, congress: int, session: int, limit: int) -> list[dict]:
        """Fallback enumerator — GovTrack's (deprecated) vote list."""
        import httpx

        try:
            params = {
                "congress": congress,
                "chamber": "house",
                "order_by": "-created",
                "limit": max(limit * 3, 30),
            }
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(GOVTRACK_VOTE_LIST, params=params)
                if resp.status_code != 200:
                    logger.warning("govtrack house vote list -> %s", resp.status_code)
                    return []
                objects = resp.json().get("objects", [])
        except Exception as exc:
            logger.error("govtrack house recent failed: %s", exc)
            return []

        rows = []
        for o in objects:
            category = (o.get("category") or "").lower()
            if "passage" not in category:
                continue
            num = o.get("number")
            if not num:
                continue
            rows.append(
                {
                    "vote_id": f"h-{congress}-{session}-{num}",
                    "chamber": "house",
                    "congress": congress,
                    "session": session,
                    "rollcall": num,
                    "date": (o.get("created") or "")[:10],
                    "issue": (o.get("related_bill") or {}).get("display_number", ""),
                    "question": o.get("question", ""),
                    "kind": "passage",
                    "result": o.get("result", ""),
                    "title": o.get("question", ""),
                    "tally": {
                        "yea": o.get("total_plus", 0),
                        "nay": o.get("total_minus", 0),
                    },
                }
            )
            if len(rows) >= limit:
                break
        return rows


_SERVICE: Optional[OfficialVotesService] = None


def get_service() -> OfficialVotesService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = OfficialVotesService()
    return _SERVICE
