from fastapi import APIRouter, HTTPException, Query
from app.services.federal_officials_service import FederalOfficialsService
from app.services import federal_live

router = APIRouter()
service = FederalOfficialsService()


@router.get("")
async def get_federal_officials():
    """Return the curated national-level officials snapshot
    (executive branch, judiciary, congressional leadership, upcoming
    federal elections)."""
    payload = service.get_federal_officials()
    if not payload:
        raise HTTPException(
            status_code=404,
            detail="Federal officials data not seeded.",
        )
    return payload


@router.get("/executive")
async def get_executive():
    exec_block = service.get_executive()
    if not exec_block:
        raise HTTPException(status_code=404, detail="No executive data seeded.")
    return exec_block


@router.get("/judiciary")
async def get_judiciary():
    jud = service.get_judiciary()
    if not jud:
        raise HTTPException(status_code=404, detail="No judiciary data seeded.")
    return jud


@router.get("/congress")
async def get_congress():
    c = service.get_congress()
    if not c:
        raise HTTPException(status_code=404, detail="No congress summary seeded.")
    return c


@router.get("/elections")
async def get_elections():
    e = service.get_elections()
    if not e:
        raise HTTPException(status_code=404, detail="No federal elections seeded.")
    return e


# ── Live-data proxies ─────────────────────────────────────────────────
@router.get("/executive-orders")
async def get_executive_orders(
    president_slug: str = Query(..., description="Federal Register slug, e.g. 'donald-trump'"),
    limit: int = Query(20, ge=1, le=100),
):
    """Proxy the Federal Register EO feed for a given president."""
    orders = await federal_live.fetch_executive_orders(president_slug, limit=limit)
    return {"president_slug": president_slug, "count": len(orders), "orders": orders}


@router.get("/presidential-actions")
async def get_presidential_actions(
    congress: int = Query(119, ge=100, le=200),
    type: str = Query("signed", pattern="^(signed|vetoed|veto)$"),
    limit: int = Query(20, ge=1, le=100),
):
    """Return bills enacted as law ('signed') or vetoed during the given
    congress. Requires CONGRESS_API_KEY on the server."""
    rows = await federal_live.fetch_presidential_actions(
        congress=congress, action_type=type, limit=limit,
    )
    return {"congress": congress, "type": type, "count": len(rows), "bills": rows}


@router.get("/scotus-cases")
async def get_scotus_cases(
    justice_name: str | None = Query(
        None,
        description="Optional surname filter, e.g. 'Jackson' to surface cases where the justice sat on the panel.",
    ),
    limit: int = Query(15, ge=1, le=50),
):
    """Proxy recent SCOTUS opinion clusters from CourtListener."""
    cases = await federal_live.fetch_scotus_cases(
        justice_name=justice_name, limit=limit,
    )
    return {"justice_name": justice_name, "count": len(cases), "cases": cases}


# ── Single-person lookup — must be last so static subpaths win ────────
@router.get("/person/{person_id}")
async def get_person(person_id: str):
    """Return an individual federal official's profile with role_type and
    Federal Register president slug (when applicable)."""
    person = service.find_by_id(person_id)
    if not person:
        raise HTTPException(
            status_code=404,
            detail=f"No federal official found with id '{person_id}'.",
        )
    # Attach the Federal Register slug if we have one recorded for this
    # person — lets the frontend call /executive-orders without a second
    # lookup.
    slug = federal_live.PRESIDENT_FEDREG_SLUGS.get(person.get("id"))
    if slug:
        person["federal_register_slug"] = slug
    return person
