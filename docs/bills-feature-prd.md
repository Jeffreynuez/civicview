# Bills & Votes — Feature PRD (v1)

**Status:** Draft for review + Claude Design handoff
**Author:** Jeffrey De La Nuez (with Claude Cowork)
**Date:** 2026-05-30
**Related code:** `backend/app/routers/{congress,bills,votes}.py`,
`backend/app/services/congress_service.py`, `frontend/components/ProfileView.js`,
`frontend/app/page.js` (home), `frontend/app/polls/page.js` (section pattern)

---

## Summary

Add a federal **Bills & Votes** surface to CivicView so citizens can see the
latest legislative activity directly — without having to first pick a specific
representative. Two surfaces:

1. **Home-page "Bills" section** — latest Senate bill(s) and House bill(s) with a
   live status tag (Upcoming / On the floor / Passed / Failed), a refresh
   control, and a vote tally when one exists.
2. **Dedicated `/bills` page** — a Senate/House toggle over an interactive
   **seat-voting chart** (GovTrack-style hemicycle). Each seat is selectable,
   opens a **rep mini-card** with key info, and links to that rep's **profile
   window** (`ProfileView`, the info/Bills/Votes view — *not* their engagement
   page). Below the chart, a full vote list with the same select-and-link
   behavior.

The goal is a healthy navigation flow: **latest bills → a specific member →
that member's info / bills / page.**

**Locked scope decisions (2026-05-30):**
- **Data:** hybrid — official **House Clerk + Senate LIS roll-call XML** as the
  source of truth for tallies and per-member positions; **GovTrack v2** for
  enrichment (vote categorization) and as a fallback.
- **Phasing:** build the **dedicated seat-chart page first**, home section as a
  fast follow.
- **Vote types v1:** **bill passage + nominations** (covers both reference
  screenshots).

---

## Problem statement

CivicView already ingests federal bill and roll-call data, but a citizen can
only reach it *through* a representative they've already selected — there's no
way to answer "what is Congress actually voting on right now?" Civic-engagement
users expect a top-level legislative feed (the way GovTrack, Quorum Civic, and
Countable provide one). Without it, the app's rich per-member vote data is
effectively hidden behind a lookup the user may not know to perform, and the
home page under-represents the live pulse of Congress that is core to the
product's transparency mission.

## Goals

1. Let any visitor see the **latest federal bills/votes** in one click from the
   home page, with no rep lookup required.
2. Make a single roll-call vote **legible at a glance** via an interactive seat
   chart — who voted how, by party, with a clear pass/fail outcome.
3. Drive a **measurable flow from a vote → an individual member → their profile
   window**, deepening engagement with member pages.
4. Source vote data **durably** (official primary sources) so a flagship surface
   doesn't rest on a single deprecated dependency.
5. Keep the surface **simple, neutral, and intuitive** — informative without the
   density/ideology-scoring complexity that makes competitor tools intimidating.

## Non-goals (v1)

1. **Full bill lifecycle tracking** (introduced → committee → floor → enacted
   pipeline visualization). Deferred — high effort, lower first-use value than
   the vote chart. (P2)
2. **The hex cartogram (district map).** The hemicycle seat chart is the v1
   visual; the cartogram is a later option. Keeps mobile/a11y scope tractable.
3. **State / local bills.** Federal only for v1. State legislative data is a
   separate ingestion problem.
4. **Procedural votes** (cloture, motions to table/recommit, amendments).
   Passage + nominations only — procedural votes confuse casual users and
   multiply edge cases.
5. **Personalized "your reps' votes" filtering** on the new page. The existing
   per-member Votes tab already serves that; the new page is the *chamber-wide*
   view.
6. **Citizen engagement on votes** (likes/comments on a roll-call). Out of scope
   — this is a data surface, not an engagement surface.

## Users & user stories

**Casual citizen (unverified, browsing):**
- As a visitor, I want to see the latest Senate and House bills on the home page
  so I know what Congress is working on without looking up a representative.
- As a visitor, I want to click a recent vote and see a chart of how everyone
  voted so I can understand the outcome at a glance.
- As a visitor, I want to click a single seat and see who that member is and how
  they voted, with a link to learn more.

**Engaged citizen (tracking reps):**
- As a citizen, I want to jump from a vote to a member's profile window so I can
  review their full record, bills, and page.
- As a citizen, I want to refresh the section to catch newly recorded votes
  without reloading the whole page.

