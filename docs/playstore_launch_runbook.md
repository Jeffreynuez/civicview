# CivicView — Google Play launch & management runbook

_Last updated 2026-06-16. Companion to `docs/playstore_listing.md` (listing
content) and `docs/mobile-capacitor.md` (build/AAB)._

The app is built and uploaded to **Internal testing** (release live). This
doc is the path from there to a **public Production launch**, plus how to
manage the app afterward. CivicView is a **Capacitor remote-URL shell** —
once it's on the store, web deploys (Vercel/Render) update the app
instantly; you only rebuild + re-upload an AAB for shell-level changes
(icon, splash, app name, allowNavigation, plugins, permissions).

---

## 0. The big question: do you have to run closed testing first?

**No — not for an organization account.** The "Test your app with a larger
group of testers / 12 testers for 14 days" flow Google shows on your
dashboard is the **production-access gate for *personal* developer accounts
created after Nov 13, 2023**. **Organization accounts (and older personal
accounts) are exempt** and can publish straight to Production.

CivicView is registered as an **organization** (CIVICVIEW, INC.), so you can
**skip the closed-testing track and promote Internal → Production directly.**

**Confirm your account type before relying on this:** Play Console → bottom-left
**Settings** (gear) → **Developer account → Account details** → "Account type"
should read **Organization**. If it somehow reads *Personal*, the 12-tester ×
14-day closed test becomes mandatory before production (set it up under
**Test and release → Testing → Closed testing**, add ≥12 testers by email,
keep them opted-in 14 continuous days, then promote).

---

## 1. Pre-production checklist (everything must be green to be reviewed)

Go to **Test and release → Publishing overview** — it lists every task still
blocking a release. Also check **Policy and programs → App content**. Below is
each required item with CivicView's answer.

**Store presence**
- **Main store listing** — title (CivicView), short + full description, icon,
  feature graphic, phone + tablet screenshots. _(Done — see playstore_listing.md.)_
- **Store settings** — app category **Social**, tags, contact email/website.
- **Countries / regions** — set distribution to **United States only**
  (Stripe in-app billing relies on the US Epic v. Google injunction window;
  don't distribute where that doesn't apply). Test and release → Production →
  Countries/regions when you create the release.
- **Pricing** — **Free**.

**App content declarations (Policy and programs → App content)**
- **Privacy policy** — a public, non-geofenced HTTPS URL (not a PDF), e.g.
  `https://civicview.app/privacy`. Same link must also live inside the app.
- **App access** — ⚠️ **the most important one for CivicView** (see §2).
- **Ads** — declare **No ads**.
- **Content rating** — complete the questionnaire (Social/communication,
  user-generated content with moderation + reporting). _(Done.)_
- **Target audience and content** — 18+, not designed for children.
- **Data safety** — must match the live build's actual collection (account
  info, user-entered location/address for district matching — not device GPS,
  Stripe purchase history). Encrypted in transit; **users can request
  deletion** → point the data-deletion field at the self-serve
  `https://civicview.app/account/delete`. _(Done — keep it matching the build.)_
- **Government apps** — declare CivicView is **not** an official government
  app / not affiliated with a government entity.
- **Financial features** — **No** financial features. _(Confirmed.)_
- **Health** — none.
- **News** — you're listed as **Social**, not News; if prompted, declare it's
  not a news publication.

---

## 2. App access — give reviewers a working login (do this carefully)

CivicView lets anyone **browse** free, but **engagement (like / vote / comment)
requires a verified, subscribed citizen** — which a reviewer can't self-serve
(ID.me + billing). If reviewers can't exercise those features, the app gets
**rejected for "login required / can't access functionality."** Prevent that:

1. Provision **one stable demo citizen account** with a fixed **email +
   password** that has the demo grants (`verified_method='demo'`,
   `is_subscribed=True`) so it can like/vote/comment. It must:
   - be **reusable** and **never expire**,
   - **bypass 2FA / OTP** (no code prompt for this account),
   - work from **any location** (US reviewers, but keep it geo-independent),
   - be in **English**.
