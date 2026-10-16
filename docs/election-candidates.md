# Election candidates: certified rosters

How races and candidate records are written in `backend/app/data/<state>/elections.json`
and `candidates.json`, and the rules every state follows. Data lint E-2, E-10 and E-13 to
E-17 (`backend/tests/test_data_lint.py`) enforce them; `backend/tests/test_certified_rosters.py`
checks the order, the badge and the wording.

## The rules

- **Complete or not shown.** A race lists every candidate on the state's certified list for
  the November ballot, including minor-party and independent candidates, or no candidate list
  at all. Never fewer, never extra, never someone who withdrew, lost a primary or was removed.
- **Official sources only.** The state's chief election office (Secretary of State, Division or
  Board of Elections) or state statute. Other sites may help find the official page; they are
  never the source.
- **Write-in candidates are left out.** Every verified race shows the same line, "Write-in
  candidates aren't listed.", with a link to the official list.
- **One order:** alphabetical by last name, then first name, in every race in every state. The
  backend sorts (`elections_service._sort_key`), so the data order does not matter.
- **Party labels exactly as the state's list prints them** (`party_label`), for example
  "Democratic", "REP", "No Party Preference", or "Democratic, Working Families" for a candidate
  on two party lines. A list that prints one string for a fusion candidate keeps it ("DEM/PROG"
  in Vermont); Alaska prints a ticket's two affiliations together ("Registered Democrat /
  Nonpartisan"). A candidate the list prints with no party has `party_label: ""` and no chip.
  The Ballot tab, the candidate page and Compare all show `party_label`. `party` stays a short
  code (D, R, L, G, I, NP, O) that only picks a color and drives the one-nominee-per-party check.
- **Nothing invented:** no bios, photos (except the congress.gov member photos the code already
  adds), websites or fundraising on a new record.

## A verified race

| Field | Meaning |
| --- | --- |
| `general_candidates` | Candidate ids on the certified list |
| `roster_status` | `"verified_nominees"` |
| `roster_source_url` | The certified list, on an official site |
| `roster_retrieved` | The day it was read (YYYY-MM-DD) |
| `write_in_list_url` | The state's write-in list, when it publishes one; otherwise the race links to `roster_source_url` |
| `incumbent_candidate_id` | The candidate who holds the seat now, or null |
| `open_seat` | True when nobody on the list holds the seat now |
| `notes` | Shown on the race. Fixed wording: "Open seat. The current representative, {name}, is not on the November ballot for this district.", "Open seat. Sen. {name} is not on the November ballot.", "Open seat. Gov. {name} is not on the November ballot.", "Open seat. The seat is vacant.", "Governor and Lieutenant Governor run together on one ticket.", "In {state}, the top two primary finishers advance to November, whatever their party." (California, Washington), "In Alaska, the top four primary finishers advance to November, whatever their party, and voters rank the candidates.", and for a special election the term it fills |
| `open_primary`, `open_primary_source_url` | The November ballot is an open primary for this office (Louisiana, U.S. House): every qualified candidate is listed, several of one party allowed, with the official page that says so (E-13) |
| `general_candidates_note` | Data only: which list, and that write-ins are not listed |

A race with no certified list keeps `general_candidates: []` and no roster fields. The Ballot
tab shows "Candidates for this race aren't listed yet. Your official sample ballot shows them."
with the sample ballot link from the state's official links. No race mixes certified and
unchecked candidates (E-13). The same applies to a federal or Governor race whose list could not
be confirmed in full: Massachusetts prints its Governor tickets by surname only and no official
source gives the independent ticket's first names, so that race is shown with no list. A state
with no confirmed list at all keeps its dates only.

## A candidate record

| Field | Meaning |
| --- | --- |
| `name` | The name as the certified list prints it, in mixed case when the list prints capitals (a surname printed in capitals inside a mixed case name too, as Hawaii does); a LAST, FIRST list is shown First Last; an office title before the name is dropped (Arkansas prints "Congressman Rick Crawford", and its official results site prints the same names without one) |
| `sort_name` | "Last, First" as the list writes the name (a LAST, FIRST list gives the surname) |
| `party`, `party_label` | See the rules above |
| `running_mate` | The Lieutenant Governor on a governor's ticket, as the list prints the name |
| `seeking_office` | "U.S. House, CA-6", "U.S. Senate, Texas", "Governor of New York" |
| `incumbent`, `current_office` | For a sitting member or governor |
| `bioguide_id` | Sitting members of Congress (congress.gov); powers the photo and the badge. Matched on the same last name and the same first name, a short form of it (Bob and Robert) or a name the other also uses; a first initial alone is not enough. One member links to one candidate in a state, the closest name (Alaska lists Dan S. Sullivan and Daniel J. Sullivan Jr. for one Senate seat). A member running for Governor keeps the link |
| `official_id`, `official_scope` | A sitting governor: `"<st>-exec-gov"`, `"state"` |
| `source_url` or `ballot_source_url` | The certified list the record was checked against |

People already in the data keep their record and id when they are on the certified list,
because follows, claims and posts are keyed on the id.

## Someone who is not on the November ballot

The record stays, so follows, posts and links keep working. It is taken off every race and marked
with the reason an official source gives:

| Reason | Fields | Wording |
| --- | --- | --- |
| Lost the primary | `eliminated`, `eliminated_note`, `eliminated_source` | "Did not advance past the {date} primary, according to {agency}." |
| Withdrew | `withdrawn`, `withdrawn_note`, `withdrawn_source` | "Withdrew before the November 3, 2026 general election, according to {agency}." |
| No official reason | `eliminated`, `ended_reason: "not_on_ballot"`, `eliminated_note`, `eliminated_source` | "Isn't on {the state's certified list} for the November 3, 2026 general election." |

Every ended record also gets `ended_recorded_on` (the day CivicView recorded it), or `ended_on`
with an official `ended_on_source` when the certification or withdrawal date is known. Without
either date the page would stay read-only and never archive (E-17).

The page then follows the settled lifecycle for former candidates
(`services/page_lifecycle.py`): "Former candidate for {office} ({year})", a 30-day farewell
window, archived three months after the date, one notice to each tracker. A `not_on_ballot`
ending reads neutrally everywhere: "CivicView recorded on {date} that {name} isn't on the 2026
general election ballot for {office}." It never claims a loss or a withdrawal.

## The "On ballot" badge

`services/ballot_status.py`: a record has the badge only when it is on a verified race's general
list, the race is printed (not an unopposed `uncontested_general` race), and the record is not
withdrawn, eliminated or a duplicate. A pointer written into an officials file is dropped when
served if that candidate is not on the ballot.

## Records nothing points to

Auto-generated records with nothing referring to them (no tracking, claimed page, posts, polls,
comments, events or notices, checked read-only in the production database) may be deleted.
Anything a person or a page refers to is kept, unused.
