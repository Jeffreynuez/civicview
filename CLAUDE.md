# CivicView — project context for new Cowork sessions

This file is auto-loaded by Cowork at the start of every session that
mounts this folder (or its parent). It exists so you can open a new
chat and start working immediately, without me re-explaining the
project, the conventions, or the open work.

## What this is

**CivicView** (civicview.app) — a non-partisan civic-engagement
platform for U.S. citizens, their elected representatives, and
election candidates. Filed as a **Florida Benefit Corporation**
(initial Profit Corp filing processed — CIVICVIEW, INC. ACTIVE,
Sunbiz tracking `#800474911808`; Benefit Corp Amendment filed 2026-06-12,
Task #90 done. EIN obtained; business bank account open).

Sole creator / founder: **Jeffrey De La Nuez**
(`jeffreynuez1@gmail.com`). The project was built with major
assistance from Claude Cowork + Claude Code + Claude Design —
the architecture decisions, product direction, and business
accountability are Jeffrey's; credit lines in the README reflect
both. Don't strip the credit if you touch the README.

## Read these first, in this order

Always read these before doing real work. They cover the persistent
state that this file deliberately does NOT duplicate:

1. **`README.md`** — Project overview, tech stack, what's shipped,
   launch sequencing, engagement permission gates. Its **"Pending
   tasks" table is the canonical open-tasks list** — on session start,
   recreate each open row (plus the launch-sequence items) as a task in
   the Cowork Progress widget (`TaskCreate`) so the open backlog carries
   across sessions. (No separate handoff doc — README + this manifest +
   Pinecone memory are the three sources of truth.)
2. **`frontend/components/HelpBuildThisView.js`** — Canonical
   shipped-vs-blocked list with sourced dollar amounts. Source of
   truth for the public funding ask.
3. **`docs/SECURITY.md`** — Env-var posture + secrets model.
4. **`backend/app/models/pages.py`** — All SQLAlchemy models in one
   file. The shape of the data layer.

## Current state & open work (snapshot 2026-06-16)

Federal + state DATA is largely complete. The README "Shipped this session
— 2026-06-03" block + the Pinecone `default` namespace hold the per-item
narrative. At a glance:

- **Federal issue-data** for all 535 members of Congress + executive branch +
  SCOTUS ("Areas of Focus") + congressional leadership — neutral + sourced
  (`congress_profiles.json`, `federal_officials.json`). Committed/pushed.
- **State legislators + governors + statewide execs** for ALL 50 states
  (`data/<state>/state_officials.json`) — Open States bulk + curated
  governors. Committed/pushed.
- **Live wiring:** state Bills/Votes (Open States, needs `jurisdiction` on the
  /bills sponsor filter), state-legislator AI issue-derivation (Haiku over
  bill titles), FL Supreme Court opinions (CourtListener v4 `docket__court`),
  address→rep (Census + free Divisions OCD-ID bridge).
- **Florida election candidates:** federal rosters + live fundraising via
  OpenFEC (`fec_service.py`); US Senate + all 28 US House races in
  `fl/elections.json`; all FL state candidates have overviews; the 6 Governor
  contenders + AG race fully curated from campaign sites. **These candidate
  files may be UNCOMMITTED — check `git status`** (`fec_service.py`,
  `fl/candidates.json`, `fl/elections.json`).

- **Shipped 2026-06-05:** Poll demographic forms complete (P0–P2: optional
  creator-attached form, aggregate-only explorer w/ k-anonymity MIN_CELL 10 /
  per-poll 25/50/100, charts, CSV, opt-in citizen profile — see README block +
  `docs/polls-demographic-forms-prd.md`); TX/CA/NY/PA candidates generated
  (`build_state_federal_candidates.py`); crowdfunding pivoted to **Indiegogo**
  (final draft + art; publish gated on EIN + business bank); 3 mobile map
  fixes (persistence / first-paint flash / camera re-assert).

**Shipped 2026-06-10:** full standard audit (all 9 test files green — two
repaired: stale official-votes list expectations + tracked-cross-account now
sends X-CSRF-Token); citizen dashboard split into Overview / Account &
settings views; start-page preference (Task #102 — `CitizenAccount.start_page`,
`PUT /api/citizen-auth/me/start-page`, once-per-session redirect, deep links
`/?open=tracked|dashboard|settings`); expanded /stats page (Task #71 DONE —
`/api/stats/detail`, 60s TTL); /polls load-more retry. Second pass same day:
#101 rate limiting DONE (shared limiter + middleware, 30/min engage,
10/10min create); #104 weekly digest DONE (opt-in, Postmark, scheduler
gated on `DIGEST_ENABLED` env — OFF until Jeffrey flips it); #105
tracked-official in-app alerts DONE (`kind='tracked_post'` fan-out);
compare surface gained agreement-rate bar + agree/disagree filters +
50-vote window. #107 CI hardening (CodeQL advanced + Bandit/ruff gate) DONE; #84 native wrap DONE (Capacitor remote-URL scaffold + store runbook; Android org verified on Google Play, app listing next); #103 audit follow-ups DONE 2026-06-12; #106 follow-up batch still pending.

