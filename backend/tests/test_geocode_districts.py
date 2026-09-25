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
"""
import asyncio
import os
import sys

_failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


def main() -> int:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.CRITICAL)
    from app.services import geocode_service as gs

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
    finally:
        gs.httpx.AsyncClient = real_client

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
