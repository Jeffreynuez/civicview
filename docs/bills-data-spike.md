# Bills & Votes — Data-Layer Spike Findings

**Date:** 2026-05-30
**Author:** Claude Cowork (for Jeffrey)
**Companion docs:** `docs/bills-feature-prd.md`, `docs/bills-feature-design-handoff.md`
**Verdict:** **GO.** Both official feeds are clean and machine-readable, and both
ID mappings resolve with data already in the repo. The only open item is how to
*enumerate* recent House votes (the per-vote data itself is solid).

---

## Why this spike

Phase A of the Bills feature needs two new endpoints — `/api/votes/recent` and
`/api/votes/{vote_id}/members` — fed by official roll-call data (hybrid plan:
official XML as source of truth, GovTrack as fallback). The two risks called out
in the PRD were (a) whether the official XML exposes recent passage + nomination
votes in a parseable shape and (b) mapping Senate's member IDs to our bioguide
IDs. This spike validated both against live feeds.

---

## What already exists (reuse, don't rebuild)

From `backend/app/services/congress_service.py` + `backend/app/data/_cache/`:

- Vote data today comes from **GovTrack `/api/v2/vote_voter`**, cached in-memory
  (30-min TTL). Per-member votes only (one member across many votes).
- **bioguide → govtrack** mapping reads the vendored
  `backend/app/data/_cache/legislators_current.json` (from
  unitedstates/congress-legislators). **That same file already carries `id.lis`
  for every senator and `id.bioguide`** — i.e. the LIS↔bioguide crosswalk we need
  is already on disk.
- Members are **not** persisted in the DB; `RepAccount.official_id` = bioguide for
  federal reps. No `lis_id` column anywhere (not needed — see mapping below).
- httpx clients use 15–25s timeouts, no retry/circuit-breaker. Congress.gov calls
  use `CONGRESS_API_KEY`. No official House/Senate XML is fetched today.

---

## Feed 1 — House Clerk roll-call XML  ✅

**Per-vote URL:** `https://clerk.house.gov/evs/{year}/roll{NNN}.xml`
(e.g. `…/evs/2026/roll001.xml`; `NNN` zero-padded to ≥3 digits). Fetched live, OK.

**Shape:**
- `<vote-metadata>`: `congress`, `session`, `chamber`, `rollcall-num`, `legis-num`
  (e.g. `QUORUM`, `H R 1041`), `vote-question`, `vote-type`
  (`YEA-AND-NAY` / `RECORDED VOTE` / `QUORUM`), `vote-result`, `action-date`
  (`6-Jan-2026`), `action-time`, and `<vote-totals>` broken out **by party** and
  **by vote** (yea / nay / present / not-voting).
- `<vote-data>` → many `<recorded-vote>` →
  `<legislator name-id="A000370" party="D" state="NC" role="legislator">Adams</legislator><vote>Present</vote>`.
- `<vote>` values: `Yea` / `Nay` / `Present` / `Not Voting` (also `Aye`/`No` on
  some question types — normalize).

**ID mapping — trivial:** `name-id` **IS the bioguide ID**. Direct match to
`RepAccount.official_id`. No crosswalk needed for the House.

**Independents:** party emitted as `R` / `D` / `I` (also `I` totals row present).

## Feed 2 — Senate LIS roll-call XML  ✅

**Recent-votes index URL:**
`https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml`
(e.g. `…vote_menu_119_2.xml`). Fetched live, OK — this is a ready-made
recent-votes list: each `<vote>` has `vote_number`, `vote_date` (`12-Mar`),
`issue` (`H.R. 7147`, `PN711`), `question`, `result`, `<vote_tally>`, `title`.

**Per-vote URL:**
`https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{NNNNN}.xml`
(e.g. `…/vote1192/vote_119_2_00053.xml`; `NNNNN` zero-padded to 5). Fetched live, OK.

