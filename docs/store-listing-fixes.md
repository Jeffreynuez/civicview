# Fixing both store listings

> **STATUS 2026-09-16.** Google Play is done: the Internal Beta name is resolved,
> the corrected description is in, and the AI asset declaration is answered.
> Microsoft is blocked: the corrected text was pasted but Partner Center refused
> to save with a server error. Paste sources live in
> `play-listing-corrected-copy.md` and `microsoft-listing-corrected-copy.md`.
>
> | Item | State |
> | --- | --- |
> | Play: "(Internal Beta)" name | Fixed. Was the internal tester enrollment, not the listing |
> | Play: app name field | Verified clean, "CivicView", 9/30 |
> | Play: custom store listings | Ruled out, none exist |
> | Play: description and short description | Corrected text applied |
> | Play: AI asset declaration | Answered. Logo and upscale labelled AI-assisted, screenshots not |
> | Microsoft: description | Pasted, **not saved**, server error |
> | Microsoft: product features | Row 1 fixed on screen, row 5 outstanding, rows past 6 unchecked |
> | Microsoft: short description | Not yet located in the form |
> | Microsoft: submission | Not submitted, certification not started |
> | Repo docs sync | Sources block synced in all four listing docs 2026-09-24; other stale text in `playstore_listing.md` and `microsoft_store_listing.md` remains |
> | **Both: sources block (NEW 2026-09-24)** | **Paste again.** The "complete list" was incomplete; rewritten in both paste sources |

Written 2026-09-15 from the Play Console, Partner Center and device screenshots.
Three separate problems, two consoles. Work top to bottom: the first one matters
far more than the other two.

---

## Problem 1: "CivicView (Internal Beta)" on Google Play

**Why this is first.** Every other issue here is a style or accuracy problem. This
one changes what a stranger concludes in the first second. A journalist or a
program officer who lands on "CivicView (Internal Beta)" with a red warning
reading "This app may be unsecure or unstable" stops there. You are about to run
outreach that drives exactly those people to that page. Nothing else on this
list is worth doing until this is settled.

**What the console actually says, which is the confusing part.** Your Play
Console shows the app as plain **CivicView**, package `app.civicview`, status
**Production**, release **4 (1.1.0)** at 100% rollout, last updated Jul 24. There
are no unpublished changes. So production is healthy and correctly named. The
phone is showing you something else.

**What the phone shows.** "CivicView (Internal Beta)", plus the red internal
tester banner, and release notes dated Jul 24. Your internal testing track still
holds release **3 (1.0.2)** from Jun 27.

So the name is coming from somewhere other than the production listing. Three
candidates, cheapest check first. Stop when the name goes away.

### Check 1: leave the internal testing program on your device

You are still enrolled as an internal tester, which is what produces the red
banner. Leaving may also resolve the name, because Play serves enrolled testers
a different view of the listing.

1. Play Console, left nav: **Test and release** then **Testing** then **Internal testing**
2. **Testers** tab
3. Copy the opt-in link (it looks like `play.google.com/apps/internaltest/<long number>`)
4. Open that link on your phone while signed in with the tester account
5. Choose **Leave the program**
6. Uninstall CivicView on the phone, then reinstall from the normal Play listing

Expect a lag. Play can take several hours to stop serving you the tester view,
so if the name is still there right after, that is not proof this was not it.

### Check 2: the app name in the main store listing

1. Play Console, left nav: **Grow users** then **Store presence** then **Main store listing**
2. Look at the **App name** field at the top, 30 character limit

If it literally reads `CivicView (Internal Beta)`, that is your answer. Change it
to `CivicView`, save, and submit. This is the single most likely cause worth
ruling out, because the console app list can show a shortened name while the
listing carries the full one.

### Check 3: a custom store listing. RULED OUT 2026-09-16.

Checked. The Store listings page shows only **Default store listing**, status
Live, last updated Jul 5, 2026, and the bottom of the page still displays the
"Target specific users with tailored content" empty state with a Create custom
store listing button. No custom listings exist, so nothing is overriding the
name for testers.

**That leaves two candidates: the tester enrollment, and the App name field in
the default listing.** Check 2 is now the one to settle.

### Then close the track down

You said testing is over, so stop the track from serving anyone:

1. **Test and release** then **Testing** then **Internal testing**
2. On release 3 (1.0.2), open the release menu and choose to **halt** or
   deactivate it
3. **Testers** tab: remove the tester list, or empty it

**The beta signal belongs in the app, not in the store name.** Your DEMO PREVIEW
badge in the navbar already does that job, it is visible in your own store
screenshots, and it is honest without making the listing look abandoned.

