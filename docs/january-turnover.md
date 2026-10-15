# January turnover

Every odd-numbered January a new Congress is sworn in, and most state
legislatures seat their new members. The terms of the 120th Congress
begin at noon Eastern on Sunday, January 3, 2027 (the Twentieth
Amendment sets that hour for every Congress). This page is the checklist
for the first week or two of January. Nothing on it needs doing before
then.

## What switches by itself

These follow the date, so nobody has to change a number:

- **The current Congress.** From noon Eastern on January 3, the backend
  (`backend/app/services/congress_calendar.py`) and the frontend
  (`frontend/lib/congress.js`) both say 120. That moves the recent
  votes on /bills, the president's signed and vetoed bills, and the
  "National officials · 120th Congress" heading on the home page.
- **Address lookups.** The Census geocoder is asked for the 120th
  Congress's districts (the `Current_Current` vintage) instead of the
  119th's (`ACS2025_Current`). In states that redrew for 2026 this
  changes answers: downtown Austin goes from TX-37 to TX-10.
- **The map's district outlines** switch to the "120th Congressional
  Districts" layer on TIGERweb.
- **Member lists** come from Congress.gov and the @unitedstates roster
  at runtime, so new members appear as soon as those sources add them,
  usually within a day or two.

If the Census geocoder or TIGERweb has not published the 120th maps
yet, the app keeps using the 119th maps and logs a warning that starts
"Census geography returned 119th Congressional Districts, not 120th
Congressional Districts". If
that happens and you need to force a vintage, set
`CENSUS_GEOCODER_VINTAGE` in Render and restart.

## Step 1: state officials

Most legislatures seat new members in early January (a few in December
or later). Once yours have, follow "Refreshing state officials" in the
README:

```
cd backend
python scripts/refresh_state_officials.py --all              # read the whole report
python scripts/refresh_state_officials.py --state TX --write # write a batch of states
```

- Confirm every new governor and statewide officeholder on the state's
  own website, and give each one a short, neutral bio with sources.
- Confirm party changes on the legislature's own site. Use the word the
  site uses ("Unaffiliated", "Nonpartisan", "Not Affiliated" and so
  on); if it differs from Open States, add a party entry to
  `backend/app/data/state_officials_corrections.json` with the URL.
- Write and commit about ten states at a time.

## Step 2: the federal roster

Wait until the @unitedstates project has added the new members (the
script tells you if it has not), then:

```
cd backend
python scripts/refresh_congress_roster.py --check-photos     # dry run: read the report
python scripts/refresh_congress_roster.py --write            # save it
```

The report lists:

- **New members with no profile.** Write each one a short, neutral bio
  and three Areas of Focus in `congress_profiles.json`, in the style of
  the existing ones. Cite a specific page for each statement: a bill
  on congress.gov, the member's House Clerk or senate.gov committee
  page, never just a home page. Never copy campaign language.
- **Members who changed seat** (House to Senate, or a new district):
  check their bio, experience and Areas of Focus still read true.
- **Departed members.** The script marks them `former_member`. Rewrite
  each bio in the past tense with the date they left and how (the House
  Clerk's vacancies page, or senate.gov's lists of senators who
  resigned, died or were appointed). Close any "to Present" in their
  experience and remove stances that describe a role they no longer
  hold.
- **Missing photos.** For a new member the image mirror has no photo
  for yet, add an official portrait to `congress_photo_overrides.json`
  and run `python scripts/build_photo_credits.py --write`. Remove an
  override once the mirror has the photo (the photo-credits script
  says so).
- **Party counts** that differ from `federal_officials.json`, and
  vacant seats.

Then update `backend/app/data/federal/federal_officials.json` by hand:

- `congress.congress_number` to 120, and `_source_as_of`.
- Congressional leadership, after the Speaker election on January 3
  and the party leadership votes (House Clerk and senate.gov).
- The Senate and House party counts and the vacancies note, from the
  House Clerk and senate.gov.
- Any Cabinet change.

## Step 3: elections

The 2026 races are over. Check that no candidate file still describes a
2026 race as upcoming, and that incumbents in the CA, NY, PA and TX
`candidates.json` and `elections.json` point at people who hold the
seat. Do not regenerate those files with
`build_state_federal_candidates.py`.

## Step 4: look at the pages

On the deployed site (or a local run), open:

- a new senator's and a new representative's profile,
- a departed member's profile (it should say "Former member of
  Congress"),
- a member who changed seat,
- an address lookup in a redrawn state (100 Congress Ave, Austin, TX
  should give TX-10), and a district with a vacancy if there is one,
- the map for a state that redrew.

## Step 5: checks and commit

```
cd backend
python tests/test_data_lint.py
python -m pytest
cd .. && ruff check backend/app
```

Commit the state batches, the roster and the profile edits as separate
commits with sources in each message, and open one pull request.
