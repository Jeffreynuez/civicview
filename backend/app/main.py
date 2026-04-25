from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.routers import (
    congress,
    states,
    address,
    events,
    state_officials,
    local_officials,
    elections,
    candidates,
    federal_officials,
    google_civic,
    auth as auth_router,
    auth_citizen as auth_citizen_router,
    pages as pages_router,
    waitlist as waitlist_router,
)
from app.db import init_db
from app.seed import seed_demo_accounts, seed_demo_citizens

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("CivicLens API starting up...")
    # Phase 1 Pages feature — create tables (idempotent) + seed demo reps.
    # Wrapped in try/except so a DB hiccup on boot doesn't take the whole
    # API down; the read-only endpoints (Congress, States, etc.) still work
    # without the pages schema.
    try:
        init_db()
        seed_demo_accounts()
        seed_demo_citizens()
    except Exception:
        logger.exception("Pages DB init/seed failed — read-only endpoints will still work.")
    yield
    logger.info("CivicLens API shutting down...")


app = FastAPI(
    title="CivicLens API",
    description="API for US political representative data",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(congress.router, prefix="/api/congress", tags=["Congress"])
app.include_router(states.router, prefix="/api/states", tags=["States"])
app.include_router(address.router, prefix="/api/address", tags=["Address Lookup"])
app.include_router(events.router, prefix="/api/events", tags=["Events"])
app.include_router(state_officials.router, prefix="/api/state-officials", tags=["State Officials"])
app.include_router(local_officials.router, prefix="/api/local-officials", tags=["Local Officials"])
app.include_router(elections.router, prefix="/api/elections", tags=["Elections"])
app.include_router(candidates.router, prefix="/api/candidates", tags=["Candidates"])
app.include_router(federal_officials.router, prefix="/api/federal-officials", tags=["Federal Officials"])
app.include_router(google_civic.router, prefix="/api/google-civic", tags=["Google Civic"])
app.include_router(auth_router.router, prefix="/api/auth", tags=["Pages — Auth"])
app.include_router(auth_citizen_router.router, prefix="/api/citizen-auth", tags=["Pages — Citizen Auth"])
app.include_router(pages_router.router, prefix="/api/pages", tags=["Pages — Feed"])
app.include_router(waitlist_router.router, prefix="/api/waitlist", tags=["Pages — Citizen Waitlist"])


@app.get("/")
async def root():
    return {
        "app": "CivicLens API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "congress_members": "/api/congress/members?state=FL",
            "all_members": "/api/congress/members/all",
            "member_detail": "/api/congress/members/{bioguide_id}",
            "member_bills": "/api/congress/members/{bioguide_id}/bills",
            "member_contact": "/api/congress/members/{bioguide_id}/contact",
            "member_votes": "/api/congress/members/{bioguide_id}/votes",
            "member_stats": "/api/congress/members/{bioguide_id}/stats?party=R",
            "bill_snapshot": "/api/congress/bills/{congress}/{bill_type}/{number}",
            "committees": "/api/congress/committees",
            "committee_detail": "/api/congress/committees/{thomas_id}",
            "state_info": "/api/states/{state_code}",
            "address_lookup": "/api/address/lookup?address=1600+Pennsylvania+Ave+NW+Washington+DC",
            "member_events": "/api/events/upcoming?bioguide_id=R000595",
            "all_events": "/api/events/all",
            "state_officials": "/api/state-officials/{state_code}",
            "governor": "/api/state-officials/{state_code}/governor",
            "federal_officials": "/api/federal-officials",
            "federal_executive": "/api/federal-officials/executive",
            "federal_judiciary": "/api/federal-officials/judiciary",
            "federal_congress": "/api/federal-officials/congress",
            "federal_elections": "/api/federal-officials/elections",
            "federal_person": "/api/federal-officials/person/{id}",
            "federal_executive_orders": "/api/federal-officials/executive-orders?president_slug=donald-trump",
            "federal_presidential_actions": "/api/federal-officials/presidential-actions?congress=119&type=signed",
            "federal_scotus_cases": "/api/federal-officials/scotus-cases?justice_name=Roberts",
            "local_cities": "/api/local-officials/{state_code}",
            "local_officials": "/api/local-officials/{state_code}/{city_slug}",
            "elections": "/api/elections/{state_code}",
            "personalized_ballot": "/api/elections/{state_code}/ballot?county_fips=&congressional_district=&state_senate_district=&state_house_district=",
            "candidate": "/api/candidates/{candidate_id}",
            "all_candidates": "/api/candidates",
            "google_civic_status": "/api/google-civic/status",
            "google_civic_voter_info": "/api/google-civic/voter-info?address=...",
            "google_civic_elections": "/api/google-civic/elections",
            "google_civic_divisions": "/api/google-civic/divisions?address=...",
            "auth_login": "POST /api/auth/login",
            "auth_logout": "POST /api/auth/logout",
            "auth_me": "GET /api/auth/me",
            "page_payload": "GET /api/pages/{official_id}",
            "page_create_post": "POST /api/pages/{official_id}/posts",
            "page_delete_post": "DELETE /api/pages/posts/{post_id}",
            "page_vote_poll": "POST /api/pages/{official_id}/polls/{poll_id}/vote",
            "page_create_event": "POST /api/pages/{official_id}/events",
            "page_delete_event": "DELETE /api/pages/events/{event_id}",
            "citizen_waitlist_signup": "POST /api/waitlist",
        },
    }
