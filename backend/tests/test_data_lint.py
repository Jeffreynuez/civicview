"""Data lint for the hand-curated civic data in backend/app/data (audit E13).

Run:  cd backend && python3 tests/test_data_lint.py   (exit 0 = pass)

Most of these files are edited by hand or by one-off scripts, and until
2026-09-25 nothing checked them, so demo data, dead references and
invented measures could reach production unnoticed. Every rule below
encodes a mistake that has actually happened in this repo. It reads
files only; it never calls the network or the app.

Elections (every <state>/elections.json):
  E-1  race ids are unique and start with "<state>-"
  E-2  every candidate id a race names exists in <state>/candidates.json
  E-3  key dates are real calendar dates (YYYY-MM-DD)
  E-4  every ballot measure names an https source_url
  E-5  roster_status, when present, is a known value
  E-6  a reported result names an https source_url
  E-7  term_length_years is a whole number from 1 to 6
  E-8  a state legislative race is for a seat that is actually on the
       ballot this cycle, with that chamber's term length, per
       legislative_seats_2026.json (seats not up were listed as 2026
       races in CA, PA and TX until 2026-09-25)
  E-9  no chamber lists the same district twice
  E-10 no race names a candidate marked withdrawn: someone who is not on
       the ballot is taken off the race and keeps their record, with
       withdrawn, withdrawn_note and withdrawn_source (the Florida
       convention, followed on 2026-10-15 for six CA, NY and TX races
       that listed a member who had left the seat)
  E-11 every date an election reminder is sent for (an election that is
       still ahead, its voter registration deadline, mail ballot request
       deadline and first day of early voting) has a source on an
       official site in key_date_sources and the day that source was
       read in key_date_retrieved; voter_info's links, poll hours and
       no_reminder entries are on official sites, and the latter two
       carry a retrieved date too. Jeffrey, 2026-10-16: "Every date
       comes from an official state source ... and carries its source
       URL." The reminder job skips a date without them; this catches
       it first. The format is in docs/election-reminders.md
  E-12 every key date of an election still ahead (any key_dates key for
       that election, not only the reminder dates: the registration
       methods, mail ballot return, early voting rule and the rest) has
       an official https source and a retrieved date, voter_info
       .poll_hours_vary has both too, and a 2026 file's general
       election is 2026-11-03. Jeffrey, 2026-10-16: "Every date and
       every race carries its source URL and the date you retrieved it."
Candidates (every <state>/candidates.json):
  C-1  a record's own "id", when present, matches its key
  C-2  no two records for the same person and office unless one is
       marked duplicate_of
  C-3  duplicate_of points at a record that exists
  C-4  an official_id points at a current record in the same state's
       state_officials.json (until 2026-10-15 two Florida candidates
       pointed at ids that never existed, "fl-exec-ag" and
       "fl-house-42", so their "currently in office" link led nowhere)
Officials (every <state>/state_officials.json, fl/local_officials.json,
federal/federal_officials.json):
  O-1  ids are unique within the file
  O-2  the same person is not listed twice for the same office
  O-3  no two people in a file share one email address (until
       2026-10-14 the record for Kentucky Rep. Samara Heavrin, House
       District 18, carried Rep. Ryan Dotson's address, the one on his
       own House District 73 record)
  O-4  every official's party is a code frontend/lib/party.js knows,
       or null for none (until 2026-10-15 every non-party status was
       stored as "I" and an empty party showed as "Independent"; the
       codes now carry the state's own word: NP Nonpartisan, U
       Unaffiliated, NA Not Affiliated, UNE Unenrolled, NPA No Party
       Affiliation, TM Tribal Member)
Seats and former officials (state_officials.json, fl/local_officials.json,
federal/federal_officials.json, federal/congress_profiles.json, id_holders.json):
  S-1  every official id, current or former, belongs to the person the
       ledger id_holders.json names. Jeffrey, 2026-10-15: "When the
       person in any seat changes, the successor must never inherit the
       predecessor's page, posts, polls, followers or account; the
       outgoing person moves to their own former record." Until then
       us-ag, us-sec-labor and us-sec-dhs had passed to the next
       officeholder (2026-09-24). Run scripts/build_id_holders.py
       --write after adding people
  S-2  former officials: every _retired_ids id has a _former_members
       record; a former id is not also a current record; successor ids
       name a record in the same file; recorded_on is a real date;
       left_office_on is set only with an official https
       left_office_source (a recorded-on date is never the day someone
       left); served_from is not after served_to
  S-3  a curated left_office_on for a member of Congress is a real date
       with an https left_office_source
  S-4  a campaign's ended_on (withdrawal date, or the certification date
       of the result that ended it) has an https ended_on_source on an
       official site; ended_recorded_on, the day our data recorded the
       change, is a real date
  The day someone left, and the day a campaign ended, come from official
  sources only (Jeffrey, 2026-10-15: "with official sources only (for
  the Florida primary, the Division of Elections or the Elections
  Canvassing Commission, not news)"). An official site is a .gov or
  .us host, or a state's own election or legislature domain listed in
  OFFICIAL_HOST_SUFFIXES.
Federal profiles (federal/congress_profiles.json, federal/federal_officials.json):
  F-1  every Areas of Focus (top_issues) source is a specific https
       page, never a site's home page (until 2026-10-15, 1,581
       stances for members of Congress and one for a Cabinet secretary
       cited only an official's home page, which supports nothing in
       particular)
Photo credits:
  P-1  every Wikimedia Commons photo in the data has an entry in
       photo_credits.json with a file page and a license, and every
       entry there is still used (audit P2; run
       scripts/build_photo_credits.py --write after changing photos)
Everywhere:
  A-1  no placeholder domains (example.com / .org / .net, localhost)
  A-2  photo, website and source URLs are https
  A-3  no file or record describes itself as demo or sample data
"""
import datetime as _dt
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

