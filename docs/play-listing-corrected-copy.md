# Google Play listing, corrected copy

Paste-ready. 2026-09-16. Three classes of change and nothing else:
em dashes removed, the paid tier corrected, no other wording touched.

---

## Short description

Replace with this. 75 of 80 characters.

```
See your reps' votes, track bills, and engage your democracy. Non-partisan.
```

---

## Full description

Replace the whole field with this.

```
CivicView connects you with the people who represent you, at every level of government, and gives you the tools to understand and engage with them.

⚠️ NOT A GOVERNMENT APP
CivicView is an independent product of CIVICVIEW, INC., a Florida Benefit Corporation. It is not affiliated with, authorized by, or endorsed by any government agency, official, political party, or campaign, and it does not provide or facilitate any government services. It is an informational and civic-engagement tool only.

Find and follow your federal, state, and local representatives. See the bills they sponsor, the votes they cast, the committees they sit on, and the executive orders they sign. Each is paired with a plain-English, AI-generated summary so you can understand what's happening without wading through legalese.

WHAT YOU CAN DO
- Look up your representatives by address across all 50 states and 435 congressional districts
- Track reps, bills, and elections, and get notified when something changes
- Read neutral, sourced profiles for all 535 members of Congress, the executive branch, and the Supreme Court
- Follow verified pages where representatives and candidates post updates, run polls, and host events
- Vote in polls, react, and join the conversation as a verified constituent
- Compare how officials vote and where they stand

WHERE OUR INFORMATION COMES FROM
All government information in CivicView comes from the public sources listed below. This is the complete list of the sources we use:
- U.S. Congress (bills, members, committees, and votes): https://www.congress.gov
- GovTrack (congressional votes and member data): https://www.govtrack.us
- The @unitedstates project (public-domain congressional rosters, committees, offices, and photos): https://unitedstates.github.io/congress-legislators
- U.S. House of Representatives, Office of the Clerk (roll-call votes): https://clerk.house.gov
- U.S. Senate (roll-call votes): https://www.senate.gov
- Federal Register (executive orders): https://www.federalregister.gov
- CourtListener / Free Law Project (federal courts, including the U.S. Supreme Court): https://www.courtlistener.com
- Federal Election Commission / OpenFEC (candidates and campaign finance): https://www.fec.gov
- Open States (state legislatures: members, bills, votes): https://openstates.org
- Google Civic Information API (matching your address to officials and elections): https://developers.google.com/civic-information
- U.S. Census Bureau Geocoder (matching your address to a district): https://geocoding.geo.census.gov
- OpenStreetMap / Nominatim (address lookup fallback): https://www.openstreetmap.org
We do not use any other sources of government information.

Photos of members and officials come from the @unitedstates project and Wikimedia Commons / Wikipedia (https://commons.wikimedia.org).

NON-PARTISAN BY DESIGN
CivicView takes no political side. Officials' data is neutral and sourced; AI-generated summaries are written to inform, not persuade.

NO ADS. NO VENTURE CAPITAL.
Browsing is free, forever. Commenting and voting require identity verification, not payment. An optional $5/month subscription adds the ability to create your own polls. That is the entire business model: no advertising, and we do not sell your data.

BUILT ON TRUST
Real verified identities. Transparent moderation with an appeals process. Your data is yours: full account deletion is available at any time, right from the app.

Democracy works better when people can see it clearly. CivicView is here to help.

CivicView is an independent civic-information service and is not a government entity. (civicview.app)
```

---

## What changed, line by line

**Seventeen em dashes, all removed.**

| Where | Was | Now |
| --- | --- | --- |
| Short description | democracy — non-partisan | democracy. Non-partisan. |
| Opening line | you — at every level — and | you, at every level, and |
| Paragraph 3 | they sign — each paired | they sign. Each is paired |
| First bullet | by address — all 50 states | by address across all 50 states |
| 12 source lines | Name — purpose: URL | Name (purpose): URL |
| Business model | business model — no advertising | business model: no advertising |

Each follows your own substitution rules: a parenthetical aside becomes commas,
a dash introducing an explanation becomes a period or a colon, and a dash
labelling a list item becomes parentheses.

**The paid tier, corrected.** This is the substantive fix.

Was:

> An optional $5/month subscription unlocks engagement features (creating polls and commenting) for verified citizens.

Now:

> Commenting and voting require identity verification, not payment. An optional $5/month subscription adds the ability to create your own polls.

The old text has been wrong since 2026-07-28, when commenting moved down from the
subscriber tier to the verified tier. It is also a weaker pitch than the truth:
"commenting is free, verification is the bar" reads far better than "pay to
comment," which is the thing you moved away from precisely because a paywall on
speech is the wrong signal for a civic platform.

---

## What was deliberately NOT touched

**The sources block keeps every factual claim intact.** Same twelve sources, same
purpose descriptions, same URLs, same closing sentence "We do not use any other
sources of government information." Only the punctuation between the source name
and its purpose changed. That block is the text that cleared the second
Misleading Claims rejection on 2026-07-05, and nothing in this edit alters what
it asserts.

**The NOT A GOVERNMENT APP disclaimer is untouched,** including the warning
emoji. That is what cleared the first rejection.

**Compound hyphens are left alone:** plain-English, roll-call, public-domain,
non-partisan, AI-generated, civic-engagement, civic-information. Your rule
removes em dashes and en dashes, not hyphens inside compound words.

---

## One judgment call I am leaving to you

The listing says "Vote in polls, react, and join the conversation as a verified
constituent" and "Real verified identities." ID.me is not live yet, so today that
runs on demo accounts with verification grants.

Arguments for leaving it: the app carries a DEMO PREVIEW badge in the navbar and
in your own store screenshots, so nobody is misled in practice, the description
describes what the product does rather than promising a date, and Google already
reviewed and approved this wording.

Argument for changing it: you are about to send journalists to this page, and one
who signs up will meet a demo account rather than ID verification.

I would leave it. Adding "coming soon" language to a store listing invites its
own policy problems, and the in-app badge already does the disclosure honestly.
But it is your call and it is a real gap.

---

## After you paste

- Check the character counter on the full description. Play caps it at 4,000 and
  this runs roughly 3,500.
- Sync `docs/playstore_listing.md` in the repo to match, or it becomes the stale
  copy the next session trusts.
- The same paid-tier error is live on the Microsoft Store listing. Fix it there
  in the same Partner Center submission as the dash fixes.
