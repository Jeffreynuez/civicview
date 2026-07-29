# CivicView — Microsoft Store Listing Package (Windows desktop, via PWABuilder)

Paste-ready content + step-by-step runbook for publishing the CivicView
PWA to the Microsoft Store on Windows. Companion to
`docs/playstore_listing.md` (Android) — the listing copy is adapted from
there so the two stores stay consistent, including the language that
survived Google's Misleading-Claims reviews.

**How this works:** the Microsoft Store package is a thin MSIX generated
by PWABuilder that installs the civicview.app PWA (commit `4620059` —
manifest + PNG install icons + service worker, already deployed). The
installed app loads the live site, so day-to-day updates ship via Vercel
with **no store resubmission**. You only resubmit if the app identity,
manifest URL, or store listing itself changes.

> Prerequisite (DONE 2026-07-24): the PWA must be live at
> https://civicview.app with the PNG-icon manifest. It is.

---

## 0. One-time: Microsoft Partner Center company account (FREE)

Registration fees were eliminated (individuals earlier; **company
accounts free as of May 2026**). Target: **company account for
CIVICVIEW, INC.** — matches the verified Google Play org account, and the
listing shows "Published by CIVICVIEW, INC."

1. Go to Partner Center → enroll in the **Microsoft Store program**
   (developer account). Sign in with a Microsoft account you control
   long-term.
2. Choose **Company** account type. Legal entity: **CIVICVIEW, INC.**
   (Florida Benefit Corporation, Sunbiz doc `#800474911808`, ACTIVE).
3. **Business verification** — two paths, pick one:
   - **DUNS number** (fastest, automated). If CIVICVIEW, INC. doesn't
     have one, a free DUNS can be requested from Dun & Bradstreet
     (takes days); OR
   - **Official documents** (manual review, 2–5 business days): upload
     the Sunbiz **Articles of Incorporation / certificate of status**.
     The EIN letter can serve as a supporting tax document.
4. **Contact / employment verification:** they prefer a work email on
   your domain. `jeffreynuez1@gmail.com` won't match `civicview.app`, so
   either:
   - (Recommended, 10 min) create `jeffrey@civicview.app` via Cloudflare
     **Email Routing** (free — routes to the Gmail inbox) and use that; or
   - provide **domain-ownership proof** for civicview.app (registrar
     invoice / Cloudflare account record) when asked.
5. Verification emails arrive as the review progresses; the account is
   usable for name reservation once approved.

---

## 1. Reserve the app name + grab the package identity

1. Partner Center → **Apps and games** → **New product** → **App** →
   reserve the name **CivicView**. (If squatted, fallback:
   `CivicView – Know Your Reps`.)
2. Open the new product → **Product management → Product identity**.
   Copy these three values exactly — PWABuilder needs them verbatim:
   - **Package/Identity/Name** (e.g. `12345CIVICVIEWINC.CivicView`)
   - **Package/Identity/Publisher** (a `CN=...GUID` string)
   - **Publisher display name** (should read `CIVICVIEW, INC.`)

---

## 2. Generate the package with PWABuilder

1. Go to https://www.pwabuilder.com → enter `https://civicview.app` →
   run the report. Expect green on manifest (name, icons incl. 512px,
   display standalone) and service worker. Fix nothing unless it flags
   a hard blocker — the action-item suggestions (shortcuts, screenshots
   in manifest, etc.) are optional polish, not requirements.
2. **Package for stores → Windows**. Fill the form:
   - Package ID / Publisher ID / Publisher display name → the three
     values from §1 step 2, verbatim.
   - App name: `CivicView`. Version: start at `1.0.1` (PWABuilder
     reserves 1.0.0; auto-increment on future repackages).
   - Icon: it pulls from the manifest — the 512px PNG.
3. Download the zip. It contains the **store package**
   (`.msixbundle` / `.msix`) plus a sideload-test version.
