'use client';

// CivicView: device push registration (the app's FCM, and web push).
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// The web app runs in two contexts: the browser (web push since
// 2026-10-18, lib/webPush.js) and the Capacitor Android/iOS shell, where
// the native runtime injects window.Capacitor into the remote-URL
// webview. We read the global rather than importing @capacitor/core
// so the web bundle carries zero extra weight.
//
// Flow (v1, Android):
//   1. PushOptInPrompt (components/) shows a contextual in-app card —
//      never a cold system prompt (Android 13+ permission denials are
//      near-permanent, so we only ask after the user taps "Enable").
//   2. enablePush(): system permission -> PushNotifications.register()
//      -> 'registration' event yields the FCM token -> POST
//      /api/push/register (cookie credentials + X-CSRF-Token, same as
//      every other write). Signed-in citizen => token binds to the
//      account; anonymous => backend subscribes it to 'announcements'.
//
// Browsers (2026-10-18): in a browser, the Home Screen app on an iPhone
// or the Windows app, the exported functions below hand over to
// lib/webPush.js (web push), so callers use one API. The app's own
// paths are unchanged.

import { request } from './http';
import { notificationLink, openDeepLink } from './deepLinks';
import {
  getPushChoice, isNativeApp, reofferAllowed, setPushChoice,
} from './pushCore';
import * as web from './webPush';

export {
  declinePushOffer, getPushChoice, isNativeApp, REOFFER_DAYS, setPushChoice,
} from './pushCore';

const TOKEN_KEY = 'cv:push:token';   // last FCM token we registered

function plugin() {
  try { return window.Capacitor?.Plugins?.PushNotifications || null; } catch { return null; }
}

// The app's own plugin (1.2.0 and later, android/.../NotificationSettingsPlugin.java):
// whether Android lets CivicView notify, which channels are muted, and
// the app's notification settings page. Absent on 1.1.0.
function settingsPlugin() {
  try { return window.Capacitor?.Plugins?.NotificationSettings || null; } catch { return null; }
}

function appPlugin() {
  try { return window.Capacitor?.Plugins?.App || null; } catch { return null; }
}

/**
 * True when the contextual opt-in card should be offered.
 * context: 'signin' (a citizen is signed in; the first offer only) or
 * 'track' (they just tracked something). The first offer comes in
 * either context. After one "Not now", only a track at least
 * REOFFER_DAYS later brings it back, once; never at launch. After a
 * second "Not now", or once push is on or Android said no, never.
 *
 * In a browser (2026-10-18, Jeffrey): only after a track, plus 'launch'
 * once when CivicView is opened from an iPhone or iPad Home Screen.
 * Never where web push can't work, and not once the browser blocked
 * notifications. An iPhone in a Safari tab gets the card too: Enable
 * shows the Add to Home Screen guide.
 *
 * 'launch' is for the browser only: in the Android app it is always
 * false, so the app offers the card exactly as it did before web push
 * (at sign-in or a track, never at launch).
 */
export function shouldOfferPush(context = 'signin', now = Date.now()) {
  if (!isNativeApp()) {
    const status = web.webPushStatus();
    if (status !== 'ready' && status !== 'ios_home_screen') return false;
    if (status === 'ready' && web.webPermission() === 'denied') return false;
    if (context === 'launch') {
      return status === 'ready' && web.isIos() && web.isStandalone() && !getPushChoice();
    }
    if (context !== 'track') return false;
    return reofferAllowed(context, now);
  }
  if (context === 'launch' || !plugin()) return false;
  return reofferAllowed(context, now);
}

// Identity headers and CSRF (2026-07-26 push deep dive, audit F4): the
// Capacitor webview does not reliably send the httpOnly session cookies
// cross-origin to api.civicview.app, so a cookie-only register bound
// every device anonymously. Requests now go through request() in
// lib/http.js, which sends every identity header and the stored CSRF
// token and refreshes the token once on a mismatch. This file used to
// keep its own copy of that logic, which read the wrong /api/csrf field
// for months.

