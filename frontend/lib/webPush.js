'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Web push (2026-10-18): desktop browsers, browsers on Android phones,
// CivicView on an iPhone or iPad Home Screen (iOS 16.4 and later) and the
// Windows app. The Android app keeps FCM (lib/push.js); lib/push.js hands
// every web case to the functions here, so its callers don't change.
//
// The same rules as the phone:
//   - Permission is asked only from a tap (Turn on in notification
//     settings, or Enable on the opt-in card), never on page load.
//   - The subscription is registered with /api/push/web/register
//     (cookies, identity headers and CSRF through lib/http.js). A sign-in
//     binds this browser to the citizen, a sign-out unbinds it, Turn off
//     unregisters it and unsubscribes.
//   - Signed out, the browser carries the officials it tracks, so their
//     posts and polls still reach it.
// Off (status 'unconfigured') until NEXT_PUBLIC_VAPID_PUBLIC_KEY is set
// on Vercel, the same public key as VAPID_PUBLIC_KEY on Render.
//
// iPhone and iPad send web alerts only to Home Screen apps, so in a
// Safari tab the status is 'ios_home_screen' and the caller shows the
// Add to Home Screen guide (components/HomeScreenGuide.js).

import { request } from './http';
import { requestNotificationPermissionFromIntent } from './notificationPermission';
import { getPushChoice, isNativeApp, setPushChoice } from './pushCore';

// The Add to Home Screen guide (components/HomeScreenGuide.js). Wording
// approved by Jeffrey on 2026-10-18. No dashes.
export const HOME_SCREEN_GUIDE = {
  title: 'Add CivicView to your Home Screen to get alerts',
  intro: 'On iPhone and iPad, alerts come only to CivicView on your Home Screen.',
  steps: [
    'Tap Share in Safari (the square with the arrow).',
    'Tap Add to Home Screen, then Add.',
    'Open CivicView from your Home Screen and tap Turn on in notification settings.',
  ],
  tooOld: 'Alerts on iPhone and iPad need iOS 16.4 or later.',
};

const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
const ENDPOINT_KEY = 'cv:webpush:endpoint'; // the endpoint last registered here
const READY_TIMEOUT_MS = 10000;

function ua() {
  try { return navigator.userAgent || ''; } catch { return ''; }
}

/** iPhone, iPod or iPad (an iPad asking for the desktop site reads as a Mac with touch). */
export function isIos() {
  if (typeof navigator === 'undefined') return false;
  const agent = ua();
  if (/iPhone|iPad|iPod/.test(agent)) return true;
  try { return /Macintosh/.test(agent) && navigator.maxTouchPoints > 1; } catch { return false; }
}

/** [major, minor] of iOS, or null when it can't be read. */
export function iosVersion() {
  const agent = ua();
  const m = agent.match(/OS (\d+)[_.](\d+)/) || agent.match(/Version\/(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Opened as an installed app: the Home Screen app, the Windows app, a desktop install. */
export function isStandalone() {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    return window.navigator.standalone === true;
  } catch { return false; }
}

function platform() {
  if (isIos()) return 'ios';
  return /Android/.test(ua()) ? 'android' : 'desktop';
}

/**
 * What this browser can do:
 *   'native'           the Android app (FCM, lib/push.js)
 *   'unconfigured'     web push is not set up yet (no public key)
 *   'ios_old'          iPhone or iPad older than iOS 16.4
 *   'ios_home_screen'  iPhone or iPad in a browser tab: add to Home Screen first
 *   'unsupported'      no service worker or Push API
 *   'ready'            can subscribe
 */
export function webPushStatus() {
  if (typeof window === 'undefined') return 'unsupported';
  if (isNativeApp()) return 'native';
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (isIos()) {
    const v = iosVersion();
    if (v && (v[0] < 16 || (v[0] === 16 && v[1] < 4))) return 'ios_old';
    if (!isStandalone()) return 'ios_home_screen';
  }
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
      return isIos() ? 'ios_home_screen' : 'unsupported';
    }
  } catch { return 'unsupported'; }
  return 'ready';
}

