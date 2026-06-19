# CivicView

A non-partisan civic-engagement web and mobile platform that connects U.S.
citizens with their elected representatives — and gives election candidates
an equal-footing surface for running at the local, state, and federal level.

Beyond connection, the app helps citizens **find** and **track** their
federal, state, and local representatives — including the bills those
representatives sponsor, the votes they cast, the committees they sit on,
the executive orders they sign (when applicable), and the public statements
they make. Representatives and candidates in turn get verified pages where
they can post, run polls, manage events, and engage their constituents
through a moderated, district-scoped channel.

CivicView is filed as a **Florida Benefit Corporation** (initial Profit
Corporation filing on the books — tracking #800474911808; Benefit Corp
Amendment filed 2026-06-12). No ads, no venture capital, no partisan agenda. The
revenue model is a $5/month consumer subscription for engagement features;
browsing is free forever.

---

## Status

**Phase:** Pre-launch. Demo-account preview active at
[civicview.app](https://civicview.app). The verified-account system + paid
subscription flow are scaffolded end-to-end on the backend and frontend
but inert until external accounts (ID.me, Stripe live mode) come online —
gated on the GoFundMe campaign launch. See the **Launch sequence** section
below for the staged rollout plan.

---

## Built by

CivicView is built and maintained by **Jeffrey De La Nuez**
([jeffreynuez1@gmail.com](mailto:jeffreynuez1@gmail.com)) — sole creator,
founder, and owner of the business.

The project was developed with major assistance from **Anthropic's
Claude AI suite**:

- **Claude Cowork** — feature scoping, planning, financial modeling,
  legal-doc drafting (Terms of Service, Privacy Policy, Benefit Corp
  filing language), end-to-end fundraising prep, and most of this README.
- **Claude Code** — backend (FastAPI + SQLAlchemy + Pydantic), frontend
  (Next.js 14 + React 18), service abstractions (Postmark, Stripe, ID.me,
  Cloudflare R2), database auto-migrations, 2FA implementation, and
  cross-cutting refactors.
- **Claude Design** — design system tokens, the interactive U.S. map +
  panel split, the help-build transparency surface, the rep / candidate
  page layouts, identity-picker UX.

The architecture decisions, product direction, content moderation policies,
business structure, and accountability live with the founder. Claude
accelerated the work; it did not own it.

---

## Engagement model + permission gates

CivicView enforces a tiered engagement model. The same person can hold up
to three independent identities concurrently (citizen + verified rep +
verified candidate), each with its own permission scope.

### Citizen tier

| Action | Free / unverified citizen | ID.me verified | ID.me verified + subscribed ($5/mo) |
| --- | :---: | :---: | :---: |
| Browse representatives, bills, votes, executive orders | ✅ | ✅ | ✅ |
| Track reps / bills / elections (receive notifications) | ✅ | ✅ | ✅ |
| Like / dislike posts and polls | — | ✅ | ✅ |
| Vote on polls | — | ✅ | ✅ |
| Create polls (on poll page or unclaimed rep / candidate pages) | — | — | ✅ |
| Comment on posts and polls | — | — | ✅ |

Verification confirms the citizen is a real U.S. person at a real address
(state + congressional district), which is the foundation for the
"verified constituent" claim every engagement carries.

### Representative tier

Sitting elected officials can **claim their auto-generated page** through a
verification flow that uses ID.me identity verification cross-referenced
against the official's government website. Once verified:

- Create posts (text + image)
- Run polls (4 visibility modes — public, district-scoped, party-scoped, supporter-scoped)
- Manage events (town halls, office hours, public appearances)
- Engage on their own page (likes, comments — "Author" badge surfaces page-owner voice)
- Dashboard with engagement analytics
- 2FA required at first login (FORCE_2FA_ENABLED)

### Candidate tier

Declared election candidates get the same surface as reps once
admin-approved (FEC ID / party nomination check today; ID.me-based
self-serve in the future build). Distinct color treatment so candidate
pages don't read as incumbent reps.

When a candidate wins, an admin flow promotes them to rep + archives the
defeated incumbent.

### Multi-identity in one browser

A single human can sign in as citizen + rep + candidate at the same time,
in the same browser. The navbar exposes an **identity dropdown** ("pills")
that lets the user pick which identity engages on any action — comment,
vote, react. Author-badge UI, ✓ markers, and engagement attribution
follow the chosen identity. Three independent cookies + bearer tokens
back this: `cl_session` (rep), `cl_citizen` (citizen), `cl_candidate`
(candidate).

---

## Pre-launch state of verification + subscription

**Today (demo preview):** Self-serve demo citizen accounts are minted via
`/api/citizen-auth/demo-signup`. Demo citizens get:

- `verified=False` (with `verified_method='demo'`)
- `is_subscribed=True` (with `subscription_status='demo'`, `stripe_subscription_id=NULL`)

This lets the demo cohort exercise the full engagement experience (create
polls, comment on posts) end-to-end. The NULL `stripe_subscription_id`
distinguishes demo grants from real paid subscribers when we audit
post-launch. Both grants are flagged for removal in the codebase
(`auth_citizen.demo_signup`) once real billing + verification go live.

**Once ID.me + Stripe are live:** Demo citizens get an opt-in migration
(see the **Identity verification + demo migration plan** section below).
Future signups go through the real verification → optional subscription
flow.

---

## Tech stack

### Backend

- **FastAPI** (Python 3.10–3.14)
- **SQLAlchemy 2.x** + **Pydantic v2**
- **PostgreSQL** in production (Render), **SQLite** in local dev
- **bcrypt** for password hashing, **itsdangerous** for session cookies
- **pyotp** + **cryptography (Fernet)** for TOTP 2FA
- **httpx** for outbound HTTP (federal data, ID.me)
- **boto3** for Cloudflare R2 (S3-compatible)
- **postmarker** for transactional email
- **stripe** for subscription billing
- **anthropic** for AI features (Claude Haiku — bill summaries, vote
  explainers, EO summaries, comment classification, semantic poll filtering)

### Frontend

- **Next.js 14 App Router** + **React 18**
- Vanilla CSS + design-system tokens (no Tailwind compile step
  required — the design system is pre-compiled tokens)
- PWA-ready (manifest + service worker)
- localStorage-backed bearer-token fallback for cross-site-cookie-blocked
  environments (Safari ITP, mobile browsers)

### Infrastructure

- **Render** (web service + Postgres) — production hosting
- **Vercel** — frontend hosting
- **Cloudflare** — DNS, WAF, DDoS protection, rate limiting on `/api/admin/*`
- **Cloudflare R2** — post-image storage (S3-compatible, no egress fees)
- **GitHub** — source, Dependabot, CodeQL, Secret Scanning + Push Protection
- **Domain:** `civicview.app` (apex) + `api.civicview.app` (backend)

### External APIs (live)

- **Anthropic Claude API** (Haiku) — AI summaries + classification
- **Congress.gov API** — federal legislator data
- **Google Civic Information API** — address-to-rep lookup
- **Census Geocoder** — address normalization
- **Postmark** — transactional email (scaffolded, awaiting credentials)
- **Stripe** — subscription billing (scaffolded, awaiting credentials)
- **ID.me** — identity verification (scaffolded, awaiting credentials)
- **Cloudflare R2** — object storage for post images

---

## Service abstractions (env-gated backends)

CivicView uses a consistent pattern for every external dependency: an
**abstract base class** + a **production backend** + a **dev / fallback
backend**. The factory picks based on env vars — when the production
credentials aren't set, the dev backend takes over gracefully so the
backend boots cleanly in any environment.

| Service | Module | Production backend | Dev fallback | Required env vars |
| --- | --- | --- | --- | --- |
| Image storage | `services/image_storage.py` | `R2Storage` | `LocalDiskStorage` | `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET_NAME` |
| Email | `services/email_service.py` | `PostmarkEmailService` | `DevEmailService` (logs to stdout) | `POSTMARK_API_TOKEN` + `POSTMARK_FROM_EMAIL` |
| Billing | `services/stripe_service.py` | `StripeBillingService` | `DevBillingService` (returns about:blank) | `STRIPE_API_KEY` + `STRIPE_PRICE_ID` + `STRIPE_WEBHOOK_SECRET` |
| Identity verification | `services/idme_service.py` | `IdMeService` | `DevIdMeService` (fail-closed) | `IDME_CLIENT_ID` + `IDME_CLIENT_SECRET` + `IDME_REDIRECT_URI` |

All four use **lazy imports** so missing optional dependencies don't crash
boot. All four log loudly when the dev fallback is active so an operator
knows the integration isn't live yet.

---

## Authentication + security

- **Three independent identity tracks** (rep / citizen / candidate) with
  separate cookies and bearer tokens. Same browser can hold all three.
- **Password hashing:** bcrypt 4.x / 5.x directly (passlib dropped due to
  bcrypt-5 compat bug).
- **Session cookies:** httpOnly, SameSite=Lax, signed with itsdangerous +
  `SESSION_SECRET`. Mirror bearer tokens for cross-site-cookie-blocked
  environments.
- **TOTP 2FA** (Task #62): pyotp for codes, Fernet for at-rest secret
  encryption keyed off `SESSION_SECRET` via HKDF. Recovery codes
  bcrypt-hashed. **Enforced** at first login for rep / candidate / admin
  identities when `FORCE_2FA_ENABLED=1` (citizens opt-in).
- **Password reset** (Task #87): single-use sha256-hashed tokens with
  1-hour TTL, sent via Postmark. Anti-enumeration on the request endpoint
  (always 200 regardless of email match). Confirmation email sent after
  successful reset.
- **Self-serve account deletion** (Task #81): soft delete with 30-day
  recovery window OR hard delete (immediate, with cascade). Verified
  identities archive a one-way hash so re-signup at the same email skips
  the ID.me re-charge.
- **Admin moderation:** suspend, hide, cascade-hide on suspension, appeals
  flow with grant/deny + reasoned logging.
- **Cloudflare WAF + DDoS + rate-limiting** on `/api/admin/*`. GitHub
  Dependabot + CodeQL + Secret Scanning + Push Protection on the source repo.
  See `docs/SECURITY.md` + `docs/INCIDENT-RESPONSE.md`.

---

## Repository layout

```
backend/
  app/
    main.py                   # FastAPI app + lifespan startup + router mounts
    db.py                     # SQLAlchemy engine + session + auto-migrate
    auth.py                   # Rep session helpers
    auth_citizen.py           # Citizen session helpers
    auth_candidate.py         # Candidate session helpers
    seed.py                   # Demo accounts + demo backfill helpers
    models/
      pages.py                # ALL SQLAlchemy models (~1.4K lines)
    schemas/
      pages.py                # ALL Pydantic request/response schemas
    routers/                  # FastAPI route modules — one per feature area
      auth.py, auth_citizen.py, auth_candidate.py
      pages.py, citizen_polls.py, feed.py
      billing.py              # Stripe Checkout + Portal + webhook
      identity_verification.py # ID.me OAuth start + callback
      two_factor.py           # TOTP enroll + verify + recovery codes
      admin.py, appeals.py
      congress.py, federal_officials.py, state_officials.py, local_officials.py
      bills.py, votes.py, eos.py, elections.py, candidates.py
      notifications.py, address.py, waitlist.py, ai.py, google_civic.py, events.py, states.py
    services/                 # External-dep abstractions + business logic
      image_storage.py        # R2Storage + LocalDiskStorage
      email_service.py        # PostmarkEmailService + DevEmailService
      stripe_service.py       # StripeBillingService + DevBillingService
      idme_service.py         # IdMeService + DevIdMeService
      password_reset.py       # Token mint/verify/purge
      account_deletion.py     # Soft + hard delete + verification archive
      totp_service.py         # TOTP secret encryption + verification
      totp_enforcement.py     # FORCE_2FA_ENABLED enforcement
      ai_service.py           # Claude wrapper for bill / vote / EO / comment AI
      congress_service.py     # Congress.gov client + photo override layer
  requirements.txt
  data/                       # Curated seed JSON for accounts / candidates / etc.

frontend/
  app/                        # Next.js App Router pages
    page.js                   # Home — interactive map + side panel
    polls/page.js             # Global polls feed
    admin/                    # Admin moderation dashboard
    account/delete/           # Self-serve account deletion
    methodology, editorial-standards, privacy, terms, contact   # About-column footer
    password-reset/           # Password reset (request + confirm modes)
  components/                 # ~50 components — see directory for full list
  lib/                        # API clients (pagesApi.js is the workhorse) + auth hooks
  public/                     # Static assets

docs/
  README.md                   # You are here
  SECURITY.md                 # Security posture, env-var setup, R2 setup
  INCIDENT-RESPONSE.md        # Runbook: compromised admin / DB breach / DDoS / leak
  LEGAL-REVIEW-ROADMAP.md     # Attorney engagement plan ($1.5K-$3K Tier-2 path)
  civicview_financial_model.xlsx  # 5-year P&L driving the $25K GoFundMe goal
  civicview_benefit_corp_filing.pdf  # Sunbiz Amendment language
  identity-model.pdf          # Source-of-truth identity model spec
  gofundme_draft.md           # GoFundMe campaign content (story, FAQ, tiers, share copy)
  build_benefit_corp_pdf.py   # Regenerates the Benefit Corp PDF
  build_identity_model_pdf.py # Regenerates the identity model PDF

Design Exports/               # Reference design-system snapshots (not in app)
DEPLOY.md, SETUP_GUIDE.md     # Production + local-dev runbooks
DESIGN_HANDOFF.md             # Design system handoff doc
render.yaml                   # Render service definition
```

---

## What's shipped (high level)

The canonical, item-by-item list of shipped features lives on the
**[Help build this](https://civicview.app/help-build)** page (source:
`frontend/components/HelpBuildThisView.js`). Maintained as the single
source of truth so the public funding ask and the internal status doc
never drift. As of May 2026 the list runs ~35 entries; high-level
categories:

- **Civic data coverage** — All 50 states + 435 congressional districts;
  full federal coverage (President, VP, Cabinet, SCOTUS, House + Senate
  leadership, all 535 members of Congress with photos); full Florida
  state coverage (state senate + house + statewide execs + 2026
  candidates + election dates); address-to-rep lookup at every level.
- **Bills + votes + executive orders** — Per-bill CRS summary + Haiku
  plain-English translation, "What was this vote?" explainer with AI,
  per-EO Haiku abstract.
- **Engagement surfaces** — Rep pages (posts, polls, comments, reactions,
  4 poll visibility modes, owner dashboard, scope filter), candidate
  pages (parallel composer + dashboard), citizen-led polls on unclaimed
  pages + standalone polls + global /polls feed, three-identity
  engagement model with multi-identity picker. Home page "National
  activity" section renders the same `FeedCard` the `/posts` page uses
  (full likes + comments + edit/delete/report inline), with an
  "All posts →" link to the canonical feed. Every post-action surface
  consolidates Edit / Delete / Report into a single kebab dropdown
  (`PostActionsMenu`) for a uniform look across home, `/posts`,
  `/polls`, and rep / candidate PageView feeds.
- **Identity + auth** — Citizen / rep / candidate auth with separate
  cookies + bearer tokens, 2FA with TOTP + recovery codes (enforced for
  rep / candidate / admin), self-serve account deletion with 30-day
  grace, password reset flow.
- **Moderation + appeals** — Report flow, auto-hide threshold, admin
  queue with Dismiss / Hide / Unhide / Suspend, cascade-hide on
  suspension, citizen + rep appeals with grant/deny.
- **AI features** — Comment sentiment + tone, semantic filter chips,
  post summarization, poll classification, vote explainer — all
  powered by Claude Haiku via `services/ai_service.py`.
- **Notifications** — Email (Postmark, scaffolded) + in-app bell with
  cross-identity inbox.
- **Service scaffolds (inert until env vars set)** — Postmark (Task
  #87), Stripe ($5/mo subscription, hosted Checkout + Customer Portal +
  webhook, Task #88), ID.me OAuth + verification archive cost-skip
  (Task #89), Cloudflare R2 (Task #83).
- **Security** — Cloudflare WAF + DDoS + rate limiting, Dependabot +
  CodeQL + Secret Scanning, daily Postgres backups, documented
  incident-response runbook.
- **Transparency** — Help-build page with line-item funding breakdown,
  5-year financial model in Excel, Benefit Corp formation PDF,
  identity-model spec PDF, full Terms + Privacy + Editorial Standards
  + Methodology + Contact pages. Public `/api/stats/summary` endpoint
  powering the home page hero tiles (Senators / Representatives /
  SCOTUS structural counts + live Reps joined / Verified citizens /
  Demo accounts created), plus a placeholder `/stats` page that an
  expanded analytics surface (engagement curves, growth by state)
  will absorb post-launch.

---

## Shipped this session — 2026-06-16 (Claude Opus 4.8, 1M)

- **Dashboard tracked redesign.** New three-tab dashboard (Overview ·
  **Manage Tracked** · Account & settings). Extracted a shared
  `components/TrackedManager.js` (used by BOTH the My Tracked nav window and
  the Manage Tracked tab — capped/scrolling sections, search, chips, per-item
  alerts, a **star "feature" toggle**, clickable official cards). Overview is
  now four **"Followed X"** spotlights (rep / candidate / election / bill),
  each showing the one pinned item + its latest updates. Featured picks are
  **account-synced** via a new `featured_tracked` table (one row per category,
  UNIQUE constraint) + `GET/PUT /api/tracked/featured` + `lib/featuredTracked.js`.
  My Tracked window gained an "Open in dashboard →" button; subtitle corrected
  to "synced to your account".
- **Profile About + Experience data.** Added neutral, cited `bio` +
  current-office-led `experience` to: the executive branch (President, VP, 15
  Cabinet secretaries), all 9 SCOTUS justices, 13 congressional-leadership
  entries (`federal_officials.json`), and the full U.S. delegations of **FL
  (30), TX (40), CA (54), NY (28), PA (19)** — 171 member bios in
  `congress_profiles.json`. Current role/year is roster-derived with
  **chamber-aware, gap-aware** logic (Schiff "senator since 2024", Sessions
  "since 2021"); prior roles curated + cited to bioguide.congress.gov.
  (The generated candidates.json bios were boilerplate — not reused.)
- **Google Play — SUBMITTED to Production review.** Finished the store
  submission. Created + published a **Child Safety Standards page**
  (`/child-safety` + footer link) to clear the CSAE declaration (the final
  blocker); filled App access (reviewer demo login), US-only, category Social;
  promoted the v1.0 internal bundle to Production. **App status: In review.**
  Org account ⇒ exempt from the 12-tester/14-day closed-test gate; managed
  publishing OFF (auto-publishes on approval). Console: enabled crash/ANR +
  reviews + pre-launch email alerts. "Prevent installs on risky devices" left
  for Jeffrey (needs device-catalog ToS acceptance). Android developer
  verification confirmed COMPLETE.
- **Help-Build "Already built" list: 35 → 48.** Added shipped features that
  had drifted off the public funding page (Bills & Votes, Compare, tracking,
  demographic forms, 2FA, password reset, account deletion, digest, stats…);
  native apps moved to In-progress.
- **Load-time perf (Task #29 — caching shipped + VERIFIED).** Slowness was the
  backend (Render Standard, NOT cold-start) — no HTTP caching, in-memory cache
  wiped on each deploy, ~6-8 live Congress.gov calls per profile. `main.py`:
  response middleware adds `Cache-Control: public, max-age=60, s-maxage=600,
  swr=86400` to public read-only endpoints (auth/personalized excluded) +
  startup background task warms the member directory + committees. Infra: API
  now serves from the **Cloudflare-proxied `api.civicview.app`** with a Cache
  Rule; `NEXT_PUBLIC_API_URL` points there. Verified `cf-cache-status: HIT`
  (Miami edge); `/api/auth/me` correctly `DYNAMIC`. Frontend was already lazy.
  Heavier per-member disk precompute deferred (not needed now).

## Shipped this session — 2026-06-10 (Claude Fable 5, 1M)

- **Full standard audit** (parse / smoke-import / tests / secrets / lint /
  feature review): verdict healthy. Repaired the two failing test files —
  `test_official_votes.py` had stale list-parser expectations from the
  intentional `19e77ca` Senate-bill fix; `test_tracked_cross_account.py`
  predated the CSRF middleware and now derives + sends `X-CSRF-Token`
  exactly like the frontend. All 9 test files green. Lint 73 → 2 findings
  (both intentional E402s). Removed 2 unused imports.
- **Citizen dashboard reorg (Task #102):** split into **Overview**
  (My Reps, Upcoming, Recent, My Polls, Saved) and **Account & settings**
  (2FA, verification, billing, start page, demographic profile, hidden-by-
  moderation) views. Civic content now leads on every viewport — the four
  account sections no longer push My Representatives below the fold on
  mobile. Quick links "Account settings" now goes somewhere real.
- **Start-page preference (Task #102):** citizens choose which surface
  CivicView opens on (Home / Polls / Posts / Bills / Dashboard / Stats).
  `CitizenAccount.start_page` (nullable, auto-migrates) + allowlisted
  `PUT /api/citizen-auth/me/start-page` + StartPageSection in dashboard
  settings + once-per-session redirect in `app/page.js` (explicit URL
  params always win; sessionStorage guard).
- **Expanded /stats page (Task #71 — DONE):** new `GET /api/stats/detail`
  (60s TTL cache, separate from /summary so home stays fast) — identity /
  engagement / content-library counts, 8-week signup + poll-vote trends,
  citizens-by-state. Frontend page rebuilt with loading + error + retry
  states, CSS-only charts, all numbers live or structural (none fabricated).
- **UX fixes from the audit:** `/bills` navbar "Tracked items" + "Dashboard"
  now deep-link via `/?open=tracked|dashboard|settings` instead of dead-
  ending on home; `/polls` infinite scroll failure now shows a tap-to-retry
  button instead of silently ending the feed.
- **Engagement rate limiting (Task #101 — DONE):** shared sliding-window
  limiter (`services/rate_limit.py`) + `EngagementRateLimitMiddleware`
  (30 writes/min on comments/reactions/votes/reports, 10/10min on
  poll/post creation, keyed by session token); demo-signup limiter
  migrated onto the same mechanism (5/24h per IP unchanged).
- **Weekly civic digest (Task #104 — DONE, sending gated):** opt-in
  Saturday email (tracked officials' posts/polls, polls closing, district
  events) via Postmark; `DIGEST_ENABLED` env flag is **OFF until Jeffrey
  flips it in Render**; demo-domain addresses never sent to; preview
  endpoint + Settings card with live preview.
- **Tracked-official alerts (Task #105 — DONE):** `kind='tracked_post'`
  in-app notifications fan out to every tracking citizen when an official
  posts (BackgroundTask, own session); bell renders kind-aware copy.
- **Compare upgrades:** shared roll-call section gained an agreement-rate
  bar ("same way on X of Y — Z%"), All/Agree/Disagree filter chips, and a
  50-vote overlap window (was 25).

## Shipped this session — 2026-06-05 (Claude Opus 4.8, 1M)

- **Optional Poll Demographic Forms — complete (P0+P1+P2).** Poll creators can
  attach an optional standardized demographic form (11 single-select questions;
  sensitive categories flagged + consent-gated). Voters answer optionally
  (replace-on-revote until close). "Explore results" inline explorer with
  geography + demographic filters and a break-down-by cross-tab (inline-SVG
  grouped bar chart) + aggregate CSV export. ALL suppression server-side:
  k-anonymity MIN_CELL=10 with per-poll creator override (25/50/100). Reusable
  opt-in citizen demographic profile (sensitive keys never persisted). New
  models `PollDemographicQuestion` / `PollVoteDemographic` /
  `CitizenDemographicProfile` + `Poll.min_cell_override`;
  `services/demographics_catalog.py` + `services/poll_demographics.py` +
  `routers/poll_demographics.py`; frontend `PollResultsModal` /
  `PollDemographicsPicker` / `PollDemographicsForm` /
  `DemographicProfileSection` wired into every poll surface. Tests green.
  PRD: `docs/polls-demographic-forms-prd.md`.
- **Multi-state election candidates (#96 partial):** TX, CA, NY, PA
  `candidates.json` + `elections.json` generated via
  `backend/scripts/build_state_federal_candidates.py` (config-driven: state
  key dates, closed-primary flags NY/PA, NY ballot measures, Senate-cycle
  gating; federal incumbents enriched from sourced profiles, challengers
  FEC-facts-only). Re-run playbook persisted in Pinecone.
- **Crowdfunding pivoted GoFundMe → Indiegogo.** `docs/indiegogo_draft.md`
  is FINAL (Flexible funding, $25K, 35 days, 4 perks w/ Dec-2026 delivery,
  FAQ, launch checklist, share copy, video script). Financial model gained an
  isolated one-time crowdfunding block (Assumptions rows 68–75: ~8% fees →
  ~$23K net; NOT wired into recurring P&L). Campaign art to Indiegogo spec in
  `../Indiegogo images/` (21:6 text-free cover, square logo thumbnail from the
  official glyph, 4 escalating reward-tier images).
- **Mobile map fixes (3):** open/closed state now persists correctly across
  reloads/navigation (localStorage written ONLY from resizer gestures +
  degenerate-viewport guard, `app/page.js`); desktop-layout first-paint flash
  killed via pre-paint viewport measurement (`lib/useViewport.js`); map camera
  re-asserts its intended target after container resizes settle
  (`intendedCameraRef` + debounced ResizeObserver, `components/MapView.js`).
- **KIE API evaluated → Task #100.** `api.kie.ai/claude/v1/messages` is an
  Anthropic-native drop-in; measured Haiku 4.5 ≈ $0.27/$1.45 per M tokens
  (~72% off) but 2.9–5.6s latency. Decision: build the provider flag, keep it
  OFF; user-comment classification stays on official Anthropic regardless.
- **Benefit Corp paperwork:** cr2e011 Articles of Amendment filled + Exhibit A
  statute citations corrected (§§607.601–607.613) — ready to file once the
  EIN lands. Also fixed the Help-build mobile cost-text overflow.

---

## Shipped this session — 2026-06-03 (Claude Opus 4.8, 1M)

Federal + state DATA layers were committed/pushed earlier this session; the
election-candidate work at the end may still be local — verify `git status`
(uncommitted: `backend/app/services/fec_service.py`, `backend/app/data/fl/candidates.json`,
`backend/app/data/fl/elections.json`).

- **Federal officials — full neutral + sourced issue data.** Every sitting
  member of Congress (both chambers, all 50 states + territory delegates,
  ~538 profiles) now has neutral, sourced `top_issues` in
  `congress_profiles.json`; executive branch, SCOTUS (as neutral "Areas of
  Focus"), and congressional leadership in `federal_officials.json` too.
  Committee auto-fill + sponsored-bill issue-area derivation + fix to the live
  bio/experience derivation (Congress.gov `startYear`/`stateCode` term fields).
  Fabricated/stale seed entries purged; SAMPLE_DATA Rick Scott bioguide fixed
  (S001227 → S001217).
- **State legislators + governors — all 50 states.** Built
  `data/<state>/state_officials.json` for every state from Open States bulk
  data (~7,355 legislators) + statewide executives; all 50 governors curated +
  sourced. Live state-legislator Bills/Votes wired (fixed the OpenStates
  `/bills` sponsor filter needing `jurisdiction`; added `openstates_id`
  fast-path) + a live AI-derived issue-areas endpoint (Haiku over bill titles).
- **Florida Supreme Court via CourtListener** (opinions; fixed the v4
  `docket__court` filter; roster already curated).
- **Address-to-rep / Google Civic.** Confirmed federal/state lookup is fully
  off the retired Representatives API (Census + own data); fixed the
  state-legislative-district layer key; wired the free Divisions OCD-ID bridge
  into `/lookup`.
- **Florida election candidates.** New `fec_service.py` (OpenFEC): 156 FL
  federal candidates added with live fundraising; US Senate + all 28 US House
  district races added to `fl/elections.json`. All FL state candidates given
  overviews; the 6 Governor contenders + AG race fully curated from official
  campaign sites (issues/endorsements/experience/fundraising); withdrawn Josh
  Weil removed.
- **Docs/financials.** `API_Research_Report.html`: added CourtListener +
  IN-USE/PLANNED tags. `/help-build` + financial model: Vote Smart $4,850/yr
  optional add-on + Google Workspace Business Starter $8.40/mo. Gmail draft
  reply to Vote Smart declining the license for now.

## Shipped this session — 2026-05-31 (Claude Opus 4.8, 1M)

Local/uncommitted unless pushed — Jeffrey decides the commits.

- **Bills & Votes feature (new).** Home-page "Bills" section (between Popular
  polls and Browse by state) + interactive `/bills` page: govtrack-style
  selectable seat hemicycle (Senate/House toggle, seat → mini-card → rep
  profile link), recent-vote selector, slate tally bar, inline AI vote
  explainer, deep-linkable vote URLs, and a "View the bill on Congress.gov"
  source link. Reachable via the navbar hamburger as **"Floor Bills"**.
  - Backend: `backend/app/services/official_votes_service.py`
    (House Clerk EVS XML + Senate LIS XML parsers, `lis→bioguide` crosswalk,
    Congress.gov beta House Roll Call API integration, GovTrack fallback,
    caching) + `GET /api/votes/recent` and `GET /api/votes/{vote_id}/members`
    (`backend/app/routers/votes.py`). 51 offline parser assertions in
    `backend/tests/test_official_votes.py`.
  - Frontend: `frontend/app/bills/page.js`, `frontend/components/bills/*`,
    `frontend/app/bills/bills.css`, plus the home section in
    `NationalOfficialsPanel.js` and the navbar entry.
  - Docs: `docs/bills-feature-prd.md`, `docs/bills-feature-design-handoff.md`,
    `docs/bills-data-spike.md` (GO verdict, Congress.gov LIVE-validated).
  - Polish/fixes: slate tally tones (was harsh green/red), full member names in
    the list, small seats to fit state labels, tappable mobile seats, Senate
    chart top-clip fix, visible "Clear" button, mobile footer reorder, House
    vacancy caption (431), Senate menu date year-parse fix, House list
    newest-first ordering.
- **Task #92 — done.** Removed the inert executive/judicial branch chips from
  `frontend/app/polls/page.js` (see Pending table for the deliberate non-changes).
- **Task #93 — increment 1.** Added an `archived` read-only prop to the shared
  `components/polls/CommentsThread.js` (prep for consolidating the 3-way comment
  fork; increments 2 + 3 are scoped in the Pending table).

---

## Shipped this session — 2026-05-28 (Claude Opus 4.8)

Local/uncommitted unless pushed — Jeffrey decides the commits.

- **Task #16 — Save/favorite posts + polls** to a dashboard "Saved" section
  (`SavedItem` model, `/api/saved`, `viewer.is_saved`, Save kebab on cards).
- **Task #41 — Threat/incitement detection, Phase 0 (shadow mode)** — verdicts
  logged, nothing hidden (`docs/threat-detection-prd.md`). Acting on verdicts is
  Task #49.
- Home "Popular polls" → shared `FeedCard` parity; `/polls ?kind=rep`
  candidate-leak fix; comments Edit/Delete/Report consolidated into the kebab
  on all three comment surfaces.
- Feed **cursor pagination + infinite scroll** on rep/candidate pages, `/polls`,
  and `/posts`.
- Map: desktop slider now matches the mobile chunky bar + a reset-view control
  (clicking outside the US also resets the camera).
- Rep profile: Bills tab search + an **AI-search toggle** on Bills + Votes
  (`POST /api/ai/filter-items`, scoped to the loaded set).
- **Non-partisan neutrality** hardening on the bill / EO / vote AI prompts, plus
  a one-time cache reset (`backend/scripts/reset_summary_cache.py`).

---

## In progress

(Mirrored on `/help-build` under the "In progress" section.)

- Remaining state/local content: official photos for state legislators,
  state judiciary for the other 49 states, and LOCAL officials
  (sheriffs/judges/DAs/school boards). State legislators + governors for all
  50 states are now seeded (Open States); federal issue-data is complete.
- Email deliverability hardening (SPF / DKIM / DMARC on `civicview.app`)
- Election-win promotion flow (admin UI surface — backend shipped)
- Crowdfunding launch — **Indiegogo** (final draft + cover/thumbnail/reward art
  ready). EIN obtained, business bank account opened, and Benefit Corp
  Amendment filed (Task #90 done) — campaign is ready to publish. Native
  app store submission underway (Android org verified on Google Play)

---

## Pending tasks (handed off to the next session)

> **Canonical open-tasks list.** On session start, recreate every row below
> (plus the launch-sequence items) as a task in the Cowork **Progress** widget
> so the backlog carries across sessions. (CLAUDE.md instructs this read
> on every session start; Pinecone holds the per-session narrative.)

| # | Task | Status | Notes |
| --- | --- | --- | --- |
| 71 | Build /stats expanded analytics page | done (2026-06-10) | Shipped: `GET /api/stats/detail` (60s in-process TTL cache, separate endpoint so the home hero stays sub-100ms) + rebuilt `frontend/app/stats/page.js` — government-structure constants, identity/engagement/content-library live counts, 8-week signup + poll-vote trend charts (CSS bars, zero-filled buckets), citizens-by-state top-15, explicit loading/error/retry states (no fabricated fallback). Future depth (growth curves beyond 8 weeks, verified-citizen coverage map) can extend the same endpoint. |
| 84 | Wrap web app into iOS + Android native via Capacitor | done (2026-06-12) | Capacitor remote-URL shell scaffold + app-store runbook committed (`9fbbac0`). Android organization account verified on Google Play Console (CivicView org, ID 5150866026642573505); next step is creating the app listing + first build upload. Apple Dev $99/yr + Google Play $25 paid. **2026-06-16:** app SUBMITTED to Google Play **Production review** (status: In review); Child Safety Standards page (`/child-safety`) published to clear the CSAE declaration; Android developer verification confirmed complete. |
| 90 | File Articles of Amendment for Benefit Corp status | done (2026-06-12) | Filed with Sunbiz. Initial Profit Corp filing (#800474911808) processed — CIVICVIEW, INC. is ACTIVE; cr2e011 Articles of Amendment (Exhibit A statute cites §§607.601–607.613) filed. Language in `docs/civicview_benefit_corp_filing.pdf`. |
| 91 | Evaluate Vercel AI Gateway for backend AI calls | pending | Post-launch / deferred. Not urgent: current AI (comment classification + post summaries in `backend/app/services/ai_service.py`) is single-provider Anthropic and already degrades gracefully. The Gateway's OpenAI-compatible endpoint makes adoption a `base_url` + key swap in `ai_service.py` (no SDK rewrite). Adopt when AI spend warrants cost/usage dashboards, when provider failover matters, or to mix models (cheap classification + stronger summaries). Pricing: $5/mo free credit, then provider list prices at zero markup (BYOK also no markup). Caveat: routing the summarize flow through the OpenAI-compatible shim instead of the native Anthropic SDK can change system-prompt / citations / prompt-caching behavior — re-test that one flow before switching. |
| 92 | Trim /polls + /posts filter cruft (audit follow-up) | done (2026-05-31) | Removed the inert `executive` + `judicial` branch chips from `BRANCH_FILTERS` + `branchCounts` in `frontend/app/polls/page.js` (backend only emits `branch` for Congress reps, so those chips always counted ~0). Deliberately LEFT the `pollBranch`/`branchCounts`/`branchFiltered` pipeline and the client-side state re-filter (~lines 313-319) intact — the original audit overreached: the re-filter guards a real refetch race, not dead work. Original audit 2026-05-28. |
| 93 | Unify forked comment rendering onto CommentsThread | done (2026-06-04) | Three independent comment implementations: shared `components/polls/CommentsThread.js` (feed thread — /polls, /posts, home), `components/PostCard.js` (own `renderCommentRow` ~1406-1822, rep/candidate page posts, HAS an edit path), and `components/CitizenPollsSection.js` (own local `CommentsThread` function ~903-1637 mounted ~824, citizen polls, NO edit path, uses `archived` to lock closed polls). Goal: collapse onto the shared component (the only one that's production-proven for both `post` and `poll` modes). **Increment 1 — DONE 2026-05-31:** added an `archived` (read-only) prop to the shared `CommentsThread` (closed poll → composer replaced with a "closed to new comments" note + Reply control hidden; existing edit/delete/report untouched). esbuild-verified. The missing capability that blocked consolidation. **Increment 2 — TODO (CitizenPollsSection, do first, smaller):** `import CommentsThread from './polls/CommentsThread'`; delete the local `CommentsThread` function (~903-1637) + its `renderCommentRow` + comment state/handlers; mount with `mode="poll" pollId signedIn={!!citizen\|\|isOwner} onLoginRequired={onCitizenLoginRequired} ownerOfficialId ownerKind archived={archived}`. Drop the old `pollAuthorId`/`citizen` props — the shared component infers the viewer internally and gates replies via comment authorship + `ownerOfficialId`. **Increment 3 — TODO (PostCard, bigger):** replace the inline `renderCommentRow` (~1406-1822) + render block + comment handlers (`loadComments`/edit/delete/report/react) with `<CommentsThread mode="post" postId signedIn onLoginRequired onMutated={onCommentCountChanged} ownerOfficialId={post.official_id} ownerKind />`; the shared component already covers edit + AI filter + feed-count sync on /posts. Do each increment as its OWN commit and **runtime-test on the dev server** (reply two-party gate, archived lock, feed-count pill) — these paths are not statically verifiable. Mount caveat: after a host-side edit, esbuild lags ~seconds-to-minutes (virtiofs cache, anthropics/claude-code#50873) — wait a beat before verifying, or restart the session for a fresh mount. |
| 94 | Threat-detection v2 enhancements (post-v1) | pending | Deferred follow-ups from the threat-detection PRD (`docs/threat-detection-prd.md` §14): image/media moderation; multi-language support; repeat-offender escalation to auto-suspend; embeddings-based near-duplicate threat detection; user-facing "why was this flagged" explanations; and an optional synchronous block-on-submit path for the worst, highest-confidence cases. Revisit after the v1 flag→review pipeline (Task #41) is live and tuned. |
| 25 | Fill out remaining states' content | in progress | DONE: federal issue-data for all 535 members of Congress + exec + SCOTUS + leadership; state legislators + governors + statewide execs for all 50 states (Open States); FL state judiciary (CourtListener opinions) + FL federal/state election candidates. REMAINING: official photos for state legislators; state judiciary rosters for the other 49 states (CourtListener, 5 req/min free-tier limit — see #97); LOCAL officials (sheriffs/judges/DAs/school boards — paid, see #99). **2026-06-16:** added About `bio` + current-office `experience` for the executive branch, SCOTUS, congressional leadership, and the full FL/TX/CA/NY/PA U.S. delegations (171 bios in `congress_profiles.json`). |
| 26 | Start DMARC monitoring (SPF merge done) | in progress | Email deliverability on `civicview.app`. **SPF merge DONE (2026-06-04):** the duplicate SPF TXT records were merged into a single `v=spf1 … -all` (RFC 7208 requires exactly one; multiple caused a PermError). **REMAINING:** publish a DMARC record in monitoring mode — a `_dmarc.civicview.app` TXT record with `p=none` + `rua=mailto:` aggregate-report mailbox — to watch SPF/DKIM alignment before tightening to quarantine/reject. DKIM already in place. |
| 95 | Vote Smart API — stated issue positions | blocked (budget) | Quoted 2026-06 at $4,850/yr for the Public-Facing Platform License (dev tiers $350/mo, $1k/3mo, $1.9k/6mo, non-public only). Draft reply sent declining for now. When funded: env-gated `votesmart_service.py` (abstract+prod+dev like idme/stripe), bioguide→candidateId crosswalk, map NPAT positions to a sourced stated-positions field. ToS HARD RULE: data may NOT be used in campaign activity → only on official/rep profiles, never candidate campaign surfaces. Coverage partial. |
| 96 | OpenFEC federal candidates for other big states | in progress | TX, CA, NY, PA DONE (2026-06-05) via `backend/scripts/build_state_federal_candidates.py` (config-driven generator; re-run playbook in Pinecone — search "state federal candidates playbook"). REMAINING: the other 45 states. Caveat: OpenFEC reflects active FEC committees, not ballot qualification → includes some withdrawn/non-qualifying filers (verify vs state). Fundraising is a static snapshot (re-run to refresh) — optional: build a live refresh endpoint. |
| 97 | State judiciary (CourtListener) for other states | pending | FL done (supreme-court opinions via `state_live.py`, `docket__court` filter). Populate `judiciary.supreme_court` rosters per state via the People API. Caveat: CourtListener free tier = 5 requests/MINUTE → bulk needs a Free Law Project membership. Trial/county judges + DAs remain a paid (Ballotpedia) gap. |
| 98 | Full candidate depth (state/local + minor filers) | pending (paid) | Campaign-site curation done for FL Governor + AG CONTENDERS only. The long tail of minor filers, all state-leg/local candidate slates, and endorsements have no free source → Ballotpedia/BallotReady subscription, or per-race manual curation on request. State candidates also have no fundraising (FEC is federal-only; FL campaign finance is at the FL Division of Elections, not integrated). |
| 99 | Local officials (sheriffs/judges/DAs/school boards) | pending (paid) | No comprehensive free source. Cicero or Ballotpedia (paid). The free Google Divisions OCD-ID bridge is already wired into `/api/address/lookup` (`ocdDivisions`) as the join key for whatever local source is chosen. |
| 100 | AI provider base-URL abstraction (KIE flag — OFF) | pending — flag stays OFF until Jeffrey says | Env-gate the Anthropic base URL in `backend/app/services/ai_service.py`: `AI_PROVIDER=official\|kie` (+ optional `ANTHROPIC_BASE_URL` override), default **official**. KIE verified 2026-06-05: `https://api.kie.ai/claude/v1/messages` is an Anthropic-native drop-in (same Messages shape incl. cache fields, resolves `claude-haiku-4-5`); measured Haiku ≈ $0.27/M in, $1.45/M out (~72% off official $1/$5; credits round to 2dp so ±10%); latency 2.9–5.6s on small calls → suitable for the cached precompute pipeline only, never interactive. HARD RULE: user-comment classification stays on official Anthropic regardless (privacy commitments). Also evaluate the official **Batch API** (50% off, zero middleman) as the default cost lever for precompute. Key: "KIE API Key" at the bottom of the Keys file. Review KIE's data-retention/DPA terms before any production flip. |
| 49 | Threat detection Phase 1+ — act on verdicts | pending | Phase 0 (shadow mode) is live (verdicts logged, nothing hidden). Phase 1+: build a labeled eval set; implement `moderation_service._apply_decision` (set `hide_reason='threat_hidden'` on auto_hide) + surface flag/auto_hide verdicts in the admin queue; wire the self-harm resources flow; then flip `moderation_policy.SHADOW_MODE` off for Phase 2 (doxxing + credible_threat only) AFTER attorney review of the policy (`docs/LEGAL-REVIEW-ROADMAP.md`). See `docs/threat-detection-prd.md` §11. |
| 101 | Rate-limit engagement writes (comments / reactions / votes) | done (2026-06-10) | Shipped: `services/rate_limit.py` (shared sliding-window, exact trailing window, Retry-After) + `middleware/rate_limit.py` (ENGAGE 30/60s on comments/reactions/votes/reports, CREATE 10/10min on poll+post creation, keyed by session token, IP fallback; 429 `code='rate_limited'`). Demo-signup limiter migrated to the same service (5/24h per IP unchanged). In-process — exact on the single Render worker; revisit Redis-backed buckets only if we scale workers. |
| 102 | Citizen dashboard Overview/Settings split + start-page preference | done (2026-06-10) | Dashboard split into Overview (civic content) + Account & settings views; new `CitizenAccount.start_page` + `PUT /api/citizen-auth/me/start-page` (allowlist: home/polls/posts/bills/dashboard/stats) + StartPageSection + once-per-session redirect in `app/page.js`. Deep links: `/?open=tracked\|dashboard\|settings`. Reps/candidates can get the same preference later if it earns its keep. |
| 103 | Audit follow-ups 2026-06-10 (verify + fix batch) | done (2026-06-12) | Completed 2026-06-12 (verify-and-fix pass over all four items). Original scope from the backend audit agent: (a) poll auto-supersede race under concurrent creates can exceed the 20-poll cap; (b) comment most-liked/disliked sort runs in Python — push into SQL; (c) confirm whether the posts feed omits candidate-authored posts (flagged, unverified); (d) `browseReps` in the dashboard only closes the overlay — consider scrolling to the officials panel. |
| 104 | Weekly civic digest email | done (2026-06-10) — **sending gated on `DIGEST_ENABLED`** | Opt-in (`CitizenAccount.digest_opt_in`, default OFF) Saturday-9am-ET email: tracked officials' posts/polls this week, polls closing ≤7d, district events ≤14d. Empty digest = no send; demo-domain emails never sent; per-citizen `digest_last_sent_at` idempotency. In-process scheduler in `main.py` lifespan — set `DIGEST_ENABLED=true` in Render env to turn on. Preview: `GET /api/citizen-auth/me/digest/preview` + Settings card. |
| 105 | Tracked-official in-app alerts | done (2026-06-10) | `emit_tracked_content_notifications` fans `kind='tracked_post'` rows to all tracking citizens when an official posts (BackgroundTask + own session, zero poster latency). Bell renders kind-aware copy. Email stays consolidated in the digest (#104). |
| 106 | Notifications/digest follow-ups (deferred) | pending | (a) poll-close alerts — the #104 scheduler can host a daily pass; (b) per-item deep links in digest emails (post/poll URLs, not just the app link); (c) instant-email alert opt-in per alert type + unsubscribe handling; (d) compare share URLs (`/compare?a=…&b=…`); (e) bell deep-link improvement beyond `open_page` + hash (noted in NotificationBellMenu). |
| 107 | CI hardening — CodeQL advanced + Bandit/ruff gate | done (2026-06-10) | CodeQL advanced setup + Bandit/ruff security gate added to CI; fixed the upload-permission failure (`9534fe8`). |
| 29 | Congress data load-time / caching pass | done caching (2026-06-16) | Edge caching live + VERIFIED (`cf-cache-status: HIT`). `backend/app/main.py` Cache-Control middleware on public read-only endpoints + startup cache warmup; API served from Cloudflare-proxied **api.civicview.app** + a Cache Rule; `NEXT_PUBLIC_API_URL` switched. Deferred (optional, not currently needed): full per-member disk precompute of detail/bills/votes; frontend skeletons/prefetch. |

**Closed:** Task #58 (Add financial-model link to /help-build) — won't ship as a public link. The `docs/civicview_financial_model.xlsx` is already in the public GitHub repo for anyone who wants to audit the math; shared on request rather than surfaced as a download on the campaign or app surfaces.

---

## Launch sequence

See `docs/gofundme_draft.md` for the full launch playbook with copy-paste
share text + GoFundMe story + perk tiers + FAQ. High-level:

**Phase 1 — free / cheap pre-work (do now):**
- Postmark account + Server API token
- ✓ EIN application at IRS.gov — obtained (interim notice; official CP 575 arriving by mail ~mid-June 2026)
- ✓ Stripe in test mode — done (no EIN required — full subscription flow works
  with test card `4242 4242 4242 4242`)

**Phase 2 — corporate + banking (1-2 weeks):**
- ✓ Sunbiz processed the initial Profit Corp filing — CIVICVIEW, INC. active
- ✓ File Benefit Corp Amendment (Task #90) — filed 2026-06-12
- ✓ Open business bank account — done (Mercury / Relay / Novo — 1-3 day approvals)

**Phase 3 — launch the GoFundMe** ($25K goal):
- Demo citizen system launches simultaneously so visitors can experience
  the full engagement model immediately (verified-quality features
  unlocked via demo grants — no waiting on ID.me)

**Phase 4 — deploy GoFundMe proceeds in priority order:**
1. First $2,400 → ID.me Relying Party application (the application
   itself requires the $2,400 setup fee upfront — campaign funds it)
2. Next $1,050 → USPTO trademark filing (classes 9 / 42 / 45)
3. Stripe live mode activation (after EIN + bank land)
4. Attorney review of ToS + Privacy Policy ($1.5K-$3K via Tier-2 solo
   attorney — see `docs/LEGAL-REVIEW-ROADMAP.md`)
5. ProPublica + OpenStates Pro API subscriptions ($600/mo combined)
6. Remainder → Year-2 operating buffer

**Phase 5 — transition demo cohort to verified accounts:**
- Once ID.me is live, demo users get an opt-in "Verify my identity"
  CTA. See the **Identity verification + demo migration plan** section
  below for the carry-over-vs-start-fresh policy.

---

## Identity verification + demo migration plan

The current build runs entirely on self-serve demo citizen accounts.
Real verified citizen accounts ship once the ID.me Relying Party
contract is funded.

**When ID.me ships, demo users get an opt-in migration:**

1. Demo user hits the new "Verify my identity" CTA (in the citizen
   dashboard or on any engagement surface that prompts for verification).
2. ID.me's flow runs in a popup / redirect. On success, ID.me returns a
   verified identity claim (legal name, address, etc.).
3. The CivicView frontend detects the demo session and presents a
   one-time choice:
   - **Keep my demo activity** — polls, votes, comments, and tracked
     reps carry over. The existing `CitizenAccount` row is updated in
     place (verified=True, display name + city + district reconciled
     against ID.me), and engagement surfaces stop labeling the user
     "Unverified."
   - **Start fresh** — the demo account is archived and a new verified
     `CitizenAccount` is created. Old polls / comments keep their
     original demo authorship attribution (no identity laundering);
     votes are wiped to avoid skewing historical poll results.
4. Default the toggle to "Start fresh" so accidental migration doesn't
   preserve abuse, but make "Keep" a one-click option so legitimate
   early users keep their work.

**Why opt-in, not forced:**
Full migration is bad because demo accounts are self-serve and not
identity-verified — forcing migration would attach real verified
identities to whatever the demo account did. Full reset is bad because
legitimate early users (your TikTok-live early adopters, friends who
tested) lose their engagement history just for upgrading. Opt-in with a
sensible default threads the needle.

**Implementation note for the cutover:**
- New endpoint `POST /api/citizen-auth/verify-and-merge` accepts the
  ID.me identity claim + a `keep_demo_data: bool` flag.
- Either updates `verified=True` on the existing row and reconciles
  display/geo fields, or archives the old row and creates a fresh one.
- A migration service function handles FK reassignment if we ever
  decide to migrate authorship attribution too (right now, archived old
  rows preserve attribution as-is).

---

## Future product features

Captured for a future release — not in scope for current launch.

- **Video posts on rep / candidate pages** — verified reps + candidates
  attach video to posts (not just text + images). Needs transcoding
  pipeline (Mux or Cloudflare Stream), size cap, moderation queue tied
  into existing takedown / DMCA flow.
- **Live-streamed town halls** — first-class "Live" affordance: rep /
  candidate goes live, citizens get push notification (PWA stack
  already in place), stream archives back into post feed. Pairs with
  comment thread for live Q&A.
- **1-on-1 live debates between reps / candidates** — request / accept
  flow where one official can challenge another to a scheduled debate.
  Surfaced on both pages + on the On-the-ballot home section while
  live. Same streaming + archival infra as town halls; the new piece
  is the invitation / scheduling state machine.
- **Optional citizen nicknames** — verified citizen picks a display
  nickname instead of their legal name on public surfaces. Verification
  still tied to real name + address (vote integrity + district scoping
  + abuse moderation preserved), but what the community sees is the
  user's choice. Pairs with a small "verified citizen" pill so a
  nickname reads as "verified, just doesn't want to publish their
  legal name."

---

## IP / legal roadmap

Tracked here so it stays visible across sessions:

- **Federal trademark filing for CivicView** — three classes (9, 42,
  45) at ~$350/class via USPTO TEAS Standard. Deferred until budget
  allows (Phase 4 of the launch sequence).
- **Copyright registration with the US Copyright Office** — $45-85 via
  the eCO portal. Deposit is first 25 + last 25 pages of source code.
  Worth doing once the codebase stabilizes after the next round of
  features.
- **DMCA agent registration** — $6 every 3 years at
  [dmca.copyright.gov](https://dmca.copyright.gov). Required for §512
  safe-harbor on user-generated content. Pair with a clearly-posted
  takedown contact on the site.
- **Florida Benefit Corp Amendment** — Task #90 above; Articles
  language in `docs/civicview_benefit_corp_filing.pdf`.
- **Attorney review of ToS + Privacy Policy** — $1.5K-$3K Tier-2 path
  per `docs/LEGAL-REVIEW-ROADMAP.md`. Required before holding real
  subscription funds.
- **Open-source carve-outs** — if any subset of CivicView ever ships as
  an OSS library (e.g. design tokens or district-geometry helpers),
  spin into a separate repo with an OSS license rather than
  dual-licensing the monorepo.

---

## Quick start

- **Local dev:** [`SETUP_GUIDE.md`](./SETUP_GUIDE.md) — run frontend +
  backend locally, test on a real phone via Wi-Fi or Tailscale.
- **Production deploy:** [`DEPLOY.md`](./DEPLOY.md) — Vercel + Render +
  Cloudflare DNS end-to-end walkthrough.
- **Security setup:** [`docs/SECURITY.md`](./docs/SECURITY.md) — env-var
  inventory, R2 / Postmark / Stripe / ID.me configuration.
- **Email deliverability:** [`docs/EMAIL-DELIVERABILITY.md`](./docs/EMAIL-DELIVERABILITY.md)
  — SPF / DKIM / DMARC setup for Postmark + Resend on Cloudflare DNS.
- **Incident response:** [`docs/INCIDENT-RESPONSE.md`](./docs/INCIDENT-RESPONSE.md)
  — runbook for compromised admin, DB breach, DDoS, credential leak.
- **Fundraising:** [`docs/gofundme_draft.md`](./docs/gofundme_draft.md)
  — full GoFundMe campaign package (story, FAQ, tiers, share copy,
  launch checklist).

---

## License

CivicView is **proprietary software**. All source code, designs,
content, and assets are © 2026 Jeffrey De La Nuez. All rights reserved.

No part of this repository may be copied, modified, distributed, or
otherwise used without the express written permission of the copyright
holder. See [`LICENSE`](./LICENSE) for full terms.

For licensing inquiries: jeffreynuez1@gmail.com