DATA = Path(__file__).resolve().parent.parent / "app" / "data"

ROSTER_STATUSES = {"verified_nominees"}
PLACEHOLDER_RE = re.compile(r"https?://(?:[\w-]+\.)*(?:example\.(?:com|org|net)|localhost)\b", re.I)
DEMO_RE = re.compile(r"\b(demo|sample|placeholder|lorem ipsum)\s+(data|record|entry|entries|content)\b", re.I)
ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
URL_KEYS = {"photo_url", "website", "source_url", "roster_source_url", "photo_source_url"}
# Hosts allowed to stay on http://, checked by hand on 2026-09-25.
# Browsers upgrade http images on an https page to https, so an http
# photo only shows if the https version works. Every other http photo
# URL was switched to https (where that served the image) or cleared
# (where nothing did).
HTTP_ONLY_HOSTS = {
    # Unreachable from our test network on either scheme, so we could
    # not tell whether https works. Left as Open States supplied them.
    "billstatus.ls.state.ms.us",
}

# Official sites other than .gov / .us hosts (rules S-2 to S-4, E-11,
# E-12). Each is run by the government itself; checked by hand.
#   dcboe.org: the District of Columbia Board of Elections, the official
#     election office for DC, 2026-10-16.
OFFICIAL_HOST_SUFFIXES = ("myflorida.com", "flsenate.gov", "myfloridahouse.gov", "dcboe.org")

# Party codes frontend/lib/party.js maps to a label (rule O-4).
PARTY_CODES = {"R", "D", "I", "NP", "U", "NA", "NPA", "UNE", "TM", "F", "L", "G"}

# Addresses two people share in the data, checked by hand on
# 2026-10-14. Open States gives both members the same address and
# neither legislature publishes member emails we could read, so we
# cannot tell whose it is. Remove an entry once it is resolved.
SHARED_EMAILS_UNRESOLVED = {
    # CA Assembly 36 (Jeff Gonzalez) and 54 (Mark González)
    "assemblymember.gonzalez@assembly.ca.gov",
    # NJ Assembly 20 (Ed Rodriguez) and 33 (Gabe Rodriguez)
    "asmrodriguez@njleg.org",
}

problems: list[str] = []


def problem(rule: str, where: str, msg: str) -> None:
    problems.append(f"{rule} {where}: {msg}")


