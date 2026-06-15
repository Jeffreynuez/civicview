# CivicView — Google Play Store Listing Package

Paste-ready content + declarations for the first Google Play submission.
Org account: **CivicView** (Account ID 5150866026642573505), already verified.
Build identity (from `frontend/capacitor.config.ts`): appId **`app.civicview`**,
appName **CivicView**, remote-URL shell loading `https://civicview.app`.

> ⚠️ **Read the "Policy watch-outs" section first.** As of June 2026 the US
> billing rule changed (see §8) — the Stripe subscription is no longer the
> blocker it once was. The top risk is now the **webview minimum-functionality**
> policy.

---

## 0. Recommended submission order in Play Console

1. **Create app** (this section's basics)
2. **Set up your app** checklist: App access → Ads → Content rating →
   Target audience → Data safety → Government/News/Financial declarations →
   Privacy Policy
3. **Store listing**: title, descriptions, graphics
4. **Create a release** on the **Internal testing** track first (fastest review,
   safest), upload the signed AAB, add yourself as a tester, then promote to
   Production once it passes.

---

## 1. Create app (basics)

| Field | Value |
| --- | --- |
| App name | **CivicView** |
| Default language | English (United States) – en-US |
| App or game | App |
| Free or paid | **Free** (the $5/mo subscription is in-app, not an upfront price) |
| Declarations | Confirm Developer Program Policies + US export laws |

---

## 2. Store listing — text (with character limits)

**App name** (max 30) — recommended:
```
CivicView
```
Alt if you want keywords in the title (still ≤30): `CivicView: Know Your Reps`

**Short description** (max 80) — recommended:
```
See your reps' votes, track bills, and engage your democracy — non-partisan.
```
Alt: `Find your representatives, follow their votes, and make your voice heard.`

**Full description** (max 4000) — recommended:
```
CivicView connects you with the people who represent you — at every level of government — and gives you the tools to understand and engage with them.

Find and follow your federal, state, and local representatives. See the bills they sponsor, the votes they cast, the committees they sit on, and the executive orders they sign — each paired with a plain-English, AI-generated summary so you can understand what's happening without wading through legalese.

WHAT YOU CAN DO
• Look up your representatives by address — all 50 states and 435 congressional districts
• Track reps, bills, and elections, and get notified when something changes
• Read neutral, sourced profiles for all 535 members of Congress, the executive branch, and the Supreme Court
• Follow verified pages where representatives and candidates post updates, run polls, and host events
• Vote in polls, react, and join the conversation as a verified constituent
• Compare how officials vote and where they stand

NON-PARTISAN BY DESIGN
CivicView takes no political side. Officials' data is neutral and sourced; AI summaries are written to inform, not persuade. CivicView is an independent Florida Benefit Corporation — not affiliated with, or endorsed by, any government agency, political party, or campaign.

NO ADS. NO VENTURE CAPITAL.
Browsing is free, forever. An optional $5/month subscription unlocks engagement features (creating polls and commenting) for verified citizens. That is the entire business model — no advertising, and we do not sell your data.

BUILT ON TRUST
Real verified identities. Transparent moderation with an appeals process. Your data is yours: full account deletion is available at any time, right from the app.

Democracy works better when people can see it clearly. CivicView is here to help.
```

**Release notes / "What's new"** (max 500) — first release:
```
First release of CivicView. Look up your federal, state, and local representatives, read plain-English summaries of bills and votes, follow verified rep and candidate pages, and vote in polls — all non-partisan and sourced. Browsing is free.
```

---

## 3. Categorization + contact details

| Field | Value | Notes |
| --- | --- | --- |
| App category | **Social** (recommended) | Core actions are connecting with reps, following pages, polls, comments. Alt: **News & Magazines** if you'd rather emphasize the bills/votes feed — but that triggers the separate **News app** declaration. |
| Tags | civic engagement, government, representatives, elections, voting info | Pick the closest Play-provided tags |
| Email | jeffreynuez1@gmail.com | Required, shown publicly |
| Website | https://civicview.app | |
| Phone | optional | |
| Privacy Policy URL | **https://civicview.app/privacy** | Required (page exists in the app) |

---

## 4. Graphics assets (required) — spec + source

Generate from the existing brand mark in `frontend/public/logo/` (the
`color-detailed` SVG — same art now on the home hero).

| Asset | Spec | Required |
| --- | --- | --- |
| App icon | 512 × 512 px, 32-bit PNG, ≤1 MB, no alpha transparency on the safe area | Yes |
| Feature graphic | 1024 × 500 px, PNG/JPG, no transparency | Yes |
| Phone screenshots | 2–8 images, PNG/JPG, 16:9 or 9:16, each side 320–3840 px | **Min 2** |
| 7" + 10" tablet screenshots | same rules | Only if you list tablet support |

Screenshot tip: capture the home map, a rep profile with bills/votes, the
`/polls` feed, and the compare view. I can generate the icon + feature graphic
from your brand SVG and mock the screenshots — say the word.

---

## 5. "Set up your app" declarations

### App access
Content is **browsable without login**; engagement (vote/comment/create) needs an
account. Give reviewers access two ways:
- **Self-serve demo (no credentials):** "Tap Sign in → Continue with a demo
  account. This is instant and self-serve, and grants full engagement features
  via demo grants — no real billing or ID verification required."
- **(Recommended) Dedicated reviewer login:** create one demo citizen account and
  enter its credentials in the *App access* form so review never depends on the
  signup flow. → _Fill in: reviewer email + password before submitting._

### Ads
**No** — the app does not contain ads.

### Content rating (IARC questionnaire — answer honestly; rating is auto-assigned)
- App category in the questionnaire: **Social networking / user-generated content**
- Violence, sexual content, profanity (in the app's own content): **None**
- Controlled substances, gambling, simulated gambling: **None**
- Users can **interact / communicate** with each other: **Yes**
- App lets users **share user-generated content**: **Yes** (posts, comments, polls)
- App shares the user's **current physical location** with other users: **No**
  (address is used only to match district; not shown to other users)
- **Digital purchases**: **No** (no live in-app purchases in this build; the $5/mo subscription is not active yet — see §9)
- Expected result: Teen / PEGI 12-ish. Let IARC compute the final rating.

### Target audience & content
- Target age group: **18 and over** (recommended — civic/voting platform built for
  adults; engagement is tied to verified U.S. persons). Answer "appeal to
  children" = **No** to stay out of the Families program.
- Contains UGC: **Yes** → confirm you have moderation + reporting (you do:
  report flow, auto-hide threshold, appeals).

### Data safety  → see the full table in Section 6.

### Government apps declaration
If asked: **Not a government app.** CivicView is an independent Florida Benefit
Corporation, not affiliated with or endorsed by any government entity. (Listing
copy states this explicitly.)

### News app declaration
With the **Social** category: answer **No** (CivicView is a civic tool, not a news
publisher). If you choose **News & Magazines**, you must complete the News
declaration with publisher details instead.

---

## 6. Data safety form (current build)

> The Android app is a webview of `civicview.app`, so this declares what the
> **live site collects** (Google requires webview-collected data to be disclosed).
> Reflects the build as submitted; see §9 for what to add when real billing /
> ID.me / verified signup go live.

**Step 1 — Data collection and security**
- Collect or share any required user data types? **Yes**
- All collected data encrypted in transit? **Yes** (HTTPS)
- Provide a way to request data deletion? **Yes** → `https://civicview.app/account/delete`
- Independent security review badge? **No** (no third-party audit)

**Account creation methods** (asked here): **Username and password** only. *Not*
OAuth (ID.me is OAuth-based but inert), not passwordless, not "no account."
Delete-account URL: `https://civicview.app/account/delete`. "Delete some data
without deleting the account" → **No** (no separate partial-deletion flow).

**Step 2/3 — Data types + usage.** For every row: **Collected = Yes, Shared = No.**

| Data type | Ephemeral? | Required / Optional | Why collected (purposes) |
| --- | :---: | --- | --- |
| Personal info → **Name** (display name) | No | Required | App functionality, Account management |
| Personal info → **Email address** | No | Required | App functionality, Account management, Fraud prevention/security (+ Developer communications if you send notification/digest emails) |
| Personal info → **User IDs** | No | Required | App functionality, Account management (+ Fraud prevention/security) |
| Personal info → **Address** | No | Optional | App functionality |
| Location → **Approximate location** (city/state) | No | Optional | App functionality (+ Personalization — local reps) |
| Personal info → **Race and ethnicity** | No | Optional | App functionality, Analytics |
| Personal info → **Political or religious beliefs** (party + religion) | No | Optional | App functionality, Analytics |
| Personal info → **Other info** (age, sex, income, education, employment, home ownership, veteran, parent/guardian) | No | Optional | App functionality, Analytics |
| Photos & videos → **Photos** (rep/candidate uploads) | No | Optional | App functionality |
| App activity → **App interactions** | No | Required | App functionality, Analytics |
| App activity → **In-app search history** | Yes, if queries aren't stored (else No) | Optional | App functionality |
| App activity → **Other user-generated content** (polls, comments) | No | Required | App functionality |

**Purpose rules:** **never** check *Advertising or marketing* (no ads). Use
*Personalization* only for location. Use *Fraud prevention/security* only for
Email + User IDs (the app does failed-login lockout: `failed_login_count`,
`locked_until`).

**Not collected** (leave unchecked): Precise location · Phone number · Sexual
orientation · all Financial info (no live billing) · Health & fitness · Messages
(no DM/chat — comments are UGC) · Videos (not built yet) · Audio · Files & docs ·
Calendar events (the events feature is app content, not the user's device
calendar) · Contacts · Installed apps · Web browsing history · Device or other
IDs · App info & performance / diagnostics (no analytics or crash SDK).

**Sensitive-data note:** race/ethnicity, political party, and religion are
collected **only** when a user opts into a poll's demographic form (sensitive
questions consent-gated; shown aggregate-only with k-anonymity). Still disclosed
as Collected + Optional.

**Sharing = No.** Processors acting on CivicView's behalf (Cloudflare; Stripe/
Postmark/ID.me/Anthropic inert or processing on your behalf) are not "sharing"
under Google's definition.

