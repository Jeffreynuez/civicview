"""An address maps to the district its current member represents.

Run:  cd backend && python3 tests/test_geocode_districts.py   (exit 0 = pass)

In September 2026 the Census geocoder's "Current_Current" vintage moved
to the 120th Congress's districts (the maps for the 2026 elections). In
states that redrew for 2026 that returns a different district from the
one the sitting member represents (downtown Austin: TX-10 instead of
TX-37). The lookup now asks for the ACS2025 vintage, which carries the
119th Congress's districts, and reads the district code even when the
CD119 field is missing from the response.

  1. The coordinates request asks for the ACS2025_Current vintage.
  2. An ACS2025-shaped record (no CD119, GEOID 4837) gives TX-37.
  3. An at-large record (GEOID 5600, BASENAME text) gives At-Large.
  4. The older shape with a CD119 field still works.
  5. When a response carries both the 119th and 120th maps, the 119th
     one is used.

The 120th Congress is seated at noon Eastern (17:00 UTC) on January 3,
2027, and the lookup follows it from the date (services/
congress_calendar.py). Checks 1 to 5 run with the clock at 2026-10-15;
the ones below stand on either side of the switch:

  6. The Congress and session derived from the date: 119th until
     January 3, 2027, 120th from then; the session turns over on
     January 3 of each year, at 17:00 UTC when a time is given.
  7. On January 2, 2027 the lookup still asks for ACS2025_Current and
     reads the 119th map (TX-37).
  8. From noon Eastern on January 3, 2027 it asks for Current_Current
     and reads the 120th map (TX-10), from a response with both maps
     or with the 120th only.
  9. If the geocoder has not published the 120th map yet, the 119th
     one is used rather than nothing.
 10. CENSUS_GEOCODER_VINTAGE overrides the table on both sides.
"""
import asyncio
import os
import sys
from datetime import UTC, date, datetime

_failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


