# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Stored official roll calls: writing them and reading them (2026-10-16).

services/roll_call_sync.py fetches House and Senate roll calls from the
official sources and hands each parsed vote to store_roll_call() here.
Everything that shows a member's votes reads through this module:

  member_votes()        the profile Votes tab and Compare (recent, year,
                        month), in the row shape the frontend and the
                        vote explainer already use
  member_vote_years()   the years the Votes tab's year picker offers
  party_line()          the party-line figure (see its docstring)
  vote_detail()         one vote with every member's position, for the
                        /bills seat chart
  vote_context()        one vote without positions, for the explainer

Pure SQLAlchemy on a Session the caller supplies; no network.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.pages import RollCall, RollCallChoice, RollCallMember, RollCallPosition

logger = logging.getLogger(__name__)

# Y Yea (or Aye), N Nay (or No), P Present, V Not Voting, C voted for a
# person in an election of the Speaker (the name is in roll_call_choices).
POSITION_LETTER = {"Yea": "Y", "Nay": "N", "Present": "P", "Not Voting": "V", "Choice": "C"}
LETTER_POSITION = {v: k for k, v in POSITION_LETTER.items()}

# The party-line figure needs at least this many party-split votes.
PARTY_LINE_MIN_VOTES = 10

# A vote stored this soon after it was cast is fetched once more later
# (see RollCall.confirmed_at).
CONFIRM_AFTER = timedelta(hours=24)

_BIOGUIDE_RE = re.compile(r"^[A-Z]\d{6}$")


