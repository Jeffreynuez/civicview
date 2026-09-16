# Microsoft Store listing, corrected copy

Paste source for the Partner Center submission. 2026-09-16.
Status: attempted, **save failed with a server error**, work not persisted.

Partner Center path: Application overview, Start update, Store listings,
English (United States).

---

## Description

Pasted successfully into the field on 2026-09-16 but **not saved**. Repaste this
when the save works.

```
CivicView connects you with the people who represent you at every level of government and gives you the tools to understand and engage with them.

⚠️ NOT A GOVERNMENT APP
CivicView is an independent product of CIVICVIEW, INC., a Florida Benefit Corporation. It is not affiliated with, authorized by, or endorsed by any government agency, official, political party, or campaign, and it does not provide or facilitate any government services. It is an informational and civic-engagement tool only.

Find and follow your federal, state, and local representatives. See the bills they sponsor, the votes they cast, the committees they sit on, and the executive orders they sign. Each is paired with a plain-English, AI-generated summary so you can understand what's happening without wading through legalese.

WHAT YOU CAN DO
• Look up your representatives by address, all 50 states and 435 congressional districts
• Track reps, bills, and elections, and get notified when something changes
• Read neutral, sourced profiles for all 535 members of Congress, the executive branch, and the Supreme Court
• Follow verified pages where representatives and candidates post updates, run polls, and host events
• Vote in polls, react, and join the conversation as a verified constituent
• Compare how officials vote and where they stand

WHERE OUR INFORMATION COMES FROM
All government information in CivicView comes from the public sources listed below. This is the complete list of the sources we use:
• U.S. Congress (bills, members, committees, and votes): https://www.congress.gov
• GovTrack (congressional votes and member data): https://www.govtrack.us
• The @unitedstates project (public-domain congressional rosters, committees, offices, and photos): https://unitedstates.github.io/congress-legislators
• U.S. House of Representatives, Office of the Clerk (roll-call votes): https://clerk.house.gov
• U.S. Senate (roll-call votes): https://www.senate.gov
• Federal Register (executive orders): https://www.federalregister.gov
• CourtListener / Free Law Project (federal courts, including the U.S. Supreme Court): https://www.courtlistener.com
• Federal Election Commission / OpenFEC (candidates and campaign finance): https://www.fec.gov
• Open States (state legislatures: members, bills, votes): https://openstates.org
• Google Civic Information API (matching your address to officials and elections): https://developers.google.com/civic-information
• U.S. Census Bureau Geocoder (matching your address to a district): https://geocoding.geo.census.gov
• OpenStreetMap / Nominatim (address lookup fallback): https://www.openstreetmap.org

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

## Product features

Separate fields, one row each. **This field is easy to miss and it had em dashes
in it.**

**Row 1. Was fixed on screen, not saved.**

```
Look up your representatives by address in all 50 states
```

**Row 5. Still needs fixing.**

```
Follow verified rep and candidate pages: posts, polls, and events
```

Rows 2, 3, 4 and 6 were clean as written:

- Track reps, bills, and elections with notifications when things change
- Neutral, sourced profiles for Congress, the executive branch, and SCOTUS
- Plain-English AI summaries of bills, votes, and executive orders
- Vote in polls and join the conversation as a verified constituent

"Plain-English" is a compound hyphen and stays.

**Check below row 6.** The panel was cut off there and the field takes up to 20.
The Description carries a seventh item, "Compare how officials vote and where
they stand," so there is probably at least one more row to inspect.

---

## Short description: NOT YET LOCATED

The Store search result and the top of the product page show this, which is not
the first line of the Description, so it comes from its own field:

> See your representatives' votes, track bills and elections, and make your voice
> heard — non-partisan, sourced, and free to browse. An independent civic...

It was not on the visible part of the Store listing form. Scroll past the
screenshots and Store logos block to find it.

Corrected, for the portion that was readable:

```
See your representatives' votes, track bills and elections, and make your voice heard. Non-partisan, sourced, and free to browse. An independent civic
```

The Store truncated the tail on screen. **Read the rest of that field and check
it for one more dash** before saving.

---

## The save failure

Error shown: "We are unable to save listing. Please reload the page or try again
later."

That is a Partner Center service-side error, not a validation error. Nothing in
the pasted content caused it, and no field was rejected.

Things worth trying on the retry:

- Sign out of Partner Center completely and back in. A stale session is the most
  common cause of this message.
- Save in smaller steps: paste the Description, save, then do Product features,
  save again. A large single save is more likely to time out.
- Use a different browser or a private window to rule out a cached session.
- If it persists for more than a day, Partner Center has a Contact Support link
  on the Application overview.

**Nothing is lost.** The corrected text lives in this file, so a reload costs
nothing but the retyping time.

---

## What still has to happen after the save works

1. Product features row 5, plus anything below row 6.
2. Locate and fix the short description.
3. Submit the submission. Certification runs roughly 24 to 72 hours.
4. Sync `docs/microsoft_store_listing.md` so the repo copy is not stale.