/**
 * Optional v2 register fields (Notifications v2 parts 3+4):
 *   tracked: this device's tracked-official keys, so ANONYMOUS
 *     installs get tracked-activity pushes too. The tracked store is
 *     in-memory (server-backed for signed-in identities). Since
 *     2026-10-16 the server ADDS these keys to the device's stored
 *     list instead of replacing it (a new session's empty memory used
 *     to wipe it); only tracked_remove, sent on untrack, takes one out.
 *   prefs — channel-prefs snapshot + tz offset for per-device
 *     quiet-hours/cadence enforcement while anonymous.
 * Dynamic imports keep this module cycle-free (trackedOfficials.js
 * imports nothing from here) and cost nothing in the native shell.
 */
let appBuild = null;
async function readAppBuild() {
  if (appBuild !== null) return appBuild;
  try {
    const info = await appPlugin()?.getInfo?.();
    const n = Number(info && info.build);
    appBuild = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch { appBuild = 0; }
  return appBuild;
}

async function v2RegisterFields() {
  const extra = {};
  // The app's versionCode (2026-10-17): 5 and later build their own
  // notifications, so the server sends them data-only messages.
  const build = await readAppBuild();
  if (build) extra.app_build = build;
  // Whether Android lets CivicView notify right now.
  const status = await getOsNotificationStatus();
  if (status) extra.os_enabled = !!status.enabled;
  try {
    const { getAllTrackedOfficials } = await import('./trackedOfficials');
    // BUG FIX (2026-07-26): getAllTrackedOfficials() returns the cache
    // OBJECT keyed by official key — not an array. The old `(... || [])
    // .map(...)` threw TypeError on every call, the catch swallowed it,
    // and `tracked` was never sent — so anonymous devices' tracked_json
    // stayed NULL and the anonymous push path was dead too.
    const keys = Object.values(getAllTrackedOfficials() || {})
      .map((o) => o && o.key)
      .filter(Boolean);
    if (keys.length) extra.tracked = keys;
  } catch { /* store unavailable — omit */ }
  try {
    const { getChannelPrefs } = await import('./channelPrefs');
    let tz = 0;
    try { tz = -new Date().getTimezoneOffset(); } catch { /* keep 0 */ }
    extra.prefs = { ...getChannelPrefs(), tz_offset_minutes: tz };
  } catch { /* omit */ }
  return extra;
}

async function postJson(path, body) {
  const { data, error, status } = await request(path, { method: 'POST', body });
  if (error) throw new Error(`push api ${path} -> ${status || error}`);
  return data;
}

/**
 * Request permission + register this device for push. Resolves
 * { ok, reason? }. Safe to call repeatedly — re-registration just
 * refreshes the token binding server-side (e.g. after sign-in, call
 * again so an anonymous token re-binds to the citizen).
 */
// The native 'registration' and 'registrationError' listeners are
// installed once per app run (2026-10-16). enablePush() used to add a
// new pair on every call (launch refresh, sign-in, the toggle), so each
// token event ran every pair ever added. Callers now wait in a list
// that the one pair settles.
let registrationListenersInstalled = false;
const registrationWaiters = [];

function settleRegistration(result) {
  while (registrationWaiters.length) {
    const w = registrationWaiters.shift();
    try { w(result); } catch { /* one waiter cannot block the rest */ }
  }
}

function installRegistrationListeners(PN) {
  if (registrationListenersInstalled) return;
  registrationListenersInstalled = true;
  PN.addListener('registration', async ({ value }) => {
    // A token event with nobody waiting is a rotation: re-register it
    // only while push is on.
    if (!registrationWaiters.length && getPushChoice() !== 'enabled') return;
    try {
      const extra = await v2RegisterFields();
      await postJson('/api/push/register', { token: value, platform: 'android', ...extra });
      setPushChoice('enabled');
      try { window.localStorage.setItem(TOKEN_KEY, value); } catch { /* private mode */ }
      settleRegistration({ ok: true });
    } catch { settleRegistration({ ok: false, reason: 'network' }); }
  });
  PN.addListener('registrationError', () => {
    settleRegistration({ ok: false, reason: 'registration' });
  });
}

export async function enablePush() {
  if (!isNativeApp()) return web.enableWebPush();
  const PN = plugin();
  if (!PN) return { ok: false, reason: 'unsupported' };
  createChannels();
  try {
    let perm = await PN.checkPermissions();
    if (perm.receive !== 'granted') perm = await PN.requestPermissions();
    if (perm.receive !== 'granted') {
      setPushChoice('denied');
      return { ok: false, reason: 'denied' };
    }
  } catch { return { ok: false, reason: 'permissions' }; }

  try { installRegistrationListeners(PN); } catch { return { ok: false, reason: 'register' }; }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    // Registration is event-driven; guard with a timeout so a silent
    // native failure can't hang the caller's UI.
    const timer = setTimeout(() => {
      const i = registrationWaiters.indexOf(finish);
      if (i >= 0) registrationWaiters.splice(i, 1);
      finish({ ok: false, reason: 'timeout' });
    }, 15000);
    registrationWaiters.push(finish);
    try { PN.register(); } catch {
      const i = registrationWaiters.indexOf(finish);
      if (i >= 0) registrationWaiters.splice(i, 1);
      finish({ ok: false, reason: 'register' });
    }
  });
}