**Edge / state stories:**
- As a visitor during a congressional recess, I want the section to clearly say
  there's no current floor activity rather than show a stale or empty chart.
- As a visitor viewing a voice vote (no roll call), I want to understand there's
  no per-member breakdown to display.
- As a mobile visitor, I want the 435-seat House chart to remain usable (legible,
  tappable, or gracefully adapted) on a small screen.

## Requirements

### Must-have (P0)

**P0-1 — Chamber-wide recent-votes endpoint.**
New backend endpoint returning the most recent **passage + nomination** roll-call
votes per chamber (id, chamber, question, bill citation/title, date, result,
tally {yea, nay, present, not_voting}, party breakdown).
- *Given* a request for `/api/votes/recent?chamber=house`, *when* the House has
  recorded roll-call votes, *then* return the N most recent passage/nomination
  votes with tallies, newest first.
- Data sourced from official House Clerk XML; GovTrack fallback if the official
  fetch fails. Results cached server-side (votes are immutable once recorded).

**P0-2 — Per-vote member-position endpoint.**
New endpoint returning **every member's position** on a single roll-call
(`/api/votes/{vote_id}/members`) → list of {bioguide_id, name, state, party,
position}. This is the inverse of the existing per-member votes call and is the
data backbone of the seat chart.
- Source: official roll-call XML (House Clerk / Senate LIS); GovTrack
  `vote_voter?vote=` as fallback. Cached by vote_id.

**P0-3 — `/bills` page with Senate/House toggle.**
A new route rendering a chamber toggle; default to the chamber with the most
recent vote.
- *Given* the page loads, *when* a chamber is selected, *then* show that
  chamber's most recent qualifying vote as the active chart + a list of recent
  votes to switch between.

**P0-4 — Interactive hemicycle seat chart.**
Render a semicircle of seats (100 Senate / 435 House) colored by party + vote
position (e.g., Yea = filled, Nay = outline; party = hue). Independents grouped
with their caucus, labeled. A clear outcome headline (e.g., "216–201 · Passed").
- *Given* a vote with per-member data, *when* the chart renders, *then* every
  member maps to exactly one seat with the correct party + position color.
- *Given* a member has no party/position data, *when* rendering, *then* fall back
  to a neutral "unknown" seat rather than miscoloring.

**P0-5 — Seat → mini-card → profile window.**
Clicking/selecting a seat opens a small popover with the member's photo, name,
state, party, and their position on this vote, plus a link to their
`ProfileView` profile window (not their engagement page).
- *Given* a seat is selected, *when* the mini-card opens, *then* it shows that
  member and a working "View profile" link; click-outside + Esc dismiss it
  (reuse the `IdentityPicker` popover conventions).

**P0-6 — Vote list with matching select-and-link.**
Below the chart, a sortable-by-default (state, then party) roster of all members'
positions, each row linking to the member's profile window — same target as the
seat mini-card.

**P0-7 — Empty / edge states.**
Recess (no recent votes), voice vote (no per-member data), and fetch-failure
states each render an explicit, friendly message — never a blank or broken
chart.

**P0-8 — Cheap refresh.**
The refresh control re-queries the **cached** recent-votes endpoint; it must not
trigger an uncached external API fan-out on every click.

### Nice-to-have (P1)

**P1-1 — Home-page "Bills" section.** Latest Senate bill(s) over latest House
bill(s), status tag (Upcoming / On the floor / Passed / Failed), tally when a
vote exists, refresh control, and a "View all →" link to `/bills`. Lazy-loaded
like the existing National-activity / Popular-polls sections so the home page
stays sub-100ms.

**P1-2 — "Upcoming / on the floor" status tag.** Sourced from the House weekly
"Bills to be Considered" XML (`docs.house.gov/floor`). Reliable for the House;
**best-effort for the Senate** (no clean equivalent feed) — Senate may show
"Recently voted" only until a source is found.

**P1-3 — Deep-linkable vote URLs.** `/bills/votes/119-2026/h145`-style shareable
links (GovTrack-style) for the civic sharing angle.

**P1-4 — Existing AI vote explainer inline.** Surface the already-built
template + Haiku "What was this vote?" explainer on the vote detail.

**P1-5 — Existing AI bill summary inline.** Surface the already-built CRS +
Haiku plain-English bill summary for the bill behind the vote.

### Future considerations (P2)

- Hex **cartogram** view as a toggle alongside the hemicycle.
- Full **bill lifecycle** pipeline visualization.
- **Procedural votes** (cloture, motions, amendments) with clear labeling.
- **Track this bill/vote** from the new surface (model exists: `/api/tracked/bills`).
- **State/local** bills + votes.

