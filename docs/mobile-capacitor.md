# Mobile apps via Capacitor — runbook (Task #84)

Architecture: **remote-URL shell**. The Android/iOS apps are thin
native shells that load the live `https://civicview.app`. See
`frontend/capacitor.config.ts` for the full rationale.

## The update model (read this first)

| Change | What you do | Store review? |
| --- | --- | --- |
| Any web change (UI, features, data, fixes) | Deploy to Vercel like always | **No — apps update instantly** |
| Icon, splash, app name, allowNavigation, plugins, permissions | Rebuild shell, upload new AAB/IPA | Yes (days) |

The browser version is the same site — nothing about it changes.

## Phase 1 — Android (Windows PC)

### One-time setup
1. Install **Android Studio** (https://developer.android.com/studio) —
   accept the SDK defaults during first launch.
2. Register the **Google Play developer account** ($25 one-time) at
   https://play.google.com/console — identity verification can take a
   day or two; start it early.

### Scaffold (git bash, repo root)
```bash
cd frontend
npm install @capacitor/core
npm install -D @capacitor/cli
npm install @capacitor/android
npx cap add android        # generates frontend/android/ — COMMIT this folder
```

### Icon + splash
1. Create `frontend/assets/` with:
   - `icon-only.png` — 1024x1024, the flag-magnifier logo, solid background
   - `splash.png` — 2732x2732, logo centered on brand-dark background
   (export from the Indiegogo art; PNG, no transparency for splash)
2. ```bash
   npm install -D @capacitor/assets
   npx capacitor-assets generate --android
   ```

### Build the release bundle (AAB)
1. `npx cap open android` (opens Android Studio)
2. Build → **Generate Signed App Bundle** → create a new keystore when
   prompted. **Save the keystore file + passwords in the Keys folder —
   losing it does NOT lock you out (Play App Signing re-signs), but
   keep it safe anyway.**
3. Output: `android/app/release/app-release.aab`

### Play Console (first release)
1. Create app → name **CivicView**, free, app (not game).
2. Use **Internal testing** first: upload the AAB, add your own Gmail
   as a tester, install via the opt-in link, click through the whole
   app on your phone (login, polls, map, subscribe flow).
3. Complete the required forms (Dashboard checklist):
   - **Privacy policy URL** — civicview.app's privacy policy page
   - **Data safety** — declare: account info (email, name), location
     (user-entered address for district matching — not device GPS),
     purchase history (Stripe). Data encrypted in transit; users can
     request deletion (self-serve delete exists). No data sold.
   - **Content rating questionnaire** — social/communication app;
     user-generated content with moderation + reporting (true: reports
     + threat-detection pipeline).
   - **App category** — News & Magazines or Social (pick one; Social
     fits the engagement model better).
   - **Ads declaration** — no ads.
4. Promote internal → **Production** when satisfied. First production
   review typically 1–7 days. New Play accounts may require a closed
   test with 12+ testers for 14 days before production access —
   if prompted, recruit from the TikTok-live early adopters.

## Phase 2 — iOS (MacBook Pro, standalone — no Claude session needed)

Prereqs: Apple Developer Program ($99/yr, developer.apple.com),
Xcode from the Mac App Store, git + node on the Mac.

```bash
git clone https://github.com/Jeffreynuez/civicview.git
cd civicview/frontend
npm install
npm install @capacitor/ios
npx cap add ios            # generates frontend/ios/ — commit it
npx capacitor-assets generate --ios
npx cap open ios           # opens Xcode
```

In Xcode:
1. Select the **App** target → Signing & Capabilities → check
   "Automatically manage signing" → select your Apple Developer team.
2. Set Bundle Identifier = `app.civicview` (must match an App ID you
   create at developer.apple.com → Identifiers if not auto-created).
3. Pick **Any iOS Device (arm64)** → Product → **Archive**.
4. In the Organizer window: **Distribute App** → App Store Connect →
   Upload (defaults are fine).

In App Store Connect (appstoreconnect.apple.com):
1. New app → platform iOS, name **CivicView**, bundle id
   `app.civicview`, SKU `civicview-ios`.
2. Fill the listing: screenshots (6.7" + 5.5" required — take them in
   the Xcode Simulator), description, keywords, support URL, privacy
   policy URL.
3. **App Privacy** section — mirror the Play data-safety answers.
4. Select the uploaded build, submit for review.

**Guideline 4.2 (minimum functionality) — important.** Apple sometimes
rejects thin web wrappers. Mitigations, in order of strength:
- Ship iOS WITH push notifications (planned: tracked-official alerts
  via @capacitor/push-notifications + APNs) — strongest argument.
- In the review notes, emphasize native-feeling behaviors: account
  system, subscriptions, interactive map, real-time civic data.
- If rejected on 4.2 anyway: respond in Resolution Center with the
  push-notification build rather than arguing the wrapper.

## Future (not now)
- Push notifications (APNs + FCM) riding the existing Notification
  fan-out — also the 4.2 mitigation.
- Deep links / universal links (civicview.app → app).
- In-app purchase consideration: subscriptions purchased INSIDE the
  iOS app may trigger Apple's IAP rules (30%/15% cut). Current stance:
  the subscribe flow runs through Stripe on the web; Apple's reader/
  external-purchase rules are in flux — REVIEW before submitting a
  build that surfaces the Subscribe button on iOS, or hide the
  subscribe CTA in the iOS shell initially.
