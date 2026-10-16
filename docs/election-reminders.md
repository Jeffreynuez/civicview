# Election reminders: the data format

Election reminders (`backend/app/services/election_reminders.py`) are
built from each state's `backend/app/data/<state>/elections.json` and
nothing else. **There is no list of states in the code.** A state gets
reminders as soon as its file has reminder dates with official sources,
so adding a state means adding data in the format below. No code change
is needed.

Every rule here is enforced by data lint E-11
(`cd backend && python3 tests/test_data_lint.py`), and the reminder job
skips anything that breaks one. A skipped reminder shows, with its
reason, under "Not sent, and why" in Admin, Election reminders.

## The rules

1. **Official sources only.** Use the Secretary of State, Division of
   Elections, Board of Elections, or the state statute. The lint accepts
   `https://` hosts ending in `.gov` or `.us`, plus the state domains
   listed in `OFFICIAL_HOST_SUFFIXES` in `tests/test_data_lint.py`. News
   sites, Ballotpedia, vote.org, county party sites and campaign sites
   are never sources.
2. **Read it before you write it.** Open the official page, find the
   date on it, and record that page as the source. A date you cannot
   confirm on an official page is left out. If it is a kind of
   reminder the state's rules rule out, record it in `no_reminder` (see
   below).
3. **Retrieved means the day you read it.** Each source gets the date
   you read the page, as `YYYY-MM-DD` in Eastern time, never in the
   future. When a date is checked again, update its retrieved date.
4. **Statewide dates only.** Every reminder is the same for every voter
   in the state. If a deadline or start date varies by county, there is
   no statewide date: use `no_reminder`.
5. **Neutral words.** Notes and text overrides never mention a
   candidate, a party, a measure or a position. No em or en dashes
   (check with Python for U+2014 and U+2013; grep character classes miss
   them).

## Fields

### `key_dates`: the dates

Every value is a string. `{phase}` is `primary`, `primary_runoff` or
`general`.

| Key | Value | Reminder sent |
| --- | --- | --- |
| `primary`, `primary_runoff`, `general` | `YYYY-MM-DD`, the election date | Election Day is tomorrow, on the day before |
| `voter_registration_deadline_{phase}` | `YYYY-MM-DD` | 3 days before (may go out a day late) and on the day before |
| `vote_by_mail_request_deadline_{phase}` | `YYYY-MM-DD`, the last day an application for a mail or absentee ballot must be received | 3 days before (may go out a day late) |
| `early_voting_window_{phase}` | `YYYY-MM-DD to YYYY-MM-DD`, the statewide early in-person voting period | Early voting starts tomorrow, on the day before the first date |
| `early_voting_optional_{phase}` | free text | none; shown on the ballot only |

Other keys in `key_dates` (and any key starting with `_`) are not read
by the reminders. Do not change existing dates without a source.

### `key_date_sources` and `key_date_retrieved`

These are siblings of `key_dates`, keyed by the same names. Every
reminder date of an election still ahead needs both, including the
election date itself:

```json
"key_date_sources": { "general": "https://...", "voter_registration_deadline_general": "https://..." },
"key_date_retrieved": { "general": "2026-10-15", "voter_registration_deadline_general": "2026-10-15" }
```

A source must be for a key that is in `key_dates`. A retrieved date must
be for a key that has a source.

### `voter_info`