def _load(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _rel(path: Path) -> str:
    return str(path.relative_to(DATA))


def _norm_name(name: str) -> str:
    name = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", (name or "").lower())
    return re.sub(r"[^a-z]", "", name)


# ── Everywhere ───────────────────────────────────────────────────────

def _walk(node, path="", key=""):
    """Yield (json_path, key, value) for every scalar in a JSON tree.
    A scalar inside a list is reported under the list's key."""
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, (dict, list)):
                yield from _walk(v, f"{path}.{k}" if path else str(k), k)
            else:
                yield path, k, v
    elif isinstance(node, list):
        for i, v in enumerate(node):
            if isinstance(v, (dict, list)):
                yield from _walk(v, f"{path}[{i}]", key)
            else:
                yield f"{path}[{i}]", key, v


def lint_everywhere(path: Path, doc) -> None:
    where = _rel(path)
    for json_path, key, value in _walk(doc):
        if not isinstance(value, str):
            continue
        loc = f"{where} {json_path}" if json_path.endswith("]") else f"{where} {json_path}.{key}"
        if PLACEHOLDER_RE.search(value):
            problem("A-1", loc, f"placeholder URL {value[:80]!r}")
        if (key in URL_KEYS and value and not value.startswith("https://")
                and urlsplit(value).netloc not in HTTP_ONLY_HOSTS):
            problem("A-2", loc, f"not https: {value[:80]!r}")
        if (key.startswith("_") or key in ("notes", "note", "data_status")) and DEMO_RE.search(value):
            problem("A-3", loc, f"describes itself as demo data: {value[:80]!r}")


# ── Elections ────────────────────────────────────────────────────────

def _race_candidate_ids(race: dict):
    if race.get("incumbent_candidate_id"):
        yield "incumbent_candidate_id", race["incumbent_candidate_id"]
    for party, ids in (race.get("primary_candidates") or {}).items():
        for cid in ids or []:
            yield f"primary_candidates.{party}", cid
    for cid in race.get("general_candidates") or []:
        yield "general_candidates", cid
    for cid in race.get("write_in_candidates") or []:
        yield "write_in_candidates", cid
    winners = (race.get("result") or {}).get("winners") or {}
    for party, w in winners.items():
        if isinstance(w, dict) and w.get("candidate_id"):
            yield f"result.winners.{party}.candidate_id", w["candidate_id"]


def _check_dates(where: str, value: str) -> None:
    for y, m, d in ISO_DATE_RE.findall(value):
        try:
            _dt.date(int(y), int(m), int(d))
        except ValueError:
            problem("E-3", where, f"not a real date: {y}-{m}-{d}")


def _legislative_district(race: dict):
    return race.get("state_senate_district") or race.get("state_house_district")


def lint_legislative_seats(state: str, races: list, where: str) -> None:
    seats_doc = _load(DATA / "legislative_seats_2026.json")
    table = seats_doc.get("states", {}).get(state.upper())
    seen: set[tuple] = set()
    for race in races:
        chamber = race.get("chamber")
        if race.get("level") != "state" or not chamber:
            continue
        rid = race.get("id")
        if table is None or chamber not in table:
            problem("E-8", f"{where} {rid}", f"no seat table for {state.upper()} {chamber} in legislative_seats_2026.json")
            continue
        cfg = table[chamber]
        district = _legislative_district(race)
        if district is None:
            problem("E-8", f"{where} {rid}", "legislative race has no district")
            continue
        if not str(district).isdigit():
            problem("E-8", f"{where} {rid}", f"district {district!r} is not a number")
            continue
        up = cfg["districts_up"]
        # A special election fills an off-cycle seat early; mark the race
        # "special_election": true and it is allowed.
        if up != "all" and int(district) not in up and not race.get("special_election"):
            problem("E-8", f"{where} {rid}", f"{chamber} district {district} is not on the {seats_doc.get('cycle')} ballot")
        if race.get("term_length_years") != cfg["term_length_years"]:
            problem("E-8", f"{where} {rid}",
                    f"term_length_years {race.get('term_length_years')} but {chamber} terms are {cfg['term_length_years']}")
        key = (chamber, str(district))
        if key in seen:
            problem("E-9", f"{where} {rid}", f"{chamber} district {district} listed twice")
        seen.add(key)


