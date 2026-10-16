# Push notifications: build, ship and run

The FCM push pipeline shipped 2026-07-24 and was reworked 2026-10-16
(work order 8, `fix/notifications`). Pushes mirror the in-app bell; the
bell stays the source of truth, and a push is only the interruption.

## What is pushed

| Kind | When | Who | Tap opens |
| --- | --- | --- | --- |
| `tracked_post` | an official you track posts (a post or a poll) | signed-in trackers, and signed-out devices tracking the page | the post (`/?page=<id>#post-<id>`), and marks its bell row read |
| `tracked_event` | an official you track schedules an event, and you turned on that official's event alert | signed-in trackers only | the page, and marks its bell row read |
| `tracked_summary` | a daily or weekly summary, or the end of quiet hours | the device the updates were held for | the bell (`/?open=notifications`); a signed-out device, which has no bell, opens the newest update's page |
| `election_reminder` | a voting deadline or Election Day (`services/election_reminders.py`) | citizens in covered states and anyone tracking the election | the state |
| `test` | admin "Send me a test push" | the admin's own devices | nothing |

No push for a post the moderation screen flags (`flag` or `auto_hide`)
or one already hidden or deleted; the bell row still comes. The screen
runs before the fan-out (`routers/pages.create_post` adds its background
task first). An event that has already started is not pushed.

## Push timing and quiet hours (Jeffrey, 2026-10-16)

Nothing is dropped silently. The bell's **Push alerts** setting
(prefs key `push_cadence`):

- **As they happen** (`realtime`, the default): each update at once.
- **Daily summary** (`daily`): one push at 6 p.m. local time.
- **Weekly summary** (`weekly`): one push Saturday at 10 a.m. local time.

Local time is the device's `tz_offset_minutes`, else Eastern. A push that
is not sent at once is stored in `push_held_items`; the summary loop
(`services/push_summaries.py`, every 5 minutes, off the boot path, under
the `push-summaries` advisory lock) sends one push per device when it is
due: "4 updates from officials you track", "From Jane Doe, John Roe and 2
more." A summary of one update is that update's own push. Updates the
person already read or cleared in the bell are left out. Each device is
claimed with one conditional UPDATE on `device_tokens.summary_sent_at`,
so two instances cannot both send it.