4. **Local smoke test (optional but smart):** double-click the sideload
   package on this PC → app installs → opens civicview.app in a
   standalone window with the CivicView icon. Uninstall after testing.

---

## 3. Create the submission in Partner Center

Product → **Start your submission**. Sections:

### Packages
Upload the `.msixbundle` from PWABuilder. Device family: **Desktop**
(leave others off unless you want them).

### Properties
| Field | Value |
| --- | --- |
| Category | **Social** (matches Play). Alt: Government & politics — fine too, but Social keeps the two stores consistent and matches the UGC nature. |
| Privacy policy URL | **https://civicview.app/privacy** (required) |
| Website | https://civicview.app |
| Support contact info | jeffreynuez1@gmail.com |
| Accessibility | Do NOT declare the app as accessibility-certified (no audit) |

### Age ratings
Same IARC questionnaire as Play — answer identically
(`docs/playstore_listing.md` §5): social/UGC app, users interact and
share content, no violence/substances/gambling, **no digital purchases
in the current build**, location not shared with other users. Expect
Teen-ish.

### Store listing (en-US) — paste-ready copy below (§4).

### Submission options / notes for certification — paste:
```
CivicView is a Progressive Web App of https://civicview.app, an
independent, non-partisan civic-engagement platform by CIVICVIEW, INC.
(a Florida Benefit Corporation). It is NOT a government app and states
this prominently in the listing and in-app.

All content is browsable without an account. To test engagement
features (polls, comments), use the instant self-serve demo login:
open Sign in -> "Continue with a demo account" — no credentials, real
billing, or ID verification required.

User-generated content is covered by reporting, auto-hide moderation
thresholds, and an appeals process.
```

Submit → certification typically completes within 24–72 hours.

---

## 4. Store listing — paste-ready text