2. Play Console → **App content → App access** → "Some or all functionality
   is restricted" → **+ Add new instructions**. Paste:

   ```
   Instruction name: Verified citizen (full engagement)
   Username: <stable-demo-email>
   Password: <stable-demo-password>
   Any other instructions:
     CivicView is browsable without an account. To test engagement
     (vote on polls, like/comment), tap the account menu → Sign in and
     use the credentials above. This demo account is pre-verified and
     subscribed so all engagement features are unlocked. No 2FA/OTP is
     required for this account. The app loads https://civicview.app.
   ```
3. If different features need different identities (rep / candidate), add a
   second credential set and say which covers what.

---

## 3. Promote Internal testing → Production

1. **Test and release → Testing → Internal testing.**
2. On your current release, click **Promote release → Production**.
3. You land on **Production**. Add **release notes** (what's in this version).
4. **Save → Next → Review release.** Resolve any errors/warnings it surfaces.
5. **Start rollout to Production → Rollout** to confirm.

Notes:
- **Play App Signing** is already enabled (Google holds the signing key), so
  the keystore you made is just your upload key — keep it in the Keys folder.
- You can set a **staged rollout %** (e.g., 20%) and increase it later, or
  100% for a small launch.
- Optional: turn on **Managed publishing** (Publishing overview → settings) if
  you want Google to *finish* the review but hold the actual go-live until you
  click **Publish** — useful to line the app launch up with your Indiegogo
  push.

---

## 4. Review timeline & what to expect

- Org accounts skip the 14-day closed-test wait, so the clock is just the
  **production review**: typically **1–3 days**, but **new apps / sensitive or
  civic-political categories can take up to ~7 days** (occasionally longer).
- Submit during a weekday, non-peak window; make sure App access creds work
  the entire review (a broken demo login is the #1 delay cause).
- If rejected: **Policy and programs → App content / Policy status** shows the
  reason. Fix and resubmit, or reply in the **Resolution Center**. Common
  first-app flags: inaccessible login, data-safety mismatch, privacy-policy
  reachability, UGC moderation adequacy (you have reporting + moderation +
  appeals — cite them).

---

## 5. After approval — managing the app

- **Releases:** because the app is a remote-URL shell, **web changes ship
  instantly** (Vercel/Render) with **no store review**. You only cut a new AAB
  + review for **icon / splash / app name / allowNavigation / plugins /
  permissions** (see `docs/mobile-capacitor.md`). Keep `versionCode` bumped on
  each AAB.
- **Android vitals (Monitor and improve):** watch crash rate & ANR rate —
  exceeding Google's bad-behavior thresholds can demote visibility.
- **Ratings & reviews (Monitor and improve → Reviews):** reply to reviews;
  enable reply notifications.
- **Pre-launch report:** Google test-runs the app on real devices and flags
  crashes/accessibility/security — check it after each AAB.
- **Policy status:** check periodically; Google emails policy changes (e.g.,
  the annual target-API-level bump — a shell rebuild) with deadlines.
- **Store listing experiments / custom listings:** later growth levers
  (A/B test icon/screenshots, US-state-targeted listings).
- **Post-launch declaration updates:** when ID.me verification and real
  billing go live, revisit Data safety + App access (see playstore_listing.md
  §9 checklist).

---

## 6. CivicView-specific watch-outs

- **US-only distribution** while the Epic v. Google US billing injunction
  covers in-app Stripe (through ~2027-11-01). Re-evaluate before expanding.
- **No ads** — keep the ads declaration accurate (Anthropic/Claude policy is
  unrelated; just don't add ad SDKs).
- **Account & data deletion** — Google requires an in-app and web path to
  request deletion; `/account/delete` satisfies it. Keep the Data-safety
  deletion URL pointed there.
- **UGC safety** — civic/political UGC draws scrutiny; your report flow,
  auto-hide threshold, admin queue, appeals, and planned threat-detection are
  the compliance story to cite if questioned.
- **iOS is a separate track** (Apple Developer Program, Xcode archive, App
  Store Connect) — deferred; see `docs/mobile-capacitor.md` Phase 2.
