# Push notifications: build, ship and run

The FCM push pipeline shipped 2026-07-24, was reworked 2026-10-16 (work
order 8, `fix/notifications`) and became full phone notifications on
2026-10-17 (`feat/phone-notifications`, app 1.2.0). Pushes mirror the
in-app bell; the bell stays the source of truth, and a push is only the
interruption.

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

Then Quiet hours, Push alerts (timing) and, in the app, Lock screen.

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
  and Lock screen: a signed-out phone gets officials' posts and polls.
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
  group per channel with a summary once 3 or more are in the tray, and a
  tag (`event-<id>`, `bill-<key>`, `poll-<id>`, `page-<id>`,
  `election-<id>`, `summary`) so a newer one replaces the older.
- Older builds (1.1.0, versionCode 4) and devices that never sent a build
  get FCM's standard notification message with `channel_id`, `tag`, the
  colour and `visibility: private`. The web app creates the same channels
  on 1.1.0 too (the push plugin has `createChannel`).
- The manifest's defaults (for a standard message): channel `officials`,
  icon `ic_stat_civicview`, colour `cv_notification_accent`.

## Lock screen

Every channel is created with Private lock-screen visibility, which
Android enforces on a secure lock screen whatever the phone's own
setting. The lock screen then shows the notification's public version,
titled "CivicView":

| Channel | Locked phone shows |
| --- | --- |
| Officials you track | New update from an official you track |
| Events | New event from an official you track |
| Replies | New reply to your comment |
| Bill updates | Update on a bill you track |
| Poll results | Results are in for a poll you voted in |
| Election reminders | Election reminder |
| Changes to pages you track | A page you track changed |
| Summaries | New updates in CivicView |
| A group of 3 or more | N new updates |

"Lock screen: Show details" (prefs key `lock_screen_details`, synced,
default off) makes the public version a full copy. Android does not let
an app change a channel's lock-screen rule after creating it, so the
public version is the switch. On 1.1.0 there is no public version: a
locked phone shows Android's own "Contents hidden".

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
  open in the app. It shows details on the lock screen on purpose.
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
  `polls.results_notified_at` (auto-migrate on boot).
- **Frontend:** `lib/push.js`, `lib/alertSettings.js`, `lib/deepLinks.js`,
  `lib/notificationPrefs.js`, `components/NotificationSettings.js`,
  `components/NotificationBellMenu.js`, `components/PushOptInPrompt.js`,
  `components/TrackedManager.js` (Mute). Deploys with the site.
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
   in Android settings, private lock screen, replies, bill updates and
   poll results alerts."), Save, Review, Start rollout to Internal
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
   reach the bell, phone or email, quiet hours, push timing, lock-screen
   details). Collected, not shared, App functionality, optional.
3. **App info and performance, Other app performance data**: the app's
   version number and whether notifications are turned off in Android
   settings, sent at registration so the server sends the right format
   and stops sending to a phone with notifications off. Collected, not
   shared, App functionality.
4. **Time zone offset**: a UTC offset from the phone's clock settings,
   used to time pushes and emails. It is far coarser than Play's
   "Approximate location" (an area of 3 square kilometers or more, such
   as a city), so the recommendation is not to declare it as location;
   the privacy policy names it. If you prefer to be conservative,
   declare Approximate location, App functionality, not shared.
5. Keep: data encrypted in transit (yes); people can request deletion
   (yes: account deletion, and turning push off deletes the token).

## Device checklist (1.2.0 from Internal testing)

1. Sign in as a demo citizen. Bell, Settings: "This phone: Push is on".
2. Android Settings, Apps, CivicView, Notifications: the 8 categories
   above with their names ("Miscellaneous" may remain from 1.1.0).
3. Admin, "Send me a test push": arrives with the CivicView mark in the
   status bar and the green accent.
4. Track an official; post from that official's page (rep session):
   "<name> posted" arrives in Officials you track. Tap it: the post opens
   and pulses, and its bell row is read.
5. Lock the phone and post again: the lock screen shows "CivicView, New
   update from an official you track". Bell, Settings, Lock screen: Show
   details; lock again and post: the full text shows.
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

## Deferred (bring back as tasks when wanted)

- State bill tracking and Open States bill updates (its own work order,
  after November 3: a tracked type with its own key, storage, My Tracked
  rows and bell links).
- iOS/APNs when the iOS shell ships.
- Election reminder pushes carrying their bell row id.
- Removing an event's notification when the official cancels the event
  (the tag is in place).
- Restoring a signed-out device's tracked list in the app from the server.
