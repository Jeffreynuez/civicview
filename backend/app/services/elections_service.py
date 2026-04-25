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
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


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
                        # Normalize — ensure id is present
                        payload = {"id": cid, **payload}
                        self._candidates[cid] = payload
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

    # ─── Candidate lookup ────────────────────────────────────────────────

    def get_candidate(self, candidate_id: str) -> Optional[dict]:
        if not candidate_id:
            return None
        return self._candidates.get(candidate_id)

    def list_candidates(self) -> list[dict]:
        return list(self._candidates.values())

    def _resolve_ids(self, ids: list[str]) -> list[dict]:
        """Resolve a list of candidate_ids to full records; skip unknowns."""
        out: list[dict] = []
        for cid in ids or []:
            cand = self._candidates.get(cid)
            if cand:
                out.append(cand)
        return out

    def _resolve_race(self, race: dict) -> dict:
        """Return a copy of a race with candidate_ids expanded to full records."""
        resolved = dict(race)

        # Expand primary_candidates: {party: [id]} -> {party: [record]}
        primary = race.get("primary_candidates") or {}
        resolved_primary: dict[str, list[dict]] = {}
        for party, ids in primary.items():
            resolved_primary[party] = self._resolve_ids(ids)
        resolved["primary_candidates"] = resolved_primary

        # Expand general_candidates: [id] -> [record]
        resolved["general_candidates"] = self._resolve_ids(race.get("general_candidates") or [])

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
            "key_dates": raw.get("key_dates", {}),
            "races": [self._resolve_race(r) for r in raw.get("races", []) or []],
            "ballot_measures": raw.get("ballot_measures", {}),
        }
        return out

    def list_states_with_elections(self) -> list[str]:
        return sorted(self._elections_by_state.keys())

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

        target_cd = str(congressional_district).strip() if congressional_district is not None else None
        target_ssd = str(state_senate_district).strip() if state_senate_district is not None else None
        target_shd = str(state_house_district).strip() if state_house_district is not None else None

        applicable_races: list[dict] = []
        for race in raw.get("races", []) or []:
            level = (race.get("level") or "").lower()
            chamber = (race.get("chamber") or "").lower()
            race_state_senate = str(race.get("state_senate_district") or "").strip()
            race_state_house = str(race.get("state_house_district") or "").strip()
            race_cd = str(race.get("congressional_district") or "").strip()

            include = False
            reason = None

            if level == "federal":
                if target_cd and race_cd and race_cd == target_cd:
                    include, reason = True, "congressional-district-match"
            elif level == "state":
                if chamber.startswith("state senate"):
                    if target_ssd and race_state_senate and race_state_senate == target_ssd:
                        include, reason = True, "state-senate-district-match"
                elif chamber.startswith("state house"):
                    if target_shd and race_state_house and race_state_house == target_shd:
                        include, reason = True, "state-house-district-match"
                else:
                    # Statewide executive/cabinet — always include for this state
                    include, reason = True, "statewide"

            if include:
                resolved = self._resolve_race(race)
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
            "key_dates": raw.get("key_dates", {}),
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
