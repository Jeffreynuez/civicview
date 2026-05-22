# Handoff to next Cowork session

**Date generated:** May 21, 2026
**Previous session length:** Very long (multi-week continuation across several
context windows). Starting fresh in a new chat to avoid memory degradation.

---

## How to use this file

Open a new Cowork chat with the same `US apps` folder mounted, then paste
the **"Bootstrap prompt"** section below s your first message. Claude will
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

## Git state at handoff

**Branch:** `main`
**Most recent commits** (chronological, oldest first):

```
f5a630c  2FA Phase 4 — FORCE_2FA_ENABLED enforces rep/candidate/admin enrollment
3ec82ba  Financial model: add payment processing fees + pen-test budget
23d2e6d  Self-serve account deletion + ID.me verification archive (Task #81)
522396d  Delete account link red + fix Ashley Moody photo (Congress.gov API bug)
209705f  Cloudflare R2 storage for post images (Task #83)
c6381eb  SECURITY.md: document Cloudflare R2 setup for post images
55bfa9f  About-column footer pages + Terms of Service (Task #85)
832a9f9  docs: add LEGAL-REVIEW-ROADMAP.md for the attorney engagement plan
cb8936f  Postmark email service + password reset flow (Task #87)
e8b9196  docs: add Benefit Corp formation reference PDF (Task #86)
53ea64a  Stripe subscription scaffold (Task #88)        [DEPLOYED]
883d964  Fix Postgres-incompatible BOOLEAN default in auto-migrate (hotfix)
c546518  Backfill is_subscribed=True on pre-existing demo citizens (Task #88)
0db523f  ID.me identity verification scaffold (Task #89)
```

**Ahead of `origin/main`**: 1 commit (0db523f at the time this file was
generated — confirm with `git status` in the new session).

**Untracked files at handoff:**
- `docs/gofundme_draft.md` (the GoFundMe campaign content — keep + commit
  as part of the Task #87/#88/#89 wave)

**Recommended first action in new session**: push the in-flight commits +
add the gofundme_draft.md to a commit before doing anything else.

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