**Shipped 2026-06-16:** Dashboard tracked redesign (Manage Tracked tab +
shared `TrackedManager` + account-synced `featured_tracked` table/endpoints +
four "Followed X" Overview spotlights + "Open in dashboard" button). Profile
About `bio` + current-office `experience` for the executive branch + SCOTUS +
congressional leadership (`federal_officials.json`) and the full FL/TX/CA/NY/PA
U.S. delegations — **171 bios in `congress_profiles.json`** (roster-derived,
chamber-aware + gap-aware "since" year; cited to bioguide). Help-Build "Already
built" list 35→48. **GOOGLE PLAY: app SUBMITTED to Production review (status: In
review)** — Child Safety Standards page (`/child-safety`) published to clear the
CSAE declaration, App access demo login set, US-only, Social; org account exempt
from the 12-tester gate; managed publishing OFF (auto-publishes on approval);
Android developer verification COMPLETE. **Load-time perf (#29) DONE + verified:**
`main.py` Cache-Control middleware on public read-only endpoints + startup cache
warmup. **The API now serves from the Cloudflare-proxied `api.civicview.app`**
(orange, Cache Rule, `NEXT_PUBLIC_API_URL` switched) with verified
`cf-cache-status: HIT` at the Miami edge; auth/personalized routes stay
`DYNAMIC`. Root cause was backend (no caching + cache wiped on each deploy),
NOT Vercel and NOT cold-start (Render is Standard, no sleep). Heavier per-member
disk precompute deferred (not needed). Auth cookies now live on api.civicview.app
(same-site with the app).

**Top open tasks (full list = README "Pending tasks" table — recreate ALL
rows into the Cowork Progress widget on session start): #95 Vote Smart API
(BLOCKED on budget, $4,850/yr quote, draft reply sent), #96 remaining states'
OpenFEC candidate pass (TX/CA/NY/PA done), #97 state judiciary for other
states (CourtListener free tier = 5 req/min), #98 full candidate depth incl.
minor filers (paid — Ballotpedia/BallotReady), #99 local officials
sheriffs/judges/DAs (paid), **#100 AI provider base-URL flag (KIE measured
~72% off Haiku but flag stays OFF until Jeffrey says; user-comment
classification stays on official Anthropic regardless)**. Plus older rows
#91, #94, #26, #49, #95, #96, #97, #98, #99, #100, #106 (done: #29, #71, #84, #90, #92, #93, #101, #102, #103, #104, #105, #107).

**API keys** (all in Render env on `civicview-api` + the Keys file): 
`CONGRESS_API_KEY`, `OPENSTATES_API_KEY`, `COURTLISTENER_TOKEN`,
`OPEN_FEC_API_KEY`, `ANTHROPIC_API_KEY` (+ R2 / Postmark / SESSION_SECRET).
OpenFEC fundraising is a static snapshot — re-run `fec_service` to refresh.

---

## Hard rules (durable across sessions)

These come from how the project is actually run. They override any
generic "default behavior" you might otherwise reach for.

- **Don't push to GitHub on your own.** Commit locally, describe
  what's ready, let Jeffrey decide on the push. He said it
  directly: "I'll be the one that decides to push or not."