# Phases and date keys the election reminders read
# (backend/app/services/election_reminders.py).
REMINDER_PHASES = ("primary", "primary_runoff", "general")
REMINDER_DATE_PREFIXES = ("voter_registration_deadline", "vote_by_mail_request_deadline", "early_voting_window")
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _retrieved_ok(value, today) -> bool:
    """A retrieved date: YYYY-MM-DD, a real date, not in the future."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value or "")):
        return False
    try:
        return _dt.date.fromisoformat(value) <= today
    except ValueError:
        return False


def lint_reminder_sources(doc: dict, where: str) -> None:
    """E-11. Only elections on or after today need sources: a past
    primary sends nothing, and a file that passes cannot start failing
    as time goes by."""
    key_dates = doc.get("key_dates") or {}
    sources = doc.get("key_date_sources") or {}
    retrieved = doc.get("key_date_retrieved") or {}
    info = doc.get("voter_info") or {}
    no_reminder = info.get("no_reminder") or {}
    today = _dt.date.today()
    for key, url in sources.items():
        if not _official(url):
            problem("E-11", f"{where} key_date_sources.{key}", "source is not an https URL on an official site")
        if key not in key_dates:
            problem("E-11", f"{where} key_date_sources.{key}", "source for a date that is not in key_dates")
        if not _retrieved_ok(retrieved.get(key), today):
            problem("E-11", f"{where} key_date_retrieved.{key}",
                    "every source needs the day it was read (YYYY-MM-DD, not in the future)")
    for key in retrieved:
        if key not in sources:
            problem("E-11", f"{where} key_date_retrieved.{key}", "retrieved date for a key with no source")
    for phase in REMINDER_PHASES:
        dates = ISO_DATE_RE.findall(str(key_dates.get(phase) or ""))
        if len(dates) != 1:
            continue
        y, m, d = (int(x) for x in dates[0])
        try:
            if _dt.date(y, m, d) < today:
                continue
        except ValueError:
            continue  # E-3 reports it
        for key in (phase,) + tuple(f"{p}_{phase}" for p in REMINDER_DATE_PREFIXES):
            if key in key_dates and key not in no_reminder and not str(sources.get(key, "")).startswith("https://"):
                problem("E-11", f"{where} key_dates.{key}", "reminder date has no https source in key_date_sources")
    for name, url in (info.get("links") or {}).items():
        if not _official(url):
            problem("E-11", f"{where} voter_info.links.{name}", "link is not an https URL on an official site")
    if info.get("official_site") is not None and not _official(info["official_site"]):
        problem("E-11", f"{where} voter_info.official_site", "not an https URL on an official site")
    hours = info.get("poll_hours")
    if hours is not None:
        if not (HHMM_RE.match(str(hours.get("open", ""))) and HHMM_RE.match(str(hours.get("close", "")))):
            problem("E-11", f"{where} voter_info.poll_hours", "open and close must be HH:MM")
        if not _official(hours.get("source_url")):
            problem("E-11", f"{where} voter_info.poll_hours", "source_url is not an https URL on an official site")
        if not _retrieved_ok(hours.get("retrieved"), today):
            problem("E-11", f"{where} voter_info.poll_hours", "no retrieved date (YYYY-MM-DD, not in the future)")
    for key, entry in no_reminder.items():
        if not isinstance(entry, dict) or not entry.get("reason") or not _official(entry.get("source_url")) \
                or not _retrieved_ok(entry.get("retrieved"), today):
            problem("E-11", f"{where} voter_info.no_reminder.{key}",
                    "needs a reason, an https source_url on an official site and a retrieved date")


def lint_all_key_date_sources(doc: dict, where: str) -> None:
    """E-12. Every key date of an election still ahead has an official
    source and the day it was read, and the 2026 general election is on
    November 3. Like E-11, a past election is left alone, so a file that
    passes cannot start failing as time goes by."""
    key_dates = doc.get("key_dates") or {}
    sources = doc.get("key_date_sources") or {}
    retrieved = doc.get("key_date_retrieved") or {}
    today = _dt.date.today()
    if str(doc.get("cycle") or "") == "2026" and key_dates.get("general") != "2026-11-03":
        problem("E-12", f"{where} key_dates.general", "the 2026 general election is 2026-11-03")
    for phase in REMINDER_PHASES:
        dates = ISO_DATE_RE.findall(str(key_dates.get(phase) or ""))
        if len(dates) != 1:
            continue
        try:
            if _dt.date(*(int(x) for x in dates[0])) < today:
                continue
        except ValueError:
            continue  # E-3 reports it
        for key, value in key_dates.items():
            if key.startswith("_") or not isinstance(value, str):
                continue
            if key != phase and not key.endswith(f"_{phase}"):
                continue
            # Keys of a later phase that share this suffix ("primary"
            # inside "primary_runoff") belong to that phase, not this one.
            if phase == "primary" and key.endswith("_primary_runoff"):
                continue
            if not _official(sources.get(key)) or not _retrieved_ok(retrieved.get(key), today):
                problem("E-12", f"{where} key_dates.{key}",
                        "needs an official https source in key_date_sources and a retrieved date")
    vary = (doc.get("voter_info") or {}).get("poll_hours_vary")
    if vary is not None:
        if not isinstance(vary, dict) or not vary.get("text") or not _official(vary.get("source_url")) \
                or not _retrieved_ok(vary.get("retrieved"), today):
            problem("E-12", f"{where} voter_info.poll_hours_vary",
                    "needs text, an https source_url on an official site and a retrieved date")
    if (doc.get("voter_info") or {}).get("poll_hours") and vary is not None:
        problem("E-12", f"{where} voter_info", "poll_hours and poll_hours_vary are both set; keep one")


def lint_elections(state_dir: Path) -> None:
    path = state_dir / "elections.json"
    state = state_dir.name
    doc = _load(path)
    where = _rel(path)
    # A state can have election dates before it has any candidates
    # (docs/election-reminders.md): no candidates.json means none.
    c_path = state_dir / "candidates.json"
    cands = _load(c_path).get("candidates", {}) if c_path.exists() else {}
    lint_legislative_seats(state, doc.get("races", []), where)

    seen: set[str] = set()
    for i, race in enumerate(doc.get("races", [])):
        rid = race.get("id") or f"races[{i}]"
        if rid in seen:
            problem("E-1", where, f"duplicate race id {rid}")
        seen.add(rid)
        if not str(rid).startswith(f"{state}-"):
            problem("E-1", where, f"race id {rid} does not start with '{state}-'")
        for field, cid in _race_candidate_ids(race):
            if cid not in cands:
                problem("E-2", f"{where} {rid}.{field}", f"unknown candidate id {cid}")
            elif cands[cid].get("withdrawn") and not field.startswith("result."):
                problem("E-10", f"{where} {rid}.{field}", f"{cid} is marked withdrawn")
        status = race.get("roster_status")
        if status is not None and status not in ROSTER_STATUSES:
            problem("E-5", f"{where} {rid}", f"unknown roster_status {status!r}")
        result = race.get("result") or {}
        if result.get("status") == "reported" and not str(result.get("source_url", "")).startswith("https://"):
            problem("E-6", f"{where} {rid}", "reported result has no https source_url")
        term = race.get("term_length_years")
        if term is not None and not (isinstance(term, int) and 1 <= term <= 6):
            problem("E-7", f"{where} {rid}", f"term_length_years {term!r}")

    for key, value in (doc.get("key_dates") or {}).items():
        if isinstance(value, str) and not key.startswith("_"):
            _check_dates(f"{where} key_dates.{key}", value)
    lint_reminder_sources(doc, where)
    lint_all_key_date_sources(doc, where)

    measures = doc.get("ballot_measures") or {}
    groups = []
    if isinstance(measures, dict):
        groups.append(("state", measures.get("state") or []))
        counties = measures.get("counties") or {}
        if isinstance(counties, dict):
            for county, items in counties.items():
                groups.append((f"counties.{county}", items or []))
        else:
            groups.append(("counties", counties))
    else:
        groups.append(("", measures))
    for label, items in groups:
        for j, m in enumerate(items):
            mid = m.get("id") or f"{label}[{j}]"
            if not str(m.get("source_url", "")).startswith("https://"):
                problem("E-4", f"{where} ballot_measures.{label} {mid}", "no https source_url")


# ── Candidates ───────────────────────────────────────────────────────

def _official_ids(node) -> set[str]:
    """Ids of every current official record in a state_officials.json
    (keys starting with "_", such as _retired_ids, are left out)."""
    ids: set[str] = set()
    if isinstance(node, dict):
        if isinstance(node.get("id"), str) and "name" in node:
            ids.add(node["id"])
        for k, v in node.items():
            if not str(k).startswith("_"):
                ids |= _official_ids(v)
    elif isinstance(node, list):
        for v in node:
            ids |= _official_ids(v)
    return ids


def lint_candidates(path: Path) -> None:
    doc = _load(path)
    where = _rel(path)
    cands = doc.get("candidates", {})
    if not isinstance(cands, dict):
        problem("C-1", where, "candidates is not an object keyed by id")
        return
    officials_path = path.parent / "state_officials.json"
    official_ids = _official_ids(_load(officials_path)) if officials_path.exists() else set()
    by_person: dict[tuple, list[str]] = {}
    for key, c in cands.items():
        if "id" in c and c["id"] != key:
            problem("C-1", f"{where} {key}", f"id field {c['id']!r} does not match its key")
        oid = c.get("official_id")
        if oid and oid not in official_ids:
            problem("C-4", f"{where} {key}", f"official_id {oid!r} is not a current record in {_rel(officials_path)}")
        if c.get("ended_on") is not None:
            if not _real_date(c["ended_on"]):
                problem("S-4", f"{where} {key}", f"ended_on {c['ended_on']!r} is not a date")
            if not _official(c.get("ended_on_source")):
                problem("S-4", f"{where} {key}", "ended_on needs an official https ended_on_source")
        if c.get("ended_recorded_on") is not None and not _real_date(c["ended_recorded_on"]):
            problem("S-4", f"{where} {key}", f"ended_recorded_on {c['ended_recorded_on']!r} is not a date")
        dup = c.get("duplicate_of")
        if dup is not None and dup not in cands:
            problem("C-3", f"{where} {key}", f"duplicate_of points at unknown id {dup}")
        if dup is None:
            person = (_norm_name(c.get("name", "")), (c.get("seeking_office") or "").strip().lower())
            by_person.setdefault(person, []).append(key)
    for (name, office), keys in by_person.items():
        if name and len(keys) > 1:
            problem("C-2", where, f"same person listed {len(keys)} times for {office!r}: {', '.join(sorted(keys))}")


# ── Officials ────────────────────────────────────────────────────────

def _official_lists(doc):
    """Return every list of official records in a file, whatever its shape."""
    if isinstance(doc, list):
        return [doc]
    out = []
    for key, value in doc.items():
        if key.startswith("_"):
            continue
        if isinstance(value, list) and value and isinstance(value[0], dict) and "name" in value[0]:
            out.append(value)
        elif isinstance(value, dict):
            out.extend(_official_lists(value))
    return out


def lint_officials(path: Path) -> None:
    doc = _load(path)
    where = _rel(path)
    ids: set[str] = set()
    seen: dict[tuple, int] = {}
    emails: dict[str, list[str]] = {}
    for records in _official_lists(doc):
        for rec in records:
            if not isinstance(rec, dict):
                continue
            email = (rec.get("contact") or {}).get("email") if isinstance(rec.get("contact"), dict) else None
            if isinstance(email, str) and email.strip():
                emails.setdefault(email.strip().lower(), []).append(str(rec.get("id") or rec.get("name")))
            oid = rec.get("id")
            if oid is not None:
                if oid in ids:
                    problem("O-1", where, f"duplicate id {oid}")
                ids.add(oid)
            office = (rec.get("office") or rec.get("title") or rec.get("role") or "").strip().lower()
            district = str(rec.get("district") or "").strip().lower()
            person = (_norm_name(rec.get("name", "")), office, district)
            if person[0] and office:
                seen[person] = seen.get(person, 0) + 1
    for (name, office, district), n in seen.items():
        if n > 1:
            problem("O-2", where, f"{name!r} listed {n} times as {office!r}{' ' + district if district else ''}")
    for email, owners in emails.items():
        if len(owners) > 1 and email not in SHARED_EMAILS_UNRESOLVED:
            problem("O-3", where, f"{email} is on {len(owners)} records: {', '.join(owners)}")

    def parties(node):
        if isinstance(node, dict):
            if "party" in node and "name" in node and "id" in node:
                yield node
            for k, v in node.items():
                if not str(k).startswith("_"):
                    yield from parties(v)
        elif isinstance(node, list):
            for v in node:
                yield from parties(v)

    for rec in parties(doc):
        code = rec.get("party")
        if code is not None and code not in PARTY_CODES:
            problem("O-4", where, f"{rec.get('id')}: party {code!r} is not a known code")


# ── Seats and former officials ───────────────────────────────────────

def _name_key(name) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return "".join(ch for ch in text.casefold() if ch.isalnum())


def _people(node, path=""):
    """(json path, record) for every dict with a string id and name."""
    if isinstance(node, dict):
        if isinstance(node.get("id"), str) and isinstance(node.get("name"), str):
            yield path, node
        for k, v in node.items():
            if k in ("elections", "_refresh", "_source", "_note"):
                continue
            yield from _people(v, f"{path}.{k}" if path else str(k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _people(v, f"{path}[{i}]")


def lint_id_holders(files) -> None:
    ledger_path = DATA / "id_holders.json"
    if not ledger_path.exists():
        problem("S-1", "id_holders.json", "missing; run scripts/build_id_holders.py --write")
        return
    holders = _load(ledger_path).get("holders") or {}
    for path in files:
        where = _rel(path)
        for jpath, rec in _people(_load(path)):
            entry = holders.get(rec["id"])
            if entry is None:
                problem("S-1", f"{where} {jpath}", f"id {rec['id']} is not in id_holders.json; "
                        "run scripts/build_id_holders.py --write")
                continue
            name, short, *aliases = entry
            if short and str(rec.get("openstates_id") or "").removeprefix("ocd-person/")[:8] == short:
                continue
            if _name_key(rec["name"]) in {_name_key(name), *(_name_key(a) for a in aliases)}:
                continue
            problem("S-1", f"{where} {jpath}", f"id {rec['id']} belongs to {name}, not {rec['name']}: give "
                    f"{rec['name']} a new id and move {name} to _former_members")


def _official(url) -> bool:
    if not str(url or "").startswith("https://"):
        return False
    host = urlsplit(str(url)).netloc.lower()
    return host.endswith((".gov", ".us")) or host.endswith(OFFICIAL_HOST_SUFFIXES)


def _real_date(value) -> bool:
    try:
        _dt.date.fromisoformat(str(value))
        return True
    except ValueError:
        return False


def lint_former(path: Path) -> None:
    doc = _load(path)
    where = _rel(path)
    former = doc.get("_former_members") or []
    current = {rec["id"] for _p, rec in _people({k: v for k, v in doc.items() if not str(k).startswith("_")})}
    former_ids = {f.get("id") for f in former}
    for r in doc.get("_retired_ids") or []:
        if r.get("id") not in former_ids:
            problem("S-2", where, f"retired id {r.get('id')} has no _former_members record")
    for f in former:
        fid = f.get("id")
        if fid in current:
            problem("S-2", f"{where} {fid}", "is both a current record and a former one")
        for sid in f.get("successor_ids") or []:
            if sid not in current and sid not in former_ids:
                problem("S-2", f"{where} {fid}", f"successor {sid} is not a record in this file")
        if not _real_date(f.get("recorded_on")):
            problem("S-2", f"{where} {fid}", f"recorded_on {f.get('recorded_on')!r} is not a date")
        if f.get("left_office_on") is not None:
            if not _real_date(f["left_office_on"]):
                problem("S-2", f"{where} {fid}", f"left_office_on {f['left_office_on']!r} is not a date")
            if not _official(f.get("left_office_source")):
                problem("S-2", f"{where} {fid}", "left_office_on needs an official https left_office_source")
        start, end = f.get("served_from"), f.get("served_to")
        if start and end and str(start) > str(end):
            problem("S-2", f"{where} {fid}", f"served_from {start} is after served_to {end}")


def lint_congress_departures(path: Path) -> None:
    where = _rel(path)
    for bioguide, prof in (_load(path) or {}).items():
        if not isinstance(prof, dict) or prof.get("left_office_on") is None:
            continue
        if not _real_date(prof["left_office_on"]):
            problem("S-3", f"{where} {bioguide}", f"left_office_on {prof['left_office_on']!r} is not a date")
        if not _official(prof.get("left_office_source")):
            problem("S-3", f"{where} {bioguide}", "left_office_on needs an official https left_office_source")


# ── Federal profiles ─────────────────────────────────────────────────

def _is_home_page(url: str) -> bool:
    page = urlsplit(url).path.strip("/").lower()
    return page in ("", "index.html", "index.htm", "home", "en", "en-us", "public")


def lint_federal_stances(path: Path) -> None:
    where = _rel(path)

    def issues(node, owner=""):
        if isinstance(node, dict):
            owner = str(node.get("id") or owner)
            for k, v in node.items():
                if k == "top_issues" and isinstance(v, list):
                    for t in v:
                        if isinstance(t, dict):
                            yield owner, t
                elif not str(k).startswith("_"):
                    yield from issues(v, owner if node.get("id") else str(k))
        elif isinstance(node, list):
            for v in node:
                yield from issues(v, owner)

    for owner, t in issues(_load(path)):
        for url in t.get("sources") or []:
            if not isinstance(url, str) or not url.startswith("https://"):
                problem("F-1", where, f"{owner} {t.get('name')!r}: source is not an https URL: {str(url)[:80]!r}")
            elif _is_home_page(url):
                problem("F-1", where, f"{owner} {t.get('name')!r}: source is a home page: {url}")


WIKIMEDIA_RE = re.compile(r"https://upload\.wikimedia\.org/wikipedia/commons/[^\s\"]+")


def lint_photo_credits(files) -> None:
    path = DATA / "photo_credits.json"
    credits = _load(path).get("credits", {}) if path.exists() else {}
    used: set[str] = set()
    for f in files:
        if f == path:
            continue
        for url in set(WIKIMEDIA_RE.findall(f.read_text(encoding="utf-8"))):
            used.add(url)
            entry = credits.get(url)
            if not entry:
                problem("P-1", _rel(f), f"no photo credit for {url[:90]}")
            elif not entry.get("file_page") or not entry.get("license"):
                problem("P-1", _rel(f), f"photo credit missing file page or license for {url[:90]}")
    for url in sorted(set(credits) - used):
        problem("P-1", "photo_credits.json", f"credit for a photo no longer used anywhere: {url[:90]}")


def main() -> int:
    state_dirs = sorted(p for p in DATA.iterdir() if p.is_dir() and not p.name.startswith("_") and p.name != "federal")
    files = sorted(DATA.rglob("*.json"))
    for path in files:
        lint_everywhere(path, _load(path))
    for sd in state_dirs:
        if (sd / "elections.json").exists():
            lint_elections(sd)
        if (sd / "candidates.json").exists():
            lint_candidates(sd / "candidates.json")
        if (sd / "state_officials.json").exists():
            lint_officials(sd / "state_officials.json")
    if (DATA / "fl" / "local_officials.json").exists():
        lint_officials(DATA / "fl" / "local_officials.json")
    lint_officials(DATA / "federal" / "federal_officials.json")
    officials_files = [sd / "state_officials.json" for sd in state_dirs if (sd / "state_officials.json").exists()]
    officials_files += [p for p in (DATA / "fl" / "local_officials.json", DATA / "federal" / "federal_officials.json")
                        if p.exists()]
    lint_id_holders(officials_files)
    for path in officials_files:
        lint_former(path)
    lint_congress_departures(DATA / "federal" / "congress_profiles.json")
    lint_federal_stances(DATA / "federal" / "congress_profiles.json")
    lint_federal_stances(DATA / "federal" / "federal_officials.json")
    lint_photo_credits(files)

    print(f"Checked {len(files)} data files.")
    if problems:
        for p in problems:
            print("FAIL " + p)
        print(f"\nFAILED: {len(problems)} problem(s)")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
