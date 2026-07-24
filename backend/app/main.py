# CivicView — backend FastAPI entrypoint.
# Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.middleware.csrf import CsrfMiddleware
from app.middleware.rate_limit import EngagementRateLimitMiddleware
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
    auth_candidate as auth_candidate_router,
    pages as pages_router,
    citizen_polls as citizen_polls_router,
    waitlist as waitlist_router,
    feed as feed_router,
    ai as ai_router,
    admin as admin_router,
    appeals as appeals_router,
    bills as bills_router,
    votes as votes_router,
    eos as eos_router,
    notifications as notifications_router,
    tracked as tracked_router,
    saved as saved_router,
    two_factor as two_factor_router,
    billing as billing_router,
    identity_verification as idme_router,
    csrf as csrf_router,
    stats as stats_router,
    poll_demographics as poll_demographics_router,
)
from app.db import init_db
from app.seed import (
    backfill_demo_citizen_subscriptions,
    maybe_run_fresh_start_wipe,
    seed_bill_summaries,
    seed_demo_accounts,
    seed_demo_candidates,
    seed_demo_citizens,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("CivicView API starting up...")
    # Phase 1 Pages feature — create tables (idempotent) + seed demo reps.
    # Wrapped in try/except so a DB hiccup on boot doesn't take the whole
    # API down; the read-only endpoints (Congress, States, etc.) still work
    # without the pages schema.
    try:
        init_db()
        # One-shot pre-launch cleanup gated by CIVICVIEW_WIPE_REP_DEMO.
        # Runs BEFORE seed so a fresh-start deploy ends with empty
        # tables, not "wiped and then re-seeded." Unset the env var
        # after the wipe boot to prevent repeated runs.
        maybe_run_fresh_start_wipe()
        seed_demo_accounts()
        seed_demo_citizens()
        seed_demo_candidates()
        # Task #88 hotfix — flip is_subscribed=True + status='demo' on
        # any existing demo-citizen row that pre-dates the
        # subscription columns. New signups already get the grant at
        # creation time (auth_citizen.demo_signup); this catches the
        # rows the auto-migrate backfilled with False. Idempotent —
        # only touches rows that still need updating.
        backfill_demo_citizen_subscriptions()
        # Pre-fetched CRS bill summaries — populates the bill_summaries
        # cache so the rep-profile Bills tab gets instant Summary
        # expansions on day one without Congress.gov round-trips.
        seed_bill_summaries()
        # Task #81 — purge soft-deleted accounts whose 30-day grace
        # window has elapsed. Runs at every backend boot; for
        # tighter recovery-window precision a daily cron via Render
        # Cron Jobs would also call this same helper.
        try:
            from app.services.account_deletion import purge_expired_accounts
            purge_expired_accounts()
        except Exception:
            logger.exception("Soft-delete purge failed — non-fatal, will retry next boot.")
        # Task #87 — purge expired password-reset tokens. Cheap O(N)
        # delete over a tiny table; same boot-time pattern as the
        # soft-delete purge above so we don't accumulate orphans.
        # Independent try/except so a token-purge failure can't take
        # down account-purge or vice versa.
        try:
            from app.services.password_reset import purge_expired_password_reset_tokens
            purge_expired_password_reset_tokens()
        except Exception:
            logger.exception(
                "Password-reset token purge failed — non-fatal, will retry next boot.",
            )
    except Exception:
        logger.exception("Pages DB init/seed failed — read-only endpoints will still work.")

    # ── Warm the Congress data cache (load-time perf, Task #29) ───────
    # CongressService keeps a per-process in-memory cache that is EMPTY on
    # every boot/redeploy, so the first visitor to each endpoint would
    # otherwise pay the live Congress.gov round-trip. Pre-fetch the hot,
    # high-traffic paths (full member directory + committees) in the
    # background so requests are warm by the time users arrive. We warm
    # the SAME service instance the /api/congress routes use, so the
    # populated cache is the one that serves traffic. Fully non-blocking:
    # startup returns immediately and any failure is swallowed.
    import asyncio as _asyncio

    async def _warm_congress_cache():
        try:
            from app.routers.congress import service as _cs
            await _cs.get_all_members()
            try:
                await _cs.get_committees()
            except Exception:
                pass
            logger.info("Congress cache warmup complete.")
        except Exception:
            logger.exception("Congress cache warmup failed — non-fatal.")

    try:
        _asyncio.get_event_loop().create_task(_warm_congress_cache())
    except Exception:
        logger.exception("Could not schedule Congress cache warmup — non-fatal.")

    # ── Weekly civic digest scheduler (Task #104) ────────────────────
    # Env-gated (DIGEST_ENABLED=true) in-process loop: sleeps until the
    # next Saturday 09:00 America/New_York, runs send_weekly_digests in
    # a fresh session, repeats. No new Render service needed; the
    # per-citizen digest_last_sent_at idempotency in the sender means
    # restarts/redeploys on send day can't double-send. If the process
    # happens to be asleep at 9am Saturday (Render restart), the next
    # boot's loop just targets the following Saturday — acceptable for
    # a courtesy digest; switch to a Render Cron Job if precision ever
    # matters.
    digest_task = None
    if os.getenv("DIGEST_ENABLED", "").strip().lower() in ("1", "true", "yes"):
        import asyncio
        from datetime import datetime, timedelta
        from zoneinfo import ZoneInfo

        async def _digest_loop():
            tz = ZoneInfo("America/New_York")
            while True:
                now = datetime.now(tz)
                days_ahead = (5 - now.weekday()) % 7  # Saturday = 5
                target = (now + timedelta(days=days_ahead)).replace(
                    hour=9, minute=0, second=0, microsecond=0
                )
                if target <= now:
                    target += timedelta(days=7)
                wait = (target - now).total_seconds()
                logger.info("digest scheduler: next run %s (in %.0f h)", target, wait / 3600)
                await asyncio.sleep(wait)
                try:
                    from app.db import SessionLocal
                    from app.services.digest_service import send_weekly_digests

                    db = SessionLocal()
                    try:
                        await asyncio.to_thread(send_weekly_digests, db)
                    finally:
                        db.close()
                except Exception:
                    logger.exception("digest run failed — will retry next Saturday")

        digest_task = asyncio.get_event_loop().create_task(_digest_loop())
        logger.info("Weekly digest scheduler ENABLED (DIGEST_ENABLED set).")
    else:
        logger.info("Weekly digest scheduler disabled (set DIGEST_ENABLED=true to enable).")

    yield
    if digest_task is not None:
        digest_task.cancel()
    logger.info("CivicView API shutting down...")


app = FastAPI(
    title="CivicView API",
    description="API for US political representative data",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS allow-list. Defaults cover local development (localhost +
# 127.0.0.1 + the Tailscale IP used for phone testing). Production
# overrides via the ALLOWED_ORIGINS env var, comma-separated, e.g.:
#
#   ALLOWED_ORIGINS=https://civicview.app,https://www.civicview.app
#
# Whitespace around each entry is stripped. Empty entries are dropped.
_DEFAULT_ALLOWED = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://100.127.231.86:3000",
]
_env_origins = os.getenv("ALLOWED_ORIGINS", "").strip()
ALLOWED_ORIGINS = (
    [o.strip() for o in _env_origins.split(",") if o.strip()]
    if _env_origins
    else _DEFAULT_ALLOWED
)

# CSRF middleware (Task #31, Phase 2). Validates X-CSRF-Token on
# state-changing requests against the HMAC of any currently-active
# session token. Registered BEFORE CORS so it sits INSIDE the CORS
# wrapper — every response (including the 403s this middleware emits
# on token mismatch) flows back out through CORS, which adds the
# Access-Control-Allow-* headers the browser needs. Reversing this
# order causes 403 responses to ship without CORS headers, which the
# browser treats as a CORS failure ("Failed to fetch" in the JS
# console) and the frontend's retry-on-csrf-mismatch path never fires.
# Starlette's add_middleware inserts at the FRONT of the user middleware
# list, so the LAST add wraps everything inside — hence CORS goes last.
app.add_middleware(CsrfMiddleware)
# Engagement write rate limiting (Task #101). Added after CsrfMiddleware
# → runs before it (Starlette executes later-added middleware first), so
# scripted spray gets a cheap 429 before any CSRF/token work.
app.add_middleware(EngagementRateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Public read-only caching (load-time perf, Task #29) ───────────────
# The reference-data endpoints below return identical PUBLIC data for
# every viewer (Congress members, officials, bills, votes, elections,
# events, stats — no per-user variation), so we let the browser and the
# Cloudflare edge cache them. This cuts repeat-load latency and offloads
# the live Congress.gov fan-out from the request path. Personalized /
# auth / write endpoints (pages feed, polls, tracked, saved, auth, admin,
# billing, notifications) are deliberately NOT matched, so nothing
# user-specific is ever served from a shared cache. We also skip any
# response that sets a cookie, as a belt-and-suspenders guard.
#
# NOTE: Cloudflare does not cache API JSON by default even with these
# headers — add a Cache Rule for these paths ("Eligible for cache",
# respect origin TTL) in the Cloudflare dashboard to get true edge
# caching. The header alone still enables browser-side caching today.
_CACHEABLE_PREFIXES = (
    "/api/congress", "/api/states", "/api/state-officials",
    "/api/local-officials", "/api/federal-officials", "/api/elections",
    "/api/candidates", "/api/events", "/api/bills", "/api/votes",
    "/api/eos", "/api/stats", "/api/address", "/api/google-civic",
)
_PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=600, stale-while-revalidate=86400"


@app.middleware("http")
async def add_public_cache_headers(request, call_next):
    response = await call_next(request)
    try:
        if (
            request.method == "GET"
            and response.status_code == 200
            and request.url.path.startswith(_CACHEABLE_PREFIXES)
            and "cache-control" not in response.headers
            and "set-cookie" not in response.headers
        ):
            response.headers["Cache-Control"] = _PUBLIC_CACHE_CONTROL
    except Exception:
        # Best-effort: a header tweak must never break a response.
        pass
    return response


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
app.include_router(auth_candidate_router.router, prefix="/api/candidate-auth", tags=["Pages — Candidate Auth"])
app.include_router(csrf_router.router, prefix="/api/csrf", tags=["Pages — CSRF"])
app.include_router(pages_router.router, prefix="/api/pages", tags=["Pages — Feed"])
# Citizen polls — endpoints are split between page-scoped routes
# (/api/pages/{official_id}/citizen-polls) and standalone routes
# (/api/citizen-polls/...), so we mount with prefix="/api" rather than
# "/api/citizen-polls" — the path parts come from the route decorators.
app.include_router(citizen_polls_router.router, prefix="/api", tags=["Pages — Citizen Polls"])
app.include_router(waitlist_router.router, prefix="/api/waitlist", tags=["Pages — Citizen Waitlist"])
app.include_router(feed_router.router, prefix="/api/feed", tags=["Pages — Home Feed"])
app.include_router(ai_router.router, prefix="/api/ai", tags=["AI"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["Admin"])
# Appeals router declares its own paths under /api/appeals AND
# /api/me/appeals AND /api/admin/appeals/... so we mount with
# prefix="/api" rather than baking the segmentation into one prefix.
app.include_router(appeals_router.router, prefix="/api", tags=["Appeals"])
# Bills router — per-bill summary cache (CRS + Haiku translation).
app.include_router(bills_router.router, prefix="/api/bills", tags=["Bills"])
# Votes router — per-vote "what was this vote?" explainer.
app.include_router(votes_router.router, prefix="/api/votes", tags=["Votes"])
# Executive orders router — per-EO Haiku plain-English summary cache.
app.include_router(eos_router.router, prefix="/api/eos", tags=["Executive Orders"])
# Tracked items — per-identity tracked bills / officials / elections.
# Replaces the prior localStorage-singleton store that survived logout.
app.include_router(tracked_router.router, prefix="/api/tracked", tags=["Tracked"])
app.include_router(saved_router.router, prefix="/api/saved", tags=["Saved"])

# In-app notifications — bell badge + dropdown feed.
app.include_router(notifications_router.router, prefix="/api/notifications", tags=["Notifications"])

# 2FA (Task #62 Phase 1) — the router declares full /api/2fa/* paths
# itself, so we mount it with no prefix. Same pattern the appeals
# router uses with its admin-side endpoints.
app.include_router(two_factor_router.router, tags=["2FA"])

# Billing (Task #88) — Stripe Checkout + Customer Portal + webhook
# under /api/billing/*. Webhook endpoint is unauthenticated by design
# (Stripe authenticates itself via the Stripe-Signature header).
app.include_router(billing_router.router, prefix="/api/billing", tags=["Billing"])

# Identity verification (Task #89) — ID.me OAuth start + callback
# under /api/identity-verification/*. Callback is unauthenticated by
# design (ID.me's redirect carries a signed state token instead).
app.include_router(
    idme_router.router,
    prefix="/api/identity-verification",
    tags=["Identity Verification"],
)

# Public stats (Task #70) — small bundle of structural + activity
# counts powering the "CivicView Stats" tiles in the National
# Officials hero. Unauthenticated by design — these are public-facing
# marketing numbers, no PII.
app.include_router(stats_router.router, prefix="/api/stats", tags=["Stats"])
# Device push-token registration (FCM). Service is env-gated on
# FIREBASE_SERVICE_ACCOUNT_JSON — without it, registration still
# works but sends log to stdout (DevPushService).
from app.routers import push as push_router  # noqa: E402
app.include_router(push_router.router, prefix="/api/push", tags=["Push"])
app.include_router(poll_demographics_router.router, prefix="/api/polls", tags=["Polls — Demographics"])


@app.get("/")
async def root():
    return {
        "app": "CivicView API",
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
            "stats_summary": "GET /api/stats/summary",
        },
    }
