# Handoff to next Cowork session

**Date last updated:** May 23, 2026 (was May 21 — extended after a long
session that landed the /polls + /posts dual-feed redesign across four
stacked PRs).
**Previous session length:** Very long (multi-week continuation across
several context windows). Starting fresh in a new chat to avoid memory
degradation.

---

## How to use this file

Open a new Cowork chat with the same `US apps` folder mounted, then paste
the **"Bootstrap prompt"** section below as your first message. Claude will
read this file + the README + the financial model + the codebase as needed.

---

## Bootstrap prompt (paste this verbatim into the new chat)

> Hi Claude — I'm Jeffrey, sole creator/founder of **CivicView**
> (civicview.app), a non-partisan civic-engagement platform for U.S.
> citizens + their elected representatives + election candidates.
>
> This chat continues from a long prior session. I need you to come up
> to speed before doing any real work.
>
> **First, read these three files in this order so you have full context:**
>
> 1. `README.md` — what the project is, tech stack, what's shipped, pending
>    tasks, launch sequencing, and the engagement permission gates.
> 2. `docs/HANDOFF_TO_NEXT_SESSION.md` — this file. Open work, current
>    git state, in-flight launch sequence, important caveats.
> 3. `docs/gofundme_draft.md` — full GoFundMe campaign content (story,
>    FAQ, perk tiers, share copy, launch checklist).
>
> **Then skim:**
> - `frontend/components/HelpBuildThisView.js` — the canonical list of
>   what's shipped vs. what's blocked on funding, with sourced dollar
>   amounts. This is the single source of truth for the public funding
>   ask, so it never drifts from reality.
> - `docs/civicview_financial_model.xlsx` — 5-year P&L that drives the
>   $25K GoFundMe goal. (Use the xlsx skill if you need to read it.)
> - `docs/LEGAL-REVIEW-ROADMAP.md` — attorney engagement plan.
>
> **Key facts to internalize:**
> - I'm the sole creator and founder. The project was built with major
>   assistance from Claude Cowork + Claude Code + Claude Design — credit
>   where it's due, but the architecture decisions, product direction,
>   and business accountability are mine.
> - The app is filed as a **Florida Benefit Corporation** (initial Profit
>   Corp filing on the books, tracking #800474911808; Benefit Corp
>   Amendment is pending — Task #90).
> - Three identity tracks (citizen / verified rep / candidate). Same
>   person can hold all three concurrently in one browser. Engagement
>   permissions are gated:
>     - **Browse everything** = free, any visitor
>     - **Like / dislike posts + polls, vote on polls** = ID.me verified citizen
>     - **Create polls, comment on posts + polls** = ID.me verified +
>       $5/mo subscribed
> - Real ID.me + Stripe live mode are scaffolded but inert until
>   external accounts come online. **Demo citizens currently get both
>   grants** (`verified_method='demo'`, `is_subscribed=True`,
>   `subscription_status='demo'`) so the demo cohort can exercise the
>   full engagement model end-to-end.
> - **Launch sequence is GoFundMe-first**: ID.me requires $2,400 upfront
>   to apply for the Relying Party contract, and that money comes from
>   the GoFundMe. Until ID.me is funded, the demo grants stand in.
>
> **Open tasks** (#84 + #90 pending; #58 closed):
> - **#58 — CLOSED.** Won't ship as a public link. The xlsx is already in
>   the public GitHub repo at `docs/civicview_financial_model.xlsx`;
>   shared on request rather than surfaced as a download on the campaign
>   or app surfaces.
> - **#84** — Wrap the web app into iOS + Android native via Capacitor.
>   Apple Dev $99/yr + Google Play $25 one-time; ~2-4 weeks for first
>   submission. Revenue-share math is already in the financial model
>   (15% on first $1M/yr per store under each platform's Small Business
>   Program).
> - **#90** — File Articles of Amendment for Benefit Corp status with
>   Sunbiz. Waits for the initial Profit Corp filing to process.
>   Article language is in `docs/civicview_benefit_corp_filing.pdf` —
>   paste verbatim into Sunbiz's "Other Articles / Optional Provisions"
>   text area on the Amendment filing.
>
> **In-flight launch tasks** (not in the numbered task list yet — these
> are the next concrete things to do, in order):
> 1. Postmark — sign up, create Server, grab API token + verify sender
>    (~10 min, free, no EIN required)
> 2. EIN — apply at IRS.gov (~10 min if you have SSN)
> 3. Stripe in test mode — create Product + $5/mo Price + webhook
>    endpoint, grab test keys (~30 min, no EIN required for test mode)
> 4. Open business bank account once EIN lands (Mercury / Relay / Novo)
> 5. File Benefit Corp Amendment (Task #90)
> 6. Launch GoFundMe (after bank account + Amendment land)
> 7. Once GoFundMe crosses $2,400, apply to ID.me. Worth a phone call
>    to ID.me's sales contact before committing — civic-tech / pre-revenue
>    Benefit Corps sometimes get reduced or staged pricing.
> 8. Attorney review of ToS + Privacy Policy ($1.5K-$3K Tier-2 path)
> 9. Stripe live mode + ProPublica + OpenStates Pro
>
> **Today's specific question / first task**: [REPLACE THIS LINE WITH
> WHATEVER YOU WANT TO DO IN THIS NEW CHAT]
>
> Acknowledge you've read all of the above, then ask me any clarifying
> questions before acting. Don't restart context from scratch — pick up
> where the prior session left off.

---

## What landed between May 21 and May 23, 2026

Two days of dense work in a single Cowork session. Headline outcome: the
whole **/polls + /posts dual-feed redesign** is committed locally across
four stacked feature branches, all off `main`, none pushed yet.

### Major workstreams completed

- **Cross-account tracked-items + notifications fix** (Tasks #17-22).
  Tracked bills / officials / elections used to live in singleton
  localStorage keys and leaked between citizen accounts on logout/login.
  Moved to server-side per-identity storage with a polymorphic
  `(tracker_kind, tracker_id)` ownership pattern (matches the existing
  Notification model). NotificationBellMenu now re-fetches on identity
  switch. A `LegacyStorageCleanup` component wipes the old localStorage
  keys once per browser. Integration test at
  `backend/tests/test_tracked_cross_account.py` (8 phases, all passing).

- **Branching setup** (Task #19). Branch protection on `main`,
  CONTRIBUTING.md added, PR-only workflow documented. Important
  foot-gun: GitHub's "Require approval of the most recent reviewable
  push" must be OFF for a sole-maintainer setup or you can't self-merge
  your own PRs. Documented in CONTRIBUTING.

- **Logo refresh** (Task #15). New "magnifying lens viewing US flag"
  design replaced the old CivicLens logo. Repo-wide rename CivicLens to
  CivicView (paths, imports, references). Old `civiclens-*` SVG files
  retired.

- **Repo-wide name change** (Task #11). Jeffrey Nuez to **Jeffrey De La
  Nuez** (legal name). README, HANDOFF, gofundme_draft, PDF author
  metadata, code copyright headers — all corrected. The first commit
  in this session.

- **Lucide migration, then reverted** (Tasks #27-36). Tried to replace
  hand-rolled inline SVG icons with `lucide-react@0.460.0`. The
  migration shipped a Phase-2 bug that broke rep pages
  (`MessageSquareText is not defined`), uncovered an unrelated
  `CheckCircle` reference in ConstituentDashboard, and triggered a
  cascade of preview-deploy failures. Reverted entirely via
  `git checkout a01d460 -- frontend/` (kept the logo refresh).
  **Lessons:** sucrase parse + JSX-only grep are NOT enough — JS-context
  identifier references slip through. For any future icon-library swap,
  do an identifier-occurrence audit or a real `next build` before
  declaring done.

- **Standalone poll interactivity on /polls** (Task #40, PR #26
  merged to main). Standalone citizen polls are now votable from the
  /polls feed for any signed-in citizen, and their authors get a
  "Close poll" pill in the footer. Backend feed enriched with
  `viewer.voter_choice_id` + `viewer.is_author` per item.

- **/polls + /posts dual-feed redesign** (Task #42 — four stacked PRs
  committed locally, see below).

### Four-PR redesign sequence — local branch state

All four branches are stacked off `main` (PR #1 to PR #2 to PR #3 to PR #4).
The first commit in PR #1 was the brief at
`docs/polls-page-redesign-brief.md`, which has been merged to main.

| Branch | Commit(s) | Scope |
| --- | --- | --- |
| `feat/polls-redesign-pr1-feed-backend` | `929469b` | Backend — multi-kind + state filter on `/api/feed/polls`, new `/api/feed/posts` endpoint, cross-link fields (`parent_post_id`, `attached_poll_id`, `has_attached_poll`), 13-phase integration test |
| `feat/polls-redesign-pr2-polls-tab` | `5afdb04` + `9243bdb` | Frontend — new `FeedCard`, `CommentsThread`, `StateDropdown`, `BranchChip` components; Bill to States / Committee to Congress rename; additive multi-select chips; states dropdown with scroll-fade; inline accordion thread; standalone-poll close X |
| `feat/polls-redesign-pr3-posts-tab` | `3ad2c66` | Frontend — `/posts` route, `TabStrip` segmented control with URL-pushed routing, `TabContent` slide-fade, post variant of FeedCard, drop Standalone chip on posts tab |
| `feat/polls-redesign-pr4-polish` | `366a4e5` | Multi-identity picker in `CommentsThread`, delete 225 lines of dead inline PollCard from `/polls/page.js` |

Net code change across the four PRs: **~3,000 lines added, ~225 dead
lines removed.** All sucrase-clean. Backend tests pass.

**To land them**: push each branch, open as a PR, merge in order
(PR #1 first, then rebase each subsequent branch onto the new main).
Until they're merged, `/polls` on production still shows the old
PollCard layout.

### Design exports referenced by the engineering work

`Design Exports/civicview-polls-page/project/` contains the round-2
Claude Design export (committed on main via PR #28). The HTML preview
in that folder is the visual reference for the redesign. Don't strip
that folder if pruning; engineering PRs cite it.

### Documentation deltas

- New: `docs/polls-page-redesign-brief.md` — full design brief
- New: `backend/tests/test_feed_dual.py` — 13-phase test for PR #1
- New: `frontend/components/polls/` — 5 new component files
- Updated: this file

### Tasks still open after this session

- **#16** — Save / favorite polls + posts to user dashboard (feature
  work; ties into My Tracked).
- **#35** — Investigate `/api/admin/whoami` 429 + CORS storm. Likely
  a navbar render-loop issue, unrelated to redesign work.
- **#41** — Threat / incitement detection algorithm for poll content.
  Owner-only delete is intentional ("I should only be able to delete
  polls if someone reports it or if it consists of a threat"); the
  threat-detection algorithm is the proactive flag layer.
- **#84** — Capacitor iOS+Android wrap. Deferred until post-launch
  funding.
- **#90** — File Articles of Amendment for Benefit Corp with Sunbiz.
  Waits for the initial Profit Corp filing to clear.
- **Future polish** (not yet ticketed):
  - `PollCommentReaction` model + endpoint (poll comments currently
    have no like/dislike concept; CommentsThread no-ops gracefully)
  - `/api/ai/filter-comments` mirror for poll comments (currently
    no-op'd on poll mode with a tooltip)
  - "Start a post" CTA for verified reps + candidates on /posts tab

---

## The "Act as" multi-identity pattern

A foundational concept. When the viewer is signed in to 2+ identities
(citizen + rep + candidate) in the same browser, every engagement
action routes through an explicit identity picker — they always know
which identity is doing what, and the backend records correctly.

Quick reference (full details in CLAUDE.md's "Act as" section):

  • Helper: `useActiveIdentities({ isOwner })` (frontend/lib/activeIdentities.js)
  • Decision: `pickEngagementIdentity({ identities })` returns
    `{single}`, `{showPicker}`, or `{none}`
  • UI component: `IdentityPicker` (popover with "Act as" header)
  • Backend contract: write endpoints accept optional `as_identity`
    body field. Single-identity path resolves from cookies/tokens
    with citizen → rep → candidate precedence.

The picker is wired into:

  • Rep page: PostCard / PollCard / CitizenPollsSection (composer +
    actions)
  • /polls feed: CommentsThread composer; FeedCard vote + like +
    dislike (PR #5)

When adding a new engagement surface (button, modal, feature), wire
it through `useActiveIdentities` + `pickEngagementIdentity` +
`IdentityPicker`. Don't roll a one-off identity-resolution shortcut.

---

## Sandbox tooling quirks worth knowing

These bit us repeatedly in this session and the workarounds are durable.

1. **Recurring git-index corruption** (`bad signature 0x00000000`).
   The index file gets corrupted, often after a long-file Edit or
   when staging large diffs. Fix:
   ```bash
   rm -f .git/index .git/index.lock
   git read-tree HEAD
   ```
   Or, if that errors with the same signature complaint, then:
   ```bash
   rm -f .git/index .git/index.lock
   git reset --mixed HEAD
   ```

2. **Edit / Write tool silently truncates large files.** Files over
   ~600 lines occasionally get cut mid-content when written via the
   Edit or Write tools; the call returns success but the file on
   disk is shorter than expected. Workaround: write large files via
   `bash` heredocs or short Python scripts (`p.write_text(...)`).
   Always parse-check after a big write
   (`python3 -c "import ast; ast.parse(open(F).read())"` for Python,
   sucrase `transform()` for JS/JSX).

3. **The phantom "untracked" file at branch switch.** When checking
   out a branch where a file exists in one but not the other, the
   index sometimes claims the working tree has an untracked copy
   that blocks the checkout, even though `ls` shows no such file.
   Force checkout (`git checkout -f <branch>`) and then immediately
   `git restore` the phantom file to clear the state.

4. **`git status --short` can return hundreds of phantom-deletion
   lines** when the index is in the corrupted state above. Always
   resolve the corruption before trusting status output.

5. **The Read tool sometimes returns a stale cached version** of a
   file that's been edited on disk. If a Read result looks like it
   contradicts a recent edit, verify with `wc -l` + `tail` via bash
   before trusting it.

6. **Large bash output gets saved to a file instead of returned.**
   When stdout exceeds ~50KB the tool returns a "saved to file"
   pointer. To avoid this: pipe through `head` / `tail` / `wc -l`,
   or split the work into smaller invocations.

7. **The two main MCP-tool path systems differ.** File tools
   (Read/Write/Edit) use Windows paths; the sandbox bash uses
   `/sessions/<id>/mnt/...` mounts of the same files. Both see
   the same bytes but cache state can differ — `md5sum` is the
   tiebreaker when they disagree.

---

## User preferences learned this session

These should carry forward as durable working-style invariants:

- **"I'll be the one that decides to push or not."** Commit locally,
  describe what's ready, let the user decide on the push.
- **"Almost always when I ask for suggestions, give me your
  recommendations."** Lead with a recommendation when offering
  options; AskUserQuestion's first option should be the recommended
  one with "(Recommended)" appended.
- **Admin delete policy**: NO unilateral admin delete on user
  content. Reports + threat-detection algorithm only. The user is
  explicit: "I should only be able to delete polls if someone
  reports it or if it consists of a threat."
- **Co-author every commit**: `Co-Authored-By: Claude Opus 4.7
  (1M context) <noreply@anthropic.com>` (currently Opus 4.7; bump
  the version as models change).
- **Detailed commit bodies**: structured sections (what / why /
  verification / env vars when relevant). ~50-100 lines is normal
  for substantive commits; tiny housekeeping commits stay short.
- **Use AskUserQuestion proactively** before multi-step work,
  especially when scope is ambiguous.
- **Don't propose new features outside the agreed spec.** Stick to
  what the user asked for; bring follow-ups as suggestions, not as
  in-flight scope creep.

---

## Git state at handoff


**Currently on:** `feat/polls-redesign-pr4-polish` (last branch we
were working on at end of session). `main` is at `4bed87d` after PR #28
merged the polls-redesign brief + design exports.

**Most recent commits on main** (chronological, newest first):

```
4bed87d  Merge PR #28 — polls/posts exports 2 (round-2 design)
8ee18df  polls/posts exports 2
39af233  Merge PR #27 — Poll/posts page design exports (round 1)
8e14e27  Poll/posts page design exports
34c3a54  docs: /polls dual-feed redesign brief (Polls + Posts tabs)
390b86c  Merge PR #26 — standalone poll vote + close
e75a414  feat(polls): standalone polls are votable + author can close from /polls
1a9047f  feat(polls): /api/feed/polls returns option IDs + per-viewer vote + author flag
ee4d8e3  Merge PR #25 — revert Lucide migration to post-logo-refresh state
a49425c  revert: roll Lucide migration back to post-logo-refresh state
```

**Stacked, unmerged feature branches** (oldest first; each is parented
on the previous one — landing requires sequential push + merge + rebase):

```
feat/polls-redesign-pr1-feed-backend    929469b   PR #1 backend
feat/polls-redesign-pr2-polls-tab       9243bdb   PR #2 polls tab (2 commits)
feat/polls-redesign-pr3-posts-tab       3ad2c66   PR #3 posts tab
feat/polls-redesign-pr4-polish          366a4e5   PR #4 polish
```

**Recommended first action in new session**: push the four feature
branches sequentially and open them as stacked PRs. After PR #1
merges, rebase PR #2 onto the new main and update the open PR; repeat
through PR #4.

---

## State of the four service abstractions

All four follow the same pattern: env-var-gated, lazy-imported, dev
fallback when creds aren't set.

| Service | Status | Env vars needed to flip to live |
| --- | --- | --- |
| Cloudflare R2 (post images) | **Live** (deployed) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` |
| Postmark (transactional email) | **Scaffolded, inert** | `POSTMARK_API_TOKEN`, `POSTMARK_FROM_EMAIL`, optional `POSTMARK_MESSAGE_STREAM` |
| Stripe ($5/mo subscription) | **Scaffolded, inert** | `STRIPE_API_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, optional `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` / `STRIPE_PORTAL_RETURN_URL` |
| ID.me (citizen verification) | **Scaffolded, inert** | `IDME_CLIENT_ID`, `IDME_CLIENT_SECRET`, `IDME_REDIRECT_URI`, optional `IDME_AUTHORIZE_URL` / `IDME_TOKEN_URL` / `IDME_USERINFO_URL` / `IDME_SCOPES` / `IDME_POST_AUTH_REDIRECT` |

Each scaffolded service has a status probe endpoint:
- `GET /api/billing/status` → `{is_configured, price_id_present}`
- `GET /api/identity-verification/status` → `{is_configured}`

The frontend cards (`BillingSection`, `VerificationSection`) read these
on mount and render "Coming soon" branches when the backend says
`is_configured: false`. No frontend changes needed at cutover — the cards
flip to live UI automatically once env vars are set on Render.

---

## Important caveats for the next session

1. **The Render free-tier cold-start matters.** The backend sleeps after
   15 min of inactivity. First request after waking often times out
   before the wake completes. Symptom: "Failed to fetch" in the
   frontend. Wait 30-60 sec and retry; it's not a real bug.

2. **Auto-migrate is in `backend/app/db.py`** and runs at every boot.
   ALTERs existing tables to add new columns from the SQLAlchemy
   models. Three failure modes to know about:
   - Boolean columns with Python-side `default=False`: must declare
     `server_default=sa_expression.false()` too, or the ALTER renders
     `DEFAULT 0` and Postgres rejects it. Fix shipped in `883d964`
     — `_render_server_default` now uses dialect-aware true/false
     literals. For new columns, prefer `server_default=expression.false()`
     when the column type is BOOLEAN.
   - `NOT NULL` columns without any default: auto-migrate skips them
     and logs a warning. Add a `server_default` or accept manual
     migration.
   - Per-column failures are now wrapped in try/except so a single bad
     column doesn't abort the rest of the table (also shipped in
     `883d964`).

3. **Demo grants are flagged for removal.** Two lines in
   `backend/app/routers/auth_citizen.py:demo_signup` —
   `is_subscribed=True, subscription_status="demo"` (Task #88) and
   `verified_method="demo"` (Task #89). Both are commented for removal
   once real billing + verification go live. Don't let them ship to
   real-user production by accident.

4. **The "Failed to fetch" episode**: see the chat history if you can.
   Tl;dr — Task #88 added an `is_subscribed BOOLEAN NOT NULL` column;
   auto-migrate emitted `DEFAULT 0`; Postgres rejected; column never
   landed; every citizen-account SELECT 500'd; "Failed to fetch" on
   login. Hotfixed in `883d964`. Backfill for pre-Task-#88 demo
   citizens in `c546518`.

5. **PII handling for ID.me** (Task #89): we deliberately persist only
   the verified flag + verified_at + verified_method + Fernet-encrypted
   legal name + sha256 address hash. No DOB, SSN, or selfie.
   Documented in `services/idme_service.py` module docstring.

6. **The user has Windows-style paths.** When the user pastes a file
   path like `C:\Users\jeffr\Desktop\US apps\CivicLens\docs\...`, the
   mounted-folder equivalent is
   `/sessions/<session-id>/mnt/US apps/CivicLens/docs/...`. The user
   doesn't see backend paths; never expose `/sessions/...` to them.

---

## What to read first (in order)

For the new session to come up to speed efficiently:

1. **`README.md`** — comprehensive project doc, all the persistent context
2. **This file** (`docs/HANDOFF_TO_NEXT_SESSION.md`) — chat-to-chat handoff
3. **`docs/gofundme_draft.md`** — fundraising content the user is preparing
4. **`frontend/components/HelpBuildThisView.js`** — canonical shipped list
5. **`docs/civicview_financial_model.xlsx`** — financial reasoning
6. **`docs/SECURITY.md`** — env vars + secrets posture
7. **`backend/app/services/`** — service abstractions (one file per
   external integration; all follow the same pattern)
8. **`backend/app/models/pages.py`** — all SQLAlchemy models in one file

---

## Anti-patterns to avoid

- **Don't re-scaffold what's already built.** Postmark, Stripe, ID.me,
  R2 are all done. The work is in the dashboards (sign up, get keys, set
  env vars), not in code.
- **Don't propose new features.** The project is feature-complete for
  launch. Focus is on launch sequencing + the two remaining pending
  tasks (#84, #90). Task #58 was closed — see the open-tasks list above.
- **Don't strip credit.** The README's "Built by" section credits Claude
  Cowork + Claude Code + Claude Design alongside the founder. Keep that
  language in any future README updates.
- **Don't commit without being asked.** The prior session worked in
  long stretches with explicit "commit it" prompts. Maintain that pace.

---

## How the prior session was operating

For continuity of working style:

- **Use AskUserQuestion proactively** before multi-step work — the user
  appreciates clear options over guessing.
- **Use TodoWrite / TaskUpdate** for tracked work. Mark `in_progress`
  before starting, `completed` after finishing.
- **Parse-check Python via `ast.parse()`** and JS via
  `sucrase.transform()` (`frontend/node_modules/.bin/sucrase` is
  available) before committing.
- **Smoke import the backend** via `python3 -c "import app.main as m"`
  to catch circular / missing-import errors before pushing.
- **Commit messages are detailed.** ~50-100 line bodies are normal,
  with structured sections (what changed, why, verification, env vars).
  Co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context)
  <noreply@anthropic.com>`.
- **The user wants honesty about uncertainty.** When something hinges
  on third-party behavior (Stripe's exact pricing, ID.me's RP contract
  terms), say so + flag it for verification rather than assuming.