def main() -> int:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.CRITICAL)
    from app.services import congress_calendar as cc
    from app.services import geocode_service as gs

    os.environ.pop("CENSUS_GEOCODER_VINTAGE", None)
    clock = {"now": datetime(2026, 10, 15, 12, 0, tzinfo=UTC)}
    real_now = cc._now
    cc._now = lambda: clock["now"]

    sent = []

    def geographies_for(case):
        cd119 = {"STATE": "48", "GEOID": "4837", "BASENAME": "37", "CDSESSN": "119"}
        cd120 = {"STATE": "48", "GEOID": "4810", "BASENAME": "10", "CD120": "10", "CDSESSN": "120"}
        base = {
            "States": [{"STATE": "48"}],
            "Counties": [{"STATE": "48", "COUNTY": "453", "BASENAME": "Travis"}],
            "Incorporated Places": [{"BASENAME": "Austin"}],
        }
        if case == "acs2025":
            return {**base, "119th Congressional Districts": [cd119]}
        if case == "at_large":
            return {
                "States": [{"STATE": "56"}],
                "119th Congressional Districts": [{
                    "STATE": "56", "GEOID": "5600", "CDSESSN": "119",
                    "BASENAME": "Congressional District (at Large)",
                }],
            }
        if case == "old_shape":
            return {**base, "119th Congressional Districts": [{"STATE": "48", "CD119": "07", "BASENAME": "7"}]}
        if case == "both":
            return {**base, "120th Congressional Districts": [cd120], "119th Congressional Districts": [cd119]}
        if case == "cd120_only":
            return {**base, "120th Congressional Districts": [cd120]}
        raise AssertionError(case)

    state = {"case": "acs2025"}

    class FakeResp:
        status_code = 200

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, params=None):
            sent.append((url, dict(params or {})))
            if url.endswith("/locations/onelineaddress"):
                return FakeResp({"result": {"addressMatches": [{
                    "coordinates": {"x": -97.7431, "y": 30.2672},
                    "matchedAddress": "100 CONGRESS AVE, AUSTIN, TX, 78701",
                    "addressComponents": {"state": "TX"},
                }]}})
            return FakeResp({"result": {"geographies": geographies_for(state["case"])}})

    real_client = gs.httpx.AsyncClient
    gs.httpx.AsyncClient = FakeClient
    try:
        svc = gs.GeocodeService()

        async def lookup():
            return await svc.lookup_address("100 Congress Ave, Austin, TX 78701")

        res = asyncio.run(lookup())
        coord_calls = [p for u, p in sent if u.endswith("/geographies/coordinates")]
        check("1: coordinates lookup asks for the ACS2025 vintage",
              bool(coord_calls) and coord_calls[-1].get("vintage") == "ACS2025_Current",
              str(coord_calls[-1:] if coord_calls else sent))
        check("2: ACS2025 record without CD119 gives TX-37",
              res and res.get("district") == "37" and res.get("districtLabel") == "TX-37", str(res))

        state["case"] = "at_large"
        rec = asyncio.run(svc._get_district_from_coords(41.14, -104.82))
        check("3: at-large record gives code 00", rec and rec.get("CD") == "00", str(rec))
        res = asyncio.run(lookup())
        check("3b: at-large lookup reports At-Large",
              res and res.get("district") == "At-Large", str(res))

        state["case"] = "old_shape"
        rec = asyncio.run(svc._get_district_from_coords(30.27, -97.74))
        check("4: CD119 field still read", rec and rec.get("CD") == "07", str(rec))

        state["case"] = "both"
        res = asyncio.run(lookup())
        check("5: with both maps present, the 119th district is used",
              res and res.get("district") == "37", str(res))

        # 6. The calendar itself.
        check("6a: January 2, 2027 is still the 119th Congress",
              cc.current_congress(date(2027, 1, 2)) == 119)
        check("6b: January 3, 2027 is the 120th Congress",
              cc.current_congress(date(2027, 1, 3)) == 120)
        check("6c: 16:59 UTC on January 3, 2027 is the 119th, 17:00 the 120th",
              cc.current_congress(datetime(2027, 1, 3, 16, 59, tzinfo=UTC)) == 119
              and cc.current_congress(datetime(2027, 1, 3, 17, 0, tzinfo=UTC)) == 120)
        check("6d: sessions turn over on January 3",
              cc.current_congress_session(date(2026, 1, 2)) == (119, 1)
              and cc.current_congress_session(date(2026, 1, 3)) == (119, 2)
              and cc.current_congress_session(date(2027, 1, 2)) == (119, 2)
              and cc.current_congress_session(date(2027, 1, 3)) == (120, 1))
        check("6e: ordinals match the Census layer names",
              [cc.ordinal(n) for n in (119, 120, 121, 122, 123)]
              == ["119th", "120th", "121st", "122nd", "123rd"])

        def last_vintage():
            calls = [p for u, p in sent if u.endswith("/geographies/coordinates")]
            return calls[-1].get("vintage") if calls else None

        # 7. The day before the switch.
        clock["now"] = datetime(2027, 1, 2, 23, 0, tzinfo=UTC)
        state["case"] = "both"
        res = asyncio.run(lookup())
        check("7: on January 2, 2027 the lookup asks for ACS2025_Current",
              last_vintage() == "ACS2025_Current", str(last_vintage()))
        check("7b: and reads the 119th map (TX-37)",
              res and res.get("districtLabel") == "TX-37", str(res))

        # 8. After noon Eastern on January 3, 2027.
        clock["now"] = datetime(2027, 1, 3, 17, 0, tzinfo=UTC)
        res = asyncio.run(lookup())
        check("8: from noon Eastern on January 3, 2027 it asks for Current_Current",
              last_vintage() == "Current_Current", str(last_vintage()))
        check("8b: and reads the 120th map from a response with both (TX-10)",
              res and res.get("districtLabel") == "TX-10", str(res))
        state["case"] = "cd120_only"
        res = asyncio.run(lookup())
        check("8c: and from a response with the 120th map only (TX-10)",
              res and res.get("districtLabel") == "TX-10", str(res))

        # 9. The geocoder still serves only the 119th map.
        state["case"] = "acs2025"
        res = asyncio.run(lookup())
        check("9: without a 120th map the 119th one is used (TX-37)",
              res and res.get("districtLabel") == "TX-37", str(res))

        # 10. The environment override.
        os.environ["CENSUS_GEOCODER_VINTAGE"] = "ACS2026_Current"
        try:
            asyncio.run(lookup())
            after = last_vintage()
            clock["now"] = datetime(2027, 1, 2, 23, 0, tzinfo=UTC)
            asyncio.run(lookup())
            before = last_vintage()
        finally:
            os.environ.pop("CENSUS_GEOCODER_VINTAGE", None)
        check("10: CENSUS_GEOCODER_VINTAGE wins on both sides of the switch",
              before == after == "ACS2026_Current", f"{before} / {after}")
    finally:
        gs.httpx.AsyncClient = real_client
        cc._now = real_now

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
