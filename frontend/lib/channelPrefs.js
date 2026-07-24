// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Channel Preferences Store
 *
 * Persistence for the user's global delivery preferences — in-app
 * toasts, mobile push, quiet-hours, digest cadence. Backed by
 * localStorage, with the same tiny pub/sub pattern the other tracked-*
 * stores use.
 *
 * Notifications v2 part 2 (2026-07-24): when a citizen is signed in,
 * the account becomes the source of truth. NotificationBellMenu calls
 * enableChannelPrefsServerSync() on sign-in, which pulls the account's
 * synced prefs (server wins over local — they're the user's cross-
 * device intent) or, for a first-time sync, seeds the account from the
 * local values. Every subsequent setChannelPrefs() change is debounced
 * up to PUT /api/citizen-auth/me/notification-prefs. Anonymous
 * visitors stay localStorage-only, exactly as before.
 *
 * The synced payload always carries tz_offset_minutes (minutes EAST of
 * UTC, e.g. EDT = -240) so the backend's quiet-hours enforcement knows
 * the user's local clock (Notifications v2 part 4).
 *
 * Schema lives in notificationPrefs.js (CHANNEL_SCHEMA).
 */
import { useEffect, useState } from 'react';
import { defaultChannelPrefs, mergeChannelPrefs, CHANNEL_SCHEMA } from './notificationPrefs';
import { fetchNotificationPrefs, saveNotificationPrefs } from './pagesApi';

const STORAGE_KEY = 'civicview.channelPrefs';
const SYNC_DEBOUNCE_MS = 700;

const listeners = new Set();
function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { /* swallow */ }
  }
}

function safeRead() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    console.warn('channelPrefs: failed to read localStorage', e);
    return null;
  }
}

function safeWrite(prefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('channelPrefs: failed to write localStorage', e);
  }
}

/**
 * Return the full merged channel prefs object. Safe to call anywhere —
 * falls back to declared defaults if nothing is stored yet.
 */
export function getChannelPrefs() {
  return mergeChannelPrefs(safeRead());
}

/**
 * Patch one or more channel-pref keys. Returns the merged prefs after
 * the patch. Silently no-ops on the server. When server sync is
 * enabled (signed-in citizen), the full prefs object is debounced up
 * to the account.
 */
export function setChannelPrefs(patch) {
  const current = getChannelPrefs();
  const next = { ...current, ...(patch || {}) };
  safeWrite(next);
  notify();
  schedulePushToServer();
  return next;
}

// ── Server sync (Notifications v2 part 2) ────────────────────────────

let serverSyncOn = false;
let pushTimer = null;

/** Prefs + the device's current UTC offset, for quiet-hours math
 * server-side. getTimezoneOffset() is minutes BEHIND UTC (EDT → 240),
 * so negate to store minutes east of UTC (EDT → -240). */
function withTz(prefs) {
  let tz = 0;
  try { tz = -new Date().getTimezoneOffset(); } catch { /* keep 0 */ }
  return { ...prefs, tz_offset_minutes: tz };
}

function schedulePushToServer() {
  if (!serverSyncOn || typeof window === 'undefined') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    // Fire-and-forget — a failed sync leaves localStorage correct and
    // the next change (or next sign-in) retries.
    saveNotificationPrefs(withTz(getChannelPrefs())).catch(() => {});
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Turn on account sync for the signed-in citizen. Pulls the account's
 * stored prefs: if the account has synced before, server wins (that's
 * the user's cross-device intent) and local is overwritten; if this is
 * the account's first sync (prefs=null), the local values seed it.
 * Safe to call repeatedly (e.g. on every identity hydrate).
 */
export async function enableChannelPrefsServerSync() {
  serverSyncOn = true;
  try {
    const { data, error } = await fetchNotificationPrefs();
    if (error) return; // Auth/network hiccup — stay local; next call retries.
    if (data && data.prefs && typeof data.prefs === 'object') {
      // tz_offset_minutes is send-path metadata, not a UI pref — keep
      // it out of the localStorage mirror the panel renders from.
      const { tz_offset_minutes: _tz, ...rest } = data.prefs;
      safeWrite(mergeChannelPrefs(rest));
      notify();
      // Re-report with THIS device's tz so quiet hours track wherever
      // the user actually is now.
      saveNotificationPrefs(withTz(getChannelPrefs())).catch(() => {});
    } else {
      // First sync for this account — seed it from local.
      saveNotificationPrefs(withTz(getChannelPrefs())).catch(() => {});
    }
  } catch { /* stay local */ }
}

/** Turn off account sync (sign-out). Local values stay as-is — they
 * keep serving the anonymous session, matching pre-v2 behavior. */
export function disableChannelPrefsServerSync() {
  serverSyncOn = false;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
}

/**
 * Reset to schema defaults.
 */
export function resetChannelPrefs() {
  safeWrite(defaultChannelPrefs());
  notify();
}

/**
 * React hook returning live channel prefs. Re-renders when another
 * component mutates them or a different browser tab does.
 */
export function useChannelPrefs() {
  const [tick, setTick] = useState(0);
  // Mirror the trackedBills/trackedOfficials/trackedElections pattern: stay
  // on schema defaults for the first render so SSR output matches the first
  // client render, then upgrade to the stored values after hydration.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);

    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) fn();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', onStorage);
    }
    return () => {
      listeners.delete(fn);
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', onStorage);
      }
    };
  }, []);

  return {
    prefs: mounted ? getChannelPrefs() : defaultChannelPrefs(),
    schema: CHANNEL_SCHEMA,
    tick,
  };
}