/** True when the user has enabled push on this device. */
export function isPushEnabled() {
  return getPushChoice() === 'enabled';
}

/**
 * Turn push off for this device: forget the token server-side and
 * record the choice. The OS permission stays granted (that's the
 * user's to manage in system settings) — we simply stop sending.
 */
export async function disablePush() {
  if (!isNativeApp()) return web.disableWebPush();
  let token = null;
  try { token = window.localStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }
  if (token) {
    try { await postJson('/api/push/unregister', { token, platform: 'android' }); } catch { /* best effort */ }
    try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
  }
  setPushChoice('declined');
  return { ok: true };
}

/**
 * Sign-in and sign-out (2026-10-16). The device belongs to whoever is
 * signed in on it. Before this, nothing re-registered on sign-out, so a
 * shared phone kept getting the last account's alerts, and a sign-in
 * only bound the phone at the next app launch.
 *
 * bindPushToAccount: re-register the saved token now, so the server
 * binds it to the citizen who just signed in. No permission prompt, no
 * native round trip. Runs once per citizen per app session.
 *
 * unbindPushDevice: the device stays registered (push keeps working for
 * whoever uses the app next) but belongs to nobody, with an empty
 * tracked list. The server also unbinds a bound token the next time the
 * app registers without a citizen session (offline sign-out, an expired
 * session).
 */
let lastBoundCitizenId = null;