| Field | Value | Used for |
| --- | --- | --- |
| `_note` | text | for people: what was checked and when |
| `official_site` | https URL, official | the link when no more specific link is set |
| `links.registration` | https URL, official | registration reminders |
| `links.mail_ballot` | https URL, official | mail ballot request reminders |
| `links.early_voting` | https URL, official | early voting reminders |
| `links.polling_place` | https URL, official: the state's polling-place lookup | Election Day reminders |
| `poll_hours` | `{"open": "HH:MM", "close": "HH:MM", "source_url": "https://...", "retrieved": "YYYY-MM-DD"}`, 24-hour local time, only if the state sets the hours statewide | "Polls are open from 7 a.m. to 7 p.m. local time." in the Election Day reminder, and its push expiry |
| `deadline_times` | `{"<key_dates key>": "HH:MM"}` | when that deadline falls that day (default 11:59 p.m.), which is when its push expires |
| `reminder_notes` | `{"<key_dates key>": "One sentence."}` | added to that date's reminders, for a rule a voter needs (Texas: received, not postmarked) |
| `reminder_text` | `{"<kind>": {"title": "...", "body": "..."}}` | replaces the standard wording when it would not be true in that state (Florida's county early voting days) |
| `no_reminder` | `{"<key_dates key>": {"reason": "...", "source_url": "https://...", "retrieved": "YYYY-MM-DD"}}` | a reminder the state's rules rule out, shown in the admin preview |

Kinds for `reminder_text`: `registration_3d`, `registration_1d`,
`mail_request_3d`, `early_voting_1d`, `election_day_1d`. Their
placeholders are `{state}` (the state's name), `{date}` (the event date,
"Monday, October 19"), `{start}` and `{end}` (the early voting window),
`{election}` ("November 3 general election"), `{note}` (that date's
`reminder_notes` sentence) and `{hours}` (the poll hours sentence). The
standard wording is `_TEMPLATES` in `election_reminders.py`.

## Example: Texas, November 3, 2026

The file also holds `races` and the rest; only the parts reminders read
are shown.

```json
{
  "state": "TX",
  "state_name": "Texas",
  "cycle": 2026,
  "key_dates": {
    "general": "2026-11-03",
    "voter_registration_deadline_general": "2026-10-05",
    "early_voting_window_general": "2026-10-19 to 2026-10-30",
    "vote_by_mail_request_deadline_general": "2026-10-23"
  },
  "key_date_sources": {
    "general": "https://www.sos.state.tx.us/elections/voter/important-election-dates.shtml",
    "voter_registration_deadline_general": "https://www.sos.state.tx.us/elections/voter/important-election-dates.shtml",
    "vote_by_mail_request_deadline_general": "https://www.sos.state.tx.us/elections/voter/important-election-dates.shtml",
    "early_voting_window_general": "https://www.sos.state.tx.us/elections/voter/important-election-dates.shtml"
  },
  "key_date_retrieved": {
    "general": "2026-10-15",
    "voter_registration_deadline_general": "2026-10-15",
    "vote_by_mail_request_deadline_general": "2026-10-15",
    "early_voting_window_general": "2026-10-15"
  },
  "voter_info": {
    "_note": "Checked on the official pages 2026-10-15.",
    "official_site": "https://www.votetexas.gov/",
    "links": {
      "registration": "https://www.votetexas.gov/register-to-vote/index.html",
      "mail_ballot": "https://www.votetexas.gov/voting-by-mail/index.html",
      "early_voting": "https://www.votetexas.gov/voting/where.html",
      "polling_place": "https://www.votetexas.gov/voting/where.html"
    },
    "poll_hours": {
      "open": "07:00",
      "close": "19:00",
      "source_url": "https://www.votetexas.gov/voting/where.html",
      "retrieved": "2026-10-15"
    },
    "deadline_times": { "vote_by_mail_request_deadline_general": "12:00" },
    "reminder_notes": {
      "vote_by_mail_request_deadline_general": "Your application must be received, not just postmarked, by then.",
      "early_voting_window_general": "Hours vary by location."
    }
  }
}
```

A reminder the state's rules rule out (Pennsylvania):

```json
"no_reminder": {
  "early_voting_window_general": {
    "reason": "Pennsylvania has no early voting period. ...; the start date varies by county.",
    "source_url": "https://www.pa.gov/agencies/vote/voter-support/mail-in-and-absentee-ballot/mail-ballot-before-election-day",
    "retrieved": "2026-10-15"
  }
}
```

## Adding a state that has no `elections.json`

Create `backend/app/data/<state>/elections.json` (the folder name is the
lowercase state code; DC is `dc`) with the fields above plus:

```json
{
  "state": "OH",
  "state_name": "Ohio",
  "cycle": 2026,
  "key_dates": {},
  "key_date_sources": {},
  "key_date_retrieved": {},
  "voter_info": {},
  "races": [],
  "ballot_measures": {}
}
```

The file can be committed without a `candidates.json`. Once it is
deployed, `/api/elections/<state>` returns it, so the state's Elections
tab shows these dates (with no races until they are added), and its
citizens get reminders from the next run of the job.

## Checks after editing

```
cd backend
python3 tests/test_data_lint.py        # E-11: sources, retrieved dates, official sites
python3 tests/test_election_reminders.py
python3 -c "import re,sys; t=open(sys.argv[1],encoding='utf-8').read(); print(len(re.findall('[\u2013\u2014]', t)))" app/data/<state>/elections.json
```

Then, on the deployed site, read the state's rows in Admin, Election
reminders: the wording, send dates, links and sources. A reminder goes
out at about 10 a.m. in each recipient's local time, only while
`ELECTION_REMINDERS_ENABLED` is set on the server.
