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
Candidates (every <state>/candidates.json):
  C-1  a record's own "id", when present, matches its key
  C-2  no two records for the same person and office unless one is
       marked duplicate_of
  C-3  duplicate_of points at a record that exists
Officials (every <state>/state_officials.json, fl/local_officials.json,
federal/federal_officials.json):
  O-1  ids are unique within the file
  O-2  the same person is not listed twice for the same office
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


def lint_elections(state_dir: Path) -> None:
    path = state_dir / "elections.json"
    state = state_dir.name
    doc = _load(path)
    where = _rel(path)
    cands = _load(state_dir / "candidates.json").get("candidates", {})
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

def lint_candidates(path: Path) -> None:
    doc = _load(path)
    where = _rel(path)
    cands = doc.get("candidates", {})
    if not isinstance(cands, dict):
        problem("C-1", where, "candidates is not an object keyed by id")
        return
    by_person: dict[tuple, list[str]] = {}
    for key, c in cands.items():
        if "id" in c and c["id"] != key:
            problem("C-1", f"{where} {key}", f"id field {c['id']!r} does not match its key")
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
    for records in _official_lists(doc):
        for rec in records:
            if not isinstance(rec, dict):
                continue
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