/** 'granted' | 'denied' | 'default' | 'unsupported' (no prompt). */
export function webPermission() {
  try { return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission; } catch { return 'unsupported'; }
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(subscription) {
  try {
    const have = subscription.options && subscription.options.applicationServerKey;
    if (!have) return true; // the browser doesn't say: assume ours
    const a = new Uint8Array(have);
    const b = keyBytes(VAPID_PUBLIC_KEY);
    return a.length === b.length && a.every((x, i) => x === b[i]);
  } catch { return true; }
}

function savedEndpoint() {
  try { return window.localStorage.getItem(ENDPOINT_KEY); } catch { return null; }
}

/** This browser's registered endpoint (the admin test push sends to it). */
export function savedWebPushEndpoint() {
  return savedEndpoint();
}

function saveEndpoint(value) {
  try {
    if (value) window.localStorage.setItem(ENDPOINT_KEY, value);
    else window.localStorage.removeItem(ENDPOINT_KEY);
  } catch { /* private mode */ }
}

async function registration() {
  // ServiceWorkerRegistration registers /sw.js at load; registering the
  // same script again just returns it.
  await navigator.serviceWorker.register('/sw.js');
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('sw timeout')), READY_TIMEOUT_MS)),
  ]);
}

// One registration step at a time in this tab: a launch refresh still in
// flight when someone tapped Turn off could land its register after the
// unregister, so the server kept a subscription the browser had already
// dropped. Every step that talks to the server waits its turn here. The
// permission prompt itself is never queued (it must run inside the tap);
// once permission is granted, subscribing needs no tap.
let pushQueue = Promise.resolve();
function inTurn(fn) {
  const run = pushQueue.then(fn, fn);
  pushQueue = run.catch(() => {});
  return run;
}

/** The browser's subscription, made with our key (subscribing when there is none). */
async function subscription({ create }) {
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub)) {
    // Made with an earlier key pair: it can never receive our pushes.
    try { await sub.unsubscribe(); } catch { /* replaced below */ }
    sub = null;
  }
  if (!sub && create) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, // every push shows a notification (iOS requires it)
      applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
    });
  }
  return sub;
}

/** The officials tracked here and the timing settings, as a phone sends them. */
async function registerFields({ tracked = true } = {}) {
  const extra = {};
  if (tracked) {
    try {
      const { getAllTrackedOfficials } = await import('./trackedOfficials');
      const keys = Object.values(getAllTrackedOfficials() || {}).map((o) => o && o.key).filter(Boolean);
      if (keys.length) extra.tracked = keys;
    } catch { /* store unavailable: omit */ }
  }
  try {
    const { getChannelPrefs } = await import('./channelPrefs');
    let tz = 0;
    try { tz = -new Date().getTimezoneOffset(); } catch { /* keep 0 */ }
    extra.prefs = { ...getChannelPrefs(), tz_offset_minutes: tz };
  } catch { /* omit */ }
  return extra;
}

async function post(path, body) {
  return request(path, { method: 'POST', body });
}

async function registerWithServer(sub, extra) {
  const json = sub.toJSON();
  const { error, status } = await post('/api/push/web/register', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys && json.keys.p256dh, auth: json.keys && json.keys.auth },
    application_server_key: VAPID_PUBLIC_KEY,
    platform: platform(),
    ...extra,
  });
  if (error) {
    if (status === 503) return { ok: false, reason: 'server_off' };
    if (status === 409) return { ok: false, reason: 'key_mismatch' };
    return { ok: false, reason: 'network' };
  }
  const before = savedEndpoint();
  if (before && before !== json.endpoint) {
    // The browser handed out a new endpoint: the old one is gone.
    post('/api/push/web/unregister', { endpoint: before }).catch(() => {});
  }
  saveEndpoint(json.endpoint);
  return { ok: true };
}

/**
 * Turn push on in this browser, from a tap. Resolves { ok, reason? }:
 * reason is the status (ios_home_screen, ios_old, unsupported,
 * unconfigured), 'denied' or 'dismissed' (the prompt), or server_off,
 * key_mismatch, network.
 */
export async function enableWebPush() {
  const status = webPushStatus();
  if (status !== 'ready') return { ok: false, reason: status };
  const perm = await requestNotificationPermissionFromIntent({ reason: 'web-push' });
  if (perm !== 'granted') {
    if (perm === 'denied') setPushChoice('denied');
    return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' };
  }
  return inTurn(async () => {
    try {
      const sub = await subscription({ create: true });
      const res = await registerWithServer(sub, await registerFields());
      if (res.ok) setPushChoice('enabled');
      return res;
    } catch {
      return { ok: false, reason: 'subscribe' };
    }
  });
}