---

## 7. The AAB upload

The native shell already exists (`frontend/capacitor.config.ts`, Task #84). To
produce the signed `.aab`, follow the app-store runbook committed with the
scaffold (commit `9fbbac0`). High level: `npx cap sync android` → open in Android
Studio (or Gradle `bundleRelease`) → sign with an **upload keystore** (back it up;
losing it means you can't update the app) → upload the `.aab` to the **Internal
testing** track first.

---

## 8. Policy watch-outs (resolve before/at upload)

1. **In-app subscription billing — now allowed in the US (was the big risk).**
   A court injunction (Epic v. Google), in effect in the **US through Nov 1,
   2027**, bars Google from requiring Google Play Billing for US-distributed
   apps and permits alternative/external payment methods and links. So the
   **$5/mo Stripe checkout in the webview is permissible** for a US-only
   release — no longer a likely rejection cause. Caveats: set the app's
   **country availability to the US only** (the injunction is US-only; elsewhere
   the Play Billing requirement still applies); Google may still levy a reduced
   service fee on transactions initiated via in-app links; and disclose
   subscription terms clearly on the purchase screen. Add Google Play Billing
   later if you expand outside the US.
2. **⚠️ Webview / minimum functionality (now the top risk).** Google tightened
   enforcement against webview-only wrappers across 2025–2026. The shell loads
   the live site, so be ready to defend genuine value: CivicView is a rich civic
   platform (address→rep lookup, bills/votes, polls, verified pages) and ships
   an offline fallback page. Strengthen the native case where cheap (push
   notifications, proper loading/offline states) and explain the value in the
   review notes.
3. **UGC policy.** Social apps with user content must have moderation + reporting +
   a way to block/report — you have these; mention them in the review notes.
4. **Elections/government content.** Keep the non-affiliation language prominent
   (it already is). Don't imply government endorsement anywhere in the listing or
   app.
5. **User blocking (UGC gap).** You have report + admin moderation + appeals,
   which covers most of the UGC policy — but there's no user-to-user **block**
   feature in the code. Social/UGC apps are expected to let users block other
   users/content in-app. Consider adding a block control before or soon after
   launch.
6. **Keep Android permissions minimal.** The generated manifest should request
   `INTERNET` only — no location/contacts/etc. (address lookup is typed, not
   GPS). Extra permissions are a top rejection + data-safety trigger.
7. **Account deletion URL.** Google requires apps with accounts to offer in-app
   deletion *and* a web deletion URL — use **https://civicview.app/account/delete**
   in the Data safety form.

---

## 9. Post-launch — update these declarations when billing / ID.me go live

The answers above describe the **current demo build**. When real accounts, the
$5/mo subscription, or ID.me verification ship, revisit these together (same day
you flip the feature on) — mismatches between a declaration and live behavior are
an enforcement risk:

- [ ] **Sign-in details (App access):** swap the demo reviewer login for a real
      verified test account once self-serve demo signup is replaced.
- [ ] **Data safety:** add what the live app then collects — **email address**
      (real, user-provided), **physical address** (street/ZIP for district),
      **payment info** (via Stripe), and **identity / government ID + legal name**
      (ID.me). Update purposes and "linked to identity."
- [ ] **Content rating (IARC):** change **"Does the app allow users to purchase
      digital goods?" → Yes** once the subscription is live, then re-submit the
      questionnaire (the rating may change).
- [ ] **Financial features:** still "no financial features" (a subscription is
      not a financial service) — re-confirm only if something else changes.
- [ ] **Store listing:** restore the verified-identity and $5/mo subscription
      lines to the full description once those features are real.
- [ ] **Billing / payments:** if you ever distribute **outside the US**, add
      Google Play Billing for those markets (the US Stripe-in-app allowance is
      injunction-specific, US-only, through 2027-11-01).
- [ ] **Country availability:** keep the app **US-only** until the above is done.

---

_Prepared 2026-06-14. Source of truth for app facts: README.md + CLAUDE.md +
frontend/capacitor.config.ts. Update if the billing decision (item 8.1) changes
the listing or build._
