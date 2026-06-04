# PRD — Optional Poll Demographic Forms + Results Explorer

**Status:** Draft for review (do NOT implement until Jeffrey signs off)
**Author:** Jeffrey De La Nuez, with Claude (Cowork)
**Date:** 2026-06-04
**Related:** poll system (`Poll`, `PollVote`, `PollOption` in `backend/app/models/pages.py`),
`FeedCard` / `PostCard` / `CitizenPollsSection`, geography scope filter (the existing
"verified citizen" result filter), `docs/LEGAL-REVIEW-ROADMAP.md`,
`docs/SECURITY.md`. Engagement gates per `CLAUDE.md`.

---

## Problem Statement

CivicView polls today segment results by geography only (country → state →
district → eventually city/town). That answers "what does this district
think," but reps, candidates, and subscribed citizens often need "what does
this district think, broken down by *who* is answering" — by age, party,
parental status, and so on. There is no way for a poll creator to attach
demographic questions to a poll, and no way to filter results by them. The
cost of not solving it: the platform's most analytically valuable signal —
cross-tabbed public opinion — is left on the table, and creators turn to
off-platform survey tools that lack CivicView's one-verified-citizen-one-vote
integrity.

## Goals

1. Let any poll creator (rep, candidate, subscribed+verified citizen) optionally
   attach a set of **standardized** demographic questions to a poll.
2. Let voters **optionally** answer those questions when voting, with no pressure
   and no gating of the vote itself.
3. Let any viewer explore results filtered/cross-tabbed by those demographics
   **and** the existing geography scope, in an enlarged results window.
4. Do all of the above without ever exposing an individual respondent's
   demographics to anyone — including the poll creator.
5. Keep the platform's non-partisan, privacy-respecting posture intact and
   defensible under the pending ToS/Privacy attorney review.

## Non-Goals (v1)

- **No free-text demographic questions.** Catalog-only (filterable, neutral,
  no PII/harassment surface). Creator-defined custom questions are P2.
- **No reusable cross-poll demographic profile.** Each poll's answers are
  captured per-vote, frozen in time. A saved opt-in profile is P2 (bigger
  privacy/centralization decision).
- **No charts/visualizations in v1.** Numeric breakdowns + bars only; richer
  viz is P1.
- **No demographics from anonymous/demo-token-only votes.** Like geography
  scopes today, demographic answers attach to verified-citizen votes only.
- **No individual-level export.** Any future export is aggregate + suppressed.

## Target Users

- **Poll creators:** reps, candidates, and subscribed+verified citizens (the
  existing poll-create gate — no change).
- **Voters:** verified citizens (the existing vote gate). Anonymous/demo-token
  votes can still vote on the poll but do not contribute demographics.
- **Result viewers:** everyone (browsing is free), seeing aggregate + suppressed
  breakdowns only.

## User Stories

- As a **rep**, I want to attach age, party, and parental-status questions to my
  school-funding poll so I can see how parents vs. non-parents in my district
  differ — without seeing any individual's answers.
- As a **candidate**, I want to filter my poll's results to "voters 18–24 in my
  district" so I can understand younger constituents, while small subsets stay
  hidden to protect them.
- As a **subscribed citizen**, I want to add a short demographic form to my poll
  on my rep's page so the discussion has richer context.
- As a **voter**, I want to vote and skip every demographic question (or answer
  only some) so I'm never forced to disclose anything to participate.
- As a **voter**, I want a clear statement that my answers are anonymous and
  shown only in aggregate so I can decide what to share.
- As **any viewer**, I want a breakdown to say "not enough responses to show"
  rather than reveal a near-unique respondent.

## The Standardized Catalog (v1)

The catalog lives in **code** (a versioned constant), not the DB, so prompts and
options stay consistent across polls. Every question is **single-select and
optional**, and every question implicitly offers **"Prefer not to say"** (= skip,
stored as no answer). Two tiers:

### Standard

- **Age band:** 18–24 · 25–34 · 35–44 · 45–54 · 55–64 · 65+
- **Sex:** Female · Male
- **Political party:** Democrat · Republican · Independent / No party ·
  Libertarian · Green · Other
- **Parent or guardian:** Yes · No
- **Education:** High school or less · Some college · Bachelor's degree ·
  Graduate degree
- **Employment:** Employed · Self-employed · Student · Retired · Not employed
- **Homeownership:** Own · Rent
- **Veteran / military service:** Yes · No

### Sensitive (extra care)

Grouped separately in the creator picker behind a "sensitive categories" notice;
same optionality + suppression rules apply.