**Shape:**
- Header: `congress`, `session`, `congress_year`, `vote_number`, `vote_date`
  (`March 12, 2026, 11:33 AM`), `question`, `vote_result` / `vote_result_text`
  (`Bill Passed (89-10)`), a structured `<document>` (type/number/title), and
  `<count>` (yeas/nays/present/absent).
- `<members>` → `<member>` with `member_full`, `last_name`, `first_name`, `party`
  (`R`/`D`/`I`), `state`, `vote_cast` (`Yea`/`Nay`/`Not Voting`/`Present`), and
  **`lis_member_id`** (`S428`).

**ID mapping — resolved:** Senate uses `lis_member_id`, **not** bioguide. Map it
via the vendored `legislators_current.json` (`id.lis` → `id.bioguide`). Confirmed
the file already has both. Build a small in-memory `lis → bioguide` dict on load
(same pattern as the existing govtrack-id resolver).

---

## Vote-type filtering (v1 = passage + nominations)

The chamber decides where the signal lives:
- **House:** bills only (House casts no nomination votes). Keep `vote-type` in
  {`YEA-AND-NAY`, `RECORDED VOTE`} with a passage-style `vote-question` (e.g.
  "On Passage", "On Motion to Suspend the Rules and Pass"). Drop `QUORUM`,
  procedural, and amendment votes for v1.
- **Senate:** filter the menu's `<question>` to **`On Passage of the Bill`**,
  **`On the Nomination`**, and passage of joint resolutions. Exclude
  `On the Cloture Motion`, `On the Motion to Proceed`, `On the Amendment`,
  `On the Motion to Table`, points of order, etc. (The menu makes this a simple
  string filter — confirmed against `vote_menu_119_2.xml`, which is mostly
  cloture/nomination/amendment traffic with clearly-labeled passage + nomination
  votes mixed in.)

---

## The House recent-list item — RESOLVED (2026-05-31)

The **Senate** has a perfect recent-list feed (`vote_menu`). The **House** has no
equivalent XML — but the **Congress.gov API House Roll Call Vote endpoints**
(beta, 118th Congress onward; LoC + House Clerk partnership) close the gap and
are now wired in as the primary House enumerator.

Endpoints (confirmed against the official docs):
- **List:** `GET /v3/house-vote/{congress}/{session}` — newest votes with
  `rollCallNumber`, `startDate`, `result` (Passed/Failed/Agreed to),
  `legislationType` (HR/HJRES/HCONRES/HRES) + `legislationNumber`, `voteType`.
  (No per-vote question or tally at the list level — those are item/member level.)
- **Members:** `GET /v3/house-vote/{congress}/{session}/{num}/members` — per-member
  `bioguideId` + `voteCast` (Aye/Nay/Present/Not Voting) + `voteParty` + `voteState`,
  plus `voteQuestion` / `result` / `legislationType` at the top. **bioguide is
  native** — no name mapping needed.

