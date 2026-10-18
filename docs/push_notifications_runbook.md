# Push notifications: build, ship and run

The FCM push pipeline shipped 2026-07-24, was reworked 2026-10-16 (work
order 8, `fix/notifications`) and became full phone notifications on
2026-10-17 (`feat/phone-notifications`, app 1.2.0). Since 2026-10-18
(`feat/web-push`) the same pushes also reach browsers, the iPhone Home
Screen app and the Windows app by web push (see **Web push** below).
Pushes mirror the in-app bell; the bell stays the source of truth, and a
push is only the interruption.

## What is pushed

| Kind | When | Who | Android channel | Tap opens |
| --- | --- | --- | --- | --- |
| `tracked_post` | an official you track posts (a post or a poll) | signed-in trackers, and signed-out devices tracking the page | Officials you track | the post (`/?page=<id>#post-<id>`) |
| `tracked_event` | an official you track schedules an event | signed-in trackers | Events | the page |
| `reply` | someone replies to your comment on a post or a citizen poll | citizens only (never reps or candidates: Jeffrey, 2026-07-26) | Replies | the post, or the poll (`#poll-<id>`) |
| `bill_update` | the daily pass finds something new on a federal bill you track | signed-in trackers | Bill updates | My Tracked (`/?open=tracked`) |
| `poll_results` | a poll you voted in closes | citizens who voted | Poll results | the poll |
| `page_change` / `page_changes` | a page you track changed (left office, campaign ended, took office); several in one run become one push | signed-in trackers | Changes to pages you track | the page, or the bell for several |
| `tracked_summary` | a daily or weekly summary, or the end of quiet hours | the device the updates were held for | Summaries | the bell; a signed-out device opens the newest update's page |
| `election_reminder` | a voting deadline or Election Day | citizens in covered states and anyone tracking the election | Election reminders | the state |
| `test` | admin "Send me a test push" | the admin's own devices | Officials you track | nothing |

Every tap marks the person's bell row read (the push carries its
`notification_id`). The table of where each kind opens is
`lib/deepLinks.js notificationLink`, shared by the bell, the activity
archive and the push tap.

No push for a post or a reply the moderation screen flags (`flag` or
`auto_hide`), or one already hidden or deleted; the bell row still comes.
An event that has already started is not pushed.

## The settings list (server-enforced, the same on every device)

One dropdown per row, in the bell's Settings and in Dashboard, Account &
settings, Notifications (`components/NotificationSettings.js`):

| Row | Choices | Default |
| --- | --- | --- |
| Officials you track | Bell and push, Bell only, Off | Bell and push |
| Events | Bell and push, Bell only, Off | Bell and push |
| Replies to your comments | Bell and push, Bell only, Off | Bell and push |
| Bill updates (federal) | Bell, push and email; Bell and push; Bell and email; Bell only; Off | Bell and push |
| Poll results | Bell and push, Bell only, Off | Bell and push |
| Election reminders | Bell, push and email; Bell and push; Bell and email; Bell only; Off | Bell and push |
| Changes to pages you track | Bell, push and email; Bell and push; Bell and email; Bell only | Bell, push and email |
| Weekly email digest | Off, Saturday mornings | Off |

Then Quiet hours, Push alerts (timing) and, in the app, Notification
details.

- Server: `services/alert_settings.py` decides bell, push and email on
  every send path. Storage: only the cells that differ from the defaults,
  in `citizen_accounts.alert_settings_json`; three cells keep their older
  columns (`election_reminders_off_at`, `election_reminder_email_at`,
  `page_change_email_off_at`) so the unsubscribe links and jobs agree.
- API: `GET /api/alert-settings`, `PATCH /api/alert-settings`
  `{row, value}`, one row per request, so a device sync or an email's
  unsubscribe link never undoes a change made elsewhere.
- Mute this official (My Tracked, signed in): `{"muted": true}` in that
  tracked official's prefs. Stops their posts, polls and events in the
  bell, the push and the weekly digest; notices that their page changed
  still come. Signed out, the button is hidden (a signed-out phone's
  tracking lives in memory only).
- Signed out, the panel shows only This phone, Quiet hours, Push alerts
  and Notification details: a signed-out phone gets officials' posts and
  polls.
- The 32 per-item "Notify me when..." switches are gone, including each
  official's event switch and each tracked election's four reminder
  switches; their stored values are no longer read.

## Android channels and how a notification looks (app 1.2.0)