- **No unilateral admin delete on user content.** Reports + a
  future threat-detection algorithm are the only paths to taking
  content down. Jeffrey's words: "I should only be able to delete
  polls if someone reports it or if it consists of a threat."
- **Lead with a recommendation when offering options.** Jeffrey
  asked for this explicitly. When using AskUserQuestion, the first
  option should be the recommended one with "(Recommended)" in
  the label.
- **Detailed commit messages.** Structured body (what / why /
  verification / env vars when relevant). ~50-100 lines is normal
  for substantive commits. Co-author trailer on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  (bump the model version when newer ones land).
- **Use AskUserQuestion proactively** before any multi-step work
  where scope is ambiguous. Don't guess; ask once with good
  options and proceed cleanly.
- **Don't propose new features outside the agreed spec.** Bring
  follow-ups as deferred suggestions, not as in-flight scope creep.
- **Don't strip the "Built by" credit** in the README — Claude
  Cowork + Claude Code + Claude Design alongside the founder.

## Engagement permission gates (don't forget these)

These shape every product decision:

- **Browse everything** → free, any visitor
- **Like / dislike posts + polls, vote on polls** → ID.me verified
  citizen
- **Create polls, comment on posts + polls** → ID.me verified +
  $5/mo subscribed

**Demo citizens currently get both grants** (`verified_method='demo'`,
`is_subscribed=True`, `subscription_status='demo'`) so the demo
cohort exercises the full engagement model. Two lines in
`backend/app/routers/auth_citizen.py:demo_signup` are flagged for
removal once real billing + ID.me go live. Don't ship them to
production by accident.

## The "Act as" multi-identity pattern (foundational)

When a viewer is signed in to 2+ identities (citizen + rep + candidate)
in the same browser, every engagement action — comment, vote, like,
dislike, react — routes through an explicit identity picker. The
viewer always knows which identity is acting, the backend records
the action against the right column, and analytics never conflate
self-engagement from different identity tracks.

How it shows up in code:

  • `useActiveIdentities({ isOwner })` (`frontend/lib/activeIdentities.js`)
    returns the list of signed-in identities. `isOwner=false` returns
    just the citizen on a page the viewer doesn't own; `isOwner=true`
    returns all signed-in identities (used on the /polls feed since
    every card is "the viewer's territory").
  • `pickEngagementIdentity({ identities })` returns one of:
      { single: kind }              — only one identity, fire directly
      { showPicker: [...identities] } — 2+ identities, always show picker
      { none: true }                 — no identities, prompt login
  • `IdentityPicker` (`frontend/components/IdentityPicker.js`) is the
    popover. Renders absolutely-positioned under the trigger button;
    click-outside + Esc close it.

How it shows up in the UI:

  • CommentsThread composer: identity badge becomes a dropdown when
    2+ identities are signed in, with "Act as" header. The chosen
    identity rides on every comment via `as_identity`.
  • FeedCard like/dislike: clicking pops the picker; chosen identity
    fires `reactToPost(..., asIdentity)`.
  • FeedCard vote: clicking a poll option pops the picker; chosen
    identity fires `votePoll(...)` (rep polls) or `voteOnCitizenPoll(...)`
    (citizen + standalone polls).
  • Rep page PostCard / PollCard / CitizenPollsSection: same pattern
    via PostingAsPicker (a sibling component) for the composer +
    IdentityPicker for action buttons.

Backend contract: every write endpoint that takes engagement accepts
an optional `as_identity` body field — one of `'citizen' | 'rep' |
'candidate'`. When the viewer is signed in to multiple identities and
the picker hasn't been shown (single-identity path), the backend
resolves identity from the request's bearer tokens / cookies using
citizen → rep → candidate precedence.

If you're adding a new engagement surface (new button, new modal, new
feature), wire it through this pattern. Don't roll a one-off
identity-resolution shortcut.

---

## Reusable shared components (use these, don't fork them)

Three component patterns recur across the app. Adding a new surface
should reach for these first.