**Quiet hours** (off, nights 10 p.m. to 8 a.m., nights and weekends, work
hours only): no push inside them. Tracked updates held by quiet hours go
out as one summary when they end ("..., while your quiet hours were
on."); a summary time inside quiet hours waits for them to end too.
Election reminders are never held or summarized: inside quiet hours the
bell row comes and the push does not, as PR #271 built them, and they
ignore the Push alerts setting.

Until 2026-10-16 the key was `digest_cadence`, defaulting to `daily`,
which let one push per device through every 20 hours and dropped the
rest. The first summary pass after the deploy rewrote every stored blob
once (`migrate_legacy_cadence`): `daily` and anything else became
`realtime`, `weekly` stayed. The write path (`sanitize_notification_prefs`),
the send path (`effective_cadence`) and the browser (`mergeChannelPrefs`)
read a leftover `digest_cadence` the same way.

Every app registration and every signed-in sync carries prefs. A device
with no prefs at all (registered before 2026-07-24) gets realtime and no
quiet hours, since the server has no clock for it.

## Who a device belongs to

- **Sign-in** binds the device at once: `PushOptInPrompt` (root layout)
  sees the new citizen and re-registers the saved token
  (`bindPushToAccount`), no prompt.
- **Sign-out** unbinds it (`POST /api/push/unbind`): still registered, no
  account, empty tracked list, held updates deleted.
- A register **without a citizen session** (offline sign-out, an expired
  session) unbinds a bound device too; a register by another citizen
  takes it over. Any change of owner drops the tracked list and held
  updates.
- A signed-out device carries its own tracked list (`tracked_json`). The
  app keeps that tracking in memory only, so registers **merge** keys
  into the stored list; only `tracked_remove`, sent on untrack, takes one
  out.

## Delivery details

- One message per device (`send_messages`, FCM `send_each`, 500 per
  request), so each push carries that recipient's own bell row id
  (`notification_id`) and event times in their own clock. Election
  reminders still use `send_to_tokens` (multicast grouped by TTL).
- TTL: posts 3 days, events until they start (at most 28 days),
  summaries 2 days, election reminders until their deadline.
- A token is pruned only when FCM says it is dead: `UnregisteredError`,
  `SenderIdMismatchError`, or an `InvalidArgumentError` that names the
  registration token. A message-level InvalidArgument prunes nothing.
- The `announcements` topic is gone: nothing ever sent to it. New devices
  are not subscribed; the first summary pass takes older devices off once
  (`device_tokens.announcements_cleared_at`).
- Rate limits: `/api/push/register`, `/unbind`, `/unregister` 60 per 10
  minutes per account or IP; event creation 10 per 10 minutes.
- In the app, a push received while CivicView is open refreshes the bell
  at once (`pushNotificationReceived`).

## Logs to look for (Render)

- Boot: `Push service: FCM (firebase-admin) active`.
- Each fan-out: `push tracked_post official=X: sent=N held_for_summary=N
  held_quiet_hours=N failed=N pruned=N`.
- Held back: `tracked_post push held back: post=N moderation flag (post)`.
- Summaries: `push summaries: {...}`; first pass after a deploy:
  `push timing migration (digest_cadence -> push_cadence): {...}` and
  `push: N device(s) taken off the unused 'announcements' topic`.
- Sign-out: `push: device unbound on sign-out`.
- Admin test: `admin rep:N test push: {devices, sent, failed, pruned, service}`.

## Admin: Send me a test push

Under the admin page heading. It sends to the devices bound to your
citizen account, plus this device when the admin page is open in the
app, and says how many were sent, failed and pruned, and whether the
server has real FCM (`service: dev` means nothing really went out).

## Architecture (what lives where)

- **Firebase project:** `CivicView` (`civicview-18`), org `civicview.app`.
  Android app registered as `app.civicview`.
- **Backend** (env-gated, same pattern as Postmark/Stripe):
  - `services/push_service.py`: `FCMPushService` when
    `FIREBASE_SERVICE_ACCOUNT_JSON` is set on Render; `DevPushService`
    (logs only) otherwise. The send path, holding, TTLs, pruning.
  - `services/push_summaries.py`: the summary loop and the one-time
    migration.
  - `routers/push.py`: `POST /api/push/register`, `/unbind`, `/unregister`
    (CSRF-protected like all writes), and `POST /api/admin/push/test`.
  - `models/pages.py`: `DeviceToken`, `PushHeldItem` (auto-migrate on boot).
  - Hooks: `notifications_inapp.emit_tracked_content_notifications` and
    `emit_tracked_event_notifications` push after the bell rows commit.
- **Frontend:** `lib/push.js` (Capacitor detection, one registration
  listener, register, bind and unbind, tap deep links), `lib/deepLinks.js`
  (the one post link the bell, the archive and the push share),
  `components/PushOptInPrompt.js` (the contextual card, and sign-in and
  sign-out binding), `components/PushTapNavigator.js` (root-mounted tap
  listener). Deploys with the site; no store review needed for copy or
  behavior here.
- **Android shell:** `@capacitor/push-notifications`; `google-services.json`
  in `android/app/`; versionCode 4 / versionName 1.1.0.
- **Dependency:** `firebase-admin>=7.7.0,<8` (send_each and the FCM topic
  API, so the 2027 Instance ID shutdown does not affect topic calls).

## Jeffrey's local build steps

1. `cd frontend`
2. `npm install`  (pulls @capacitor/push-notifications)
3. `npx cap sync android`  (wires the plugin into the native project)
4. Open `frontend/android` in Android Studio, Build, Generate Signed
   App Bundle (same keystore as v1.0.2), AAB.
5. Play Console, CivicView, Production, Create new release, upload the
   AAB.

## Play Console data safety

App content, Data safety: "Device or other IDs", Device IDs, collected,
not shared, for App functionality (push notification delivery),
optional to the user. Nothing in the 2026-10-16 rework changes it.

## Testing checklist (after a Render deploy and an app install)

1. Render env has `FIREBASE_SERVICE_ACCOUNT_JSON`; the boot log shows the
   FCM line.
2. Sign in as a demo citizen in the app; turn push on; Admin, "Send me a
   test push" arrives.
3. Track an official; post from that official's page (rep session): the
   phone shows "<name> posted" at once (As they happen). Tap it: the post
   opens and its bell row is read.
4. Set Push alerts to Daily summary; post twice; nothing arrives until
   6 p.m. local, then one "2 updates from officials you track".
5. Sign out in the app; post again: nothing arrives for that account.
6. With the app open, a new push refreshes the bell without waiting.

## Deferred (bring back as tasks when wanted)

- Bill-status pushes (needs a server-side daily check).
- The short per-type alert list that replaces the hidden "Notify me
  when..." switches (work order 10).
- iOS/APNs when the iOS shell ships.
- Election reminder pushes carrying their bell row id (their send path
  is grouped by TTL and was left as PR #271 built it).
- Restoring a signed-out device's tracked list in the app from the server
  (the server keeps it; the app's memory starts empty each session).
