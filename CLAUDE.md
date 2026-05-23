# CivicView — project context for new Cowork sessions

This file is auto-loaded by Cowork at the start of every session that
mounts this folder (or its parent). It exists so you can open a new
chat and start working immediately, without me re-explaining the
project, the conventions, or the open work.

## What this is

**CivicView** (civicview.app) — a non-partisan civic-engagement
platform for U.S. citizens, their elected representatives, and
election candidates. Filed as a **Florida Benefit Corporation**
(initial Profit Corp filing on the books, Sunbiz tracking
`#800474911808`; Benefit Corp Amendment is Task #90, pending).

Sole creator / founder: **Jeffrey De La Nuez**
(`jeffreynuez1@gmail.com`). The project was built with major
assistance from Claude Cowork + Claude Code + Claude Design —
the architecture decisions, product direction, and business
accountability are Jeffrey's; credit lines in the README reflect
both. Don't strip the credit if you touch the README.

## Read these first, in this order

Always read these before doing real work. They cover the persistent
state that this file deliberately does NOT duplicate:

1. **`docs/HANDOFF_TO_NEXT_SESSION.md`** — Canonical state doc.
   Has the bootstrap prompt, current git/branch state, what landed
   in the most recent sessions, sandbox tooling quirks, user
   working-style preferences. Read this top-to-bottom every new
   session.
2. **`README.md`** — Project overview, tech stack, what's shipped,
   open tasks, launch sequencing, engagement permission gates.
3. **`frontend/components/HelpBuildThisView.js`** — Canonical
   shipped-vs-blocked list with sourced dollar amounts. Source of
   truth for the public funding ask.
4. **`docs/SECURITY.md`** — Env-var posture + secrets model.
5. **`backend/app/models/pages.py`** — All SQLAlchemy models in one
   file. The shape of the data layer.

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
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
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

## Sandbox tooling quirks worth knowing

Repeated bites in past sessions; full workarounds in
`docs/HANDOFF_TO_NEXT_SESSION.md` under "Sandbox tooling quirks".
Headline list:

1. **Recurring `bad signature 0x00000000` git-index corruption.**
   Fix: `rm -f .git/index .git/index.lock && git read-tree HEAD`
   (or `git reset --mixed HEAD` if read-tree errors). Check the
   handoff for the deeper recipe.
2. **Edit / Write tool silently truncates large files** (>~600
   lines). Workaround: write large files via bash heredocs or
   short Python scripts. Always parse-check after a big write.
3. **`git status --short` can return hundreds of phantom
   deletions** when the index is corrupted. Resolve the
   corruption before trusting status.
4. **The Read tool sometimes serves a stale cached version.** If
   a Read contradicts a recent edit, verify with `wc -l + tail`
   via bash.

## Quick facts you'll be asked

- **Production:** Backend on Render Pro ($25/mo), frontend on
  Vercel, Postgres on Render. Cold-start matters: the backend
  sleeps after 15 min and the first request after waking often
  times out. "Failed to fetch" after long inactivity is usually
  cold start, not a real bug.
- **Repo:** `https://github.com/Jeffreynuez/civiclens` (private).
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
