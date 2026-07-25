// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Tracked Bills Store — server-backed, per-identity.
 *
 * Replaces the prior localStorage-singleton implementation (which
 * survived logout/login and leaked one citizen's tracked bills into
 * another's session). The cache now lives in module-level memory and
 * gets bootstrapped from /api/tracked on login + cleared on logout
 * via the helpers in trackedSync.js.
 *
 * Exported surface is unchanged so existing components keep working:
 *
 *   billKey(congress, type, number)        canonical key
 *   getAllTrackedBills()                    snapshot of the cache
 *   isTracked(key)                          boolean
 *   trackBill(snapshot)                     fire-and-forget; optimistic
 *   untrackBill(key)                        fire-and-forget; optimistic
 *   updateTrackedBill(key, patch)           patch snapshot + sync to server
 *   getBillPrefs(key)                       merged prefs for a tracked bill
 *   setBillPrefs(key, patch)                merge-patch; fire-and-forget
 *   useTrackedBills()                       React hook { map, list, tick }
 *
 * Plus two internal helpers used by trackedSync.js:
 *   _bootstrapBills(rows)                   replace the cache
 *   _clearBills()                           empty the cache
 *
 * Cache shape is the same as the prior localStorage shape, so the
 * existing call sites (TrackedBillsModal, ProfileView, MyTrackedModal,
 * the navbar badge) don't need adjustments beyond the import surface.
 *
 * Bill key format: "{congress}-{type}-{number}" (lowercased),
 * e.g. "119-hr-1234".
 */
import { useEffect, useState } from 'react';
import { defaultPrefsFor, mergePrefs, PREF_TYPES } from './notificationPrefs';
import {
  postTrackBill as apiPostTrackBill,
  deleteTrackedBill as apiDeleteTrackedBill,
  patchTrackedBillPrefs as apiPatchTrackedBillPrefs,
} from './pagesApi';

let cache = {};
const listeners = new Set();
function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (_) { /* swallow */ }
  }
}

// Internal — used by trackedSync.loadAllTracked() to seed the cache
// from the server response on login.
export function _bootstrapBills(rows) {
  cache = {};
  if (!Array.isArray(rows)) {
    notify();
    return;
  }
  for (const row of rows) {
    if (!row || !row.bill_key) continue;
    const snap = (row.snapshot && typeof row.snapshot === 'object') ? row.snapshot : {};
    cache[row.bill_key] = {
      ...snap,
      key: row.bill_key,
      tracked_at: row.tracked_at || snap.tracked_at || new Date().toISOString(),
      prefs: (row.prefs && typeof row.prefs === 'object')
        ? row.prefs
        : defaultPrefsFor(PREF_TYPES.bill),
    };
  }
  notify();
}

// Internal — used by trackedSync.clearAllTracked() on logout.
export function _clearBills() {
  cache = {};
  notify();
}

export function billKey(congress, type, number) {
  if (!congress || !type || !number) return null;
  return `${congress}-${String(type).toLowerCase()}-${String(number).toLowerCase()}`;
}

export function getAllTrackedBills() {
  return cache;
}

export function isTracked(key) {
  if (!key) return false;
  return Boolean(cache[key]);
}

export function trackBill(snapshot) {
  if (!snapshot) return;
  const key = snapshot.key || billKey(snapshot.congress, snapshot.type, snapshot.number);
  if (!key) return;
  const existing = cache[key];
  const prefs = (existing && existing.prefs) || defaultPrefsFor(PREF_TYPES.bill);
  const next = {
    ...snapshot,
    key,
    tracked_at: snapshot.tracked_at || new Date().toISOString(),
    prefs,
  };
  cache[key] = next;
  notify();
  // Fire-and-forget — UI already optimistic.
  apiPostTrackBill({ bill_key: key, snapshot: next, prefs }).catch(() => { /* swallow */ });
  // Contextual push offer — see trackedOfficials._announceTrack.
  import('./trackedOfficials').then((m) => m._announceTrack && m._announceTrack()).catch(() => {});
}

export function untrackBill(key) {
  if (!key) return;
  if (key in cache) {
    delete cache[key];
    notify();
    apiDeleteTrackedBill(key).catch(() => { /* swallow */ });
  }
}

export function updateTrackedBill(key, patch) {
  if (!key) return;
  if (!(key in cache)) return;
  const next = { ...cache[key], ...patch };
  cache[key] = next;
  notify();
  // Server doesn't expose an "update snapshot" endpoint distinct from
  // POST — POST is idempotent and refreshes the snapshot in place, so
  // we re-POST to keep the server in sync.
  apiPostTrackBill({ bill_key: key, snapshot: next, prefs: next.prefs }).catch(() => {});
}

export function getBillPrefs(key) {
  if (!key) return defaultPrefsFor(PREF_TYPES.bill);
  const entry = cache[key];
  if (!entry) return defaultPrefsFor(PREF_TYPES.bill);
  return mergePrefs(PREF_TYPES.bill, entry.prefs || {});
}

export function setBillPrefs(key, patch) {
  if (!key) return null;
  const entry = cache[key];
  if (!entry) return null;
  const merged = {
    ...mergePrefs(PREF_TYPES.bill, entry.prefs || {}),
    ...(patch || {}),
  };
  cache[key] = { ...entry, prefs: merged };
  notify();
  apiPatchTrackedBillPrefs(key, patch || {}).catch(() => { /* swallow */ });
  return merged;
}

/**
 * React hook returning a live `{ map, list, tick }` view of tracked
 * bills. The `mounted` gate matches the prior implementation so any
 * SSR'd component (navbar badge) keeps its hydration semantics — we
 * stay empty until after the first client render, then surface the
 * cache.
 */
export function useTrackedBills() {
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const map = mounted ? cache : {};
  const list = Object.values(map).sort((a, b) => {
    const at = a.tracked_at || '';
    const bt = b.tracked_at || '';
    return bt.localeCompare(at);
  });
  return { map, list, tick };
}
