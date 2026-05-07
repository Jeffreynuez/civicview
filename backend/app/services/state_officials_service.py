# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
State Officials Service
Loads curated state-level officials (governor, state senate, state house) from
static JSON files under /data/<state>/state_officials.json.

Shape is modeled after OpenStates so we can swap in the live API later without
touching the frontend. For now, Florida is the only seeded state.
"""
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


class StateOfficialsService:
    def __init__(self):
        # state_code (e.g. "FL") -> full JSON payload
        self._by_state: dict[str, dict] = {}
        # Cross-reference: any sitting state official who also appears as a
        # candidate in /data/<state>/candidates.json. Used to inject an
        # `active_candidacy` pointer on find_person_by_id responses so the
        # frontend can render a "Currently running for X" cross-nav link.
        # Key = (state_code_upper, official_id) → candidate dict (with id).
        self._candidacies_by_official: dict[tuple[str, str], dict] = {}
        self._load_all()
        self._load_candidacy_index()

    def _load_all(self) -> None:
        if not DATA_DIR.exists():
            logger.warning("StateOfficialsService: data dir missing at %s", DATA_DIR)
            return
        for state_dir in DATA_DIR.iterdir():
            if not state_dir.is_dir():
                continue
            path = state_dir / "state_officials.json"
            if not path.exists():
                continue
            try:
                with path.open("r", encoding="utf-8") as fh:
                    raw = json.load(fh)
                state_code = (raw.get("state") or state_dir.name).upper()
                self._by_state[state_code] = raw
                logger.info(
                    "StateOfficialsService: loaded %s (%d senators, %d reps)",
                    state_code,
                    len((raw.get("state_senate", {}) or {}).get("members", []) or []),
                    len((raw.get("state_house", {}) or {}).get("members", []) or []),
                )
            except (json.JSONDecodeError, OSError) as e:
                logger.error("StateOfficialsService: failed to load %s: %s", path, e)

    def _load_candidacy_index(self) -> None:
        """Walk every /data/<state>/candidates.json and index by
        (state, official_id) for candidates whose `official_scope == 'state'`.

        Mirrors CongressService._load_candidacy_index but keyed on official_id
        instead of bioguide_id, since state-level officials don't have
        bioguide ids. Powers the `active_candidacy` cross-nav pointer on
        state-person responses.
        """
        self._candidacies_by_official = {}
        if not DATA_DIR.exists():
            return
        for state_dir in DATA_DIR.iterdir():
            if not state_dir.is_dir():
                continue
            c_path = state_dir / "candidates.json"
            if not c_path.exists():
                continue
            state_code = state_dir.name.upper()
            try:
                with c_path.open("r", encoding="utf-8") as fh:
                    raw = json.load(fh)
                cands = raw.get("candidates", {}) or {}
                for cid, payload in cands.items():
                    scope = (payload.get("official_scope") or "").lower()
                    oid = payload.get("official_id")
                    if scope != "state" or not oid:
                        continue
                    entry = {"id": cid, **payload}
                    self._candidacies_by_official[(state_code, oid)] = entry
            except (json.JSONDecodeError, OSError) as e:
                logger.error("StateOfficialsService: failed to load %s: %s", c_path, e)
        if self._candidacies_by_official:
            logger.info(
                "StateOfficialsService: indexed %d sitting-state-official candidacies",
                len(self._candidacies_by_official),
            )

    def has_state(self, state_code: str) -> bool:
        return (state_code or "").upper() in self._by_state

    def get_state_officials(self, state_code: str) -> Optional[dict]:
        """Return the full state-officials payload, or None if not seeded."""
        return self._by_state.get((state_code or "").upper())

    def get_governor(self, state_code: str) -> Optional[dict]:
        payload = self.get_state_officials(state_code)
        if not payload:
            return None
        return (payload.get("executive", {}) or {}).get("governor")

    def get_state_legislator(
        self, state_code: str, chamber: str, district: str
    ) -> Optional[dict]:
        """Look up an individual state senator/rep by chamber + district.

        chamber: 'senate' | 'house' (case-insensitive)
        district: stringified district number (e.g. '40').
        Returns None if not found. Searches members first, then leadership.
        """
        payload = self.get_state_officials(state_code)
        if not payload:
            return None
        chamber_key = "state_senate" if chamber.lower().startswith("s") else "state_house"
        block = payload.get(chamber_key, {}) or {}
        target = str(district).strip()
        for collection in ("members", "leadership"):
            for m in block.get(collection, []) or []:
                if str(m.get("district", "")).strip() == target:
                    return m
        return None

    # ── Judiciary helpers ───────────────────────────────────────────────
    def get_judiciary(self, state_code: str) -> Optional[dict]:
        """Return the full judiciary payload (SC, DCAs, circuits, county
        courts) or None if not seeded."""
        payload = self.get_state_officials(state_code)
        if not payload:
            return None
        return payload.get("judiciary")

    def get_circuit_for_county(
        self, state_code: str, county: str
    ) -> Optional[dict]:
        """Return the circuit payload whose `counties` list includes the
        given county name, or None. Case-insensitive match, tolerant of
        extra whitespace and the 'County' suffix."""
        jud = self.get_judiciary(state_code)
        if not jud or not county:
            return None
        target = county.strip().lower().replace(" county", "")
        for c in jud.get("circuits", []) or []:
            for name in c.get("counties", []) or []:
                if (name or "").strip().lower() == target:
                    return c
        return None

    def get_county_court(
        self, state_code: str, county: str = None, county_fips: str = None
    ) -> Optional[dict]:
        """Return the county-court payload for a given county (name or FIPS)."""
        jud = self.get_judiciary(state_code)
        if not jud:
            return None
        target_name = (county or "").strip().lower().replace(" county", "")
        target_fips = str(county_fips or "").strip()
        for row in jud.get("county_courts", []) or []:
            if target_fips and str(row.get("county_fips", "")).strip() == target_fips:
                return row
            if target_name and (row.get("county", "") or "").strip().lower() == target_name:
                return row
        return None

    def get_dca_by_district(
        self, state_code: str, district: str
    ) -> Optional[dict]:
        """Return the DCA payload for a numeric district (e.g. '3')."""
        jud = self.get_judiciary(state_code)
        if not jud or not district:
            return None
        target = str(district).strip()
        for d in jud.get("district_courts_of_appeal", []) or []:
            if str(d.get("district", "")).strip() == target:
                return d
        return None

    def reload(self) -> None:
        self._by_state = {}
        self._candidacies_by_official = {}
        self._load_all()
        self._load_candidacy_index()

    def _decorate_with_candidacy(
        self, state_code: str, person: dict
    ) -> dict:
        """If this person has a matching candidate record in the same state,
        inject an `active_candidacy` pointer so the frontend can render the
        "Currently running for X" cross-nav button. No-op when there's no
        matching candidacy."""
        if not person:
            return person
        pid = person.get("id")
        if not pid:
            return person
        key = ((state_code or "").upper(), pid)
        candidacy = self._candidacies_by_official.get(key)
        if candidacy and not person.get("active_candidacy"):
            person["active_candidacy"] = {
                "candidate_id": candidacy.get("id"),
                "seeking_office": candidacy.get("seeking_office"),
                "incumbent": candidacy.get("incumbent", False),
            }
        return person

    # ── Person lookup (any role in any section) ─────────────────────────
    def find_person_by_id(
        self, state_code: str, person_id: str
    ) -> Optional[dict]:
        """Walk the state payload and return the first person whose `id`
        matches, decorated with a `role_type` so the frontend can pick the
        right ProfileView tab set.

        role_type ∈ {'state_governor', 'state_cabinet', 'state_legislator',
                     'state_scotus', 'state_dca', 'state_circuit_judge',
                     'state_county_judge'}.
        """
        payload = self.get_state_officials(state_code)
        if not payload or not person_id:
            return None
        target = str(person_id).strip()

        # Executive branch
        exe = payload.get("executive", {}) or {}
        gov = exe.get("governor") or {}
        if gov.get("id") == target:
            return self._decorate_with_candidacy(
                state_code,
                {**gov, "role_type": "state_governor", "chamber": "Executive"},
            )
        ltg = exe.get("lt_governor") or {}
        if ltg.get("id") == target:
            return self._decorate_with_candidacy(
                state_code,
                {**ltg, "role_type": "state_cabinet", "chamber": "Executive"},
            )
        for c in exe.get("cabinet", []) or []:
            if c.get("id") == target:
                return self._decorate_with_candidacy(
                    state_code,
                    {**c, "role_type": "state_cabinet", "chamber": "Executive"},
                )

        # Legislature (senate + house, leadership + members)
        for chamber_key, chamber_label in (
            ("state_senate", "State Senate"),
            ("state_house",  "State House"),
        ):
            block = payload.get(chamber_key, {}) or {}
            for bucket in ("leadership", "members"):
                for m in block.get(bucket, []) or []:
                    if m.get("id") == target:
                        return self._decorate_with_candidacy(
                            state_code,
                            {
                                **m,
                                "role_type": "state_legislator",
                                "chamber": m.get("chamber") or chamber_label,
                            },
                        )

        # Judiciary
        jud = payload.get("judiciary", {}) or {}
        sc = jud.get("supreme_court", {}) or {}
        for j in sc.get("members", []) or []:
            if j.get("id") == target:
                return {
                    **j,
                    "role_type": "state_scotus",
                    "chamber": sc.get("body_name") or "State Supreme Court",
                }
        for d in jud.get("district_courts_of_appeal", []) or []:
            ch = d.get("chief_judge") or {}
            if ch.get("id") == target:
                return {**ch, "role_type": "state_dca", "chamber": f"DCA {d.get('district','')}"}
            for jj in d.get("judges_sample") or []:
                if jj.get("id") == target:
                    return {**jj, "role_type": "state_dca", "chamber": f"DCA {d.get('district','')}"}
        for c in jud.get("circuits", []) or []:
            ch = c.get("chief_judge") or {}
            if ch.get("id") == target:
                return {
                    **ch,
                    "role_type": "state_circuit_judge",
                    "chamber": f"{c.get('circuit_name') or c.get('id','')} Circuit",
                }
        for cc in jud.get("county_courts", []) or []:
            ch = cc.get("chief_judge") or {}
            if ch.get("id") == target:
                return {
                    **ch,
                    "role_type": "state_county_judge",
                    "chamber": f"{cc.get('county','')} County Court",
                }

        return None