function savedToken() {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export async function bindPushToAccount(citizenId) {
  if (!isNativeApp()) return web.bindWebPush(citizenId);
  if (getPushChoice() !== 'enabled') return false;
  if (citizenId && citizenId === lastBoundCitizenId) return false;
  const token = savedToken();
  if (!token) return false;
  try {
    const extra = await v2RegisterFields();
    delete extra.tracked; // a bound device's tracking lives on the account
    await postJson('/api/push/register', { token, platform: 'android', ...extra });
    lastBoundCitizenId = citizenId || null;
    return true;
  } catch { return false; }
}

export async function unbindPushDevice() {
  lastBoundCitizenId = null;
  if (!isNativeApp()) return web.unbindWebPush();
  const token = savedToken();
  if (!token) return false;
  try {
    await postJson('/api/push/unbind', { token });
    return true;
  } catch { return false; }
}

// ── Android notification settings (2026-10-17) ───────────────────────

/**
 * The app's notification channels, the same ids, names and importance
 * as android/.../NotificationChannels.java, which creates them at app
 * start. Creating them again from here only updates the names and
 * descriptions (so wording changes with a web deploy); Android keeps
 * each person's own choices. No lock-screen visibility: Android ignores
 * an app's own choice there; the server keeps notifications neutral
 * unless the person chose Show details (push_service.shown).
 * Importance: 4 high (pops up), 3 default, 2 low (silent).
 */
export const CHANNELS = [
  { id: 'officials', name: 'Officials you track', description: 'New posts and polls from officials and candidates you track', importance: 3 },
  { id: 'events', name: 'Events', description: 'Events scheduled by officials and candidates you track', importance: 3 },
  { id: 'replies', name: 'Replies', description: 'Replies to your comments', importance: 4 },
  { id: 'bills', name: 'Bill updates', description: 'New actions, votes and status changes on federal bills you track', importance: 3 },
  { id: 'poll_results', name: 'Poll results', description: 'Results of polls you voted in, when they close', importance: 3 },
  { id: 'elections', name: 'Election reminders', description: 'Voting deadlines and Election Day, from official state sources', importance: 4 },
  { id: 'page_changes', name: 'Changes to pages you track', description: 'When an official you track leaves office, a campaign ends or a candidate takes office', importance: 2 },
  { id: 'summaries', name: 'Summaries', description: 'Your daily or weekly summary, and updates held during quiet hours', importance: 3 },
];

let channelsCreated = false;
export function createChannels() {
  if (channelsCreated || !isNativeApp()) return;
  const PN = plugin();
  if (!PN || typeof PN.createChannel !== 'function') return;
  channelsCreated = true;
  for (const c of CHANNELS) {
    try {
      Promise.resolve(PN.createChannel({ ...c, vibration: true })).catch(() => {});
    } catch { /* older plugin: the app creates them itself */ }
  }
}

/**
 * { enabled, blockedChannels } from Android, or null on the web.
 * 1.2.0 and later ask Android directly; 1.1.0 falls back to the push
 * plugin's permission check (which says granted on Android 12 and older
 * even when notifications are off).
 */
export async function getOsNotificationStatus() {
  if (!isNativeApp()) return null;
  const NS = settingsPlugin();
  if (NS && typeof NS.getStatus === 'function') {
    try {
      const r = await NS.getStatus();
      return { enabled: !!r.enabled, blockedChannels: Array.isArray(r.blockedChannels) ? r.blockedChannels : [] };
    } catch { /* fall through */ }
  }
  const PN = plugin();
  if (!PN) return null;
  try {
    const perm = await PN.checkPermissions();
    return { enabled: perm.receive === 'granted', blockedChannels: [] };
  } catch { return null; }
}

/** True when this app build can open Android's notification settings. */
export function canOpenNotificationSettings() {
  const NS = settingsPlugin();
  return !!(NS && typeof NS.openSettings === 'function');
}

/** Open CivicView's page in Android's notification settings. */
export async function openNotificationSettings() {
  const NS = settingsPlugin();
  if (!NS || typeof NS.openSettings !== 'function') return false;
  try { await NS.openSettings(); return true; } catch { return false; }
}

// The latest status, shared with the settings panel (usePushStatus in
// components/NotificationSettings.js subscribes).
let lastStatus = null;
const statusListeners = new Set();

export function getLastOsStatus() {
  return lastStatus;
}

export function subscribeOsStatus(fn) {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

/**
 * Check Android's answer now: at launch and every time the app comes
 * back to the front (someone may have just been in Android settings).
 * When it changed and push is on, the server hears it (os_enabled), so
 * a phone with notifications off is not counted as push-enabled.
 */
export async function refreshOsStatus() {
  const status = await getOsNotificationStatus();
  if (!status) return null;
  const before = lastStatus;
  lastStatus = status;
  if (!before || before.enabled !== status.enabled
      || before.blockedChannels.join(',') !== status.blockedChannels.join(',')) {
    for (const fn of statusListeners) {
      try { fn(status); } catch { /* one listener cannot block the rest */ }
    }
  }
  if (before && before.enabled !== status.enabled && getPushChoice() === 'enabled') {
    const token = savedToken();
    if (token) {
      try {
        await postJson('/api/push/register', { token, platform: 'android', os_enabled: status.enabled });
      } catch { /* the next launch reports it */ }
    }
  }
  return status;
}

let resumeWatchInstalled = false;
export function initPushStatusWatch() {
  if (resumeWatchInstalled) return;
  if (!isNativeApp()) {
    // A browser: when the person comes back to the tab, see whether
    // they changed CivicView's notification permission in the site
    // settings meanwhile, and if so, register again or let go.
    resumeWatchInstalled = true;
    let permission = web.webPermission();
    try {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const now = web.webPermission();
        if (now === permission) return;
        permission = now;
        web.refreshWebPush().finally(() => {
          try { window.dispatchEvent(new CustomEvent('cv:push-state')); } catch { /* SSR */ }
        });
      });
    } catch { /* SSR */ }
    return;
  }
  resumeWatchInstalled = true;
  createChannels();
  refreshOsStatus();
  const App = appPlugin();
  try {
    App?.addListener?.('resume', () => { refreshOsStatus(); });
  } catch { /* no App plugin: launch-time check only */ }
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshOsStatus();
    });
  } catch { /* SSR */ }
}