def utcnow() -> datetime:
    """The current UTC time as a naive datetime, the way the DateTime
    columns store it (the stdlib's own utcnow() is deprecated)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _clip(value: Optional[str], size: int) -> Optional[str]:
    """Strip and cut a value to its column size; None when empty."""
    text = (value or "").strip()
    return text[:size] or None
_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


# ── normalizing a parsed vote ──────────────────────────────────────────
def parse_official_date(raw: Optional[str]) -> Optional[date]:
    """The vote date from any of the official formats:
    House "16-Sep-2026", Senate "September 30, 2026,  09:29 PM",
    Congress.gov "2026-05-20T13:00:00-04:00"."""
    s = (raw or "").strip()
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{4})$", s)
    if m:
        return date(int(m.group(3)), _MONTHS[m.group(2).lower()], int(m.group(1)))
    m = re.match(r"^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4})", s)
    if m and m.group(1).lower() in _MONTHS:
        return date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))
    return None


def _split_legis(legis: str) -> tuple[Optional[str], Optional[str]]:
    toks = (legis or "").split()
    if len(toks) >= 2 and toks[-1].isdigit():
        return " ".join(toks[:-1]), toks[-1]
    return ((legis or "").strip() or None), None


def _split_cite(cite: str) -> tuple[Optional[str], Optional[str]]:
    """'S. 4668' / 'H.R. 9340' / 'S.J.Res. 12' -> (type, number)."""
    m = re.match(r"^\s*(.*?)\s*(\d+)\s*$", cite or "")
    if not m or not m.group(1):
        return None, None
    return m.group(1), m.group(2)


def record_from_parsed(parsed: dict) -> dict:
    """Turn a parsed vote (parse_house_roll, parse_senate_vote or
    parse_house_vote_members) into the row values store_roll_call()
    writes. Raises ValueError when the vote has no usable date."""
    from app.services.official_votes_service import categorize_vote

    chamber = "h" if parsed.get("chamber") == "house" else "s"
    vdate = parse_official_date(parsed.get("date"))
    if vdate is None:
        raise ValueError(f"no date on {parsed.get('vote_id')}")
    session = parsed.get("session")
    if isinstance(session, str):
        session = 2 if session.strip().lower().startswith("2") else 1
    if chamber == "h":
        doc_type, doc_number = _split_legis(parsed.get("legis_num") or "")
        description = (parsed.get("title") or "").strip() or None
        doc_title = None
        question_text = None
        title = None
    else:
        bill = parsed.get("bill") or {}
        doc_type = (bill.get("type") or "").strip() or None
        doc_number = (bill.get("number") or "").strip() or None
        doc_title = (bill.get("short_title") or bill.get("title") or "").strip() or None
        description = (parsed.get("document_text") or "").strip() or doc_title
        if not doc_number and parsed.get("amendment_to"):
            # An amendment vote: the bill it amends ("S. 4668").
            doc_type, doc_number = _split_cite(parsed["amendment_to"])
            doc_title = (parsed.get("amendment_to_title") or "").strip() or None
        question_text = (parsed.get("question_text") or "").strip() or None
        title = (parsed.get("title") or "").strip() or None
    question = (parsed.get("question") or "").strip()
    category = parsed.get("category") or categorize_vote(
        parsed.get("chamber"), question, parsed.get("vote_type"), description,
    )

    positions, members, choices, skipped = [], [], [], []
    seen = set()
    for m in parsed.get("members") or []:
        bio = (m.get("bioguide_id") or "").strip().upper()
        if not _BIOGUIDE_RE.match(bio):
            skipped.append(m.get("name") or m.get("lis_member_id") or "?")
            continue
        if bio in seen:
            continue
        seen.add(bio)
        letter = POSITION_LETTER.get(m.get("position"), "V")
        choice = _clip(m.get("choice"), 80) if letter == "C" else None
        if letter == "C" and not choice:
            letter = "V"
        positions.append((bio, letter, _clip(m.get("party"), 1)))
        members.append((bio, _clip(m.get("name"), 160), _clip(m.get("state"), 2)))
        if choice:
            choices.append((bio, choice))

    totals = parsed.get("totals") or {}
    return {
        "vote_id": f"{chamber}-{int(parsed['congress'])}-{int(session)}-{int(parsed['rollcall'])}",
        "chamber": chamber,
        "congress": int(parsed["congress"]),
        "session": int(session),
        "number": int(parsed["rollcall"]),
        "vote_date": vdate,
        "vote_year": vdate.year,
        "question": question,
        "question_text": question_text,
        "description": description,
        "title": title,
        "result": (parsed.get("result") or "").strip()[:160],
        "vote_type": _clip(parsed.get("vote_type"), 64),
        "category": (category or "unknown")[:24],
        "doc_type": _clip(doc_type, 24),
        "doc_number": _clip(doc_number, 32),
        "doc_title": doc_title,
        "source": _clip(parsed.get("source"), 16),
        "yea": int(totals.get("yea") or 0),
        "nay": int(totals.get("nay") or 0),
        "present": int(totals.get("present") or 0),
        "not_voting": int(totals.get("not_voting") or 0),
        "by_party": parsed.get("by_party") or {},
        "positions": positions,
        "members": members,
        "choices": choices,
        "skipped": skipped,
    }


# ── writing ───────────────────────────────────────────────────────────
def _confirmed_at(rec: dict, now: datetime) -> Optional[datetime]:
    if rec.get("source"):
        return None  # provisional (Congress.gov): fetched again from the Clerk
    cast = datetime.combine(rec["vote_date"], datetime.min.time())
    # The day the vote was cast plus a full day after it: a Senate file
    # can be amended in the hours after the vote.
    return now if now - cast >= CONFIRM_AFTER + timedelta(days=1) else None


_FIELDS = ("vote_id", "chamber", "congress", "session", "number", "vote_date", "vote_year",
           "question", "question_text", "description", "title", "result", "vote_type",
           "category", "doc_type", "doc_number", "doc_title", "yea", "nay", "present",
           "not_voting", "source")


def _apply_fields(rc: RollCall, rec: dict) -> None:
    for key in _FIELDS:
        setattr(rc, key, rec[key])
    rc.by_party_json = json.dumps(rec["by_party"], sort_keys=True)


def _insert_ignore(db: Session, table, rows: list[dict], keys: list[str]) -> None:
    """INSERT ... ON CONFLICT DO NOTHING (Postgres and SQLite)."""
    if not rows:
        return
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    db.execute(insert(table).on_conflict_do_nothing(index_elements=keys), rows)


def _upsert_members(db: Session, members: list) -> None:
    """Add anyone not yet known (two writers adding the same new member
    can't collide: ON CONFLICT DO NOTHING), then keep each name and state
    current."""
    if not members:
        return
    _insert_ignore(db, RollCallMember.__table__,
                   [{"bioguide_id": b, "name": name, "state": state} for b, name, state in members],
                   ["bioguide_id"])
    ids = [b for b, _, _ in members]
    existing = {m.bioguide_id: m for m in db.execute(
        select(RollCallMember).where(RollCallMember.bioguide_id.in_(ids))).scalars()}
    for bio, name, state in members:
        row = existing.get(bio)
        if row is None:
            continue
        # Keep a full name over a bare surname (the House file names
        # members by surname only when the crosswalk doesn't know them).
        if name and (not row.name or len(name) > len(row.name)):
            row.name = name
        if state and row.state != state:
            row.state = state


def _write_positions(db: Session, roll_call_id: int, positions: list, choices=()) -> None:
    if positions:
        db.execute(
            RollCallPosition.__table__.insert(),
            [{"roll_call_id": roll_call_id, "bioguide_id": b, "position": p, "party": party}
             for b, p, party in positions],
        )
    if choices:
        db.execute(
            RollCallChoice.__table__.insert(),
            [{"roll_call_id": roll_call_id, "bioguide_id": b, "choice": c} for b, c in choices],
        )


def store_roll_call(db: Session, rec: dict, *, now: Optional[datetime] = None) -> str:
    """Insert one roll call and its positions in a single transaction.

    Returns "added", or "exists" when it is already stored (a roll call
    is never fetched or written twice). Safe when two writers race: the
    unique vote_id makes the loser roll back and report "exists", after
    checking that the vote really is stored (any other integrity error is
    raised, not mistaken for a stored vote)."""
    now = now or utcnow()
    if db.execute(select(RollCall.id).where(RollCall.vote_id == rec["vote_id"])).first():
        return "exists"
    rc = RollCall(fetched_at=now, confirmed_at=_confirmed_at(rec, now))
    _apply_fields(rc, rec)
    db.add(rc)
    try:
        db.flush()
        _write_positions(db, rc.id, rec["positions"], rec.get("choices") or ())
        _upsert_members(db, rec["members"])
        db.commit()
    except IntegrityError:
        db.rollback()
        if db.execute(select(RollCall.id).where(RollCall.vote_id == rec["vote_id"])).first():
            return "exists"
        raise
    return "added"


def confirm_roll_call(db: Session, rec: dict, *, now: Optional[datetime] = None) -> str:
    """The one later re-check: of a vote stored within a day of being cast,
    and of a provisional House vote stored from Congress.gov (rec is then
    the Clerk's own file). Every stored field, position and Speaker
    choice is compared; the stored vote is replaced when any differs.
    Returns "unchanged", "changed" or "missing"."""
    now = now or utcnow()
    rc = db.execute(select(RollCall).where(RollCall.vote_id == rec["vote_id"])).scalar_one_or_none()
    if rc is None:
        return "missing"
    stored = {(p.bioguide_id, p.position, p.party) for p in db.execute(
        select(RollCallPosition).where(RollCallPosition.roll_call_id == rc.id)).scalars()}
    stored_choices = {(c.bioguide_id, c.choice) for c in db.execute(
        select(RollCallChoice).where(RollCallChoice.roll_call_id == rc.id)).scalars()}
    same_fields = all(getattr(rc, k) == rec[k] for k in _FIELDS) and (
        rc.by_party_json == json.dumps(rec["by_party"], sort_keys=True))
    same = same_fields and stored == set(rec["positions"]) and stored_choices == set(rec.get("choices") or ())
    outcome = "unchanged" if same else "changed"
    if outcome == "changed":
        _apply_fields(rc, rec)
        db.execute(RollCallPosition.__table__.delete().where(RollCallPosition.roll_call_id == rc.id))
        db.execute(RollCallChoice.__table__.delete().where(RollCallChoice.roll_call_id == rc.id))
        _write_positions(db, rc.id, rec["positions"], rec.get("choices") or ())
        _upsert_members(db, rec["members"])
    rc.confirmed_at = None if rec.get("source") else now
    db.commit()
    return outcome


def stored_numbers(db: Session, chamber: str, congress: int, session: int) -> set[int]:
    return set(db.execute(select(RollCall.number).where(
        RollCall.chamber == chamber, RollCall.congress == congress, RollCall.session == session,
    )).scalars())


def unconfirmed(db: Session, older_than: timedelta = timedelta(hours=12),
                now: Optional[datetime] = None) -> list[tuple[str, int, int, int]]:
    """Votes still waiting for their one re-check (or, for a provisional
    House vote, for the Clerk's file), fetched at least older_than ago:
    [(chamber, congress, session, number)]."""
    now = now or utcnow()
    rows = db.execute(select(RollCall.chamber, RollCall.congress, RollCall.session, RollCall.number).where(
        RollCall.confirmed_at.is_(None), RollCall.fetched_at <= now - older_than,
    )).all()
    return [tuple(r) for r in rows]


# ── reading ───────────────────────────────────────────────────────────
def _house_year(congress: int, session: int) -> int:
    return 1789 + 2 * (congress - 1) + (session - 1)


def roll_call_url(rc: RollCall) -> str:
    """The official human-readable page for a roll call."""
    if rc.chamber == "h":
        return f"https://clerk.house.gov/Votes/{_house_year(rc.congress, rc.session)}{rc.number}"
    return (
        "https://www.senate.gov/legislative/LIS/roll_call_votes/"
        f"vote{rc.congress}{rc.session}/vote_{rc.congress}_{rc.session}_{rc.number:05d}.htm"
    )


def _bill(rc: RollCall) -> Optional[dict]:
    from app.services.official_votes_service import bill_code, bill_cite, congress_bill_url

    code = bill_code(rc.doc_type)
    if not code or not rc.doc_number:
        return None
    title = rc.doc_title if rc.chamber == "s" else rc.description
    return {
        "type": code,
        "number": rc.doc_number,
        "display_number": bill_cite(code, rc.doc_number),
        "title": title or None,
        "congress": rc.congress,
        "url": congress_bill_url(rc.congress, code, rc.doc_number),
    }


def _question(rc: RollCall, bill: Optional[dict]) -> str:
    q = (rc.question_text or rc.question or "").strip() if rc.chamber == "s" else (rc.question or "").strip()
    desc = (rc.description or "").strip()
    # Add what the vote was on in words when the row has no bill to show
    # it (nominations, motions), and for amendments (their purpose).
    if desc and desc.lower() not in q.lower() and (not bill or rc.category == "amendment"):
        q = f"{q}: {desc}" if q else desc
    return q or "Roll-call vote"


def position_text(letter: Optional[str], choice: Optional[str] = None) -> str:
    """Yea / Nay / Present / Not Voting, or "Voted for {name}" in an
    election of the Speaker (the same wording for every name)."""
    if letter == "C":
        return f"Voted for {choice}" if choice else "Voted for a candidate"
    return LETTER_POSITION.get(letter, "Not Voting")


def vote_row(rc: RollCall, position_letter: Optional[str] = None, choice: Optional[str] = None) -> dict:
    """One vote in the shape /api/congress/members/{id}/votes returns and
    POST /api/votes/explain accepts."""
    bill = _bill(rc)
    row = {
        "vote_id": rc.vote_id,
        "question": _question(rc, bill),
        "chamber": "house" if rc.chamber == "h" else "senate",
        "congress": rc.congress,
        "session": rc.session,
        "number": rc.number,
        "result": rc.result,
        "category": rc.category,
        "date": rc.vote_date.isoformat(),
        "url": roll_call_url(rc),
        "bill": bill,
    }
    if position_letter is not None:
        row["position"] = position_text(position_letter, choice)
        if position_letter == "C" and choice:
            row["choice"] = choice
    return row


def member_votes(db: Session, bioguide_id: str, *, limit: Optional[int] = None,
                 year: Optional[int] = None, month: Optional[int] = None) -> list[dict]:
    """A member's votes, newest first. No year: the `limit` most recent.
    Year: every vote that calendar year, optionally one month of it."""
    q = (
        select(RollCall, RollCallPosition.position, RollCallChoice.choice)
        .join(RollCallPosition, RollCallPosition.roll_call_id == RollCall.id)
        .outerjoin(RollCallChoice, (RollCallChoice.roll_call_id == RollCall.id)
                   & (RollCallChoice.bioguide_id == RollCallPosition.bioguide_id))
        .where(RollCallPosition.bioguide_id == bioguide_id.upper())
        .order_by(RollCall.vote_date.desc(), RollCall.chamber, RollCall.number.desc())
    )
    if year is not None:
        start = date(int(year), int(month or 1), 1)
        if month:
            end = date(int(year) + (1 if int(month) == 12 else 0), 1 if int(month) == 12 else int(month) + 1, 1)
        else:
            end = date(int(year) + 1, 1, 1)
        q = q.where(RollCall.vote_date >= start, RollCall.vote_date < end)
    elif limit:
        q = q.limit(int(limit))
    return [vote_row(rc, pos, choice) for rc, pos, choice in db.execute(q).all()]


def member_vote_years(db: Session, bioguide_id: str) -> list[int]:
    """Calendar years in which the member has stored votes, newest first."""
    rows = db.execute(
        select(RollCall.vote_year)
        .join(RollCallPosition, RollCallPosition.roll_call_id == RollCall.id)
        .where(RollCallPosition.bioguide_id == bioguide_id.upper())
        .group_by(RollCall.vote_year)
    ).scalars()
    return sorted({int(y) for y in rows}, reverse=True)


def _majority(counts: dict) -> Optional[str]:
    y, n = int(counts.get("yea") or 0), int(counts.get("nay") or 0)
    if y > n:
        return "Y"
    if n > y:
        return "N"
    return None


def party_line(db: Session, bioguide_id: str, congress: int) -> dict:
    """The party-line figure, the same way for every member and party.

    The votes counted are the roll calls of the given Congress on which
    most voting Republicans and most voting Democrats took opposite
    sides ("party-split" votes; only Yea and Nay are counted on each
    side). The figure is the share of those votes on which the member
    voted with most of their own party. Votes where the member answered
    Present or did not vote are left out, and so are elections of the
    Speaker (a vote for a person, not Yea or Nay).

    Party switchers (Jeffrey, 2026-10-16): only the votes the member cast
    in their current party count, in either direction. The current party
    is the one the official record gives on the member's most recent
    stored vote in that Congress. If it is independent, there is no
    figure: there is no independent majority to compare with.

    Returns {pct, analyzed, congress, party, reason}; pct is None with
    reason "independent", "not_enough" (fewer than PARTY_LINE_MIN_VOTES)
    or "no_votes".
    """
    rows = db.execute(
        select(RollCallPosition.position, RollCallPosition.party, RollCall.by_party_json, RollCall.category)
        .join(RollCall, RollCall.id == RollCallPosition.roll_call_id)
        .where(RollCallPosition.bioguide_id == bioguide_id.upper(), RollCall.congress == int(congress))
        .order_by(RollCall.vote_date.desc(), RollCall.number.desc())
    ).all()
    out = {"pct": None, "analyzed": 0, "congress": int(congress), "party": None, "reason": None}
    current = next((party for _, party, _, _ in rows if party), None)
    if current is None:
        out["reason"] = "no_votes"
        return out
    out["party"] = current
    if current not in ("R", "D"):
        out["reason"] = "independent"
        return out
    matched = analyzed = 0
    for position, party, by_party_json, category in rows:
        if party != current or position not in ("Y", "N") or category == "leadership":
            continue
        try:
            by_party = json.loads(by_party_json or "{}")
        except ValueError:
            continue
        r_side = _majority(by_party.get("R") or {})
        d_side = _majority(by_party.get("D") or {})
        if r_side is None or d_side is None or r_side == d_side:
            continue
        analyzed += 1
        if position == (r_side if current == "R" else d_side):
            matched += 1
    out["analyzed"] = analyzed
    if analyzed < PARTY_LINE_MIN_VOTES:
        out["reason"] = "not_enough"
        return out
    out["pct"] = round(matched * 100 / analyzed)
    return out


def _get(db: Session, vote_id: str) -> Optional[RollCall]:
    return db.execute(select(RollCall).where(RollCall.vote_id == vote_id)).scalar_one_or_none()


def vote_context(db: Session, vote_id: str) -> Optional[dict]:
    """The stored vote (no positions), or None when it isn't stored."""
    rc = _get(db, vote_id) if vote_id else None
    return vote_row(rc) if rc else None


def _house_date_text(d: date) -> str:
    return f"{d.day}-{d.strftime('%b')}-{d.year}"


def vote_detail(db: Session, vote_id: str) -> Optional[dict]:
    """One stored vote with every member's position, in the shape
    /api/votes/{vote_id}/members returns (the same keys the live House
    and Senate parsers produce), or None when it isn't stored."""
    from app.services.official_votes_service import classify_senate_question, congress_bill_url

    rc = _get(db, vote_id)
    if rc is None:
        return None
    rows = db.execute(
        select(RollCallPosition, RollCallMember.name, RollCallMember.state, RollCallChoice.choice)
        .outerjoin(RollCallMember, RollCallMember.bioguide_id == RollCallPosition.bioguide_id)
        .outerjoin(RollCallChoice, (RollCallChoice.roll_call_id == RollCallPosition.roll_call_id)
                   & (RollCallChoice.bioguide_id == RollCallPosition.bioguide_id))
        .where(RollCallPosition.roll_call_id == rc.id)
        .order_by(RollCallPosition.bioguide_id)
    ).all()
    members = []
    for p, name, state, choice in rows:
        m = {"bioguide_id": p.bioguide_id, "name": name or p.bioguide_id, "state": state,
             "party": p.party, "position": position_text(p.position, choice)}
        if p.position == "C" and choice:
            m["choice"] = choice
        members.append(m)
    try:
        by_party = json.loads(rc.by_party_json or "{}")
    except ValueError:
        by_party = {}
    out = {
        "vote_id": rc.vote_id,
        "chamber": "house" if rc.chamber == "h" else "senate",
        "congress": rc.congress,
        "session": rc.session,
        "rollcall": rc.number,
        "question": rc.question,
        "result": rc.result,
        "date": _house_date_text(rc.vote_date),
        "title": (rc.description if rc.chamber == "h" else rc.title) or "",
        "category": rc.category,
        "url": roll_call_url(rc),
        "totals": {"yea": rc.yea, "nay": rc.nay, "present": rc.present, "not_voting": rc.not_voting},
        "by_party": by_party,
        "members": members,
        "stored": True,
    }
    if rc.chamber == "h":
        out["legis_num"] = " ".join(x for x in (rc.doc_type, rc.doc_number) if x)
        out["vote_type"] = rc.vote_type or ""
        bill = _bill(rc)
        out["source_url"] = bill["url"] if bill else None
    else:
        out["kind"] = classify_senate_question(rc.question)
        out["bill"] = ({"type": rc.doc_type or "", "number": rc.doc_number, "title": rc.doc_title or ""}
                       if rc.doc_number else None)
        out["source_url"] = congress_bill_url(rc.congress, rc.doc_type, rc.doc_number) if rc.doc_number else None
    return out


def latest_numbers(db: Session, chamber: str, congress: int, session: int, limit: int) -> list[RollCall]:
    return list(db.execute(
        select(RollCall).where(RollCall.chamber == chamber, RollCall.congress == congress,
                               RollCall.session == session)
        .order_by(RollCall.number.desc()).limit(int(limit))
    ).scalars())


def summary(db: Session, recent_hours: int = 24, now: Optional[datetime] = None) -> dict:
    """Counts for the admin view: per chamber and session, and what was
    added in the last `recent_hours`."""
    now = now or utcnow()
    per_session = [
        {"chamber": c, "congress": cg, "session": s, "stored": n, "newest_date": str(d) if d else None,
         "highest_number": hi}
        for c, cg, s, n, d, hi in db.execute(
            select(RollCall.chamber, RollCall.congress, RollCall.session, func.count(RollCall.id),
                   func.max(RollCall.vote_date), func.max(RollCall.number))
            .group_by(RollCall.chamber, RollCall.congress, RollCall.session)
            .order_by(RollCall.congress.desc(), RollCall.session.desc(), RollCall.chamber)
        ).all()
    ]
    recent = [
        {"vote_id": v, "date": str(d), "fetched_at": f.isoformat() if f else None}
        for v, d, f in db.execute(
            select(RollCall.vote_id, RollCall.vote_date, RollCall.fetched_at)
            .where(RollCall.fetched_at >= now - timedelta(hours=recent_hours))
            .order_by(RollCall.fetched_at.desc()).limit(200)
        ).all()
    ]
    return {
        "roll_calls": int(db.execute(select(func.count(RollCall.id))).scalar() or 0),
        "positions": int(db.execute(select(func.count()).select_from(RollCallPosition)).scalar() or 0),
        "awaiting_recheck": int(db.execute(select(func.count(RollCall.id)).where(
            RollCall.confirmed_at.is_(None))).scalar() or 0),
        "provisional_from_congress_gov": int(db.execute(select(func.count(RollCall.id)).where(
            RollCall.source.is_not(None))).scalar() or 0),
        "per_session": per_session,
        "added_recently": recent,
    }


def with_session(fn, *args, **kwargs):
    """Run fn(db, *args) in a fresh session (for asyncio.to_thread)."""
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        return fn(db, *args, **kwargs)
    finally:
        db.close()


def chunked(items: Iterable, size: int):
    buf = []
    for it in items:
        buf.append(it)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf
