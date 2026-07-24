# Push notifications — build & ship runbook (Android v1)

FCM push pipeline shipped 2026-07-24. Scope: tracked-activity pushes
(officials you track posting posts/polls) for signed-in citizens;
anonymous app installs join the `announcements` broadcast topic.
Pushes mirror the in-app bell — the bell remains the source of truth.

## Architecture (what lives where)

- **Firebase project:** `CivicView` (`civicview-18`), org `civicview.app`.
  Android app registered as `app.civicview`.
- **Backend** (env-gated, same pattern as Postmark/Stripe):
  - `services/push_service.py` — `FCMPushService` when
    `FIREBASE_SERVICE_ACCOUNT_JSON` is set on Render; `DevPushService`
    (logs only) otherwise. Dead tokens pruned on send.
  - `routers/push.py` — `POST /api/push/register` / `/unregister`
    (CSRF-protected like all writes).
  - `models/pages.py::DeviceToken` — auto-migrates on boot.
  - Hook: `notifications_inapp.emit_tracked_content_notifications`
    mirrors its fan-out to devices after the in-app rows commit.
- **Frontend:** `lib/push.js` (Capacitor-global detection, permission →
  register → POST flow) + `components/PushOptInPrompt.js` (contextual
  card, native-app-only, shows once a citizen is signed in and no
  choice is recorded). Deploys with the site — no store review needed
  for copy/behavior tweaks here.
- **Android shell:** `@capacitor/push-notifications` plugin;
  `google-services.json` in `android/app/` (Capacitor's template
  auto-applies the google-services plugin when the file exists);
  versionCode 4 / versionName 1.1.0.

## Jeffrey's local build steps

1. `cd frontend`
2. `npm install`  (pulls @capacitor/push-notifications)
3. `npx cap sync android`  (wires the plugin into the native project)
4. Open `frontend/android` in Android Studio → Build → Generate Signed
   App Bundle (same keystore as v1.0.2) → AAB.
5. Play Console → CivicView → Production → Create new release →
   upload AAB (versionCode 4).

## Play Console — Data safety update (required)

App content → Data safety → edit:
- **Data collected:** add "Device or other IDs" → Device IDs →
  collected, not shared, for App functionality (push notification
  delivery). Optional-to-user (they can decline the permission).
- Everything else unchanged. Release notes suggestion: "Optional push
  notifications for officials you track."

## Testing checklist (after Render deploy + app install)

1. Render env has `FIREBASE_SERVICE_ACCOUNT_JSON`; boot log shows
   "Push service: FCM (firebase-admin) active".
2. Fresh install, sign in as a demo citizen → opt-in card appears →
   Enable → system prompt → allow. Backend log: register bound=true.
3. Track an official; post from that official's page (rep session) →
   phone shows "<name> posted" while the app is closed.
4. App Info → Notifications now shows the toggle ON (not Blocked).
5. Anonymous check: fresh install, skip sign-in… no card (by design —
   card is citizen-contextual). Token registers on enable-from-future-
   settings only; announcements topic reachable via Firebase console
   test message to topic `announcements`.

## Deferred (bring back as tasks when wanted)

- Bill-status pushes (needs a small server-side daily check — tracked
  bills are currently verified client-side on app open).
- iOS/APNs when the iOS shell ships.
- Per-kind push preferences in dashboard settings + an "enable push"
  card there for users who declined the contextual prompt.
- Announcements topic opt-in for signed-in users.
