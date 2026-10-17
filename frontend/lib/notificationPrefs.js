// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Notification preferences.
 *
 * 2026-10-17 (phone notifications): the 32 per-item "Notify me when..."
 * switches are gone. In their place:
 *
 *   ALERT_ROWS: one short list, the same on every device and enforced
 *     by the server (backend/app/services/alert_settings.py). Each row
 *     is one kind of alert with one dropdown: where it arrives (the
 *     bell, a push, an email). Read and saved one row at a time through
 *     /api/alert-settings (lib/alertSettings.js).
 *   Mute this official: per official in My Tracked, stored in that
 *     tracked official's prefs as { muted: true }. It stops their posts,
 *     polls and events in the bell, the push and the weekly digest;
 *     the notice that their page changed still comes.
 *   CHANNEL_SCHEMA (below): quiet hours, push timing and the lock
 *     screen, synced to the account and sent with each phone's
 *     registration.
 *
 * PREF_SCHEMA keeps one entry per tracked type so stored prefs objects
 * still merge; no per-item switch is shown or read any more.
 */

export const PREF_TYPES = {
  representative: 'representative',
  candidate: 'candidate',
  bill: 'bill',
  election: 'election',
};

export const PREF_SCHEMA = {
  representative: { label: 'Representative', options: [], sliders: [] },
  candidate: { label: 'Candidate', options: [], sliders: [] },
  bill: { label: 'Bill', options: [], sliders: [] },
  election: { label: 'Election', options: [], sliders: [] },
};

/**
 * The notification settings list. key: the server's row name. channel:
 * the Android notification channel its pushes use (the "Off in Android
 * settings" note). The same wording for every official, party and
 * state. Bill updates cover federal bills only (state bills cannot be
 * tracked yet), so no copy promises state bill alerts.
 */
export const ALERT_ROWS = [
  { key: 'officials', label: 'Officials you track', hint: 'Their posts and polls', channel: 'officials' },
  { key: 'events', label: 'Events', hint: 'Scheduled by officials you track', channel: 'events' },
  { key: 'replies', label: 'Replies to your comments', hint: null, channel: 'replies' },
  { key: 'bills', label: 'Bill updates', hint: 'Federal bills you track, from Congress.gov', channel: 'bills' },
  { key: 'poll_results', label: 'Poll results', hint: 'When a poll you voted in closes', channel: 'poll_results' },
  { key: 'elections', label: 'Election reminders', hint: 'Voting deadlines and Election Day', channel: 'elections' },
  { key: 'page_changes', label: 'Changes to pages you track', hint: 'Leaving office, a campaign ending, taking office', channel: 'page_changes' },
];

export const ALERT_CHOICE_LABELS = {
  bell_push_email: 'Bell, push and email',
  bell_push: 'Bell and push',
  bell_email: 'Bell and email',
  bell: 'Bell only',
  off: 'Off',
};

/** The defaults the server applies before anyone changes anything. */
export const ALERT_DEFAULTS = {
  officials: 'bell_push',
  events: 'bell_push',
  replies: 'bell_push',
  bills: 'bell_push',
  poll_results: 'bell_push',
  elections: 'bell_push',
  page_changes: 'bell_push_email',
};

/** The weekly email digest's row (CitizenAccount.digest_opt_in). */
export const DIGEST_ROW = {
  key: 'digest',
  label: 'Weekly email digest',
  hint: 'What officials you track did this week',
  choices: ['off', 'weekly'],
  choiceLabels: { off: 'Off', weekly: 'Saturday mornings' },
};

/** True when a choice sends email. */
export function choiceHasEmail(value) {
  return value === 'bell_push_email' || value === 'bell_email';
}

/** True when a choice sends a push. */
export function choiceHasPush(value) {
  return value === 'bell_push_email' || value === 'bell_push';
}

/**
 * Build a fresh prefs object for a given type using the declared defaults.
 * Safe to call when first tracking a new subject.
 */
export function defaultPrefsFor(type) {
  const schema = PREF_SCHEMA[type];
  if (!schema) return {};
  const out = {};
  for (const opt of schema.options) out[opt.key] = opt.default;
  for (const s of schema.sliders) out[s.key] = s.default;
  return out;
}