/**
 * Clear every delivered CivicView notification out of the system tray
 * — and with it the launcher app-icon badge count, which Android
 * derives from tray presence. Called by the bell's "Clear" action so
 * in-app clear and device state stay in step. No-op on the web.
 */
export async function clearDeliveredNotifications() {
  if (!isNativeApp()) {
    // A browser: close CivicView's notifications and clear the app badge.
    await web.closeWebNotifications();
    web.setAppBadgeCount(0);
    return;
  }
  const PN = plugin();
  if (!PN || !isNativeApp()) return;
  try { await PN.removeAllDeliveredNotifications(); } catch { /* best effort */ }
}

/**
 * Fire-and-forget refresh — called on app load when the user already
 * enabled push, so a rotated FCM token or a new sign-in re-binds
 * server-side without any UI.
 */
export function refreshPushRegistration() {
  if (!isNativeApp()) {
    // A browser: register again without a prompt (lib/webPush.js).
    web.refreshWebPush().catch(() => { /* the next load retries */ });
    return;
  }
  if (getPushChoice() !== 'enabled') return;
  (async () => {
    // Never a permission prompt at launch (2026-10-17): when Android
    // has notifications off for CivicView, only tell the server
    // (os_enabled: false) and let the settings panel offer Open
    // settings.
    const status = await getOsNotificationStatus();
    if (status && !status.enabled) {
      const token = savedToken();
      if (token) {
        try {
          await postJson('/api/push/register', { token, platform: 'android', ...(await v2RegisterFields()) });
        } catch { /* the next launch reports it */ }
      }
      return;
    }
    await enablePush();
  })().catch(() => { /* silent: next launch retries */ });
}

/**
 * Push deep links (2026-07-25). Registers the notification-TAP
 * listener so tapping a tracked-post push opens the exact post: the
 * push payload carries {kind, official_id, post_id} (set server-side
 * in push_tracked_post), and PageView's '#post-<id>' hash handler
 * scrolls + pulses the post once the feed mounts.
 *
 * Full navigation (location.assign) rather than history nudging: a
 * tap either cold-starts the app or foregrounds it from anywhere, so
 * a clean load of the target page is the predictable path. Capacitor
 * buffers the launching notification's tap event until a listener
 * attaches, so registering on root-layout mount also catches taps
 * that START the app. Module-level once-flag — the registration is
 * process-wide, not per-component.
 */
async function markTappedRead(notificationId) {
  const id = Number(notificationId);
  if (!Number.isInteger(id) || id <= 0) return;
  try {
    const { markNotificationRead } = await import('./pagesApi');
    await Promise.race([
      markNotificationRead(id),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch { /* the bell row stays unread; nothing else depends on it */ }
}

/**
 * A browser (2026-10-18): public/sw.js shows the notification. Its tap
 * focuses an open CivicView window and posts { type: 'cv:push-tap', url,
 * notification_id } here, so the tap does what the app's does: mark the
 * bell row read, then open the link. With no window open, sw.js opens
 * the link with the bell row id as ?cv_read=, read and removed here. A
 * push arriving while CivicView is open posts 'cv:push-received', which
 * refreshes the bell.
 */
// The bell row id a tap opened this window with (?cv_read=), read when
// this module loads: app/page.js rewrites the address on its first
// render, before any effect could read it.
const launchReadId = (() => {
  try { return new URL(window.location.href).searchParams.get('cv_read'); } catch { return null; }
})();

function initWebPushTapNavigation() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  tapNavInstalled = true;
  try {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = (event && event.data) || {};
      if (msg.type === 'cv:push-received') {
        try { window.dispatchEvent(new CustomEvent('cv:notifications-refresh')); } catch { /* SSR */ }
      } else if (msg.type === 'cv:push-tap') {
        const url = typeof msg.url === 'string' && msg.url.startsWith('/') ? msg.url : null;
        markTappedRead(msg.notification_id).finally(() => { if (url) openDeepLink(url); });
      }
    });
  } catch { /* no service worker messages */ }
  if (!launchReadId) return;
  markTappedRead(launchReadId);
  try {
    const here = new URL(window.location.href);
    if (here.searchParams.has('cv_read')) {
      here.searchParams.delete('cv_read');
      window.history.replaceState(window.history.state, '', here.pathname + here.search + here.hash);
    }
  } catch { /* ignore */ }
}

