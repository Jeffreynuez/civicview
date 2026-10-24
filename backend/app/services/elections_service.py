# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Elections Service
Loads curated elections + candidates payloads per state from
/data/<state>/elections.json and /data/<state>/candidates.json.

Core responsibilities:
  - Resolve candidate_id -> full candidate record (for race listings)
  - Return per-state election payloads
  - Build a personalized ballot by intersecting the user's geography
    (state, county_fips, congressional_district, state_senate_district,
    state_house_district) with the curated data.
"""
import json
import logging
import re
import unicodedata
from pathlib import Path
from typing import Optional

from app.services.candidate_enrichment import enrich_candidate

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# States whose primaries send the top two finishers to November regardless
# of party. The one-nominee-per-party rule does not apply there.
_TOP_TWO_STATES = {"CA", "WA"}
# Alaska's open primary sends the top four finishers to November.
_TOP_FOUR_STATES = {"AK"}

# Labels that mean "no party". More than one such candidate can legitimately
# appear on a general ballot, so they never trip the per-party check.
# "O" is the code for any other party or independent body (the row shows
# the state's own label), and two different ones can share a race.
_NO_PARTY_LABELS = {"NPA", "I", "WRI", "NP", "NONE", "U", "UN", "UNA", "O"}

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()


def _sort_key(cand: dict) -> tuple:
    """Alphabetical by last name, then first name: the one ordering rule
    for every race in every state. `sort_name` ("Last, First" as the
    state's list writes the name) wins; otherwise the last word of the
    name that is not a suffix."""
    sort_name = cand.get("sort_name")
    if sort_name and "," in sort_name:
        last, first = sort_name.split(",", 1)
        return (_fold(last.strip()), _fold(first.strip()), cand.get("id") or "")
    words = [w for w in re.split(r"\s+", (cand.get("name") or "").strip()) if w]
    while len(words) > 1 and words[-1].rstrip(".").lower() in _SUFFIXES:
        words.pop()
    last = words[-1] if words else ""
    return (_fold(last), _fold(" ".join(words[:-1])), cand.get("id") or "")


def _alphabetical(cands: list[dict]) -> list[dict]:
    return sorted(cands, key=_sort_key)


def _person_key(name: Optional[str]) -> str:
    """First and last name, lowercased, suffixes and nicknames dropped.
    Used only to spot the same person listed twice on one roster."""
    if not name:
        return ""
    cleaned = re.sub(r'"[^"]*"', " ", name.lower())
    tokens = [
        t for t in re.split(r"[^a-z]+", cleaned)
        if t and t not in {"jr", "sr", "ii", "iii", "iv"}
    ]
    if len(tokens) < 2:
        return ""
    return f"{tokens[0]} {tokens[-1]}"


def _district_key(value) -> Optional[str]:
    """One spelling for a congressional district on both sides of the
    Your Ballot match: "7", "07" and "FL-7" are "7"; an at-large seat
    ("At-Large" from the address lookup, "AL" or "0" in the data, "WY-AL"
    on an account) is "AL"."""
    if value is None:
        return None
    text = str(value).strip().upper()
    at_large = ("AT-LARGE", "AT LARGE", "AL", "0", "00", "98")
    if text not in at_large and "-" in text:
        prefix, rest = text.split("-", 1)
        if len(prefix) == 2 and prefix.isalpha():
            text = rest
    if text in at_large:
        return "AL"
    return str(int(text)) if text.isdigit() else (text or None)


def _primary_concluded(raw: dict) -> bool:
    return bool((raw.get("primary_status") or {}).get("concluded"))


def _https(url) -> bool:
    return isinstance(url, str) and url.startswith("https://")


def _public_voter_info(raw: dict) -> dict:
    """The parts of a state's voter_info a visitor sees (2026-10-16):
    the official links, and the poll hours with their source. Reminder
    wording, deadline times and admin notes stay server-side. Only https
    links pass, so a typo can never put a plain-http link on the tab."""
    info = raw.get("voter_info") or {}
    links = {k: v for k, v in (info.get("links") or {}).items() if _https(v)}
    out: dict = {"links": links}
    if _https(info.get("official_site")):
        out["official_site"] = info["official_site"]
    hours = info.get("poll_hours") or {}
    if hours.get("open") and hours.get("close") and _https(hours.get("source_url")):
        out["poll_hours"] = {k: hours.get(k) for k in ("open", "close", "source_url", "retrieved")}
    vary = info.get("poll_hours_vary") or {}
    if vary.get("text") and _https(vary.get("source_url")):
        out["poll_hours_vary"] = {k: vary.get(k) for k in ("text", "source_url", "retrieved")}
    return out


def _date_sources(raw: dict) -> dict:
    """Each key date's official source and the day it was read, keyed
    like key_dates, for the Elections tab's Sources list. A date that
    needs a second official page (one page has the date, another the
    rule) lists it under `more`, from key_date_more_sources."""
    sources = raw.get("key_date_sources") or {}
    retrieved = raw.get("key_date_retrieved") or {}
    more = raw.get("key_date_more_sources") or {}
    out = {}
    for key, url in sources.items():
        if not _https(url):
            continue
        entry = {"url": url, "retrieved": retrieved.get(key)}
        extra = [
            {"url": m.get("url"), "retrieved": m.get("retrieved")}
            for m in (more.get(key) or [])
            if isinstance(m, dict) and _https(m.get("url"))
        ]
        if extra:
            entry["more"] = extra
        out[key] = entry
    return out


class ElectionsService:
    def __init__(self):
        # state_code -> elections payload
        self._elections_by_state: dict[str, dict] = {}
        # candidate_id -> candidate record (flat across states for quick lookup)
        self._candidates: dict[str, dict] = {}
        self._load_all()

    # ─── Loading ──────────────────────────────────────────────────────────

    def _load_all(self) -> None:
        if not DATA_DIR.exists():
            logger.warning("ElectionsService: data dir missing at %s", DATA_DIR)
            return
        for state_dir in DATA_DIR.iterdir():
            if not state_dir.is_dir():
                continue

            # Candidates
            c_path = state_dir / "candidates.json"
            if c_path.exists():
                try:
                    with c_path.open("r", encoding="utf-8") as fh:
                        raw = json.load(fh)
                    cands = raw.get("candidates", {}) or {}
                    for cid, payload in cands.items():
                        # Normalize — ensure id is present, then enrich.
                        # Enrichment happens HERE, once at load, rather
                        # than per-request in get_candidate: every
                        # consumer (profile, ballot, compare, race
                        # listings) reads from this same dict, so doing
                        # it at the door means no surface can forget.
                        payload = {"id": cid, **payload}
                        self._candidates[cid] = enrich_candidate(payload)
                    logger.info(
                        "ElectionsService: loaded %d candidates from %s",
                        len(cands),
                        c_path,
                    )
                except (json.JSONDecodeError, OSError) as e:
                    logger.error("ElectionsService: failed to load %s: %s", c_path, e)

            # Elections
            e_path = state_dir / "elections.json"
            if e_path.exists():
                try:
                    with e_path.open("r", encoding="utf-8") as fh:
                        raw = json.load(fh)
                    state_code = (raw.get("state") or state_dir.name).upper()
                    self._elections_by_state[state_code] = raw
                    logger.info(
                        "ElectionsService: loaded elections for %s (%d races)",
                        state_code,
                        len(raw.get("races", []) or []),
                    )
                except (json.JSONDecodeError, OSError) as e:
                    logger.error("ElectionsService: failed to load %s: %s", e_path, e)

    # ─── Ballot measure lookup ───────────────────────────────────────────

    def get_measure(self, measure_id: str) -> Optional[dict]:
        """One ballot measure by its `id`, statewide or county, with the
        state it belongs to added as `state` and `state_name`. None when no
        loaded state has it. Used by the plain-English explainer, which
        works only from the official text in the data, never from text a
        caller sends."""
        if not measure_id:
            return None
        for code, raw in self._elections_by_state.items():
            measures = raw.get("ballot_measures") or {}
            if isinstance(measures, list):
                pool = list(measures)
            else:
                pool = list(measures.get("state") or [])
                for items in (measures.get("counties") or {}).values():
                    pool.extend(items or [])
            for m in pool:
                if isinstance(m, dict) and m.get("id") == measure_id:
                    return {**m, "state": code, "state_name": raw.get("state_name")}
        return None

    # ─── Candidate lookup ────────────────────────────────────────────────

    def get_candidate(self, candidate_id: str) -> Optional[dict]:
        if not candidate_id:
            return None
        return self._candidates.get(candidate_id)

    def list_candidates(self) -> list[dict]:
        return list(self._candidates.values())

    def _resolve_ids(self, ids: list[str], *, drop_withdrawn: bool = True) -> list[dict]:
        """Resolve a list of candidate_ids to full records; skip unknowns.

        Withdrawn candidates are dropped by default. A suspended campaign
        appearing on a ballot roster is the most damaging error this data
        can produce — a voter can plan around someone who is not running —
        and the `withdrawn` flag was previously honored ONLY by the
        candidate profile banner, so a withdrawn candidate still rendered
        as a normal ballot row everywhere else. Filtering here, at the one
        place every surface resolves ids, means no surface can forget.

        Pass drop_withdrawn=False where the historical field is the point
        (a results view showing who ran, for instance).
        """
        out: list[dict] = []
        for cid in ids or []:
            cand = self._candidates.get(cid)
            if not cand:
                continue
            if drop_withdrawn and cand.get("withdrawn"):
                continue
            out.append(cand)
        return out

    def _resolve_race(self, race: dict, *, state_code: str = "", primary_concluded: bool = False) -> dict:
        """Return a copy of a race with candidate_ids expanded to full records.

        `primary_concluded` comes from the state's `primary_status` DATA
        (never from today's date) and turns on the verified-roster check
        described below.
        """
        resolved = dict(race)

        # Expand primary_candidates: {party: [id]} -> {party: [record]}
        primary = race.get("primary_candidates") or {}
        resolved_primary: dict[str, list[dict]] = {}
        for party, ids in primary.items():
            resolved_primary[party] = _alphabetical(self._resolve_ids(ids))
        resolved["primary_candidates"] = resolved_primary

        # Expand general_candidates: [id] -> [record], alphabetical by
        # last name (one rule everywhere; ballot order rotates by county
        # in several states, so it cannot be the rule).
        general = _alphabetical(self._resolve_ids(race.get("general_candidates") or []))
        resolved["general_candidates"] = general
        # Qualified write-ins are listed separately: Florida (and most
        # states) print a blank write-in line, never the names, so
        # rendering them as ballot rows would describe a ballot that does
        # not exist.
        resolved["write_in_candidates"] = _alphabetical(
            self._resolve_ids(race.get("write_in_candidates") or []))

        # ── Guard: is this general roster actually a general roster? ──
        #
        # A general ballot can carry at most ONE nominee per party. If two
        # or more Republicans (or Democrats) are still listed, the roster
        # was never narrowed after the primary and what we would render is
        # not a ballot — it is the pre-primary field wearing a ballot's
        # label. That is worse than showing nothing: a voter reading it
        # would believe nine Republicans are running against each other in
        # November.
        #
        # This is a STRUCTURAL check, not a data-freshness one. It cannot
        # be satisfied by a stale file quietly passing review, and it stays
        # correct for every state and cycle without a date to maintain.
        # The UI reads `general_roster_unresolved` and says the nominees
        # are not set yet rather than presenting the list as final.
        #
        # Extended 2026-09-24 after the first version let real gaps through:
        #   * every real party counts, not only R and D (two Libertarian
        #     nominees is the same impossibility as two Republicans);
        #     "no party" labels (NPA, I, WRI) can legitimately repeat;
        #   * top-two states (CA, WA) nominate two candidates regardless of
        #     party, so the rule there is "at most two", and a D-versus-D
        #     general is legitimate;
        #   * the same person listed twice (duplicate records) is flagged;
        #   * write-ins never count, they are not printed on the ballot.
        ballot_rows = [
            c for c in general
            if not c.get("write_in") and (c.get("party") or "").upper() != "WRI"
        ]
        reasons: list[str] = []
        if race.get("open_primary"):
            # An open primary (Louisiana's November ballot for U.S. House)
            # lists every qualified candidate, whatever their party, so
            # several from one party is the ballot, not a stale roster.
            pass
        elif (state_code or "").upper() in _TOP_TWO_STATES:
            if len(ballot_rows) > 2:
                reasons.append("top-two")
        elif (state_code or "").upper() in _TOP_FOUR_STATES:
            if len(ballot_rows) > 4:
                reasons.append("top-four")
        else:
            counts: dict[str, int] = {}
            for cand in ballot_rows:
                party = (cand.get("party") or "").upper()
                if party and party not in _NO_PARTY_LABELS:
                    counts[party] = counts.get(party, 0) + 1
            reasons.extend(sorted(p for p, n in counts.items() if n > 1))
        seen_names: set[str] = set()
        for cand in ballot_rows:
            key = _person_key(cand.get("name"))
            if key and key in seen_names:
                reasons.append("duplicate-person")
                break
            if key:
                seen_names.add(key)
        resolved["general_roster_unresolved"] = bool(reasons)
        if reasons:
            resolved["general_roster_unresolved_parties"] = reasons

        # ── Guard 2: has anyone checked this roster since the primary? ──
        #
        # A roster can pass the structural check and still be wrong: an
        # FEC filer list with one Republican and one Democrat looks like a
        # ballot but may name someone who lost, withdrew, or never
        # qualified (FL-11 showed a retiring incumbent this way). Once the
        # state's primary has concluded (DATA, set by a person), only a
        # race whose roster was checked against the official candidate
        # list (`roster_status: "verified_nominees"`) is presented as the
        # November ballot. Everything else says what it is.
        # A race with no candidates listed claims nothing, so it gets no
        # warning; the Ballot tab says the candidates aren't listed yet.
        resolved["general_roster_unverified"] = bool(
            primary_concluded
            and general
            and not resolved["general_roster_unresolved"]
            and race.get("roster_status") != "verified_nominees"
        )

        # incumbent_candidate_id: expose resolved incumbent for convenience
        inc_id = race.get("incumbent_candidate_id")
        if inc_id:
            inc = self._candidates.get(inc_id)
            if inc:
                resolved["incumbent"] = inc

        return resolved

    # ─── State payload ───────────────────────────────────────────────────

    def get_elections(self, state_code: str) -> Optional[dict]:
        """Return the state's full elections payload with candidate_ids expanded
        to full candidate records (convenient for the frontend)."""
        raw = self._elections_by_state.get((state_code or "").upper())
        if not raw:
            return None

        out = {
            "state": raw.get("state"),
            "state_name": raw.get("state_name"),
            "cycle": raw.get("cycle"),
            # Closed-primary states (FL, NY, CT, etc.) only allow registered
            # partisans to vote in their party's primary. The frontend uses
            # this to gate the BallotTab closed-primary disclosure banner.
            # Defaults to False — open-primary states leave it unset.
            "closed_primary": bool(raw.get("closed_primary", False)),
            "key_dates": raw.get("key_dates", {}),
            "key_date_sources": _date_sources(raw),
            "voter_info": _public_voter_info(raw),
            # Whether the primary has already been held, and whether its
            # results are certified. Carried as DATA rather than derived
            # from today's date on purpose: a date comparison would flip
            # this field overnight with no code change and no review,
            # which is exactly how a ballot silently starts describing an
            # election that already happened. A human updates it when the
            # results are actually in hand.
            "primary_status": raw.get("primary_status") or None,
            "races": [
                self._resolve_race(
                    r,
                    state_code=raw.get("state") or state_code,
                    primary_concluded=_primary_concluded(raw),
                )
                for r in raw.get("races", []) or []
            ],
            "ballot_measures": raw.get("ballot_measures", {}),
        }
        return out

    def list_states_with_elections(self) -> list[str]:
        return sorted(self._elections_by_state.keys())

    def state_summaries(self) -> list[dict]:
        """One row per state with an elections file: its name, how many
        races it lists, and how many of those name general-election
        candidates."""
        out = []
        for code in sorted(self._elections_by_state):
            raw = self._elections_by_state[code]
            races = raw.get("races", []) or []
            out.append({
                "state": code,
                "state_name": raw.get("state_name"),
                "races": len(races),
                "races_with_candidates": sum(
                    1 for r in races if self._resolve_ids(r.get("general_candidates") or [])
                ),
            })
        return out

    # ─── Personalized ballot ─────────────────────────────────────────────

    def get_personalized_ballot(
        self,
        state_code: str,
        county_fips: Optional[str] = None,
        county_name: Optional[str] = None,
        congressional_district: Optional[str] = None,
        state_senate_district: Optional[str] = None,
        state_house_district: Optional[str] = None,
        city_slug: Optional[str] = None,
    ) -> Optional[dict]:
        """Build a ballot tailored to a specific voter's geography.

        Inclusion rules (any level of geography may be missing — we include
        what we can):
          * Statewide races and statewide ballot measures always included.
          * Federal/US House race matched by congressional_district.
          * State senate race matched by state_senate_district.
          * State house race matched by state_house_district.
          * County ballot measures matched by county_fips, falling back to
            county_name (case-insensitive).
          * City ballot measures matched by city_slug (when we add city
            measures; today the schema leaves room for them).
        """
        state = (state_code or "").upper()
        raw = self._elections_by_state.get(state)
        if not raw:
            return None

        target_cd = _district_key(congressional_district)
        target_ssd = str(state_senate_district).strip() if state_senate_district is not None else None
        target_shd = str(state_house_district).strip() if state_house_district is not None else None

        applicable_races: list[dict] = []
        for race in raw.get("races", []) or []:
            level = (race.get("level") or "").lower()
            chamber = (race.get("chamber") or "").lower()
            race_state_senate = str(race.get("state_senate_district") or "").strip()
            race_state_house = str(race.get("state_house_district") or "").strip()
            race_cd = _district_key(race.get("congressional_district")) or ""

            include = False
            reason = None

            if level == "federal":
                office = (race.get("office") or "").lower()
                if office.startswith("u.s. senate") or (not race_cd and "house" not in office):
                    # A U.S. Senate race is statewide: every voter in the
                    # state has it on their ballot. It was previously
                    # dropped because it has no congressional district.
                    include, reason = True, "statewide-federal"
                elif target_cd and race_cd and race_cd == target_cd:
                    include, reason = True, "congressional-district-match"
            elif level == "state":
                if chamber.startswith("state senate"):
                    if target_ssd and race_state_senate and race_state_senate == target_ssd:
                        include, reason = True, "state-senate-district-match"
                elif chamber.startswith("state house") or chamber.startswith("state assembly"):
                    if target_shd and race_state_house and race_state_house == target_shd:
                        include, reason = True, "state-house-district-match"
                else:
                    # Statewide executive/cabinet — always include for this state
                    include, reason = True, "statewide"

            if include:
                resolved = self._resolve_race(
                    race, state_code=state, primary_concluded=_primary_concluded(raw)
                )
                resolved["_match_reason"] = reason
                applicable_races.append(resolved)

        # Ballot measures
        measures = raw.get("ballot_measures", {}) or {}
        applicable_measures: list[dict] = []

        # Statewide measures
        for m in measures.get("state", []) or []:
            applicable_measures.append({**m, "_match_reason": "statewide"})

        # County measures
        if county_fips or county_name:
            target_fips = str(county_fips).strip() if county_fips else None
            target_name = (county_name or "").strip().lower()
            for county_key, items in (measures.get("counties", {}) or {}).items():
                for m in items or []:
                    m_fips = str(m.get("county_fips", "")).strip()
                    m_county = (m.get("county", "") or "").strip().lower()
                    matched = False
                    if target_fips and m_fips and m_fips == target_fips:
                        matched = True
                    elif target_name and m_county and m_county == target_name:
                        matched = True
                    elif county_key and target_name and county_key.lower() == target_name:
                        matched = True
                    if matched:
                        applicable_measures.append({**m, "_match_reason": "county"})

        return {
            "state": state,
            "state_name": raw.get("state_name"),
            "cycle": raw.get("cycle"),
            # Mirror the same closed_primary signal here so personalized
            # ballots gate the disclosure correctly. Same default behavior
            # as get_elections — False unless explicitly set.
            "closed_primary": bool(raw.get("closed_primary", False)),
            "key_dates": raw.get("key_dates", {}),
            "key_date_sources": _date_sources(raw),
            "voter_info": _public_voter_info(raw),
            "primary_status": raw.get("primary_status") or None,
            "geography": {
                "state": state,
                "county_fips": county_fips,
                "county_name": county_name,
                "congressional_district": congressional_district,
                "state_senate_district": state_senate_district,
                "state_house_district": state_house_district,
                "city_slug": city_slug,
            },
            "races": applicable_races,
            "ballot_measures": applicable_measures,
        }

    def reload(self) -> None:
        self._elections_by_state = {}
        self._candidates = {}
        self._load_all()
