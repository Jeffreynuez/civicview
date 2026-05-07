# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Local Officials Service
Loads curated municipal officials (mayor, council/commission) from
static JSON files under /data/<state>/local_officials.json.

Cities are indexed by kebab-case slug (e.g. 'st-petersburg').
"""
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


class LocalOfficialsService:
    def __init__(self):
        # state_code -> {city_slug -> city_payload}
        self._by_state: dict[str, dict[str, dict]] = {}
        self._load_all()

    def _load_all(self) -> None:
        if not DATA_DIR.exists():
            logger.warning("LocalOfficialsService: data dir missing at %s", DATA_DIR)
            return
        for state_dir in DATA_DIR.iterdir():
            if not state_dir.is_dir():
                continue
            path = state_dir / "local_officials.json"
            if not path.exists():
                continue
            try:
                with path.open("r", encoding="utf-8") as fh:
                    raw = json.load(fh)
                state_code = (raw.get("state") or state_dir.name).upper()
                cities = raw.get("cities", {}) or {}
                self._by_state[state_code] = cities
                logger.info(
                    "LocalOfficialsService: loaded %d cities for %s",
                    len(cities),
                    state_code,
                )
            except (json.JSONDecodeError, OSError) as e:
                logger.error("LocalOfficialsService: failed to load %s: %s", path, e)

    def list_cities(self, state_code: str) -> list[dict]:
        """Return a lightweight index of cities with officials seeded.

        Shape: [{slug, city, county, county_fips, population, government_type}]
        """
        cities = self._by_state.get((state_code or "").upper(), {})
        out: list[dict] = []
        for slug, payload in cities.items():
            out.append({
                "slug": payload.get("slug", slug),
                "city": payload.get("city"),
                "county": payload.get("county"),
                "county_fips": payload.get("county_fips"),
                "population": payload.get("population"),
                "government_type": payload.get("government_type"),
                "website": payload.get("website"),
                "tier": payload.get("tier") or "city",
            })
        # Sort by population desc (largest first — matches "top metros" framing)
        out.sort(key=lambda c: c.get("population") or 0, reverse=True)
        return out

    def get_local_officials(self, state_code: str, city_slug: str) -> Optional[dict]:
        """Return the full officials payload for a city, or None if not seeded."""
        if not state_code or not city_slug:
            return None
        cities = self._by_state.get(state_code.upper(), {})
        return cities.get(city_slug.lower())

    def find_city_by_county_fips(self, state_code: str, county_fips: str) -> Optional[dict]:
        """Return the first seeded city in the given county (best-effort match
        when we don't have a city name from geocoding)."""
        if not state_code or not county_fips:
            return None
        cities = self._by_state.get(state_code.upper(), {})
        target = str(county_fips).strip()
        for payload in cities.values():
            if str(payload.get("county_fips", "")).strip() == target:
                return payload
        return None

    def reload(self) -> None:
        self._by_state = {}
        self._load_all()