/** Turn push off here: forget it on the server, then unsubscribe. */
export function disableWebPush() {
  return inTurn(async () => {
    const endpoints = new Set();
    if (savedEndpoint()) endpoints.add(savedEndpoint());
    try {
      const sub = webPushStatus() === 'ready' ? await subscription({ create: false }) : null;
      if (sub) {
        endpoints.add(sub.endpoint);
        await sub.unsubscribe();
      }
    } catch { /* best effort */ }
    for (const endpoint of endpoints) await post('/api/push/web/unregister', { endpoint });
    saveEndpoint(null);
    setPushChoice('declined');
    return { ok: true };
  });
}

/**
 * At load, never a prompt. Push on and permission still granted:
 * register again (a new endpoint, the sign-in, the time zone). The
 * permission taken away in the browser's settings: the server forgets
 * this browser, and the panel shows the state.
 */
export function refreshWebPush() {
  return inTurn(async () => {
    if (getPushChoice() !== 'enabled' || webPushStatus() !== 'ready') return;
    if (webPermission() !== 'granted') {
      const endpoint = savedEndpoint();
      if (endpoint) await post('/api/push/web/unregister', { endpoint });
      saveEndpoint(null);
      setPushChoice(webPermission() === 'denied' ? 'denied' : null);
      return;
    }
    try {
      const sub = await subscription({ create: true }); // granted: no prompt
      await registerWithServer(sub, await registerFields());
    } catch { /* the next load retries */ }
  });
}

let lastBoundCitizenId = null;

/** Sign-in: register again so the server binds this browser to the citizen. */
export function bindWebPush(citizenId) {
  return inTurn(async () => {
    if (getPushChoice() !== 'enabled' || webPushStatus() !== 'ready' || webPermission() !== 'granted') return false;
    if (citizenId && citizenId === lastBoundCitizenId) return false;
    try {
      const sub = await subscription({ create: false });
      if (!sub) return false;
      // A bound browser's tracking lives on the account.
      const res = await registerWithServer(sub, await registerFields({ tracked: false }));
      if (res.ok) lastBoundCitizenId = citizenId || null;
      return res.ok;
    } catch { return false; }
  });
}

/** Sign-out: this browser keeps push but belongs to nobody. */
export function unbindWebPush() {
  return inTurn(async () => {
    lastBoundCitizenId = null;
    const endpoint = savedEndpoint();
    if (!endpoint) return false;
    const { error } = await post('/api/push/web/unbind', { endpoint });
    return !error;
  });
}

let syncTimer = null;
const pendingRemovals = new Set();

/** After a track or untrack: the signed-out browser's tracked list follows. */
export function syncWebPush({ removed } = {}) {
  if (getPushChoice() !== 'enabled' || !savedEndpoint() || webPushStatus() !== 'ready') return;
  if (removed) pendingRemovals.add(String(removed).toLowerCase());
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    inTurn(async () => {
      // Turned off while this waited: nothing to sync.
      if (getPushChoice() !== 'enabled' || !savedEndpoint()) return;
      const removals = [...pendingRemovals];
      pendingRemovals.clear();
      try {
        const sub = await subscription({ create: false });
        if (!sub) return;
        const extra = await registerFields();
        const stillTracked = new Set(extra.tracked || []);
        const gone = removals.filter((k) => !stillTracked.has(k));
        if (gone.length) extra.tracked_remove = gone;
        const res = await registerWithServer(sub, extra);
        if (!res.ok) removals.forEach((k) => pendingRemovals.add(k));
      } catch {
        removals.forEach((k) => pendingRemovals.add(k));
      }
    });
  }, 800);
}

/** The bell's Mark as read and Clear: close CivicView's notifications here too. */
export async function closeWebNotifications() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const shown = reg ? await reg.getNotifications() : [];
    shown.forEach((n) => n.close());
  } catch { /* best effort */ }
}

/**
 * The app badge (Badging API) on the installed app's icon: the bell's
 * unread count, cleared at 0. Only installed apps show it (the Windows
 * app, a desktop install, the Home Screen app); a browser tab skips it.
 */
export function setAppBadgeCount(n) {
  try {
    if (isNativeApp() || !isStandalone() || typeof navigator === 'undefined') return;
    if (n > 0 && typeof navigator.setAppBadge === 'function') {
      navigator.setAppBadge(n).catch(() => {});
    } else if (typeof navigator.clearAppBadge === 'function') {
      navigator.clearAppBadge().catch(() => {});
    }
  } catch { /* unsupported */ }
}