- **`FeedCard`** (`frontend/components/polls/FeedCard.js`) — the
  canonical post / poll card used by `/polls`, `/posts`, AND the home
  page's National activity section. Anywhere you need to show a
  "sample of the real feed," wire this up via `fetchPostsFeed({ limit })`
  with a singleton-comments accordion at the section level. Props
  worth knowing: `card`, `kind`, `isCommentsOpen`, `onToggleComments`,
  `signedIn`, `onLoginRequired`, `onCardUpdated` (in-place patch),
  `onMutated` (fallback reload), `citizenViewer`. Don't fork a
  "preview" variant — anonymous viewers fall through to
  `onLoginRequired` for any engagement action; that IS the gate.

- **`PostActionsMenu`** (`frontend/components/PostActionsMenu.js`) —
  three-dot kebab dropdown that consolidates Edit / Delete / Report
  on every post surface. Items array is `{id, label, onClick,
  destructive?, disabled?}`. Trigger renders grayed + disabled when
  items is empty (safety net). Used by both `FeedCard` and `PostCard`
  so the two surfaces stay visually identical.

- **`IdentityPicker`** + **`PostingAsPicker`** — see the "Act as"
  section above. Required for every engagement write surface.

**CSS topology rule:** Component styles co-locate with the component.
Page chrome stays in the page-route stylesheet. FeedCard's styles
live in `frontend/components/polls/FeedCard.css` (imported by
FeedCard.js), NOT in `frontend/app/polls/polls.css`. A component
that silently relies on a page-route stylesheet breaks the moment
it's reused outside that route. When extracting a new shared
component, audit its selectors and pull them into a co-located
`.css` file from the start.

These conventions have Pinecone records in the `default` namespace
(`pattern-reuse-feedcard-on-preview-surfaces-20260528`,
`pattern-css-topology-component-vs-page-chrome-20260528`) for cross-
session continuity.

---

## Cross-session memory via Pinecone (optional layer)

Jeffrey installed a Cowork plugin called **pinecone-memory** that
wires the official `@pinecone-database/mcp` server into every session.
When it's loaded, you'll have `mcp__pinecone__*` tools available —
most importantly `search-records` and `upsert-records` against the
`claude-memory` index (1024-dim, cosine, serverless aws us-east-1,
embedding model `multilingual-e5-large`).

**Pinecone namespace for this project:** `default`. CivicView's ~69
records live in the `default` namespace. (Legacy name preserved
to avoid a full 69-record migration — Pinecone doesn't support
namespace rename in place.) Cross-project records (Jeffrey's
working-style preferences, sandbox-tooling quirks, Pinecone MCP
conventions) live in the `shared` namespace. The pinecone-memory
plugin's SKILL.md (v0.3.0+) instructs sessions to search BOTH
this project's namespace AND `shared` on the first substantive
message, so cross-project lessons surface automatically alongside
CivicView-specific ones.

**Convention** (full version lives in the plugin's SKILL.md, summary
here so this manifest stays self-sufficient):

1. **Start of session, after Jeffrey's first substantive message:**
   `search-records` the `claude-memory` index with the topic of his
   message, `top_k=5`. If anything ≥ 0.70 comes back, briefly mention
   it before answering ("picking up where we left off on X"). If
   nothing relevant, proceed silently — don't narrate empty results.
2. **After substantive work:** `upsert-records` a memory whenever a
   commit lands, a design decision is made, a blocker is identified,
   a user preference is stated, or a non-obvious quirk surfaces. Use
   the metadata shape: `{text, kind, area, date, commit?}` where
   `kind ∈ {decision, fix, preference, quirk, fact, commit, blocker}`.
3. **Don't save:** secrets, raw code (link the commit SHA instead),
   long transcripts, anything Jeffrey says to forget.
4. **CLAUDE.md vs Pinecone:** This file is the authoritative manifest.
   If a Pinecone record contradicts CLAUDE.md, CLAUDE.md wins; the
   stale memory should be overwritten or deleted.

**If the MCP isn't loaded** (plugin not installed in this session,
key rotated, Pinecone down): proceed without it. The plugin is a
recall enhancement, not a hard dependency. The Read-the-handoff-doc
flow above is the baseline; Pinecone augments it.

---

## Sandbox tooling quirks worth knowing

