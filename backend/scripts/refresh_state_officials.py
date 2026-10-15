# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Refresh backend/app/data/<state>/state_officials.json from Open States.

Run from backend/:

    python scripts/refresh_state_officials.py --all                  # dry run: report only
    python scripts/refresh_state_officials.py --state TX --state NE  # dry run, two states
    python scripts/refresh_state_officials.py --all --write          # write the files

A dry run (the default) prints the report and writes nothing. --write
writes the changed state files. Run it again after each wave of
changes in the legislatures, and always in January after new members
are sworn in.

Sources
-------
* Legislators and statewide executives: the openstates/people
  repository on GitHub (data/<state>/legislature, data/<state>/executive
  and data/<state>/retired). Its data is dedicated to the public domain
  under CC0 1.0 (the repository's LICENSE file). The script makes a
  shallow, sparse git clone of it into a temporary folder, or reads an
  existing checkout given with --people-dir. No key, no rate limit.
* Seats per district (to find vacancies): the district tables in
  openstates/openstates-core (openstates/metadata/data/<state>.py, MIT
  license), fetched from raw.githubusercontent.com and read with Python's
  ast module. The files are parsed, never executed. --metadata-dir
  reads a local copy of that data folder instead.
* The Open States API v3 is used only to fill a gap: when a person in
  our file is missing from the people repository altogether (Open
  States sometimes merges duplicate records). The proxy or the
  OPENSTATES_API_KEY environment variable supplies the key; the script
  never prints it.

What it does, per state
-----------------------
* Matches our legislators to Open States by openstates_id.
* Same person, same seat: the record and its id stay. Hand-curated
  fields stay as they are (photos and photo credits, bios, capitol
  offices, file-link relocations, sources). The name and party follow
  Open States. An empty email, website or photo is filled from Open
  States. An email is replaced only when the new one is on the same
  domain (or replaces a free mail address with an official one) and
  contains the person's family name; every other difference is listed,
  not applied.
* A new person in a seat gets a new id: the seat id plus their family
  name, e.g. tx-sen-4-ligon. An id is never handed to a different
  person, because posts, claimed pages, citizen polls and follows are
  keyed on it (Jeffrey, 2026-10-14). Ids that leave the roster are kept
  in the file's _retired_ids list so they are never reused.
* A person who moved to another seat or chamber is treated the same
  way: the old id retires and the person gets a new id for the new
  seat. Their photo and photo credit come with them.
* A seat with fewer members than it has seats is a vacancy. Vacancies
  go in a "vacancies" list on the chamber (district, seats_vacant,
  previous_member when we knew who left, first_noted). The app does not
  read that list yet, so nothing users see changes (Jeffrey,
  2026-10-14).
* Statewide executives: governor, lieutenant governor, attorney
  general, secretary of state, treasurer and auditor. A record whose
  officeholder is unchanged keeps every curated field. A missing office
  is added (Jeffrey, 2026-10-14). A changed officeholder gets a new
  record with no bio, and the report says so: confirm the change on the
  official state website and write a short neutral bio with sources
  before merging. Appointed election administrators that Open States
  lists as "chief election officer" are skipped.

Corrections
-----------
Open States can lag the legislatures by weeks. When an official source
is ahead of it, record that in app/data/state_officials_corrections.json
(each entry names its official source_url and the date it was checked):
* left_office: a person the official site no longer lists, though Open
  States still does. The script retires them and the seat shows as
  vacant.
* seat_not_vacant: a seat the official source says is held (or is in
  dispute) while Open States lists nobody. The seat is left out of the
  vacancies list.
* name: the name as the official site writes it, when Open States has
  it short or wrong (and the family name the new id is built from).
* party: the party an official source gives (certified election
  results, the legislature's roster) when Open States or our own
  record has it wrong, including the state's own word for no party
  ("U" Unaffiliated, "NA" Not Affiliated, "UNE" Unenrolled, "NPA" No
  Party Affiliation, "TM" Tribal Member). A party of null means the
  official has none (an appointed office with no party on any official
  source), and no party label shows.
* exclude: a statewide officeholder not to add, with the reason.
Every run reports each correction; once Open States agrees, the report
says the correction can be deleted.

Photos must be https. An http photo is upgraded only when the https
address serves an image; otherwise it is left out and listed. Search
engine thumbnails are never used. After the run, if any Wikimedia photo
changed, run scripts/build_photo_credits.py --write, then
tests/test_data_lint.py.

Needs PyYAML and httpx, both in backend/requirements.txt, and git.
"""
from __future__ import annotations

import argparse
import ast
import datetime as dt
import json
import os
import re
import subprocess  # nosec B404 - runs git with fixed arguments only
import sys
import tempfile
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlsplit

try:
    import yaml
except ImportError:  # pragma: no cover - present via backend/requirements.txt
    sys.exit("PyYAML is required: pip install -r requirements.txt")
import httpx

DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "data"
CORRECTIONS_FILE = "state_officials_corrections.json"
PEOPLE_REPO = "https://github.com/openstates/people.git"
METADATA_URL = (
    "https://raw.githubusercontent.com/openstates/openstates-core/main/"
    "openstates/metadata/data/{name}.py"
)
OPENSTATES_API = "https://v3.openstates.org"
# openstates-core names two modules differently from the state code.
METADATA_FILE = {"in": "ind", "or": "ore"}

STATES = [
    "ak", "al", "ar", "az", "ca", "co", "ct", "de", "fl", "ga",
    "hi", "ia", "id", "il", "in", "ks", "ky", "la", "ma", "md",
    "me", "mi", "mn", "mo", "ms", "mt", "nc", "nd", "ne", "nh",
    "nj", "nm", "nv", "ny", "oh", "ok", "or", "pa", "ri", "sc",
    "sd", "tn", "tx", "ut", "va", "vt", "wa", "wi", "wv", "wy",
]

# Open States role type -> our chamber block. Nebraska's one chamber
# ("legislature" / "unicameral") lives in state_senate, as before.
CHAMBER_OF_ROLE = {"upper": "state_senate", "legislature": "state_senate", "lower": "state_house"}
CHAMBER_OF_META = {"upper": "state_senate", "unicameral": "state_senate", "lower": "state_house"}
ID_PREFIX = {"state_senate": "sen", "state_house": "rep"}
DEFAULT_LABELS = {
    "state_senate": ("State Senate", "State Senator"),
    "state_house": ("State House", "State Representative"),
}

# Party names as Open States writes them -> the codes the app shows
# (frontend/lib/party.js maps each code to its label). Fusion tickets
# ("Republican/Conservative") use the first party. Nebraska's officially
# nonpartisan senators are "NP" (shown "Nonpartisan"; until 2026-10-15
# they were stored as "I" and shown as Independent). Where a state's own
# word differs from Open States' ("Unaffiliated" in North Carolina, "Not
# Affiliated" in Alaska, "Unenrolled" in Massachusetts and Maine, "No
# Party Affiliation" in Florida), a party entry in
# state_officials_corrections.json gives it, with its source.
PARTY_CODE = {
    "Republican": "R",
    "Democratic": "D",
    "Democratic-Farmer-Labor": "D",
    "Independent": "I",
    "Nonpartisan": "NP",
    "Unaffiliated": "U",
    "Forward": "F",
    "Libertarian": "L",
    "Green": "G",
}

# Executive offices we carry, by Open States role type: our block key
# ("governor" / "lt_governor" / "cabinet"), the role label, and the id
# stem (matching the ids already in the files).
EXEC_OFFICES = {
    "governor": ("governor", "Governor", "exec-gov"),
    "lt_governor": ("lt_governor", "Lieutenant Governor", "exec-lieutenant-governor"),
    "attorney general": ("cabinet", "Attorney General", "exec-attorney-general"),
    "secretary of state": ("cabinet", "Secretary of State", "exec-secretary-of-state"),
    "treasurer": ("cabinet", "Treasurer", "exec-treasurer"),
    "auditor": ("cabinet", "Auditor", "exec-auditor"),
}
SKIPPED_EXEC_TYPES = {"chief election officer"}

FREE_MAIL = {"gmail.com", "yahoo.com", "aol.com", "hotmail.com", "outlook.com",
             "icloud.com", "comcast.net", "msn.com", "live.com", "me.com"}
# Image hosts that are not a source: search-engine thumbnails (Google
# Images serves them from gstatic.com, Bing from bing.net).
BLOCKED_PHOTO_HOSTS = ("gstatic.com", "bing.net")
FILE_LINK_RE = re.compile(r"\.(pdf|xml|txt|docx?|xlsx?|csv|zip)(\?|$)", re.I)


# ── small helpers ────────────────────────────────────────────────────

def name_key(name: object) -> str:
    """Same comparison form as app/services/display_names.name_key."""
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return "".join(ch for ch in text.casefold() if ch.isalnum())


def slug(text: object) -> str:
    text = unicodedata.normalize("NFKD", str(text or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def district_sort_key(district: object):
    parts = re.split(r"(\d+)", str(district))
    return [(0, int(p)) if p.isdigit() else (1, p.lower()) for p in parts]


def party_code(party_name: str | None) -> str | None:
    if not party_name:
        return None
    if party_name in PARTY_CODE:
        return PARTY_CODE[party_name]
    first = party_name.split("/")[0].strip()
    return PARTY_CODE.get(first)


def is_active(role: dict, today: str) -> bool:
    end = str(role.get("end_date") or "")
    start = str(role.get("start_date") or "")
    return (not end or end > today) and (not start or start <= today)


def email_domain(email: str | None) -> str:
    return (email or "").rsplit("@", 1)[-1].lower() if email and "@" in email else ""


def official_domain(domain: str) -> bool:
    return bool(domain) and domain not in FREE_MAIL


# ── sources ──────────────────────────────────────────────────────────

def checkout_people(people_dir: str | None) -> tuple[Path, str]:
    """Return (data dir, commit sha) for openstates/people."""
    if people_dir:
        root = Path(people_dir).resolve()
        data = root / "data" if (root / "data").is_dir() else root
        repo_root = data.parent
    else:
        tmp = Path(tempfile.mkdtemp(prefix="openstates-people-"))
        repo_root = tmp / "people"
        print(f"Cloning {PEOPLE_REPO} (shallow, data/ only) ...", file=sys.stderr)
        git = ["git", "-c", "advice.detachedHead=false"]
        subprocess.run(git + ["clone", "--depth", "1", "--filter=blob:none", "--sparse",  # nosec B603
                              PEOPLE_REPO, str(repo_root)], check=True)
        subprocess.run(git + ["-C", str(repo_root), "sparse-checkout", "set", "data"],  # nosec B603
                       check=True)
        data = repo_root / "data"
    sha = "unknown"
    try:
        sha = subprocess.run(["git", "-C", str(repo_root), "rev-parse", "HEAD"],  # nosec B603 B607
                             check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    return data, sha


def _literal(node):
    return ast.literal_eval(node)


def parse_metadata(source: str) -> dict[str, dict[str, int]]:
    """Seats per district for each chamber, from an openstates-core
    metadata module, without executing it. Returns
    {our chamber key: {district label: seats}}."""
    tree = ast.parse(source)
    out: dict[str, dict[str, int]] = {}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "Chamber"):
            continue
        kw = {k.arg: k.value for k in node.keywords}
        chamber = CHAMBER_OF_META.get(_literal(kw["chamber_type"]))
        if not chamber:
            continue
        seats: dict[str, int] = {}

        def walk(expr):
            if isinstance(expr, ast.BinOp):
                walk(expr.left)
                walk(expr.right)
            elif isinstance(expr, ast.List):
                for d in expr.elts:
                    args = [_literal(a) for a in d.args]
                    kws = {k.arg: _literal(k.value) for k in d.keywords}
                    seats[str(args[0])] = args[3] if len(args) > 3 else kws.get("num_seats", 1)
            elif isinstance(expr, ast.Call) and getattr(expr.func, "id", None) == "simple_numbered_districts":
                args = [_literal(a) for a in expr.args]
                kws = {k.arg: _literal(k.value) for k in expr.keywords}
                for n in range(1, int(args[2]) + 1):
                    seats[str(n)] = kws.get("num_seats", 1)
            else:
                raise ValueError(f"unexpected districts expression: {ast.dump(expr)[:120]}")

        walk(kw["districts"])
        total = _literal(kw["num_seats"]) if "num_seats" in kw else sum(seats.values())
        if sum(seats.values()) != total:
            raise ValueError(f"{chamber}: districts add up to {sum(seats.values())}, not {total}")
        out[chamber] = seats
    return out


def load_metadata(state: str, metadata_dir: str | None, client: httpx.Client) -> dict:
    name = METADATA_FILE.get(state, state)
    if metadata_dir:
        source = (Path(metadata_dir) / f"{name}.py").read_text(encoding="utf-8")
    else:
        url = METADATA_URL.format(name=name)
        for attempt in range(4):
            try:
                resp = client.get(url)
                resp.raise_for_status()
                break
            except httpx.HTTPError:
                if attempt == 3:
                    raise
                time.sleep(2 ** (attempt + 1))
        source = resp.text
    return parse_metadata(source)


def load_people(data: Path, state: str) -> dict[str, dict]:
    """Every person file for a state, keyed by ocd-person id, tagged
    with the folder it came from (legislature / executive / retired)."""
    people: dict[str, dict] = {}
    for folder in ("legislature", "executive", "retired"):
        for path in sorted((data / state / folder).glob("*.yml")):
            with path.open(encoding="utf-8") as fh:
                rec = yaml.safe_load(fh)
            rec["_folder"] = folder
            rec["_file"] = f"data/{state}/{folder}/{path.name}"
            people[rec["id"]] = rec
    return people


def api_person(client: httpx.Client, state: str, ocd_id: str) -> dict | None:
    """Gap filler: ask the Open States API about one person id."""
    headers = {}
    key = os.getenv("OPENSTATES_API_KEY", "").strip()
    if key:
        headers["X-API-KEY"] = key
    try:
        resp = client.get(f"{OPENSTATES_API}/people",
                          params={"jurisdiction": state, "id": ocd_id}, headers=headers)
        if resp.status_code != 200:
            return None
        results = resp.json().get("results") or []
        return results[0] if results else None
    except (httpx.HTTPError, ValueError):
        return None


class PhotoChecker:
    """Decides whether a photo URL can be used, with network checks
    cached per run. Many official sites refuse automated requests (403,
    429); such a photo is not rejected, only marked as unchecked."""

    def __init__(self, client: httpx.Client, enabled: bool):
        self.client = client
        self.enabled = enabled
        self.cache: dict[str, tuple[str | None, str]] = {}

    def _probe(self, url: str) -> str:
        """'ok', 'bad' (gone, or not an image) or 'unknown' (refused or
        unreachable, so we cannot tell)."""
        try:
            resp = self.client.get(url, headers={"Range": "bytes=0-2047"})
        except httpx.HTTPError:
            return "unknown"
        ctype = resp.headers.get("content-type", "")
        if resp.status_code in (200, 206):
            return "ok" if ctype.startswith("image/") else "bad"
        if resp.status_code in (404, 410):
            return "bad"
        return "unknown"

    def usable(self, url: str | None) -> tuple[str | None, str]:
        """(url to store or None, a note for the report, or "")."""
        if not url:
            return None, ""
        if url in self.cache:
            return self.cache[url]
        host = urlsplit(url).netloc.lower()
        if any(host == h or host.endswith("." + h) for h in BLOCKED_PHOTO_HOSTS):
            result = (None, f"photo left empty, not a source (search-engine thumbnail): {url[:80]}")
        elif url.startswith("https://"):
            state = self._probe(url) if self.enabled else "unknown"
            if state == "ok":
                result = (url, "")
            elif state == "bad":
                result = (None, f"photo left empty, the https address is gone or not an image: {url[:80]}")
            else:
                result = (url, f"photo kept but not checked (the host refused an automated check): {url[:80]}")
        elif url.startswith("http://"):
            https = "https://" + url[len("http://"):]
            state = self._probe(https) if self.enabled else "unknown"
            if state == "ok":
                result = (https, "")
            else:
                result = (None, f"photo left empty, http only and no working https address: {url[:80]}")
        else:
            result = (None, f"photo left empty, not a web address: {url[:80]}")
        self.cache[url] = result
        return result


# ── the refresh ──────────────────────────────────────────────────────

class Report:
    def __init__(self, state: str):
        self.state = state
        self.added: list[str] = []
        self.removed: list[str] = []
        self.changed: list[str] = []
        self.vacancies: list[str] = []
        self.contact: list[str] = []
        self.unverified: list[str] = []
        self.empty: list[str] = []
        self.notes: list[str] = []
        self.vacant_seats = 0

    def counts(self) -> dict:
        return {
            "added": len(self.added), "removed": len(self.removed),
            "changed": len(self.changed), "vacant_seats": self.vacant_seats,
            "unverified": len(self.unverified), "empty_fields": len(self.empty),
        }

    def as_dict(self) -> dict:
        return {k: getattr(self, k) for k in
                ("added", "removed", "changed", "vacancies", "contact", "unverified", "empty", "notes")}


def current_party(person: dict) -> str | None:
    names = [p["name"] for p in person.get("party") or [] if not p.get("end_date")]
    return names[0] if names else None


def legislative_role(person: dict, today: str) -> dict | None:
    roles = [r for r in person.get("roles") or []
             if r.get("type") in CHAMBER_OF_ROLE and is_active(r, today)]
    return roles[0] if roles else None


def pick_website(person: dict) -> tuple[str | None, str | None]:
    """(official web page, file link) from a person's links."""
    page = doc = None
    for link in person.get("links") or []:
        url = (link.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            continue
        if FILE_LINK_RE.search(url):
            doc = doc or url
        elif page is None:
            page = url
    return page, doc


def same_person_name(ours: str, person: dict) -> bool:
    keys = {name_key(person.get("name"))}
    keys.update(name_key(o.get("name")) for o in person.get("other_names") or [])
    if name_key(ours) in keys:
        return True
    # "Daniel McKee" vs "Dan McKee": same family name and first initial.
    family = name_key(person.get("family_name") or str(person.get("name", "")).split()[-1])
    parts = [p for p in re.split(r"\s+", str(ours or "").strip()) if p
             and name_key(p) not in ("jr", "sr", "ii", "iii", "iv")]
    if len(parts) >= 2 and family and name_key(parts[-1]) == family:
        given = name_key(person.get("given_name") or str(person.get("name", "")).split()[0])
        return bool(given) and name_key(parts[0])[:1] == given[:1]
    return False


class StateRefresher:
    def __init__(self, state: str, doc: dict, people: dict, seats: dict, today: str,
                 photos: PhotoChecker, client: httpx.Client, use_api: bool,
                 corrections: dict | None = None):
        self.state = state
        self.doc = doc
        self.people = people
        self.seats = seats
        self.today = today
        self.photos = photos
        self.client = client
        self.use_api = use_api
        corrections = corrections or {}
        self.left_office = [c for c in corrections.get("left_office") or []
                            if str(c.get("state", "")).lower() == state]
        self.not_vacant = [c for c in corrections.get("seat_not_vacant") or []
                           if str(c.get("state", "")).lower() == state]
        self.names = {c.get("openstates_id"): c for c in corrections.get("name") or []
                      if str(c.get("state", "")).lower() == state}
        self.names_used: set[str] = set()
        self.parties = {c.get("openstates_id"): c for c in corrections.get("party") or []
                        if str(c.get("state", "")).lower() == state}
        self.excluded = {c.get("openstates_id"): c for c in corrections.get("exclude") or []
                         if str(c.get("state", "")).lower() == state}
        self.report = Report(state)
        retired = doc.get("_retired_ids") or []
        self.retired_ids = {r["id"] for r in retired if isinstance(r, dict) and r.get("id")}
        self.retired_out: list[dict] = list(retired)
        self.all_ids = self._collect_ids()
        # (chamber, district) -> names of members who left that seat in this run
        self.vacated: dict[tuple[str, str], list[str]] = defaultdict(list)

    def apply_name(self, person: dict) -> dict:
        """The person, with a name correction applied when one exists."""
        fix = self.names.get(person.get("id"))
        if not fix:
            return person
        self.names_used.add(person["id"])
        if fix.get("name") == person.get("name"):
            self.report.notes.append(
                f"correction no longer needed: Open States now writes {fix['name']!r}; "
                f"delete it from {CORRECTIONS_FILE}")
            return person
        self.report.notes.append(
            f"correction applied: name {person.get('name')!r} -> {fix['name']!r} ({fix.get('source_url')})")
        return {**person, "name": fix["name"], "family_name": fix.get("family_name") or person.get("family_name")}

    def corrected_party(self, person: dict) -> tuple[str | None, dict | None]:
        """(party code, the correction used or None) for a person."""
        fix = self.parties.get(person.get("id"))
        if fix:
            if fix.get("party") == party_code(current_party(person)):
                self.report.notes.append(
                    f"correction no longer needed: Open States now gives {person['name']} party "
                    f"{fix['party']}; delete it from {CORRECTIONS_FILE}")
            return fix.get("party"), fix
        return party_code(current_party(person)), None

    # ids ------------------------------------------------------------
    def _collect_ids(self) -> set[str]:
        ids = set(self.retired_ids)
        exe = self.doc.get("executive") or {}
        for key in ("governor", "lt_governor"):
            if isinstance(exe.get(key), dict) and exe[key].get("id"):
                ids.add(exe[key]["id"])
        for c in exe.get("cabinet") or []:
            if c.get("id"):
                ids.add(c["id"])
        for chamber in ("state_senate", "state_house"):
            block = self.doc.get(chamber) or {}
            for bucket in ("members", "leadership"):
                for m in block.get(bucket) or []:
                    if m.get("id"):
                        ids.add(m["id"])
        return ids

    def new_id(self, stem: str, person: dict) -> str:
        family = slug(person.get("family_name") or str(person.get("name", "")).split()[-1])
        base = f"{stem}-{family or 'member'}"
        candidate, n = base, 2
        while candidate in self.all_ids:
            candidate = f"{base}-{n}"
            n += 1
        self.all_ids.add(candidate)
        return candidate

    def retire(self, record: dict, reason: str) -> None:
        entry = {"id": record["id"], "name": record.get("name"), "retired_on": self.today,
                 "reason": reason}
        if record.get("openstates_id"):
            entry["openstates_id"] = record["openstates_id"]
        self.retired_out.append(entry)
        self.retired_ids.add(record["id"])

    # legislators ----------------------------------------------------
    def chamber_labels(self, chamber: str) -> tuple[str, str]:
        members = (self.doc.get(chamber) or {}).get("members") or []
        chambers = Counter(m.get("chamber") for m in members if m.get("chamber"))
        roles = Counter(m.get("role") for m in members if m.get("role"))
        default = DEFAULT_LABELS[chamber]
        return (chambers.most_common(1)[0][0] if chambers else default[0],
                roles.most_common(1)[0][0] if roles else default[1])

    def contact_template(self, chamber: str) -> list[str]:
        members = (self.doc.get(chamber) or {}).get("members") or []
        keys = Counter(k for m in members for k in (m.get("contact") or {}))
        half = len(members) / 2
        return [k for k, n in keys.items() if n > half and k in ("dc_office", "dc_phone")]

    def resolve_missing(self, ocd_id: str, ours: dict) -> dict | None:
        """Our person id is not in the repository. Ask the API, then
        look for a record with the same name in the state's folders."""
        if self.use_api:
            hit = api_person(self.client, self.state, ocd_id)
            if hit:
                role = hit.get("current_role") or {}
                self.report.notes.append(
                    f"{ours['id']} ({ours['name']}): not in the people repository; the Open States API "
                    f"lists them as {role.get('org_classification')} {role.get('district')}")
                if role.get("org_classification") in CHAMBER_OF_ROLE:
                    return {"_api": True, "id": ocd_id, "name": hit.get("name"),
                            "party": [{"name": hit.get("party")}] if hit.get("party") else [],
                            "roles": [{"type": role.get("org_classification"),
                                       "district": str(role.get("district"))}],
                            "_folder": "legislature"}
        key = name_key(ours.get("name"))
        for person in self.people.values():
            if name_key(person.get("name")) != key:
                continue
            if any(str(r.get("district")) == str(ours.get("district")) for r in person.get("roles") or []):
                return person
        return None

    def new_member(self, person: dict, chamber: str, district: str, carry: dict | None = None) -> dict:
        chamber_label, role_label = self.chamber_labels(chamber)
        stem = f"{self.state}-{ID_PREFIX[chamber]}-{district}"
        rec: dict = {
            "id": self.new_id(stem, person),
            "openstates_id": person["id"],
            "name": person["name"],
            "party": self.corrected_party(person)[0],
            "chamber": chamber_label,
            "district": district,
            "role": role_label,
            "photo_url": None,
            "contact": {},
        }
        if current_party(person) and not rec["party"] and not self.corrected_party(person)[1]:
            self.report.unverified.append(
                f"{rec['id']}: party {current_party(person)!r} has no code; stored as given")
            rec["party"] = current_party(person)
        # photo: carried from the same person's old record, else Open States
        if carry and carry.get("photo_url"):
            for k in ("photo_url", "photo_source", "photo_credit", "photo_source_url"):
                if k in carry:
                    rec[k] = carry[k]
        else:
            url, why = self.photos.usable(person.get("image"))
            rec["photo_url"] = url
            self.note_photo(rec, person, url, why)
        page, doc_link = pick_website(person)
        contact: dict = {}
        if page:
            contact["official_website"] = page
        contact["email"] = person.get("email") or None
        for k in self.contact_template(chamber):
            contact[k] = None
        if not page:
            extra = f" (only a file link was published: {doc_link[:80]})" if doc_link else ""
            self.report.empty.append(f"{rec['id']} ({person['name']}): official website{extra}")
        if not contact["email"]:
            self.report.empty.append(f"{rec['id']} ({person['name']}): email")
        rec["contact"] = contact
        return rec

    def note_photo(self, rec: dict, person: dict, url: str | None, why: str) -> None:
        if url is None:
            self.report.empty.append(f"{rec['id']} ({person['name']}): photo" + (f", {why}" if why else ""))
        elif why:
            self.report.unverified.append(f"{rec['id']} ({person['name']}): {why}")

    def maybe_update_email(self, rec: dict, person: dict) -> None:
        contact = rec.setdefault("contact", {})
        ours, theirs = contact.get("email"), person.get("email")
        if not theirs or ours == theirs:
            return
        if not ours:
            contact["email"] = theirs
            self.report.contact.append(f"{rec['id']}: email added {theirs}")
            return
        d_ours, d_theirs = email_domain(ours), email_domain(theirs)
        family = name_key(person.get("family_name") or rec.get("name", "").split()[-1])
        local = name_key(theirs.split("@")[0])
        name_ok = bool(family) and (family in local or (len(local) >= 4 and local in family))
        if name_ok and (d_ours == d_theirs or (not official_domain(d_ours) and official_domain(d_theirs))):
            contact["email"] = theirs
            self.report.contact.append(f"{rec['id']}: email {ours} -> {theirs}")
        else:
            self.report.unverified.append(
                f"{rec['id']} ({rec['name']}): Open States email {theirs} differs from ours {ours}; kept ours")

    def refresh_legislature(self) -> None:
        today = self.today
        # Open States: who sits where today
        current: dict[str, tuple[dict, str, str]] = {}
        for pid, person in self.people.items():
            if person["_folder"] != "legislature":
                continue
            role = legislative_role(person, today)
            if role:
                current[pid] = (person, CHAMBER_OF_ROLE[role["type"]], str(role["district"]))

        ours_by_os: dict[str, tuple[str, dict]] = {}
        for chamber in ("state_senate", "state_house"):
            for m in (self.doc.get(chamber) or {}).get("members") or []:
                ours_by_os[m.get("openstates_id")] = (chamber, m)

        # Corrections: people an official site shows have left
        for c in self.left_office:
            ocd_id = c.get("openstates_id")
            if ocd_id in current:
                del current[ocd_id]
                self.report.notes.append(
                    f"correction applied: {c.get('name')} has left ({c.get('source_url')}, checked "
                    f"{c.get('checked')}); Open States still lists them")
            else:
                self.report.notes.append(
                    f"correction no longer needed: Open States no longer lists {c.get('name')}; "
                    f"delete it from {CORRECTIONS_FILE}")

        # Our people missing from the repository entirely
        for ocd_id, (chamber, m) in list(ours_by_os.items()):
            if ocd_id in self.people or not ocd_id:
                continue
            found = self.resolve_missing(ocd_id, m)
            if found and found.get("_api"):
                role = found["roles"][0]
                current[ocd_id] = (found, CHAMBER_OF_ROLE[role["type"]], role["district"])
            elif found:
                self.report.notes.append(
                    f"{m['id']} ({m['name']}): our openstates_id is not in the repository; "
                    f"matched by name to {found['id']} in {found['_folder']}/")
                if found["id"] in current:
                    current[ocd_id] = current.pop(found["id"])
            else:
                self.report.unverified.append(
                    f"{m['id']} ({m['name']}): not found in Open States at all; treated as left office")

        new_members: dict[str, list[dict]] = {"state_senate": [], "state_house": []}
        kept: dict[str, list[dict]] = {"state_senate": [], "state_house": []}
        moved_from: dict[str, dict] = {}

        for chamber in ("state_senate", "state_house"):
            for m in (self.doc.get(chamber) or {}).get("members") or []:
                ocd_id = m.get("openstates_id")
                hit = current.get(ocd_id)
                if hit and hit[1] == chamber and hit[2] == str(m.get("district")):
                    person = self.apply_name(hit[0])
                    rec = dict(m)
                    if not person.get("_api") and person["id"] != ocd_id:
                        rec["openstates_id"] = person["id"]
                        self.report.changed.append(
                            f"{m['id']}: openstates_id {ocd_id} -> {person['id']} (Open States merged records)")
                    if person["name"] != m.get("name"):
                        self.report.changed.append(f"{m['id']}: name {m.get('name')!r} -> {person['name']!r}")
                        rec["name"] = person["name"]
                    code, fix = self.corrected_party(person)
                    if code and code != m.get("party"):
                        self.report.changed.append(
                            f"{m['id']} ({person['name']}): party {m.get('party')} -> {code}")
                        if fix:
                            self.report.notes.append(
                                f"{m['id']}: party per correction ({fix.get('source_url')})")
                        else:
                            self.report.unverified.append(
                                f"{m['id']} ({person['name']}): party change {m.get('party')} -> {code} "
                                f"is from Open States; confirm on the legislature's website")
                        rec["party"] = code
                    if not person.get("_api"):
                        if not rec.get("photo_url"):
                            url, why = self.photos.usable(person.get("image"))
                            if url:
                                rec["photo_url"] = url
                                self.report.contact.append(f"{m['id']}: photo added")
                                if why:
                                    self.report.unverified.append(f"{m['id']} ({person['name']}): {why}")
                            elif why:
                                self.report.notes.append(f"{m['id']} ({person['name']}): still no photo, Open States {why}")
                        contact = dict(rec.get("contact") or {})
                        rec["contact"] = contact
                        page, _ = pick_website(person)
                        if page and not contact.get("official_website") and not contact.get("official_document"):
                            contact["official_website"] = page
                            self.report.contact.append(f"{m['id']}: website added {page}")
                        self.maybe_update_email(rec, person)
                    kept[chamber].append(rec)
                elif hit:
                    moved_from[ocd_id] = m
                else:
                    fix = next((c for c in self.left_office if c.get("openstates_id") == ocd_id), None)
                    self.retire(m, f"left office per {fix['source_url']}" if fix
                                else "left office (no longer listed by Open States)")
                    self.vacated[(chamber, str(m.get("district")))].append(m.get("name"))
                    self.report.removed.append(f"{m['id']} ({m.get('name')}): left office")

        # newcomers and movers
        for ocd_id, (person, chamber, district) in sorted(
                current.items(), key=lambda kv: (kv[1][1], district_sort_key(kv[1][2]), kv[1][0]["name"])):
            if ocd_id in ours_by_os and ocd_id not in moved_from:
                continue
            old = moved_from.get(ocd_id)
            person = self.apply_name(person)
            rec = self.new_member(person, chamber, district, carry=old)
            if old:
                self.retire(old, f"moved to {rec['id']}")
                old_chamber = "state_senate" if old in self._original_members["state_senate"] else "state_house"
                self.vacated[(old_chamber, str(old.get("district")))].append(old.get("name"))
                self.report.changed.append(
                    f"{old['id']} -> {rec['id']} ({person['name']}): district "
                    f"{old.get('chamber')} {old.get('district')} -> {rec['chamber']} {district}")
            else:
                self.report.added.append(f"{rec['id']} ({person['name']}, {rec['party']})")
            new_members[chamber].append(rec)

        for chamber in ("state_senate", "state_house"):
            block = self.doc.setdefault(chamber, {})
            block["members"] = self.merge_members(kept[chamber], new_members[chamber])
            self.refresh_vacancies(chamber, block)

    @staticmethod
    def merge_members(kept: list[dict], new: list[dict]) -> list[dict]:
        """Keep the existing order; put each new member after the last
        member of the same district, else before the first later district."""
        out = list(kept)
        for rec in new:
            key = district_sort_key(rec["district"])
            same = [i for i, m in enumerate(out) if str(m.get("district")) == rec["district"]]
            if same:
                out.insert(same[-1] + 1, rec)
                continue
            later = [i for i, m in enumerate(out) if district_sort_key(m.get("district")) > key]
            out.insert(later[0] if later else len(out), rec)
        return out

    def refresh_vacancies(self, chamber: str, block: dict) -> None:
        seats = self.seats.get(chamber)
        if not seats:
            if block.get("members"):
                self.report.notes.append(f"{chamber}: no seat table from Open States metadata")
            block.pop("vacancies", None)
            return
        filled = Counter(str(m.get("district")) for m in block.get("members") or [])
        for c in self.not_vacant:
            if c.get("chamber") != chamber:
                continue
            district = str(c.get("district"))
            if filled.get(district, 0) >= seats.get(district, 0):
                self.report.notes.append(
                    f"correction no longer needed: {chamber} district {district} is filled in Open States; "
                    f"delete it from {CORRECTIONS_FILE}")
                continue
            filled[district] += int(c.get("seats") or 1)
            self.report.unverified.append(
                f"{chamber} district {district}: not listed as vacant, per correction: {c.get('note')} "
                f"({c.get('source_url')})")
        before = {str(v.get("district")): v for v in block.get("vacancies") or []}
        vacancies = []
        for district in sorted(seats, key=district_sort_key):
            open_seats = seats[district] - filled.get(district, 0)
            if open_seats <= 0:
                continue
            entry = {"district": district, "seats_vacant": open_seats}
            old = before.get(district)
            prev_names = list((old or {}).get("previous_members") or [])
            for name in self.vacated.get((chamber, district), []):
                if name and name not in prev_names:
                    prev_names.append(name)
            if prev_names:
                entry["previous_members"] = prev_names
            entry["first_noted"] = (old or {}).get("first_noted") or self.today
            vacancies.append(entry)
            label = "seat" if open_seats == 1 else "seats"
            self.report.vacant_seats += open_seats
            self.report.vacancies.append(f"{chamber} district {district}: {open_seats} {label}")
        for district, n in filled.items():
            if district not in seats:
                self.report.unverified.append(
                    f"{chamber} district {district!r} is not in Open States' district table")
            elif n > seats[district]:
                self.report.unverified.append(
                    f"{chamber} district {district}: {n} members for {seats[district]} seats")
        if vacancies:
            block["vacancies"] = vacancies
        else:
            block.pop("vacancies", None)

    # executives -----------------------------------------------------
    def refresh_executive(self) -> None:
        exe = self.doc.setdefault("executive", {})
        holders: dict[str, list[dict]] = defaultdict(list)
        for person in self.people.values():
            if person["_folder"] != "executive":
                continue
            for role in person.get("roles") or []:
                if not is_active(role, self.today):
                    continue
                rtype = role.get("type")
                if rtype in EXEC_OFFICES and person["id"] in self.excluded:
                    fix = self.excluded[person["id"]]
                    self.report.notes.append(
                        f"not added, per correction: {person['name']} ({rtype}): {fix.get('note')}")
                elif rtype in EXEC_OFFICES:
                    holders[rtype].append({**person, "_role": role})
                elif rtype in SKIPPED_EXEC_TYPES:
                    kept = next((c for c in exe.get("cabinet") or []
                                 if c.get("openstates_id") == person["id"]), None)
                    if kept:
                        # An elected officeholder Open States types as an
                        # election administrator (Massachusetts' Secretary
                        # of the Commonwealth). The curated record stays.
                        self.report.notes.append(
                            f"{kept['id']} ({kept.get('name')}): kept; Open States types the office {rtype}")
                    else:
                        self.report.notes.append(
                            f"skipped {person['name']} ({rtype}): election administrator, not carried")

        cabinet = list(exe.get("cabinet") or [])
        for rtype, (slot, label, stem) in EXEC_OFFICES.items():
            found = holders.get(rtype) or []
            if len(found) > 1:
                self.report.unverified.append(
                    f"{label}: Open States lists {len(found)} current holders "
                    f"({', '.join(p['name'] for p in found)}); left unchanged")
                continue
            person = found[0] if found else None
            if slot == "cabinet":
                idx = next((i for i, c in enumerate(cabinet) if c.get("role") == label), None)
                ours = cabinet[idx] if idx is not None else None
            else:
                ours = exe.get(slot) if isinstance(exe.get(slot), dict) else None
            if person is None:
                if ours:
                    self.report.notes.append(
                        f"{ours['id']} ({ours.get('name')}): Open States lists no current {label}; kept ours")
                continue
            if ours and (ours.get("openstates_id") == person["id"] or same_person_name(ours.get("name"), person)):
                rec = dict(ours)
                if not rec.get("openstates_id"):
                    rec["openstates_id"] = person["id"]
                    self.report.notes.append(f"{ours['id']}: openstates_id added ({person['id']})")
                if person["name"] != ours.get("name") and name_key(person["name"]) != name_key(ours.get("name")):
                    self.report.notes.append(
                        f"{ours['id']}: kept our name {ours.get('name')!r} (Open States: {person['name']!r})")
                code, fix = self.corrected_party(person)
                if fix and code != ours.get("party"):
                    rec["party"] = code
                    self.report.changed.append(
                        f"{ours['id']} ({ours.get('name')}): party {ours.get('party')} -> {code} "
                        f"per correction ({fix.get('source_url')})")
                elif code and code != ours.get("party"):
                    self.report.unverified.append(
                        f"{ours['id']} ({ours.get('name')}): our party {ours.get('party')}, Open States "
                        f"{current_party(person)}; kept ours, confirm on the official site")
            else:
                rec = self.new_exec(self.apply_name(person), slot, label, stem)
                if ours:
                    self.retire(ours, f"officeholder changed to {rec['id']}")
                    self.report.removed.append(f"{ours['id']} ({ours.get('name')}): no longer {label}")
                    self.report.unverified.append(
                        f"{rec['id']} ({rec['name']}): new {label}. Confirm on the official state "
                        f"website and write a short neutral bio with sources before merging")
                else:
                    self.report.added.append(f"{rec['id']} ({rec['name']}, {rec['party']}): {label}")
            if slot == "cabinet":
                if idx is None:
                    cabinet.append(rec)
                else:
                    cabinet[idx] = rec
            else:
                exe[slot] = rec
        if cabinet:
            exe["cabinet"] = cabinet

    def new_exec(self, person: dict, slot: str, label: str, stem: str) -> dict:
        role = person["_role"]
        rec: dict = {
            "id": self.new_id(f"{self.state}-{stem}", person),
            "openstates_id": person["id"],
            "name": person["name"],
            # A correction can say there is no party (an appointed office
            # whose sources give none); only without one does Open States'
            # own wording stand in for a missing code.
            "party": (self.corrected_party(person)[0] if self.corrected_party(person)[1]
                      else (self.corrected_party(person)[0] or current_party(person))),
            "role": label,
            "office": "Executive Office of the Governor" if slot == "governor" else "Executive",
        }
        if slot == "governor":
            start = str(role.get("start_date") or "")[:4]
            rec["serving_since"] = start or None
            prior = (self.doc.get("executive") or {}).get("governor") or {}
            rec["website"] = prior.get("website")
            rec["photo_url"] = None
            rec["bio"] = None
            rec["sources"] = [prior["website"]] if prior.get("website") else []
            self.report.empty.append(f"{rec['id']} ({person['name']}): bio and photo")
            return rec
        # Open States' first link is often the person's old legislature
        # page, so the office's website is left for the person who
        # confirms the officeholder to fill in.
        rec["website"] = None
        page, _ = pick_website(person)
        self.report.empty.append(
            f"{rec['id']} ({person['name']}): website. Add the office's official site"
            + (f" (Open States links {page[:80]})" if page else ""))
        url, why = self.photos.usable(person.get("image"))
        rec["photo_url"] = url
        self.note_photo(rec, person, url, why)
        return rec

    # entry ----------------------------------------------------------
    def run(self) -> dict:
        self._original_members = {
            ch: list((self.doc.get(ch) or {}).get("members") or []) for ch in ("state_senate", "state_house")}
        self.refresh_legislature()
        self.refresh_executive()
        if self.retired_out:
            self.doc["_retired_ids"] = self.retired_out
        return self.doc


def dump(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def order_keys(doc: dict) -> dict:
    """Keep the file's top-level key order: _refresh after _source, and
    _retired_ids last."""
    head = ["_note", "_source", "_refresh", "state", "state_name"]
    out = {k: doc[k] for k in head if k in doc}
    out.update({k: v for k, v in doc.items() if k not in out and k != "_retired_ids"})
    if "_retired_ids" in doc:
        out["_retired_ids"] = doc["_retired_ids"]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--state", action="append", default=[], metavar="XX",
                    help="two-letter state code; repeat for more")
    ap.add_argument("--all", action="store_true", help="every state")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True,
                      help="print the report and write nothing (the default)")
    mode.add_argument("--write", action="store_true", help="write the changed files")
    ap.add_argument("--people-dir", help="existing checkout of openstates/people (skips the clone)")
    ap.add_argument("--metadata-dir", help="local copy of openstates-core metadata/data")
    ap.add_argument("--as-of", help="treat this date (YYYY-MM-DD) as today")
    ap.add_argument("--no-api", action="store_true", help="never call the Open States API")
    ap.add_argument("--no-network-checks", action="store_true",
                    help="do not test photo URLs (http photos are then left out)")
    ap.add_argument("--report-json", help="also write the report as JSON to this path")
    ap.add_argument("--data-dir", default=str(DATA_DIR), help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    states = STATES if args.all else sorted({s.lower() for s in args.state})
    unknown = [s for s in states if s not in STATES]
    if not states or unknown:
        ap.error(f"give --all or --state XX (unknown: {', '.join(unknown)})" if unknown else "give --all or --state XX")

    today = args.as_of or dt.date.today().isoformat()
    corrections_path = Path(args.data_dir) / CORRECTIONS_FILE
    corrections = (json.loads(corrections_path.read_text(encoding="utf-8"))
                   if corrections_path.exists() else {})
    data, sha = checkout_people(args.people_dir)
    reports: dict[str, dict] = {}
    totals = Counter()
    pending: list[tuple[Path, dict]] = []
    with httpx.Client(timeout=20, follow_redirects=True,
                      headers={"User-Agent": "CivicView-state-officials-refresh/1.0 (+https://civicview.app)"}) as client:
        photos = PhotoChecker(client, enabled=not args.no_network_checks)
        for state in states:
            path = Path(args.data_dir) / state / "state_officials.json"
            original = path.read_text(encoding="utf-8")
            doc = json.loads(original)
            seats = load_metadata(state, args.metadata_dir, client)
            people = load_people(data, state)
            refresher = StateRefresher(state, json.loads(original), people, seats, today,
                                       photos, client, use_api=not args.no_api,
                                       corrections=corrections)
            new_doc = refresher.run()
            rep = refresher.report
            changed = dump(new_doc) != dump(doc)
            if changed:
                new_doc["_refresh"] = {
                    "refreshed_on": today,
                    "source": "Open States people data (github.com/openstates/people, CC0 1.0) at commit "
                              f"{sha[:12]}; seats per district from openstates-core metadata",
                    "script": "backend/scripts/refresh_state_officials.py",
                }
                new_doc = order_keys(new_doc)
            counts = rep.counts()
            totals.update(counts)
            reports[state] = {"counts": counts, **rep.as_dict(), "file_changed": changed}
            print_state(state, rep, counts, changed)
            if changed:
                pending.append((path, new_doc))

    # Write only after every state was computed, so a network error part
    # way through never leaves a batch half written.
    if args.write:
        for path, new_doc in pending:
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(dump(new_doc), encoding="utf-8")
            json.loads(tmp.read_text(encoding="utf-8"))
            os.replace(tmp, path)

    print()
    print(f"Open States people data at commit {sha[:12]}, as of {today}.")
    print("Totals: " + ", ".join(f"{k} {v}" for k, v in totals.items()))
    print("Files written." if args.write else "Dry run: nothing written. Add --write to apply.")
    if args.report_json:
        Path(args.report_json).write_text(json.dumps(
            {"as_of": today, "people_commit": sha, "states": reports}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8")
    return 0


def print_state(state: str, rep: Report, counts: dict, changed: bool) -> None:
    print(f"\n== {state.upper()} == added {counts['added']}, removed {counts['removed']}, "
          f"changed {counts['changed']}, vacant seats {counts['vacant_seats']}, "
          f"unverified {counts['unverified']}, empty fields {counts['empty_fields']}"
          + ("" if changed else " (no change)"))
    for title, items in (("added", rep.added), ("removed", rep.removed), ("changed", rep.changed),
                         ("vacancies", rep.vacancies), ("contact", rep.contact),
                         ("unverified", rep.unverified), ("empty", rep.empty), ("notes", rep.notes)):
        for item in items:
            print(f"  {title:<10} {item}")


if __name__ == "__main__":
    sys.exit(main())