| Channel id | Name in Android settings | Importance |
| --- | --- | --- |
| `officials` | Officials you track | default (sound) |
| `events` | Events | default |
| `replies` | Replies | high (pops up) |
| `bills` | Bill updates | default |
| `poll_results` | Poll results | default |
| `elections` | Election reminders | high |
| `page_changes` | Changes to pages you track | low (silent) |
| `summaries` | Summaries | default |

- Created natively at app start (`NotificationChannels.java`, called by
  `MainActivity` and before each notification) and re-asserted from the
  web app (`lib/push.js createChannels`, Capacitor `createChannel`), so a
  name or description can change with a web deploy. The ids must match
  `push_service.CHANNELS`; `tests/test_notification_switches.py` checks
  the server, the app and the web agree.
- The server sends build 5 and later a data-only message;
  `CivicViewMessagingService` (it replaces the Capacitor plugin's service
  in the manifest and hands every message on to it) builds the
  notification: the channel, the white status bar icon
  (`res/drawable/ic_stat_civicview.xml`), the brand colour `#2D6A4F`, a
  group per channel with a summary once 3 or more are in the tray
  (counting the one just posted; it lists who posted only when details
  are shown), and a tag (`event-<id>`, `bill-<key>`, `poll-<id>`,
  `page-<id>`, `election-<id>`, `summary`) so a newer one replaces the
  older.
- Older builds (1.1.0, versionCode 4) and devices that never sent a build
  get FCM's standard notification message with `channel_id`, `tag` and
  the colour. The web app creates the same channels on 1.1.0 too (the
  push plugin has `createChannel`).
- The manifest's defaults (for a standard message): channel `officials`,
  icon `ic_stat_civicview`, colour `cv_notification_accent`.

## Notification details (the private lock screen)

By default a notification names nobody: the server sends only a neutral
line as its title, with no body (`push_service.shown`), on every app
build, 1.1.0 included. So a locked phone shows the neutral line, and so
does the unlocked tray; tapping opens the update. "Notification
details: Show details" (prefs key `lock_screen_details`, synced, default
off) sends who posted and what.

| Channel | Shown by default |
| --- | --- |
| Officials you track | New update from an official you track |
| Events | New event from an official you track |
| Replies | New reply to your comment |
| Bill updates | Update on a bill you track |
| Poll results | Results are in for a poll you voted in |
| Election reminders | Election reminder |
| Changes to pages you track | A page you track changed (one change), or "N pages you track changed" |
| Summaries | the count line, such as "4 updates from officials you track" |
| A group of 3 or more | its count line, such as "3 updates from officials you track" |

Why the text itself and not Android's lock-screen rules (checked in the
Android source, 2026-10-17): Android replaces an app's own lock-screen
visibility for its channels with the app-wide setting, and it shows a
notification's public version only when the person has hidden sensitive
content in Android's own settings, which is off on most phones. A
private flag and a public version alone would leave the full text on
most lock screens. The app still sets the public version (the same
text) and asks for Private.

## Permission state

- At every launch and every resume the app asks Android
  (`NotificationSettings` plugin, `getStatus`: notifications on or off,
  and which channels are blocked). 1.1.0 has no plugin and falls back to
  the push plugin's check (which says granted on Android 12 and older).
- Off: the panel says "Notifications are off" with **Open settings**
  (the app's page in Android's notification settings). The app tells the
  server (`os_enabled: false` on `/api/push/register`), which sets
  `device_tokens.notifications_off_at` and skips that phone in every send
  path until it reports them back on. The token is kept.
- A row whose channel is blocked shows "Push for this is off in Android
  settings."
- Never a permission prompt at launch: a launch with notifications off
  only reports it.
