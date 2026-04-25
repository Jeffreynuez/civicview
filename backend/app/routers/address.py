from fastapi import APIRouter, HTTPException, Query
from app.services.geocode_service import GeocodeService
from app.services.congress_service import CongressService

router = APIRouter()
geocode = GeocodeService()
congress = CongressService()


@router.get("/lookup")
async def lookup_address(
    address: str = Query(..., description="Full US address (e.g., '1600 Pennsylvania Ave NW, Washington, DC 20500')")
):
    """
    Look up an address to find:
    - The congressional district
    - The state's Congress members
    - Which specific representative serves that district
    """
    # Step 1: Geocode the address
    result = await geocode.lookup_address(address)
    if not result:
        raise HTTPException(
            status_code=404,
            detail="Could not find that address. Please try a full US street address (e.g., '123 Main St, Springfield, IL 62701').",
        )

    state_code = result.get("stateCode")
    district = result.get("district")

    if not state_code:
        raise HTTPException(status_code=404, detail="Could not determine the state for that address.")

    # Step 2: Get Congress members for the state
    members = await congress.get_members_by_state(state_code)

    # Step 3: Find the specific district representative
    my_rep = None
    if district and district != "At-Large":
        try:
            district_num = int(district)
            my_rep = next(
                (m for m in members if m.get("chamber") == "House" and m.get("district") == district_num),
                None,
            )
        except (ValueError, TypeError):
            pass

    # At-large states have one representative for the whole state
    if district == "At-Large":
        house_members = [m for m in members if m.get("chamber") == "House"]
        if len(house_members) == 1:
            my_rep = house_members[0]

    # Senators always represent the full state
    my_senators = [m for m in members if m.get("chamber") == "Senate"]

    return {
        "address": result["matchedAddress"],
        "coordinates": result["coordinates"],
        "stateCode": state_code,
        "stateFips": result.get("stateFips"),
        "district": district,
        "districtLabel": result.get("districtLabel"),
        # New: broader civic geography for state/local/ballot context
        "countyFips": result.get("countyFips"),
        "countyName": result.get("countyName"),
        "city": result.get("city"),
        "citySlug": result.get("citySlug"),
        "stateSenateDistrict": result.get("stateSenateDistrict"),
        "stateHouseDistrict": result.get("stateHouseDistrict"),
        "yourRepresentative": my_rep,
        "yourSenators": my_senators,
        "allMembers": members,
    }
