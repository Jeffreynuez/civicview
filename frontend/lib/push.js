'use client';

// CivicView — device push registration (native app shell only).
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// The web app runs in two contexts: the browser (no native push —
// everything here no-ops) and the Capacitor Android/iOS shell, where
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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const CHOICE_KEY = 'cv:push:choice'; // 'enabled' | 'declined' | 'denied'
const TOKEN_KEY = 'cv:push:token';   // last FCM token we registered

export function isNativeApp() {
  try {
    return !!(typeof window !== 'undefined'
      && window.Capacitor
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
  } catch { return false; }
}

function plugin() {
  try { return window.Capacitor?.Plugins?.PushNotifications || null; } catch { return null; }
}

export function getPushChoice() {
  try { return window.localStorage.getItem(CHOICE_KEY); } catch { return null; }
}

export function setPushChoice(value) {
  try { window.localStorage.setItem(CHOICE_KEY, value); } catch { /* private mode */ }
}

/** True when the contextual opt-in card should be offered. */
export function shouldOfferPush() {
  return isNativeApp() && !!plugin() && !getPushChoice();
}

async function csrfToken() {
  // Best-effort — mirrors the pagesApi pattern. Anonymous devices may
  // have no session (nothing to CSRF-protect); missing token is fine.
  try {
    const res = await fetch(`${API_BASE_URL}/api/csrf`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.token || data?.csrf_token || null;
  } catch { return null; }
}

/**
 * Optional v2 register fields (Notifications v2 parts 3+4):
 *   tracked — this device's tracked-official keys, so ANONYMOUS
 *     installs get tracked-activity pushes too. The tracked store is
 *     in-memory (server-backed for signed-in identities), so we only
 *     send the list when it's non-empty — a launch-time re-register
 *     that runs before stores hydrate must not wipe the server-side
 *     copy. Omitted field = "leave stored value alone" server-side.
 *   prefs — channel-prefs snapshot + tz offset for per-device
 *     quiet-hours/cadence enforcement while anonymous.
 * Dynamic imports keep this module cycle-free (trackedOfficials.js
 * imports nothing from here) and cost nothing in the native shell.
 */
async function v2RegisterFields() {
  const extra = {};
  try {
    const { getAllTrackedOfficials } = await import('./trackedOfficials');
    const keys = (getAllTrackedOfficials() || [])
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
  const headers = { 'Content-Type': 'application/json' };
  const csrf = await csrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`push api ${path} -> ${res.status}`);
  return res.json();
}

/**
 * Request permission + register this device for push. Resolves
 * { ok, reason? }. Safe to call repeatedly — re-registration just
 * refreshes the token binding server-side (e.g. after sign-in, call
 * again so an anonymous token re-binds to the citizen).
 */
export async function enablePush() {
  const PN = plugin();
  if (!PN) return { ok: false, reason: 'unsupported' };
  try {
    let perm = await PN.checkPermissions();
    if (perm.receive !== 'granted') perm = await PN.requestPermissions();
    if (perm.receive !== 'granted') {
      setPushChoice('denied');
      return { ok: false, reason: 'denied' };
    }
  } catch { return { ok: false, reason: 'permissions' }; }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
    // Registration is event-driven; guard with a timeout so a silent
    // native failure can't hang the caller's UI.
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), 15000);
    PN.addListener('registration', async ({ value }) => {
      clearTimeout(timer);
      try {
        const extra = await v2RegisterFields();
        await postJson('/api/push/register', { token: value, platform: 'android', ...extra });
        setPushChoice('enabled');
        try { window.localStorage.setItem(TOKEN_KEY, value); } catch { /* private mode */ }
        finish({ ok: true });
      } catch { finish({ ok: false, reason: 'network' }); }
    });
    PN.addListener('registrationError', () => {
      clearTimeout(timer);
      finish({ ok: false, reason: 'registration' });
    });
    try { PN.register(); } catch { clearTimeout(timer); finish({ ok: false, reason: 'register' }); }
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
 * Fire-and-forget refresh — called on app load when the user already
 * enabled push, so a rotated FCM token or a new sign-in re-binds
 * server-side without any UI.
 */
export function refreshPushRegistration() {
  if (!isNativeApp() || getPushChoice() !== 'enabled') return;
  enablePush().catch(() => { /* silent — next launch retries */ });
}

/**
 * Lightweight server-side re-sync of this device's tracked list +
 * prefs snapshot — POSTs the cached token straight to /api/push/register
 * with the v2 fields, no permission flow / native round-trip. Called
 * (debounced) by trackedOfficials.js after track/untrack so an
 * anonymous device's server-side tracked list follows its choices.
 * No-op on web, when push is off, or when no token is cached.
 */
let syncTimer = null;
export function syncPushRegistration() {
  if (!isNativeApp() || getPushChoice() !== 'enabled') return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    let token = null;
    try { token = window.localStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }
    if (!token) return;
    try {
      const extra = await v2RegisterFields();
      // Untracking down to zero must clear server-side: send an
      // explicit [] here (we KNOW the store is hydrated — the user
      // just acted on it), unlike the launch-time omit-when-empty.
      if (!extra.tracked) extra.tracked = [];
      await postJson('/api/push/register', { token, platform: 'android', ...extra });
    } catch { /* best effort — next launch re-registers anyway */ }
  }, 800);
}
