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

logger = logging.getLogger(__name__)

CENSUS_GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder"
# Which boundaries the district lookup uses. The address must map to the
# districts that sitting officials represent: the 119th Congress's, and
# the 2024 state legislative districts they were elected under. The
# Census "Current_Current" vintage used to give those, but in September
# 2026 it moved to the 120th Congress's districts (the maps for the 2026
# elections), which differ in states that redrew for 2026: downtown
# Austin came back as TX-10 instead of TX-37. ACS2025_Current keeps the
# 119th districts. When the 120th Congress is seated (January 2027), set
# CENSUS_GEOCODER_VINTAGE to Current_Current (or ACS2026_Current) and
# change CURRENT_CONGRESS to 120.
CENSUS_GEOCODER_VINTAGE = os.environ.get("CENSUS_GEOCODER_VINTAGE", "ACS2025_Current")
CURRENT_CONGRESS = 119
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Nominatim's terms require a contact User-Agent. Keeps us in their
# acceptable-use range; the email is the same address that owns the
# project's domain.
NOMINATIM_UA = "CivicView/1.0 (https://civicview.app; jeffreynuez1@gmail.com)"

# A query is treated as "loose" (= ZIP / city / state only) when it
# matches one of these shapes. We send loose queries straight to
# Nominatim; full street addresses go to Census first.
_ZIP_ONLY_RE = re.compile(r"^\s*\d{5}(?:-\d{4})?\s*$")
_HAS_STREET_NUMBER_RE = re.compile(r"^\s*\d+\s+\S")



def _district_code(record: dict) -> Optional[str]:
    """Two-digit district code ("07", "00" at-large, "98" delegate) from a
    Census congressional district record. The CD<session> field is not
    in every vintage (ACS2025 leaves it out), so fall back to the last
    two digits of the GEOID (state FIPS + district), then BASENAME."""
    for key in (f"CD{CURRENT_CONGRESS}", "CD119", "CD118", "CD117", "CD", "CDFP"):
        if record.get(key):
            return str(record[key])
    geoid = str(record.get("GEOID") or "")
    if len(geoid) == 4 and geoid.isdigit():
        return geoid[2:]
    return record.get("BASENAME") or None


def _pick_congressional_district(geographies: dict) -> Optional[dict]:
    """The congressional district record for the current Congress, with
    its code normalized into "CD". Prefers the layer named for
    CURRENT_CONGRESS (e.g. "119th Congressional Districts") so a response
    that carries more than one Congress's maps never picks the wrong one."""
    wanted = f"{CURRENT_CONGRESS}th Congressional Districts"
    keys = [k for k, v in geographies.items() if "Congressional" in k and v]
    if not keys:
        return None
    key = wanted if wanted in keys else keys[0]
    if key != wanted:
        logger.warning("Census geography returned %s, not %s", key, wanted)
    record = dict(geographies[key][0])  # shallow copy so we can add extras
    record["CD"] = _district_code(record)
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
        url = f"{CENSUS_GEOCODER_BASE}/geographies/coordinates"
        params = {
            "x": lng,
            "y": lat,
            "benchmark": "Public_AR_Current",
            "vintage": CENSUS_GEOCODER_VINTAGE,
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

                cd_result = _pick_congressional_district(geographies)

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