- **Race / ethnicity:** White · Black or African American · Hispanic or Latino ·
  Asian · Native American or Alaska Native · Native Hawaiian or Pacific Islander ·
  Two or more · Other
- **Household income:** Under $30k · $30k–$60k · $60k–$100k · $100k–$150k · $150k+
- **Religion:** Protestant · Catholic · Jewish · Muslim · Other faith ·
  None / Unaffiliated

> Catalog is additive over time. Changing a question's options is a versioned
> migration concern; v1 treats the catalog as append-mostly.

## Privacy & Security Rules (load-bearing)

1. **Aggregate-only, for everyone.** No endpoint or UI ever returns an individual
   respondent's demographics — not to viewers, not to the poll creator, not to
   admins. Only suppressed aggregate counts.
2. **Minimum cell size = 10 (app-wide).** A demographic breakdown bucket — or any
   filtered subset — is shown only when ≥ 10 verified-citizen respondents fall in
   it. Otherwise the UI shows "Not enough responses to show (need ≥ 10)." This
   applies after **all** active filters are combined (geography + demographics),
   so stacked filters can't drill down to a near-unique person.
3. **Always optional.** No demographic question can be made required; voting on
   the poll never depends on answering any of them.
4. **Verified-citizen votes only.** Demographics attach to `citizen_id` votes,
   mirroring how geography scopes work today. Anonymous/demo-token votes carry no
   demographics.
5. **Consent copy at vote time:** "This poll's creator added optional questions
   about you. Answers are anonymous, never linked to you publicly, and shown only
   in aggregate. You can skip any or all."
6. **Self-reported labeling.** Every breakdown is labeled "Self-reported,
   unverified."
7. **Retention:** demographic answers live and die with the poll (FK cascade on
   poll delete; deletion still follows the report/threat rules — no new unilateral
   delete path).
8. **Legal:** add a section to `docs/SECURITY.md`; flag the sensitive categories
   (party, race/ethnicity, religion, income) explicitly for the pending
   ToS/Privacy attorney review before production launch.

## Data Model

**New table `poll_demographic_questions`** — which catalog questions a poll uses.

| column | type | notes |
| --- | --- | --- |
| id | PK | |
| poll_id | FK polls.id (CASCADE), index | |
| question_key | str(40) | catalog key, e.g. `age_band`, `party` |
| sort_order | int | display order |
| created_at | datetime | |

Unique index `(poll_id, question_key)`. Prompts/options/tier are resolved from the
code catalog by `question_key` — not stored here.

**New table `poll_vote_demographics`** — answers, frozen at vote time.

| column | type | notes |
| --- | --- | --- |
| id | PK | |
| poll_id | FK polls.id (CASCADE), index | denormalized for one-scan filtering |
| poll_vote_id | FK poll_votes.id (CASCADE), index | the vote this answer rides on |
| question_key | str(40), index | |
| answer_value | str(64), index | one of the catalog's option values |
| created_at | datetime | |

Unique index `(poll_vote_id, question_key)`. Rows written only for verified-citizen
votes that answered. This mirrors the existing denormalized-snapshot pattern on
`PollVote` (geography frozen at vote time).

> BOOLEAN/NOT-NULL migration note from CLAUDE.md applies: any non-null boolean must
> use `server_default`. Auto-migrate runs on boot (`backend/app/db.py`).

## API

- **Attach form (create/edit poll):** the poll create/edit payload accepts
  `demographic_question_keys: [str]` (validated against the catalog). Editing the
  set after votes exist is allowed but additive-only (can't delete a question that
  already has answers in v1 — avoids orphaning data; revisit in P1).
- **Vote with demographics:** `votePoll` / `voteOnCitizenPoll` accept an optional
  `demographics: { question_key: answer_value }`. Backend validates each key is
  attached to the poll and each value is a valid catalog option; ignores the block
  entirely for non-verified votes; stores one `poll_vote_demographics` row per
  answered question. Routed through the existing `as_identity` contract.
- **Results breakdown:** `GET /api/polls/{id}/results/breakdown?scope=<geo>&
  filter[<key>]=<value>...&by=<question_key>` returns, for the filtered subset:
  per-option counts + percentages, the subset N, and (if `by` given) a breakdown
  of the chosen option distribution across that question's buckets — **with cells
  < 10 suppressed**. Reuses the existing geography scope filter logic.

## UX Flows

**Creator (poll composer):** an optional "Add demographic questions" section →
catalog checklist grouped Standard / Sensitive (sensitive behind a one-line
notice), drag to reorder, live preview of what voters will see. Defaults to none.