/**
 * Merge a stored prefs object with the current default schema. Any newly
 * introduced pref keys get their declared defaults; unknown legacy keys are
 * preserved so we never silently drop user-set values.
 */
export function mergePrefs(type, stored) {
  const base = defaultPrefsFor(type);
  if (!stored || typeof stored !== 'object') return base;
  return { ...base, ...stored };
}

/**
 * Channel-level (global) settings, kept in the same module so UIs import
 * one schema. Synced to the account (lib/channelPrefs.js) and sent with
 * each phone's registration (lib/push.js), so the server applies them
 * per device.
 *
 * 2026-10-17: the "Delivery channels" switches (in-app toasts, desktop
 * notifications, email digests, mobile push) are gone. Push is the
 * "This phone" row of the settings list, the weekly digest is a row of
 * that list, and nothing read the other two. lock_screen_details is new.
 */
export const CHANNEL_SCHEMA = {
  label: 'Timing',
  options: [],
  sliders: [
    {
      key: 'quiet_hours',
      label: 'Quiet hours',
      description: 'No pushes in these hours, your local time. Held updates arrive in one summary after; election reminders wait in the bell.',
      choices: ['off', 'nights', 'nights_weekends', 'work_hours_only'],
      // Short enough for the dropdown: nights are 10 p.m. to 8 a.m.;
      // work_hours_only is quiet except weekdays 9 a.m. to 6 p.m.
      choiceLabels: {
        off: 'Off',
        nights: '10 p.m. to 8 a.m.',
        nights_weekends: 'Nights and weekends',
        work_hours_only: 'Outside weekday 9 to 6',
      },
      default: 'nights',
    },
    // Push timing (2026-10-16). Was 'digest_cadence', default 'daily',
    // which let one push a day through and silently dropped the rest.
    // Now every update is pushed or summarized, never dropped; the
    // server sends the summaries (services/push_summaries.py). Covers
    // officials' posts, polls and events, bill updates and poll results;
    // replies and page changes come as they happen (2026-10-17).
    {
      key: 'push_cadence',
      label: 'Push alerts',
      description: 'A daily summary comes at 6 p.m., a weekly one Saturday at 10 a.m., your time. They cover officials, events, bills and poll results.',
      choices: ['realtime', 'daily', 'weekly'],
      choiceLabels: { realtime: 'As they happen', daily: 'Daily summary', weekly: 'Weekly summary' },
      default: 'realtime',
    },
  ],
  // Notification details (2026-10-17, the Android app only): hidden by
  // default, so a notification, and so a locked phone, shows only a
  // general line ("New update from an official you track") instead of
  // whom you follow. The server sends that line as the notification
  // itself (push_service.shown): Android's own lock-screen hiding works
  // only on phones set to hide sensitive content. Key name kept.
  lockScreen: {
    key: 'lock_screen_details',
    label: 'Notification details',
    description: 'Hidden: each notification shows only a general line, such as "New update from an official you track". Tap it to see the update.',
    choiceLabels: { hide: 'Hide details', show: 'Show details' },
    default: false,
  },
};

export function defaultChannelPrefs() {
  const out = {};
  for (const opt of CHANNEL_SCHEMA.options) out[opt.key] = opt.default;
  for (const s of CHANNEL_SCHEMA.sliders) out[s.key] = s.default;
  out[CHANNEL_SCHEMA.lockScreen.key] = CHANNEL_SCHEMA.lockScreen.default;
  return out;
}

/**
 * The old 'digest_cadence' key, as saved in this browser or on the
 * account before 2026-10-16: 'weekly' carries over, anything else
 * ('daily' was the silent default nobody chose) becomes 'realtime'.
 * The server's one-time migration does the same.
 */
export function migrateLegacyChannelPrefs(stored) {
  if (!stored || typeof stored !== 'object' || !('digest_cadence' in stored)) return stored;
  const { digest_cadence: legacy, ...rest } = stored;
  if (!('push_cadence' in rest)) rest.push_cadence = legacy === 'weekly' ? 'weekly' : 'realtime';
  return rest;
}

export function mergeChannelPrefs(stored) {
  const base = defaultChannelPrefs();
  if (!stored || typeof stored !== 'object') return base;
  return { ...base, ...migrateLegacyChannelPrefs(stored) };
}
