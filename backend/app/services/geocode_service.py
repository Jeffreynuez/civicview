# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Geocoding & District Lookup Service

Two-tier geocoder so the lookup accepts a wide range of inputs:

  1. Census Geocoder (free, accurate for U.S. street addresses, no
     key required). Best when the user provides a full address.
     Strict: it rejects ZIP-only / city-only inputs.

  2. Nominatim / OpenStreetMap fallback. Loose: accepts "Melbourne",
     "32822", "Melbourne, FL", "Florida", etc. We use it ONLY to
     resolve a free-form query to coordinates; we then hand those
     coordinates back to the Census Geocoder for the actual
     congressional-district lookup, since OSM doesn't have
     congressional boundaries.

The router calls `lookup_address` which transparently routes through
both tiers — same response shape regardless of which tier matched.
"""

import logging
import os
import re
from typing import Optional

import httpx

from app.services import congress_calendar

logger = logging.getLogger(__name__)

CENSUS_GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder"
# Which boundaries the district lookup uses. An address must map to the
# districts that sitting officials represent, which change when a new
# Congress is seated at noon on January 3 of an odd year. The Census
# geocoder serves each set of maps under a "vintage". Checked against
# the geocoder on 2026-10-15:
#   ACS2025_Current  "119th Congressional Districts" and the 2024 state
#                    legislative districts (what members represent
#                    until January 3, 2027)
#   Current_Current  "120th Congressional Districts" and the 2026 state
#                    legislative districts (the maps the 2026 elections
#                    use; ACS2026_Current returns the same)
# In states that redrew for 2026 the two differ: downtown Austin is
# TX-37 on the 119th map and TX-10 on the 120th. The vintage follows
# the Congress sitting today (services/congress_calendar.py), so the
# switch needs no one to remember it. If the vintage asked for does not
# return the sitting Congress's layer yet, _pick_congressional_district
# falls back to the previous Congress's layer (the 119th, for the 120th)
# and logs a warning. CENSUS_GEOCODER_VINTAGE in the environment
# overrides the table, for an emergency switch without a deploy.
VINTAGE_FOR_CONGRESS = {119: "ACS2025_Current", 120: "Current_Current"}
# A Congress not in the table yet (the 121st, from 2029) asks for the
# geocoder's current maps, and falls back as above if they lag.
DEFAULT_VINTAGE = "Current_Current"


def _current_congress() -> int:
    return congress_calendar.current_congress()


def geocoder_vintage(congress: Optional[int] = None) -> str:
    """The Census geocoder vintage for `congress` (default: the one
    sitting now), or the CENSUS_GEOCODER_VINTAGE override."""
    override = os.environ.get("CENSUS_GEOCODER_VINTAGE", "").strip()
    if override:
        return override
    n = congress or _current_congress()
    return VINTAGE_FOR_CONGRESS.get(n, DEFAULT_VINTAGE)


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim's terms require a contact User-Agent. Keeps us in their
# acceptable-use range; the email is the project's contact address.
NOMINATIM_UA = "CivicView/1.0 (https://civicview.app; civicview@civicview.app)"

# A query is treated as "loose" (= ZIP / city / state only) when it
# matches one of these shapes. We send loose queries straight to
# Nominatim; full street addresses go to Census first.
_ZIP_ONLY_RE = re.compile(r"^\s*\d{5}(?:-\d{4})?\s*$")
_HAS_STREET_NUMBER_RE = re.compile(r"^\s*\d+\s+\S")



def _district_code(record: dict, congress: Optional[int] = None) -> Optional[str]:
    """Two-digit district code ("07", "00" at-large, "98" delegate) from a
    Census congressional district record. The CD<session> field is not
    in every vintage (ACS2025 leaves it out), so fall back to the last
    two digits of the GEOID (state FIPS + district), then BASENAME."""
    n = congress or _current_congress()
    keys = [f"CD{n}", f"CD{n - 1}", "CD119", "CD118", "CD117", "CD", "CDFP"]
    for key in dict.fromkeys(keys):
        if record.get(key):
            return str(record[key])
    geoid = str(record.get("GEOID") or "")
    if len(geoid) == 4 and geoid.isdigit():
        return geoid[2:]
    return record.get("BASENAME") or None


def _pick_congressional_district(geographies: dict, congress: Optional[int] = None) -> Optional[dict]:
    """The congressional district record for the sitting Congress, with
    its code normalized into "CD". Prefers the layer named for that
    Congress (e.g. "120th Congressional Districts") so a response that
    carries more than one Congress's maps never picks the wrong one;
    until the geocoder publishes it, the previous Congress's layer is
    used instead."""
    n = congress or _current_congress()
    wanted = f"{congress_calendar.ordinal(n)} Congressional Districts"
    previous = f"{congress_calendar.ordinal(n - 1)} Congressional Districts"
    keys = [k for k, v in geographies.items() if "Congressional" in k and v]
    if not keys:
        return None
    if wanted in keys:
        key = wanted
    else:
        key = previous if previous in keys else keys[0]
        logger.warning("Census geography returned %s, not %s; using it until the "
                       "geocoder publishes the %s", key, wanted, wanted)
    record = dict(geographies[key][0])  # shallow copy so we can add extras
    record["CD"] = _district_code(record, n)
    return record

class GeocodeService:
    """Converts US addresses to coordinates and congressional districts."""

    async def lookup_address(self, address: str) -> Optional[dict]:
        """
        Resolve a free-form U.S. address-or-place string into:
          • coordinates (lat/lng)
          • state code
          • congressional district number (when geography supports it)
          • matched address (canonicalized)
          • county / city / state-legislative-district context

        Tries two geocoders in succession:
          1. Census Geocoder for full street addresses (high
             precision, but rejects ZIP-only / city-only inputs).
          2. Nominatim (OpenStreetMap) for everything else — ZIPs,
             city names, county names, "Melbourne FL", etc. Once
             Nominatim returns coordinates, we still call Census's
             /geographies/coordinates endpoint to resolve the
             congressional district at that point.

        Returns None when neither geocoder can match.
        """
        normalized = (address or "").strip()
        if not normalized:
            return None

        # Heuristic: ZIP-only or queries lacking a leading street
        # number aren't valid for Census's onelineaddress endpoint —
        # skip straight to Nominatim. Otherwise try Census first
        # (it's more accurate for street-address district matching).
        try_census_first = (
            not _ZIP_ONLY_RE.match(normalized)
            and bool(_HAS_STREET_NUMBER_RE.match(normalized))
        )

        geo_result = None
        if try_census_first:
            geo_result = await self._geocode_address(normalized)
        if not geo_result:
            geo_result = await self._geocode_nominatim(normalized)
        # Defensive: if a non-street-number address still slipped past
        # the heuristic (e.g. "1600 Pennsylvania Ave"), also try Census
        # as a last resort before giving up.
        if not geo_result and not try_census_first:
            geo_result = await self._geocode_address(normalized)
        if not geo_result:
            return None

        lat = geo_result["coordinates"]["y"]
        lng = geo_result["coordinates"]["x"]
        matched_address = geo_result.get("matchedAddress", normalized)

        # Step 2: Use coordinates to find the congressional district
        district_info = await self._get_district_from_coords(lat, lng)

        # Extract state FIPS and convert to state code
        state_fips = None
        state_code = None
        district_number = None
        county_fips = None
        county_name = None
        city_name = None
        state_senate_district = None
        state_house_district = None

        if district_info:
            state_fips = district_info.get("STATE", "")
            district_number = district_info.get("CD", district_info.get("CDFP", ""))
            state_code = FIPS_TO_STATE.get(state_fips)

            # Clean district number — "00" means at-large
            if district_number in ("00", "98"):
                district_number = "At-Large"
            else:
                try:
                    district_number = str(int(district_number))  # Remove leading zeros
                except (ValueError, TypeError):
                    pass

            # Extras surfaced from the same /geographies response
            county_fips = district_info.get("_COUNTY_FIPS")
            county_name = district_info.get("_COUNTY_NAME")
            city_name = district_info.get("_PLACE_NAME")
            state_senate_district = district_info.get("_SLDU")
            state_house_district = district_info.get("_SLDL")

        # If we couldn't get district from geography, try to extract state from the address
        if not state_code and geo_result.get("addressComponents"):
            state_code = geo_result["addressComponents"].get("state", "")

        # Build a city slug (kebab-case) — useful for matching against local_officials.json
        city_slug = None
        if city_name:
            import re
            slug = city_name.lower().strip()
            # Standardize "St." -> "st" before stripping punctuation
            slug = slug.replace("st.", "st").replace("ft.", "ft")
            slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
            city_slug = slug or None

        return {
            "matchedAddress": matched_address,
            "coordinates": {"lat": lat, "lng": lng},
            "stateCode": state_code,
            "stateFips": state_fips,
            "district": district_number,
            "districtLabel": f"{state_code}-{district_number}" if state_code and district_number else None,
            "countyFips": county_fips,
            "countyName": county_name,
            "city": city_name,
            "citySlug": city_slug,
            "stateSenateDistrict": state_senate_district,
            "stateHouseDistrict": state_house_district,
        }

    async def congressional_district_for_street_address(
        self, address: str,
    ) -> Optional[tuple[str, str]]:
        """(state, district) in the canonical form of services/citizen_geo
        ("FL-17", "WY-AL") for a full street address, or None.

        Census only, never the Nominatim fallback: this reads the address
        ID.me verified (identity_verification.verification_callback), and
        that address goes to the U.S. Census geocoder and nowhere else."""
        from app.services.citizen_geo import normalize_district

        hit = await self._geocode_address((address or "").strip())
        if not hit:
            return None
        coords = hit.get("coordinates") or {}
        info = await self._get_district_from_coords(coords.get("y"), coords.get("x"))
        if not info:
            return None
        state = FIPS_TO_STATE.get(info.get("STATE", ""))
        district = normalize_district(state, info.get("CD"))
        return (state, district) if state and district else None

    async def _geocode_nominatim(self, query: str) -> Optional[dict]:
        """Geocode via Nominatim (OpenStreetMap). Looser than Census —
        accepts ZIPs, city names, partial addresses. Returns the same
        shape `_geocode_address` does so the caller can treat the two
        interchangeably.

        We restrict results to the U.S. (countrycodes=us) and ask for
        the address breakdown so we can preserve the user-visible
        "matched address" string. Errors / no-match returns None.
        """
        params = {
            "q": query,
            "format": "json",
            "addressdetails": "1",
            "limit": "1",
            "countrycodes": "us",
        }
        headers = {"User-Agent": NOMINATIM_UA}
        try:
            async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
                resp = await client.get(NOMINATIM_URL, params=params)
                if resp.status_code != 200:
                    # The typed address is personal data; it stays out of the logs.
                    logger.warning("Nominatim returned %s for an address lookup", resp.status_code)
                    return None
                data = resp.json()
                if not isinstance(data, list) or not data:
                    logger.info("No Nominatim match for an address lookup")
                    return None
                hit = data[0]
                try:
                    lat = float(hit["lat"])
                    lng = float(hit["lon"])
                except (KeyError, TypeError, ValueError):
                    return None
                display = hit.get("display_name") or query
                return {
                    "coordinates": {"x": lng, "y": lat},
                    "matchedAddress": display,
                    "addressComponents": hit.get("address") or {},
                }
        except Exception as e:
            logger.error("Nominatim geocoder error: %s", e)
            return None

    async def _geocode_address(self, address: str) -> Optional[dict]:
        """Geocode an address using the Census Geocoder API."""
        url = f"{CENSUS_GEOCODER_BASE}/locations/onelineaddress"
        params = {
            "address": address,
            "benchmark": "Public_AR_Current",
            "format": "json",
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, params=params)
                if resp.status_code != 200:
                    logger.warning(f"Census geocoder returned {resp.status_code}")
                    return None

                data = resp.json()
                matches = data.get("result", {}).get("addressMatches", [])
                if not matches:
                    logger.info("No Census geocoder match for an address lookup")
                    return None

                return matches[0]  # Best match
        except Exception as e:
            logger.error(f"Census geocoder error: {e}")
            return None

    async def _get_district_from_coords(self, lat: float, lng: float) -> Optional[dict]:
        """Look up congressional district from coordinates using Census Geocoder."""
        # One Congress for the whole lookup, so a request that straddles
        # the January 3 switch cannot ask for one map and read another.
        congress = _current_congress()
        url = f"{CENSUS_GEOCODER_BASE}/geographies/coordinates"
        params = {
            "x": lng,
            "y": lat,
            "benchmark": "Public_AR_Current",
            "vintage": geocoder_vintage(congress),
            "format": "json",
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, params=params)
                if resp.status_code != 200:
                    logger.warning(f"Census geography lookup returned {resp.status_code}")
                    return None

                data = resp.json()
                geographies = data.get("result", {}).get("geographies", {})

                cd_result = _pick_congressional_district(geographies, congress)

                if cd_result is None:
                    # Fall back to a stub so we still try to extract other geographies
                    states = geographies.get("States", [])
                    if states:
                        cd_result = {"STATE": states[0].get("STATE", ""), "CD": None}
                    else:
                        return None

                # ── Extras: county / place / state legislative districts ──
                # Counties: {STATE, COUNTY, BASENAME, NAME}
                counties = geographies.get("Counties", [])
                if counties:
                    c = counties[0]
                    state_fips = c.get("STATE") or cd_result.get("STATE") or ""
                    county_fips = c.get("COUNTY") or ""
                    if state_fips and county_fips:
                        cd_result["_COUNTY_FIPS"] = f"{state_fips}{county_fips}"
                    cd_result["_COUNTY_NAME"] = c.get("BASENAME") or c.get("NAME")

                # Incorporated Places (cities). Sometimes "Census Designated Places"
                # is the only match — fall back to that.
                place_keys = ["Incorporated Places", "Census Designated Places"]
                for pk in place_keys:
                    places = geographies.get(pk, [])
                    if places:
                        p = places[0]
                        cd_result["_PLACE_NAME"] = p.get("BASENAME") or p.get("NAME")
                        break

                # State legislative districts — upper & lower chambers.
                # Census prefixes these layer keys with a vintage year, e.g.
                # "2024 State Legislative Districts - Upper", so an exact-key
                # lookup silently fails. Match by substring (like the
                # Congressional layer above) so the year prefix doesn't break it.
                def _find_layer(substr):
                    for k, v in geographies.items():
                        if substr in k and v:
                            return v[0]
                    return None

                sldu = _find_layer("State Legislative Districts - Upper")
                if sldu:
                    val = sldu.get("SLDU") or sldu.get("BASENAME")
                    if val:
                        try:
                            cd_result["_SLDU"] = str(int(val))
                        except (ValueError, TypeError):
                            cd_result["_SLDU"] = str(val).strip()

                sldl = _find_layer("State Legislative Districts - Lower")
                if sldl:
                    val = sldl.get("SLDL") or sldl.get("BASENAME")
                    if val:
                        try:
                            cd_result["_SLDL"] = str(int(val))
                        except (ValueError, TypeError):
                            cd_result["_SLDL"] = str(val).strip()

                return cd_result
        except Exception as e:
            logger.error(f"Census geography lookup error: {e}")
            return None


# FIPS state codes to two-letter abbreviations
FIPS_TO_STATE = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
    "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
    "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
    "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR",
    "78": "VI",
}