**Voter:** after selecting a poll option, an optional demographics step (inline
expander or light modal) appears with a per-question "Prefer not to say" and a
prominent **Skip** / **Submit vote** that works with zero answers. Consent line
shown. Goes through the `IdentityPicker` like any engagement action.

**Results Explorer (the "enlarged poll window"):** an **"Explore results"** button
on the poll card opens a shared `PollResultsModal` (one component reused by
`FeedCard`, `PostCard`, `CitizenPollsSection` — not forked; co-located CSS per the
project's component-CSS rule). Contents:
- Geography scope control (existing country/state/district/city).
- Demographic filter pills for each attached question.
- Recomputed option results for the current filtered subset (with subset N).
- Optional per-demographic breakdown view.
- Suppression notices where N < 10; "Self-reported, unverified" + "Anonymous,
  aggregate-only" labels throughout.

## Requirements

### P0 — Must-have (v1)

- [ ] `poll_demographic_questions` + `poll_vote_demographics` tables + auto-migrate.
- [ ] Versioned code catalog (Standard + Sensitive tiers, exact options above).
- [ ] Attach catalog questions on poll create/edit (validated).
- [ ] Capture optional demographics at vote time (verified citizens only;
      per-question optional + Prefer-not-to-say; consent copy).
- [ ] `PollResultsModal` opened by an "Explore results" button on all three poll
      surfaces, with geography + demographic filters.
- [ ] Min-cell suppression (10) enforced **server-side** (never ship raw small-cell
      counts to the client), applied after combined filters.
- [ ] "Self-reported, unverified" + "aggregate-only" labeling.
- [ ] No individual-response access anywhere; no new admin delete path.

### P1 — Should-have (fast follow)

- [ ] Bar/chart visualizations in the explorer.
- [ ] Aggregate, suppressed CSV export for creators.
- [ ] Edit/replace demographic answers until the poll closes.
- [ ] Per-poll suppression threshold (creator may raise above 10, never lower).

### P2 — Future

- [ ] Opt-in reusable citizen demographic profile (auto-fill, with its own consent).
- [ ] Creator-defined custom single-select questions (fixed options, light moderation).
- [ ] Additional catalog categories; multi-select questions.

## Acceptance Criteria (samples)

- Given a poll with an attached `party` question, when a verified citizen votes and
  picks "Independent / No party," then one `poll_vote_demographics` row is stored
  and the vote succeeds.
- Given the same poll, when a citizen votes and skips every demographic question,
  then the vote still succeeds and no demographic rows are written.
- Given a breakdown where only 7 respondents are "65+ in District 5," when any
  viewer (including the creator) opens that cut, then the bucket shows "Not enough
  responses to show" and no count is returned by the API.
- Given an anonymous token-only vote, when it is cast, then no demographic data is
  accepted or stored.
- Given a poll with no attached form, when a voter votes, then no demographics step
  appears and behavior is unchanged from today.

## Success Metrics

**Leading (days–weeks):** % of new polls that attach a form; among polls with a
form, % of verified voters who answer ≥ 1 question (target ≥ 40%); explorer open
rate on polls with forms; zero privacy incidents / sub-threshold leaks.

**Lagging (weeks–months):** creator retention / repeat use of forms; qualitative
feedback from reps/candidates on usefulness; no increase in vote-abandonment on
polls with forms vs. without (guards against the demographics step suppressing
participation).

## Open Questions

- **[legal]** Do the sensitive categories (party, race/ethnicity, religion, income)
  need explicit consent language or a regional carve-out before production?
  (Blocking for production, not for a behind-flag build.)
- **[product]** Should the demographics step appear *before* or *after* the option
  is recorded (i.e., is a vote with a half-filled form committed if the user
  navigates away)? Recommendation: commit the vote first, demographics are an
  optional follow-on write.
- **[design]** Does "Explore results" replace or sit beside the current inline
  results view on the card?
- **[data]** Confirm the suppression rule for *combined* filters is the subset N
  (it is, per the privacy rules) and that the API computes it server-side.
- **[product]** Allow deleting an attached question that already has answers
  (destructive) or additive-only in v1? Current spec: additive-only.

## Timeline / Phasing

No hard external deadline. Suggested build order for P0: (1) models + migration +
catalog constant; (2) attach-on-create + vote-time capture (backend) with tests;
(3) `PollResultsModal` + breakdown endpoint with server-side suppression; (4)
consent/labeling copy + `docs/SECURITY.md` update + legal flag. Each as its own
commit (detailed body + Co-Authored-By trailer); Jeffrey decides every push.