Repeated bites in past sessions; full workarounds live in the `shared`
Pinecone memory records (search "sandbox quirk" / "fuse cache" /
"edit tool"). Headline list:

1. **Recurring `bad signature 0x00000000` git-index corruption.**
   Fix: `rm -f .git/index .git/index.lock && git read-tree HEAD`
   (or `git reset --mixed HEAD` if read-tree errors). Check the
   `shared` Pinecone records for the deeper recipe.
2. **Edit / Write tool silently truncates files — at ANY size.**
   (2026-06-05: bit a 123-line file, not just >600-line ones.) Do
   ALL repo file edits via short Python scripts using the safe
   pattern: write to `<file>.tmp`, assert `os.path.getsize(tmp)`
   is sane, then `os.replace(tmp, file)`. NEVER `open(path,'w')`
   directly on the target — Python truncates the file before
   constructor errors (e.g. a bad `newline=` arg) are raised;
   MapView.js was zeroed exactly this way (recovered via
   `git show HEAD:<path>`). Parse-check (esbuild) after writes.
3. **`git status --short` can return hundreds of phantom
   deletions** when the index is corrupted. Resolve the
   corruption before trusting status.
4. **Stale file snapshots cut BOTH ways.** The Read tool can
   serve a stale cached version after a sandbox-side edit (verify
   with `wc -l + tail` via bash) — and the bash FUSE mount can
   serve a stale snapshot of a file Jeffrey just edited on
   Windows (2026-06-05: the Keys file showed 24 lines in bash
   while the Read tool saw the real 26-line file). If bash and
   Read disagree, trust whichever reflects the expected recent
   change.
5. **This sandbox's git may not read the repo index**
   (`index uses 'l' extension`, written by newer git on Windows):
   `git status` / `diff`-vs-index fail; `git show` / `log` work
   fine. Run index-touching git on Jeffrey's machine; recover
   clobbered files via `git show HEAD:<path> > <path>`.

## Quick facts you'll be asked

- **Production:** Backend on Render Pro ($25/mo), frontend on
  Vercel, Postgres on Render. Cold-start matters: the backend
  sleeps after 15 min and the first request after waking often
  times out. "Failed to fetch" after long inactivity is usually
  cold start, not a real bug.
- **Repo:** `https://github.com/Jeffreynuez/civicview` (PUBLIC —
  made public pre-Indiegogo for transparency; Jeffrey corrected the
  stale 'private' note 2026-06-10. No secrets live in the repo).
  Branch protection on `main`; PR-only workflow. Jeffrey is the
  sole maintainer — GitHub's "Require approval of the most recent
  reviewable push" MUST be OFF or he can't self-merge.
- **Three identities** can coexist in one browser: citizen / rep /
  candidate. Separate cookies + bearer tokens per identity. The
  engagement-write side uses citizen → rep → candidate precedence.
- **Auto-migrate runs on backend boot** (`backend/app/db.py`).
  BOOLEAN NOT NULL columns must use `server_default=expression.false()`
  or Postgres rejects the migration. See the "Failed to fetch"
  incident notes in the handoff.
- **Home page hero stats** are powered by `GET /api/stats/summary`
  (unauthenticated; `backend/app/routers/stats.py`). Returns
  structural constants (Senators=100, Representatives=435, SCOTUS=9)
  plus live `COUNT()`s for `reps_joined` / `verified_citizens` /
  `demo_accounts_created`. The demo-accounts tile retires when
  ID.me ships and `verified_citizens` becomes meaningful.

## File paths in this environment

- Workspace folder: `C:\Users\jeffr\Desktop\US apps\CivicLens`
  (Windows-side, as Jeffrey sees it).
- Sandbox mount: `/sessions/<session-id>/mnt/US apps/CivicLens`
  (bash-side). Never expose `/sessions/...` paths to Jeffrey —
  they look like backend infrastructure and cause confusion.
- Keys + secrets live in `C:\Users\jeffr\Desktop\US apps\Keys\`
  (sibling to the repo, never inside it). Don't read those files
  unless explicitly asked.

---

If you've read this far, you have enough context to ask Jeffrey
what he wants to work on today. Then read the handoff doc + the
specific files relevant to the task before touching anything.