## Data sources & architecture notes

- **Roll-call tallies + per-member positions (P0):** House → official Clerk
  roll-call XML (`clerk.house.gov`); Senate → official LIS roll-call XML
  (`senate.gov`). **GovTrack v2** (`/api/v2/vote_voter`, already wired in
  `congress_service.py`) is the fallback + enrichment layer (vote
  categorization, person-id mapping). Rationale: ProPublica's Congress API shut
  down (July 2024); GovTrack's API is officially deprecated — acceptable for a
  profile tab, too fragile as the sole backbone of a flagship page.
- **Floor schedule / "upcoming" (P1):** House weekly XML at
  `docs.house.gov/floor`. Senate has no clean equivalent — treat as best-effort.
- **Bill detail + summaries:** reuse existing `BillSummary` cache + Congress.gov
  fetch. **Vote explainers:** reuse existing `VoteExplainer` cache.
- **Caching:** roll-call data is immutable once recorded — cache aggressively by
  vote_id. Floor schedule refreshes ~weekly. The refresh button hits cache.
- **README cleanup:** the Phase-4 "ProPublica + OpenStates Pro subscriptions"
  line is now stale on the ProPublica half — update when this ships.

## UX / design notes (for Claude Design)

- **Visual language:** GovTrack's hemicycle is the reference, simplified — order
  seats by **state then party**, *not* ideology score (keeps it neutral +
  intuitive). Outcome headline prominent.
- **Non-partisan brand tension:** party coloring (red/blue) is factual and
  standard, but confirm the exact palette against CivicView's neutral design
  tokens — consider desaturated party hues so the page doesn't read as partisan.
- **Mobile + accessibility is the hard part:** 435 tiny seats must stay usable on
  a phone and be keyboard-navigable + screen-reader-legible. Run the
  **accessibility-review** skill on the chart before handoff. Likely needs: a
  responsive seat-size strategy, a list-first fallback on narrow screens, ARIA
  roles per seat, and adequate tap targets.
- **Component reuse:** the mini-card popover should follow `IdentityPicker`
  conventions (absolute-positioned, click-outside + Esc). Co-locate the chart's
  CSS with the component (CSS topology rule), not in the page stylesheet.
- **Flow target:** seat / vote-row → member **profile window** (`ProfileView`),
  explicitly not the engagement `PageView`.

## Success metrics

**Leading (days–weeks):**
- % of home-page sessions that open the `/bills` page (target: meaningful
  baseline — set after first week of data).
- Seat/vote-row → profile-window click-through rate (target: this surface becomes
  a top-3 entry path into member profiles).
- `/bills` refresh usage + repeat visits (signal of "I check this").

**Lagging (weeks–months):**
- Member-profile-window views attributable to the Bills surface.
- Retention lift among users who use `/bills` vs. those who don't.

*Measurement note:* the existing `/api/stats/summary` pattern + the future
`/stats` analytics page (Task #71) are the natural home for these counters.

## Open questions

- **[Design]** Seat-square vs. hex on the hemicycle, and the exact party palette
  against neutral tokens — blocking for the chart build.
- **[Design]** Mobile strategy for 435 seats: shrink-to-fit, scrollable, or
  list-first below a breakpoint — blocking for responsive build.
- **[Engineering]** House Clerk + Senate LIS XML parsing: confirm both expose
  recent passage **and** nomination roll-calls in a parseable shape; map their
  member IDs to our bioguide IDs (Senate uses LIS IDs). Non-blocking but
  schedule early — it's the riskiest data task.
- **[Engineering]** Is GovTrack's `vote_voter` still returning current-Congress
  data reliably enough to be a real fallback? Validate before depending on it.
- **[Product]** Home section: when there's a fresh *upcoming* bill (no vote yet)
  AND a fresh *passed* vote, which leads the card? (Proposed: show both states;
  upcoming on top with no tally, recent vote below with tally + chart link.)

## Timeline / phasing

- **Phase A (now): the `/bills` page.** P0-1 through P0-8. This is the bulk of the
  work and is independently shippable + testable.
- **Phase B (fast follow): the home section.** P1-1, P1-2, P1-3.
- **Phase C (post-launch): AI inline + P2 items** as capacity allows.

Dependency: Phase A's two new endpoints (P0-1, P0-2) gate everything else — build
and validate the official-XML ingestion first.