let tapNavInstalled = false;
export function initPushTapNavigation() {
  if (tapNavInstalled) return;
  if (!isNativeApp()) {
    initWebPushTapNavigation();
    return;
  }
  const PN = plugin();
  if (!PN) return;
  tapNavInstalled = true;
  // A push that arrives while the app is open (2026-10-16): refresh the
  // bell at once instead of at its next 60 s poll.
  try {
    PN.addListener('pushNotificationReceived', () => {
      try { window.dispatchEvent(new CustomEvent('cv:notifications-refresh')); } catch { /* SSR */ }
    });
  } catch { /* plugin variant without the event */ }
  try {
    PN.addListener('pushNotificationActionPerformed', (action) => {
      try {
        const d = (action && action.notification && action.notification.data) || {};
        // Where each kind opens is lib/deepLinks.js notificationLink,
        // the same table the bell and the activity archive use:
        //   tracked_post: the post (#post-<id> scroll and pulse);
        //   tracked_event: the page, whose Events tab has it;
        //   reply (2026-10-17): the post, or the citizen poll (#poll-<id>);
        //   poll_results: the poll; bill_update: My Tracked;
        //   page_change: the page; page_changes and tracked_summary:
        //     the bell (a signed-out phone's summary opens the newest
        //     update's page, since it has no bell);
        //   election_reminder: the state.
        // The push carries the person's bell row id, so the tap marks
        // that row read first (briefly: navigation must not wait).
        const url = notificationLink(d.kind, d);
        if (!url) return;
        markTappedRead(d.notification_id).finally(() => openDeepLink(url));
      } catch { /* malformed payload — open normally */ }
    });
  } catch { /* plugin variant without the event — fail open */ }
}

/**
 * Lightweight server-side re-sync of this device's tracked list +
 * prefs snapshot: POSTs the cached token straight to /api/push/register
 * with the v2 fields, no permission flow / native round-trip. Called
 * (debounced) by trackedOfficials.js after track/untrack so an
 * anonymous device's server-side tracked list follows its choices.
 * Untracked keys travel as tracked_remove (2026-10-16): the server
 * merges `tracked` and removes only what was untracked.
 * No-op on web, when push is off, or when no token is cached.
 */
let syncTimer = null;
const pendingRemovals = new Set();
export function syncPushRegistration({ removed } = {}) {
  if (!isNativeApp()) {
    web.syncWebPush({ removed });
    return;
  }
  if (getPushChoice() !== 'enabled') return;
  if (removed) pendingRemovals.add(String(removed).toLowerCase());
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    const token = savedToken();
    if (!token) return;
    const removals = [...pendingRemovals];
    pendingRemovals.clear();
    try {
      const extra = await v2RegisterFields();
      const body = { token, platform: 'android', ...extra };
      const stillTracked = new Set(extra.tracked || []);
      const gone = removals.filter((k) => !stillTracked.has(k));
      if (gone.length) body.tracked_remove = gone;
      await postJson('/api/push/register', body);
    } catch {
      // best effort: keep the removals for the next sync
      removals.forEach((k) => pendingRemovals.add(k));
    }
  }, 800);
}