- The opt-in card: the first offer as before (a signed-in citizen with no
  choice yet, or the first track). "Not now" records the date; the card
  comes back once, only when they track something at least 30 days later;
  a second "Not now" ends it. If Android already refused, the card offers
  Open settings. Its text names only alerts that exist (federal bills
  only; signed out, only officials' posts and polls).

## Bill updates (daily pass)

`services/bill_updates.py`, Congress.gov only (api.congress.gov v3).
State bills cannot be tracked yet; that is its own work order.

- Once a day after 9 a.m. Eastern, in its own loop off the boot path
  (first look 3 minutes after boot, then every 15 minutes to see whether
  today's pass is due). The day is claimed in `job_runs` (`bill-updates`,
  the Eastern date) and an advisory lock keeps two instances apart.
- On by default in production only; `BILL_UPDATES_ENABLED=true` or
  `false` overrides that. Needs `CONGRESS_API_KEY` (Render).
- One request per tracked bill (`/bill/{congress}/{type}/{number}`), and
  `/actions` only for a bill whose latest action changed. At most 1,500
  bills a pass, least recently checked first (Congress.gov allows 5,000
  requests an hour), two at a time.
- `bill_watch` holds what the pass last saw; the first look records and
  sends nothing (no backlog). A change becomes one `bill_updates` row
  (status change, recorded vote, or other action; up to 3 actions) and
  each tracker gets it once (`bill_update_deliveries`, unique per update
  and person): bell row, push (tag `bill-<key>`), and one email per pass
  per person who chose email, with its own one-click unsubscribe
  (`bill_updates` type). Every tracker's My Tracked snapshot is refreshed.
- The home page no longer re-checks tracked bills in the browser; My
  Tracked keeps its manual Refresh.
- Admin: `GET /api/admin/bill-updates` (what is watched, the last runs,
  recent updates), `POST /api/admin/bill-updates/run` (a pass now; it
  sends what it finds).

## Poll results

`services/poll_results.py`, every 5 minutes inside the summary loop. A
poll has closed when its closing time passed or its citizen author closed
it. Each is claimed once (`polls.results_notified_at`); the citizens who
voted get a bell row and a push "Results are in". Nothing for a poll
taken down after reports, a citizen poll archived on a page claim or
pushed off by newer polls (unless its time had already run out), or a
post's poll whose post was deleted or hidden. The first pass after the
deploy stamps every poll already closed and sends nothing
(`job_runs`: `poll-results`, `seeded`).

## Page changes

The former-pages job (`services/page_lifecycle_job.py`) collects the
tracker notices of one run per citizen and sends one push each: the
change itself when there is one, else "3 pages you track changed"
opening the bell. The "Follow in office" hand-off does the same.

## Push timing and quiet hours

The **Push alerts** setting (prefs key `push_cadence`): As they happen
(the default), Daily summary (one push at 6 p.m. local) or Weekly summary
(Saturday 10 a.m. local). It covers officials' posts, polls and events,
bill updates and poll results. Replies and page changes come as they
happen. **Quiet hours** hold every push except election reminders; what
they held goes out as one summary when they end. Election reminders are
never held or summarized: inside quiet hours only the bell row comes.

A summary of one update is that update's own push on its own channel; a
summary of several goes on the Summaries channel ("4 updates from
officials you track", or for a mix "3 new updates: Officials you track,
bills you track and polls you voted in."). Held updates live in
`push_held_items` (their channel and tag ride in `data_json` as
`_channel`, `_tag`); updates the person already read or cleared in the
bell are left out. Each device is claimed with one conditional UPDATE on
`device_tokens.summary_sent_at`.

## Who a device belongs to

- **Sign-in** binds the device at once; **sign-out** unbinds it
  (`POST /api/push/unbind`); a register without a citizen session unbinds
  a bound device; a register by another citizen takes it over. Any change
  of owner drops the tracked list and held updates.
- A signed-out device carries its own tracked list (`tracked_json`);
  registers merge keys, only `tracked_remove` takes one out.
- Every register also carries `app_build` (the versionCode, from the
  Capacitor App plugin) and `os_enabled`.

## Delivery details

- One message per device (`send_messages`, FCM `send_each`, 500 per
  request), so each carries its own bell row id, format and lock-screen
  text. Election reminders too since 2026-10-17 (they were a multicast
  per TTL).
- TTL: posts, replies, poll results, bill updates and page changes 3
  days, events until they start (at most 28 days), summaries 2 days,
  election reminders until their deadline.
- A token is pruned only when FCM says it is dead: `UnregisteredError`,
  `SenderIdMismatchError`, or an `InvalidArgumentError` that names the
  registration token.
- Rate limits: `/api/push/register`, `/unbind`, `/unregister` 60 per 10
  minutes per account or IP.
- In the app, a push received while CivicView is open refreshes the bell
  at once (`pushNotificationReceived`).

## Logs to look for (Render)

- Boot: `Push service: FCM (firebase-admin) active`; `Bill updates ENABLED
  (daily after 9 a.m. Eastern).`
- Each fan-out: `push tracked_post official=X: sent=N held_for_summary=N
  held_quiet_hours=N failed=N pruned=N` (also `reply`, `bill_update`,
  `poll_results`, `page_change`).
- Held back: `tracked_post push held back: post=N moderation flag (post)`,
  `reply push held back: post_comment=N moderation flag`.
- Bills: `bill updates pass: {checked, seeded, unchanged, updates, bell,
  pushed_devices, emails_sent, errors, run_key}`.
- Polls: `poll results: {...}`; first pass `poll results: first pass
  stamped N poll(s) already closed (no backlog)`.
- Page changes: `page change pushes: {single, grouped, devices}`.
- Summaries: `push summaries: {...}`.

## Admin

- **Send me a test push** (under the admin page heading): the devices
  bound to your citizen account, plus this device when the admin page is
  open in the app. It shows its details on purpose.
- **Bill updates:** `GET /api/admin/bill-updates`, `POST /api/admin/bill-updates/run`.

## Architecture (what lives where)

- **Firebase project:** `CivicView` (`civicview-18`), Android app
  `app.civicview`.
- **Backend:** `services/push_service.py` (FCM or the dev logger, the
  message formats, channels, holding, pruning), `services/alert_settings.py`
  (the list), `services/push_summaries.py`, `services/poll_results.py`,
  `services/bill_updates.py`, `services/notifications_inapp.py` (bell rows,
  replies), `services/page_lifecycle_job.py`, `routers/push.py`,
  `routers/alert_settings.py`, `routers/bill_updates.py`. Tables:
  `device_tokens` (+ `app_build`, `notifications_off_at`),
  `push_held_items`, `bill_watch`, `bill_updates`, `bill_update_deliveries`,
  `job_runs`; columns `citizen_accounts.alert_settings_json`,
  `polls.results_notified_at` (auto-migrate on boot). Web push
  (2026-10-18): `services/web_push.py`, table `web_push_subscriptions`,
  column `push_held_items.web_subscription_id`.
- **Frontend:** `lib/push.js`, `lib/alertSettings.js`, `lib/deepLinks.js`,
  `lib/notificationPrefs.js`, `components/NotificationSettings.js`,
  `components/NotificationBellMenu.js`, `components/PushOptInPrompt.js`,
  `components/TrackedManager.js` (Mute). Web push: `public/sw.js`,
  `lib/webPush.js`, `lib/pushCore.js`, `components/HomeScreenGuide.js`.
  Deploys with the site.
- **Android shell:** `CivicViewMessagingService.java`,
  `NotificationChannels.java`, `NotificationSettingsPlugin.java`,
  `MainActivity.java`, `res/drawable/ic_stat_civicview.xml`,
  `res/values/colors.xml`, channel names in `res/values/strings.xml`,
  the manifest's service and meta-data. versionCode 5 / versionName 1.2.0.

## Release 1.2.0 (Jeffrey's steps)

The backend and web parts work with 1.1.0 phones as they are (they get
the standard message), so the merge can go out before the app does.

1. Keep 1.1.0 ready: in Play Console, App bundle explorer, download the
   1.1.0 (versionCode 4) AAB and keep it with the keystore. Tag the main
   commit just before this PR's merge (`git tag v1.1.0 <commit>`, then
   push the tag) so a 1.1.1 can be rebuilt from it.
2. In `C:\dev\US apps\CivicLens`: pull `main` after the merge.
3. `cd frontend`, then `npm ci`, then `npx cap sync android`.
4. Android Studio: open `frontend\android` (Gradle JDK `ms-21`, as
   before), let it sync, then Build, Generate Signed App Bundle, Android
   App Bundle, the same upload keystore as 1.1.0, release. The AAB is in
   `frontend\android\app\release\`.
5. Play Console, CivicView, Testing, Internal testing, Create new release,
   upload the AAB, release notes ("Notification channels you can manage
   in Android settings, private notifications by default, replies, bill
   updates and poll results alerts."), Save, Review, Start rollout to Internal
   testing. Add yourself as a tester if needed and install it from the
   opt-in link on your phone (it updates the 1.1.0 install in place).
6. Run the device checklist below on your phone.
7. When it passes: Production, Create new release, Add from library (the
   same 5 (1.2.0) bundle), staged rollout 20 percent, then 100 percent
   after a day or two with no crash reports.
8. Render env: `APP_LATEST_VERSION_CODE=5` (the update nudge, row #109)
   once 1.2.0 is at 100 percent. Leave `APP_MIN_VERSION_CODE` unset.

**Rolling back.** During the staged rollout: Production, Halt rollout
(phones still on 1.1.0 stay there). After 100 percent, Play cannot go
back to a lower versionCode: rebuild the 1.1.0 commit with versionCode 6
and versionName 1.1.1, upload, roll out. The server needs no change
either way: anything below build 5 gets the standard message.

## Play Console Data safety (App content, Data safety)

Already declared: Device or other IDs (the FCM token), collected, not
shared, App functionality, optional. Changes to make for 1.2.0:

1. **App activity, App interactions**: declare it (if not already) for
   the officials, bills and elections someone tracks and mutes, and the
   polls they voted in (used to send their alerts). Collected, not
   shared, App functionality. Optional for a signed-out phone's tracked
   list (sent only when push is on).
2. **App activity, Other actions**: notification settings (which alerts
   reach the bell, phone or email, quiet hours, push timing, whether
   notifications show details). Collected, not shared, App
   functionality, optional.
3. **App info and performance, Other app performance data**: the app's
   version number and whether notifications are turned off in Android
   settings, sent at registration so the server sends the right format
   and stops sending to a phone with notifications off. Collected, not
   shared, App functionality.
4. **Location, Approximate location** (Jeffrey, 2026-10-17: declare
   it): the time zone offset, a UTC offset read from the phone's clock
   settings, used to time pushes, quiet hours and summaries and the
   times shown in emails. It is sent for a signed-in citizen (the
   settings sync) and for a phone with push on, never for a signed-out
   visitor without push. Play's definition of the type is "User or
   device physical location to an area greater than or equal to 3
   square kilometers, such as the city a user is in". In the form:
   - Data types: Location, tick **Approximate location** (not Precise
     location).
   - Is this data collected, shared, or both? **Collected** only.
   - Is this data processed ephemerally? **No, this collected data is
     not processed ephemerally** (it is stored with the settings).
   - Is this data required for your app, or can users choose whether
     it's collected? **Data collection is required (users can't turn
     off this data collection)**: a signed-in citizen has no switch
     for it, so "required" is the accurate answer.
   - Why is this user data collected? **App functionality** only.
   The privacy policy already names it (Your settings, and Push
   notifications); no change there.
5. Keep: data encrypted in transit (yes); people can request deletion
   (yes: account deletion, and turning push off deletes the token).
6. The ids in each push (checked 2026-10-18, no change needed): every
   FCM push carries the kind of update and the ids that open it (page,
   post, poll or event id, a federal bill's number, a state code, the
   bell row id), and names and text only with Show details. Google
   delivers it as our service provider, which Play does not count as
   sharing, and what the ids reveal (which officials, bills and polls
   someone follows) is the App interactions data in item 1. So no new
   data type and no "shared" answer. Web push is not part of the app.

## Device checklist (1.2.0 from Internal testing)

1. Sign in as a demo citizen. Bell, Settings: "This phone: Push is on".
2. Android Settings, Apps, CivicView, Notifications: the 8 categories
   above with their names ("Miscellaneous" may remain from 1.1.0).
3. Admin, "Send me a test push": arrives with the CivicView mark in the
   status bar and the green accent.
4. Track an official; post from that official's page (rep session): a
   notification arrives in Officials you track. Tap it: the post opens
   and pulses, and its bell row is read.
5. With the default setting the notification in step 4 read only "New
   update from an official you track". Lock the phone and post again: the
   lock screen shows the same line and no name. Bell, Settings,
   Notification details: Show details; post again: "<name> posted" and
   the text show, locked and unlocked. Set it back to Hide details.
6. Android settings: turn off the Officials you track category; post: no
   notification, the bell row comes, and Settings shows "Push for this is
   off in Android settings." under Officials you track. Turn it back on.
7. Android settings: turn off all CivicView notifications; switch back to
   the app: Settings shows "Notifications are off" with Open settings;
   tap it, Android's page opens; turn them on, switch back: "Push is on".
8. Replies: from another account reply to your comment on a post, and on
   a citizen poll: each pops up in Replies; the tap opens the post or the
   poll card.
9. Events: schedule an event on the page: it arrives in Events and opens
   the page.
10. Poll results: vote in a citizen poll that closes in a few minutes;
    within 5 minutes of closing, "Results are in" arrives in Poll results
    and opens the poll.
11. Bill updates: track a federal bill, run `POST
    /api/admin/bill-updates/run` once (it only records the bill), then in
    the Render database shell `UPDATE bill_watch SET
    latest_action_date='2000-01-01' WHERE bill_key='<the key>';` and run
    it again: "<citation>: <change>" arrives in Bill updates; the tap opens
    My Tracked.
12. Page changes: Admin, Transitions, set a left-office date on a test
    page you track and run the job: the push arrives in Changes to pages
    you track; with three such pages in one run, one push "3 pages you
    track changed" opens the bell.
13. Three posts from tracked officials: the tray groups them under "3
    updates from officials you track".
14. Mute the official in My Tracked; post: no bell row and no push. Unmute.
15. Sign out: posts still reach the phone only for officials tracked
    signed out; the opt-in card and Settings say only officials' posts
    and polls.

## Web push (browsers, the iPhone Home Screen app, the Windows app; 2026-10-18)

The same pushes as the phone, to desktop browsers (Chrome, Edge,
Firefox, Safari on a Mac), browsers on Android phones, CivicView on an
iPhone or iPad Home Screen (iOS 16.4 or later) and the Windows app
(Microsoft Store). The Android app keeps FCM: it never registers the
service worker, and what an FCM push contains did not change.

### Turning it on (Jeffrey's steps)

Web push is off until the keys are set: browsers keep the old line
"Push alerts come through the CivicView Android app on Google Play", and
the API sends nothing to browsers.

1. On your own computer, never in a Claude session:
   `cd "C:\dev\US apps\CivicLens"`, then
   `python scripts\generate_vapid_keys.py` (any Python 3 with the
   `cryptography` package). It prints four lines and writes nothing.
2. Save the pair in `C:\dev\US apps\Keys\` (never in the repo).
3. Render, `civicview-api`, Environment: add `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:civicview@civicview.app`).
   Save; Render redeploys.
4. Vercel, the CivicView project, Settings, Environment Variables,
   Production: add `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the same public key.
   Redeploy production (a `NEXT_PUBLIC_` value is built into the site, so
   it needs a new build, not only a restart).
5. Render logs, about a minute after boot: `Web push: VAPID keys loaded,
   web push active`. If it says `VAPID_PUBLIC_KEY is not the public key
   of VAPID_PRIVATE_KEY`, a key was pasted wrong.
6. Run the two checklists below.

Use one pair for good. A new pair ends every browser's subscription
(each browser subscribes again, without a prompt, the next time
CivicView opens in it); replace it only if the private key leaks. If
Vercel and Render hold different public keys, every Turn on fails ("Could
not turn on push here") and Render logs `a browser subscribed with
another public key`.

### How it works

- **Subscribing** (`lib/webPush.js`): only from a tap (Turn on in the
  settings list, or Enable on the opt-in card); never on page load. The
  subscription goes to `POST /api/push/web/register` with the officials
  this browser tracks (signed out) and the timing settings, exactly like
  a phone. A sign-in binds the browser, a sign-out unbinds it
  (`/api/push/web/unbind`), Turn off unsubscribes and deletes it
  (`/api/push/web/unregister`). CSRF and the push rate limit (60 per 10
  minutes) apply. At every load with push on, the browser registers
  again without a prompt; if the permission was taken away in the
  browser's site settings, the server forgets it.
- **Only real push services**: the API accepts an endpoint only on
  `https` at `fcm.googleapis.com`, `android.googleapis.com`,
  `jmt17.google.com`, `*.push.services.mozilla.com`,
  `*.notify.windows.com` or `*.push.apple.com`, so nobody can make the
  server send requests to an address of their choosing.
- **Sending** (`services/web_push.py`): every send path in
  `push_service` (tracked posts and polls, events, replies, bill updates,
  poll results, page changes, election reminders) and every summary
  (`push_summaries`) picks the person's browsers by the same rules as
  their phones: the settings list, Mute, quiet hours, Push alerts timing,
  grouping of page changes, TTLs. Each push is encrypted for that browser
  (RFC 8291, aes128gcm, http-ece) and signed with our VAPID key (RFC 8292,
  py-vapid), so the push service can't read what it says (the text, the
  ids for the tap, the badge count). Headers, which the push service
  reads in the clear: `TTL` as for the phone (3 days for a post, 2 for a
  summary, until the start for an event, until the deadline for an
  election reminder), `Urgency: high` for replies and election
  reminders, and `Topic` (a newer undelivered push replaces the older
  one). The Topic is an HMAC of the tag under a key derived from
  `VAPID_PRIVATE_KEY`, 22 URL-safe characters: the tags come from small
  sets anyone can list (`page-<official id>`, `bill-<key>`, `poll-<n>`,
  `event-<n>`), so a plain hash could be reversed by hashing them all.
  The push service still sees the endpoint, that CivicView sent it, the
  time, the size, the TTL and the urgency, and that two pushes share a
  Topic; the privacy policy says so.
- **Keys at registration**: `p256dh` must be a point on P-256
  (`from_encoded_point`), not just 65 bytes starting with 0x04, and
  `auth` 16 bytes; anything else is a 400 `invalid_keys`. A stored row
  whose keys still can't be encrypted for (a row written before that
  check, or by hand) is removed at its first send with its held updates,
  as for a 404 or 410, instead of being retried forever.
- **Order of commits**: on every send path the phones' results (held
  updates, `last_push_at`, pruned tokens) are committed first; the
  browsers are then sent to in a transaction of their own
  (`push_service._send_to_browsers`), so a web push failure rolls back
  only the browsers' changes. In the summary pass a failed browser
  counts as a transient failure: its claim is released and its held
  updates wait for the next pass.
- **What it says**: built from the same message as the phone with
  `push_service.shown()`: by default only the general line ("New update
  from an official you track", or a count line for a summary) and no
  body; who and what only with Notification details: Show details, which
  is one setting for all of a person's devices.
- **Pruning**: only when the push service answers 404 or 410. A 403
  (our key or clock) is logged as an error and keeps the subscription, so
  a configuration mistake can't wipe every browser.
- **The service worker** (`public/sw.js`): shows every push (iOS takes
  the permission away from a site that receives a push and shows
  nothing, so a payload it can't read still shows "New updates in
  CivicView"), with the CivicView icon; a newer push with the same tag
  replaces the older one; once 3 or more from one channel are on screen
  they become one count notification ("3 updates from officials you
  track") that opens the bell; pushes are handled one at a time. A tap
  focuses an open CivicView window and hands it the link (the bell row is
  marked read, then the post opens, as in the app), or opens one at the
  link with `?cv_read=<row>`. The links are a copy of
  `lib/deepLinks.js`; `npm run test:notifications` checks they agree.
- **App badge**: in an installed app (the Windows app, a desktop install,
  the Home Screen app) the icon shows the bell's unread count; each push
  carries the count and the bell sets it on every refresh; Mark as read
  and Clear close CivicView's notifications and clear the badge.
- **iPhone and iPad**: iOS sends web push only to Home Screen apps. In a
  Safari tab, Turn on (or the card's Enable) shows this guide instead of
  a prompt:

  > **Add CivicView to your Home Screen to get alerts**
  > On iPhone and iPad, alerts come only to CivicView on your Home Screen.
  > 1. Tap Share in Safari (the square with the arrow).
  > 2. Tap Add to Home Screen, then Add.
  > 3. Open CivicView from your Home Screen and tap Turn on in notification settings.

  Older than iOS 16.4: "Alerts on iPhone and iPad need iOS 16.4 or
  later." The Home Screen app keeps its own storage, so the person signs
  in there once, and it offers the card once when opened with no choice
  yet.
- **The opt-in card in a browser**: only after a track, plus once when
  the Home Screen app opens; never at sign-in or on page load, and not
  once the browser blocks CivicView's notifications.
- **Settings list**: "This browser" ("This app" when installed), Push is
  on or off, "Notifications are blocked" with how to allow them in the
  site settings, then the same rows, Quiet hours, Push alerts and
  Notification details as the app.

### Storage and endpoints

- Table `web_push_subscriptions`: endpoint (unique), p256dh, auth,
  platform (desktop, android, ios), citizen_id (NULL signed out),
  tracked_json, prefs_json, last_push_at, summary_sent_at, created_at,
  last_seen_at. `push_held_items.web_subscription_id` holds a browser's
  held updates (`device_token_id` became nullable). Auto-migrate adds
  both on boot. Account deletion removes a citizen's browsers.
- `POST /api/push/web/register` `{endpoint, keys: {p256dh, auth},
  application_server_key, platform, tracked?, tracked_remove?, prefs?}`:
  503 `web_push_off` without the keys, 400 `endpoint_not_allowed` or
  `invalid_keys`, 409 `vapid_key_mismatch`.
- `POST /api/push/web/unbind` and `/api/push/web/unregister` `{endpoint}`.
- Admin, "Send me a test push" also reaches this browser and the
  browsers bound to the admin's citizen account (`web: on|off` in the
  answer).

### Known gap: a rotated subscription (no route for it yet; Jeffrey, 2026-10-18)

A push service can replace a browser's subscription with a new one (it
is rare: an expiry, a browser update, the push service rotating its
keys). `public/sw.js` then subscribes again on `pushsubscriptionchange`,
but a service worker has no session and no CSRF token, so it does not
tell the server. Until CivicView is next opened in that browser:

- the server still holds the old endpoint; the push service answers 410
  for it and the row is removed, with any updates held for that
  browser's summary;
- that browser gets no pushes. Its bell rows, email and the person's
  other devices are unaffected.

The next time CivicView opens there (any page, signed in or not),
`refreshWebPush` registers the current subscription, binds it to the
signed-in citizen and sends the tracked list and settings, with no
prompt. A worker-side route that registers the new subscription at once
is in Deferred below; it would need its own way to prove which browser
it is (the old endpoint and keys) instead of a session.

### Logs to look for (Render)

- `Web push: VAPID keys loaded, web push active` (or `Web push off: ...`
  with the reason).
- Each fan-out: `web push tracked_post official=X: sent=N
  held_for_summary=N held_quiet_hours=N failed=N pruned=N` (and the other
  kinds), next to the phone line.
- `web push: N push(es) refused with [403] (check the VAPID keys and the
  server clock); subscriptions kept`.
- `web push: a browser subscribed with another public key; check that
  NEXT_PUBLIC_VAPID_PUBLIC_KEY matches VAPID_PUBLIC_KEY`.
- `web push: N subscription(s) with keys that can't be encrypted for;
  removed`.
- `web push failed (non-fatal; the phones' results were already saved)`,
  or in the summary pass `push summaries: web push to a browser failed;
  it is tried again next pass`, each with its traceback.

### Checklist: iPhone (the Home Screen app, iOS 16.4 or later)

1. In Safari, open civicview.app and sign in as a demo citizen. Bell,
   Settings: "This browser", "Push is off".
2. Tap Turn on: the Add to Home Screen guide shows, and iOS asks nothing.
3. Share, Add to Home Screen, Add. Open CivicView from its Home Screen
   icon (no Safari address bar) and sign in there.
4. The card "Get a heads-up when things move" shows once. Tap Enable
   notifications; iOS asks to allow notifications: Allow. Bell, Settings:
   "This app", "Push is on".
5. Track a test official; from that official's page (rep session, on
   another device) post. A notification arrives reading only "New update
   from an official you track", locked or not.
6. Tap it: CivicView opens at the post (it pulses) and the bell row is
   read. Before reading, the Home Screen icon showed the unread count;
   after Mark as read it is gone.
7. Bell, Settings, Notification details: Show details; post again:
   "<name> posted" and the text. Set it back to Hide details.
8. Post three times quickly: one notification "3 updates from officials
   you track"; tapping it opens the bell.
9. Push alerts: Daily summary; post: nothing now; at 6 p.m. one summary.
   Set it back to As they happen.
10. Over a day, check that every push showed a notification and that
    notifications keep arriving (iOS has not taken the permission away).
11. Bell, Settings, Turn off: posts no longer notify; Turn on again works
    without a new iOS prompt.
12. Sign out in the Home Screen app: posts from officials you tracked
    while signed in stop; sign back in and they come again.

### Checklist: the Windows app (Microsoft Store)

1. Open CivicView from the Start menu and sign in as a demo citizen.
   Bell, Settings: "This app", "Push is off".
2. Turn on: Windows (Edge) asks to show notifications: Allow. "Push is
   on". Nothing was asked before the tap.
3. Admin, "Send me a test push": a CivicView notification appears in the
   corner and in the notification center ("CivicView test push").
4. Post from a tracked official: "New update from an official you track".
   Click it: the app comes forward at the post, and the bell row is read.
5. The taskbar icon shows the unread count; Mark as read in the bell
   clears it.
6. Three posts quickly: one notification "3 updates from officials you
   track"; clicking it opens the bell.
7. Close the app and post: the notification still arrives (if it does
   not, Edge, Settings, System and performance, "Continue running
   background extensions and apps when Microsoft Edge is closed" must be
   on). Clicking it opens the app at the post.
8. Windows Settings, System, Notifications: turn CivicView off: no
   notifications, the bell rows still come. Turn it back on.
9. Turn off in the app: no notifications; Turn on again works without a
   new prompt.
10. Optional, a desktop browser tab (Chrome or Edge): the same as steps
    1 to 4, with "This browser".

## Deferred (bring back as tasks when wanted)

- State bill tracking and Open States bill updates (its own work order,
  after November 3: a tracked type with its own key, storage, My Tracked
  rows and bell links).
- iOS/APNs when the iOS shell ships (web push already covers the
  iPhone Home Screen app).
- A monochrome badge image for notifications in Chrome on Android (it
  shows Chrome's default small icon today).
- Registering a rotated subscription from the service worker itself
  (see "Known gap: a rotated subscription" above: today the page
  registers it the next time CivicView opens, and the old endpoint is
  pruned on its 410).
- Election reminder pushes carrying their bell row id.
- Removing an event's notification when the official cancels the event
  (the tag is in place).
- Restoring a signed-out device's tracked list in the app from the server.
- One coded notification id in place of the ids in each FCM push (Jeffrey,
  2026-10-18: a later Android build, after November 3). Today each push
  carries the kind of update and the ids that open it (page, post, poll,
  event, bill number, state code, bell row id); the privacy policy says
  so. Web push needs no change: its payload is encrypted end to end.