---

## Problem 2: em dashes in both listings

Your rule, your stated reason: an em dash reads as an AI tell. That is a
cosmetic complaint on a resume and a strategic one here, because CivicView's
biggest positioning problem is being mistaken for one of the AI-generated
legislation trackers flooding this category. The store listing is the first
thing a curious reporter reads.

**Find them by searching for this character:** —

### Google Play, confirmed instances

**Short description.** Currently:

> See your reps' votes, track bills, and engage your democracy — non-partisan.

Replace with:

> See your reps' votes, track bills, and engage your democracy. Non-partisan.

74 characters, inside the 80 limit.

**Release notes / What's new.** Currently:

> New: optional notifications — get an alert when officials you track post an update or run a poll. CivicView will offer to turn them on after you sign in;

Replace with:

> New: optional notifications. Get an alert when officials you track post an update or run a poll. CivicView will offer to turn them on after you sign in;

One caution: release notes are attached to a specific release. If Play will not
let you edit them on an already-published release, do not force it. Carry the
corrected text on your next release instead. The descriptions are the part that
matters for a first impression anyway.

**Full description.** I could not read all of it, so search it for the character
yourself. Path: **Grow users** then **Store presence** then **Store listings**,
then **Edit default listing**.

**Do not rewrite the sources block while you are in there.** The listing was last
updated Jul 5, 2026, which is the day the description was rebuilt to clear the
second Misleading Claims rejection. That exhaustive source list ending "we use no
other sources" is the version that passed review. Change the app name, fix the
dash characters, and leave the structure and the sourcing language exactly as
they are.

### Microsoft Store, confirmed instances

**Short description.** Currently:

> See your representatives' votes, track bills and elections, and make your voice heard — non-partisan, sourced, and free to browse. An independent civic...

Replace with:

> See your representatives' votes, track bills and elections, and make your voice heard. Non-partisan, sourced, and free to browse. An independent civic...

**Full description, opening line.** Currently:

> CivicView connects you with the people who represent you — at every level of government — and gives you the tools to understand and engage with them.

Replace with:

> CivicView connects you with the people who represent you, at every level of government, and gives you the tools to understand and engage with them.

Both substitutions follow your own documented rules: a parenthetical aside
becomes commas, and a dash introducing an explanation becomes a period.

---

## Problem 3: the Microsoft listing sells a tier that no longer exists

The live description says the $5/month subscription unlocks "engagement
features." That stopped being true on 2026-07-28, when commenting moved down
from the subscriber tier to the verified tier. The subscription now gates
**poll creation only**.

This is the same drift README task #113 tracks in `HelpBuildThisView.js:217` and
the Indiegogo draft (kept outside the repo since 2026-09-24). The store listing was not on that task's list and
should be.

It matters more than the dashes: Google Play rejected this app twice under
Misleading Claims for description accuracy. A live listing describing a tier
that does not exist is the same category of problem.

**The accurate version of the gates:**

- Browse, search, track: free, no account
- Like, vote on polls, comment: requires identity verification, not payment
- Create polls: requires verification plus the $5/month subscription

---

## Doing it in Partner Center, which works differently from Play

**You cannot edit the live listing.** Your Store presence section is marked
read-only, showing "Submission 1: Last modified on 07/27/2026". Changes require
a new submission.

1. Partner Center, **Application overview**
2. Under **Product release**, click **Start update**. This opens a new
   submission pre-filled with the current values.
3. Go to **Store listings** and edit the description fields
4. Submit for certification

**Batch every fix into this one submission.** Em dashes and the paid tier
together. A new submission goes back through certification, typically 24 to 72
hours, so submitting twice costs you a second wait for no reason.

Also worth doing while you are in there: confirm the availability setting still
reads as publicly discoverable. Your overview currently shows a green check on
"Your product is currently available in the Microsoft Store based on the
discoverability configured in the Availability module."

---

## Order of operations

1. Kill "(Internal Beta)" on Play. Checks 1, 2, 3 above, then close the track.
2. Fix the Play descriptions. Same save, one submission.
3. Start one Partner Center update carrying both the dash fixes and the tier
   correction.
4. Wait for both to go live, then look at each listing on a device you are not
   signed in as a tester on.
5. Only then point outreach at either store.

---

## No action needed

**Android developer verification is done.** Your Play Console home reads "All of
your apps have been successfully registered to meet Android developer
verification requirements." The Sep 30, 2026 deadline in the notification panel
is a non-event for you. Dismiss it.
