# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
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
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

CENSUS_GEOCODER_BASE = "https://geocoding.geo.census.gov/geocoder"
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
                    logger.warning("Nominatim returned %s for %r", resp.status_code, query)
                    return None
                data = resp.json()
                if not isinstance(data, list) or not data:
                    logger.info("No Nominatim match for: %s", query)
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
                    logger.info(f"No address match found for: {address}")
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
            "vintage": "Current_Current",
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

                # Look for Congressional Districts — the key name includes the session number
                # e.g., "119th Congressional Districts", "118th Congressional Districts"
                cd_result = None
                for key, value in geographies.items():
                    if "Congressional" in key and value:
                        cd_result = dict(value[0])  # shallow copy so we can add extras
                        # The district field can be CD, CD118, CD119, CDFP, BASENAME, etc.
                        # Normalize to "CD" for downstream code
                        for cd_key in ("CD119", "CD118", "CD117", "CD", "CDFP", "BASENAME"):
                            if cd_key in cd_result and cd_result[cd_key]:
                                cd_result["CD"] = cd_result[cd_key]
                                break
                        break

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

                # State legislative districts — upper & lower chambers
                sldu = geographies.get("State Legislative Districts - Upper", [])
                if sldu:
                    v = sldu[0]
                    val = v.get("SLDU") or v.get("BASENAME")
                    if val:
                        try:
                            cd_result["_SLDU"] = str(int(val))
                        except (ValueError, TypeError):
                            cd_result["_SLDU"] = str(val).strip()

                sldl = geographies.get("State Legislative Districts - Lower", [])
                if sldl:
                    v = sldl[0]
                    val = v.get("SLDL") or v.get("BASENAME")
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
