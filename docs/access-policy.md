# Access and Neutrality Policy

Draft for review. Not published. Intended location: civicview.app/access-policy,
linked from the footer and from the About page.

---

## Why this page exists

CivicView is a civic platform that carries the pages of elected officials and
candidates from both major parties, minor parties, and no party. A platform like
that gets one question over and over, from people on every side: what are the
rules, and are they the same for me as they are for the other guy.

This page is the answer, written down in advance so it does not have to be
improvised later. It is a commitment, not a description of a mood. If CivicView
ever departs from it, that is a fact you can point at.

## 1. Equal access

Any elected official, declared candidate, or organization may use CivicView on
the same terms as any other. Eligibility does not depend on party, ideology,
platform, endorsements, or who else is already here.

Accounts for officials and candidates are opened after a manual identity check
by CivicView staff (today, the founder). The check confirms two things: that you
are who you say you are, and that you hold or are running for the office you
name. It does not consider party, positions, or anything you have said, and an
account is not refused for any other reason.

## 2. No paid placement

No one can pay CivicView for visibility, ranking, priority in search, placement
on the home page, or any form of promotional treatment. No advertising is sold
against political content.

CivicView plans a paid tier for citizens. It will buy the ability to create
polls. It will not buy audience, reach, or position.

## 3. The same rules for every office

An officeholder's page is built the same way regardless of who holds the office.
The data shown, the sources used, the fields displayed, and the way records are
presented follow one specification. Where a record is thin, it is thin for
everyone. Where a record is missing, we say it is missing rather than filling
the gap.

## 4. Sources are published

Every source CivicView draws on is named here.

Government sources: Congress.gov; GovTrack; the @unitedstates project; the House
Clerk and the U.S. Senate; the Federal Register; CourtListener; the Federal
Election Commission; Open States; the Florida Department of State and Division
of Elections; Google Civic Information and the U.S. Census Geocoder; and the
official websites of the offices themselves (White House, Congress, state, court
and city websites) for names, contact details and biographies.

Other sources, each linked where it appears: photos from the @unitedstates
project, Wikimedia Commons, official websites, and image links published by Open
States, some hosted by Ballotpedia; some candidate details from campaign
websites, news reports, Ballotpedia and Wikipedia; maps and address lookup from
OpenStreetMap, CARTO and U.S. Census boundary data. Plain-English summaries and
state legislators' focus areas are written by Claude (Anthropic) and labeled
AI-generated.

We use no other sources.

These are public data providers whose APIs we call. They are not partners,
sponsors, or affiliates, and their inclusion implies nothing about their view of
CivicView.

Where CivicView combines records in a way the original source does not, that
combination is labeled as our editorial judgment rather than presented as the
source's fact.

## 5. The code is open to inspection

CivicView's source is public at github.com/Jeffreynuez/civicview. Anyone can
read how a page is assembled, how a ballot is validated, and what happens to a
record we cannot verify. A claim on this page that the code contradicts is a
claim you should not accept.

## 6. What CivicView does not do

- We do not infer anyone's political leaning, and we do not score, rank,
  segment, or target people by it. Some polls carry optional questions the
  poll's creator chose, such as party affiliation. Answers are self-reported and
  optional, counted only from verified accounts, and published only as totals
  for groups of at least 10 people, never tied to a person.
- We do not sell placement, and we do not sell the ability to reach a specific
  group of users.
- We do not remove lawful content because a person or organization with
  influence objected to it.
- We do not fabricate. If we do not have a fact, the field is empty or the
  record says the fact is unavailable.

## 7. How content comes down

Content on CivicView comes down only in these ways:

- **Reports.** Signed-in citizens and officials can report a post, poll or
  comment. A person reviews reports under the published editorial standards
  and decides whether the content stays or is hidden. If enough reports from verified accounts
  arrive (five by default), the content is hidden automatically until that
  review happens. Reports from demo accounts go to review but never count
  toward that automatic step. The author can appeal a decision.
- **Account suspension.** An administrator can suspend an account that breaks
  the Terms of Service, for example for threats, impersonation or spam, and can
  hide that account's content along with it. This is the one path that does not
  start with a report on a specific item.
- **Threat screening, in testing.** An automated check for genuine threats is
  being tested. Today it only records its assessments. It removes nothing.

There is no administrator button that removes a single post, poll or comment
without a report. This constraint is deliberate and it cuts against the
operator's own convenience, which is the point of writing it down.

## 8. Independence

CivicView, Inc. is a Florida Benefit Corporation with a single founder. It has
accepted no money from any political party, campaign committee, political action
committee, or advocacy organization, and it will not accept money from those
sources in exchange for any treatment described on this page.

CivicView is not a certified B Corporation. Benefit corporation is a legal
status granted by the State of Florida. The two are different and we do not
claim the second.

## 9. If you think we got something wrong

Errors in public records are common and CivicView inherits them. If a record on
this platform is wrong, report it and we will trace it to the source, correct
what is ours to correct, and say which part came from upstream.

If you believe this policy was violated, say so in writing. Where the answer is
general enough to matter to other people, the answer gets published.

## 10. Changes

This page is versioned. Material changes are dated and the previous version
remains readable.

Last updated: [DATE ON PUBLICATION]

---

## Notes for Jeffrey, remove before publishing

Rewritten 2026-09-24 after the code audit, so every section describes what the
code does today. What changed and what still needs you:

1. **Section 1** now describes the manual identity check instead of denying
   one. Candidates are approved by an admin after verification and reps are
   onboarded by email; the Terms already say "manual verification by CivicView
   staff".
2. **Section 2** describes the paid tier as planned, since it is not live yet
   (demo citizens are granted the subscriber features).
3. **Section 4** now carries the same source list as the corrected store
   listings. Keep the three in sync.
4. **Section 6** discloses the optional poll questions (party, and on some
   polls race, religion and income) instead of implying none are collected.
5. **Section 7** describes the three paths that exist. Automatic hiding now
   counts only reports from verified accounts and reps, the admin cannot hide a
   single item without a report, suspension with content hiding is disclosed,
   and threat screening is described as in testing. There is no admin audit
   table yet and the suspension reason is optional, so the page makes no claim
   about records. Requiring a reason and adding an audit table would let it
   promise one; that is a follow-up, not in this batch.
6. **Section 8, the funding sentence** still needs your confirmation. If any of
   it is not exactly true, cut the sentence rather than soften it.

**One thing this page cannot do.** It is worth being clear about the limit.
A published neutrality policy is the right thing to have and it will help you
in ordinary disputes. It will not protect you from a determined bad-faith
attack. ERIC was a nonpartisan interstate compact run by state election
officials, with published rules, and nine member states withdrew between January
2022 and October 2023 after a run of articles about its funding history. Several
officials who withdrew said publicly that the tool worked. Virginia, which left
in 2023, did not resume membership until April 30, 2026. CTCL was cleared by
courts and regulators and twenty-nine states restricted or banned private
election funding anyway. The correction, when it comes, arrives late and does not
restore the position.

So publish this because it is true and because you want it to be your own
standing answer. Do not publish it believing it is armor.