Integration (in `official_votes_service.py`, all gated behind `CONGRESS_API_KEY`
with fallbacks so it can't break the working feature):
- House recent enumeration → **Congress.gov list (primary)**, GovTrack (deprecated)
  as last-resort fallback. The list has no tally, so the lead row's tally +
  question are enriched from its per-vote detail (one bounded extra fetch — that
  row feeds the home Bills card).
- House per-member detail → **Clerk EVS XML (primary, already tested)**, with the
  **Congress.gov members endpoint as a second official fallback**.
- Amendment votes (`HAMDT`) and non-House bill types filtered out; rows sorted
  newest-first by roll number.
- `current_congress_session()` derives congress/session from the date (replaces
  the pinned 119/2); `year_for()` replaces the hardcoded 2025/2026 EVS-year map.

**Parsers unit-tested offline** (`backend/tests/test_official_votes.py`) AND
**live-validated** against `api.congress.gov` (2026-05-31, real key):
- List `GET /v3/house-vote/119/2` returned the documented shape
  (`houseRollCallVotes[]` with `rollCallNumber`/`legislationType`/
  `legislationNumber`/`result`/`startDate`/`voteType`). Surfaced one real case:
  the House also votes on **Senate-originated bills** (`legislationType: "S"`),
  now included in the filter (+ S./S.J.Res. cites).
- Members `GET /v3/house-vote/119/2/{n}/members` wraps members as
  **`houseRollCallVoteMemberVotes.results` = a direct array** (not `results.item`),
  with member fields **`bioguideID`** (capital ID), `voteCast` (full words —
  "Yea"/"Not Voting"…), `voteParty`, `voteState`, `firstName`, `lastName`. The
  parser handles this exactly (defensive `bioguideId|bioguideID`, list/`item`
  branch, `normalize_position`); proven against the live shape.

The tested Clerk-XML + GovTrack fallbacks remain in place as a safety net.

---

## Proposed endpoint shapes

**`GET /api/votes/recent?chamber=house|senate&limit=N`**
Returns recent passage/nomination votes for the chamber, newest first:
```
[{ vote_id, chamber, congress, session, number, date,
   bill: { type, number, title } | nomination: { pn, title },
   question, result, tally: { yea, nay, present, not_voting },
   by_party: { R:[y,n], D:[y,n], I:[y,n] } }]
```
- Senate source: `vote_menu` XML (filter by question).
- House source: Congress.gov enumeration (filter by type), tally from per-roll
  XML totals.

**`GET /api/votes/{vote_id}/members`**
Returns every member's position for one roll-call (the seat-chart backbone):
```
[{ bioguide_id, name, state, party, position }]   // position ∈ Yea|Nay|Present|Not Voting
```
- House: parse `recorded-vote` (name-id = bioguide).
- Senate: parse `member` (lis_member_id → bioguide via crosswalk).

**`vote_id` scheme:** `h-{congress}-{session}-{rollnum}` /
`s-{congress}-{session}-{votenum}` (e.g. `h-119-2-1`, `s-119-2-53`). Unambiguous
and reversible to the source XML URL. Note: differs from the existing
GovTrack-derived `h114-310` scheme — keep the official scheme for this pipeline
and translate when GovTrack is the fallback.

---

## Caching & resilience

- Roll-call results are **immutable once recorded** → cache per-vote member data
  aggressively/indefinitely by `vote_id`. The recent-list cache gets a short TTL
  (e.g. 5–15 min) since new votes land during sessions.
- Persisting beyond the current in-memory cache is worth considering (a small
  `vote_cache` table) so cold starts don't re-fetch, but in-memory is fine for v1.
- Add a **fallback chain**: official XML → GovTrack → cached/empty with a clear
  "couldn't load" state (matches the design's fetch-failure card).
- Reuse existing httpx timeouts; add a light retry (1 retry) on the official XML
  fetches since gov endpoints occasionally hiccup.

---

## Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| House recent-vote enumeration source unconfirmed | Medium | Validate Congress.gov house-vote endpoint first thing in build; GovTrack + EVS index as fallbacks |
| `vote_cast` / `<vote>` value variants (Aye/No vs Yea/Nay) | Low | Normalize in the parser |
| LIS id missing for a brand-new senator not yet in vendored JSON | Low | Refresh `legislators_current.json` on a schedule; fall back to name+state match |
| Member voted but not in our member dataset (e.g., just-seated) | Low | Render seat with name from the XML; profile link degrades gracefully |
| Senate `vote_date` lacks year in the menu | Low | Use `congress_year` header or the per-vote full date |
| Official endpoint downtime | Low | GovTrack fallback + cache |

---

## Recommendation

**Proceed to build Phase A.** Suggested order:
1. Add an `official_votes` service: per-roll House + Senate XML parsers
   (`xml.etree`), the `lis→bioguide` crosswalk loader, and value normalization.
2. Confirm the Congress.gov House enumeration endpoint; wire the recent-list
   builder for both chambers.
3. Expose `/api/votes/recent` + `/api/votes/{vote_id}/members` with the
   GovTrack-fallback chain + caching.
4. Then the frontend `/bills` page per the (now-locked) design handoff.

No blockers. The data foundation is real and mostly already in the repo.