**Description** (main field — adapted from the Play full description;
trim to the field's counter if needed):
```
CivicView connects you with the people who represent you — at every level of government — and gives you the tools to understand and engage with them.

⚠️ NOT A GOVERNMENT APP
CivicView is an independent product of CIVICVIEW, INC., a Florida Benefit Corporation. It is not affiliated with, authorized by, or endorsed by any government agency, official, political party, or campaign, and it does not provide or facilitate any government services. It is an informational and civic-engagement tool only.

Find and follow your federal, state, and local representatives. See the bills they sponsor, the votes they cast, the committees they sit on, and the executive orders they sign — each paired with a plain-English, AI-generated summary so you can understand what's happening without wading through legalese.

WHAT YOU CAN DO
• Look up your representatives by address — all 50 states and 435 congressional districts
• Track reps, bills, and elections, and get notified when something changes
• Read neutral, sourced profiles for all 535 members of Congress, the executive branch, and the Supreme Court
• Follow verified pages where representatives and candidates post updates, run polls, and host events
• Vote in polls, react, and join the conversation as a verified constituent
• Compare how officials vote and where they stand

WHERE OUR INFORMATION COMES FROM
All government information in CivicView comes from the public sources listed below. This is the complete list of the sources we use:
• U.S. Congress — bills, members, committees, and votes: https://www.congress.gov
• GovTrack — congressional votes and member data: https://www.govtrack.us
• The @unitedstates project — public-domain congressional rosters, committees, offices, and photos: https://unitedstates.github.io/congress-legislators
• U.S. House of Representatives, Office of the Clerk — roll-call votes: https://clerk.house.gov
• U.S. Senate — roll-call votes: https://www.senate.gov
• Federal Register — executive orders: https://www.federalregister.gov
• CourtListener / Free Law Project — federal courts, including the U.S. Supreme Court: https://www.courtlistener.com
• Federal Election Commission (OpenFEC) — candidates and campaign finance: https://www.fec.gov
• Open States — state legislatures (members, bills, votes): https://openstates.org
• Google Civic Information API — matching your address to officials and elections: https://developers.google.com/civic-information
• U.S. Census Bureau Geocoder — matching your address to a district: https://geocoding.geo.census.gov
• OpenStreetMap / Nominatim — address lookup fallback: https://www.openstreetmap.org
We do not use any other sources of government information.

Photos of members and officials come from the @unitedstates project and Wikimedia Commons / Wikipedia (https://commons.wikimedia.org).

NON-PARTISAN BY DESIGN
CivicView takes no political side. Officials' data is neutral and sourced; AI-generated summaries are written to inform, not persuade.

NO ADS. NO VENTURE CAPITAL.
Browsing is free, forever. An optional $5/month subscription lets verified citizens create their own polls. Commenting, liking, and voting require only identity verification, not a subscription. That is the entire business model — no advertising, and we do not sell your data.

BUILT ON TRUST
Real verified identities. Transparent moderation with an appeals process. Your data is yours: full account deletion is available at any time, right from the app.

Democracy works better when people can see it clearly. CivicView is here to help.

CivicView is an independent civic-information service and is not a government entity. (civicview.app)
```

**Product features** (short bullet list field — enter as separate rows):
```
Look up your representatives by address — all 50 states, 435 districts
Track reps, bills, and elections with notifications when things change
Neutral, sourced profiles for Congress, the executive branch, and SCOTUS
Plain-English AI summaries of bills, votes, and executive orders
Follow verified rep and candidate pages — posts, polls, and events
Vote in polls and join the conversation as a verified constituent
Non-partisan by design — no ads, no data selling
```

**Search terms** (up to 7, one concept each):
```
representatives
congress
civic engagement
elections
bills and votes
government
non-partisan
```

**What's new in this version** (first release):
```
First Microsoft Store release of CivicView. Look up your federal, state, and local representatives, read plain-English summaries of bills and votes, follow verified rep and candidate pages, and vote in polls — all non-partisan and sourced. Browsing is free.
```

**Copyright / trademark info:**
```
© 2026 CIVICVIEW, INC. All rights reserved.
```

---

## 5. Screenshots (required — at least 1; recommend 4)

Desktop screenshots, PNG, landscape (1366×768 minimum; 1920×1080
ideal). Easiest path: install the PWA locally (Edge → civicview.app →
Install), size the window to ~1920×1080, and capture:
1. Home — national map + hero stats
2. A rep profile — bills / votes / Areas of Focus
3. The /polls feed
4. The compare view (agreement-rate bar)

Same framing rule as Play: never crop in a way that implies government
affiliation; the app chrome IS the branding.

---

## 6. Post-certification checklist

- [ ] Listing live — search "CivicView" in the Microsoft Store on
      Windows; confirm publisher shows CIVICVIEW, INC.
- [ ] Install from the Store on a clean machine; verify standalone
      window, icon, sign-in, demo engagement flow.
- [ ] Add the Microsoft Store badge/link alongside the Google Play link
      wherever the Play badge appears (bell panel copy says "Android
      app" — desktop copy can now also point at the Store listing).
      Bring this as a small follow-up change, not scope creep.
- [ ] README + HelpBuildThisView "Already built" list: add the
      Microsoft Store listing row.
- [ ] When real billing / ID.me ship: revisit age-ratings "digital
      purchases" answer + listing copy — same day, same as the Play
      checklist (`playstore_listing.md` §9).

## 7. Facts for future sessions

- Store package = PWABuilder MSIX shell; **web deploys need no store
  resubmission**. Repackage only for identity/manifest-URL changes.
- Partner Center company registration is free (fee dropped May 2026);
  business verification 2–5 days via Sunbiz docs or DUNS.
- The PWA prerequisites shipped in commit `4620059` (PNG install
  icons — Chromium requires explicit 192/512 raster entries; SVG-only
  manifests fail the install heuristic).

_Prepared 2026-07-24. Sources of truth: this repo's README.md +
CLAUDE.md + docs/playstore_listing.md; Microsoft Learn
(whats-new-company-developer) for the free-registration change._
