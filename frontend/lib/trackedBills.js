/**
 * Tracked Bills Store
 *
 * Browser-only persistence for the user's tracked bills.
 * Backed by localStorage; exposes a tiny pub/sub so any component using
 * useTrackedBills() stays in sync when another component mutates the list.
 *
 * Stored shape: { [key]: snapshot } where snapshot is:
 *   { key, congress, type, number, title, citation,
 *     latest_action, latest_action_date, introduced_date,
 *     policy_area, url,
 *     sponsor_bioguide, sponsor_name,
 *     tracked_at }
 *
 * Bill key format: "{congress}-{type}-{number}" (lowercased), e.g. "119-hr-1234".
 */
import { useEffect, useState } from 'react';
import { defaultPrefsFor, mergePrefs, PREF_TYPES } from './notificationPrefs';

const STORAGE_KEY = 'civiclens.trackedBills';

const listeners = new Set();
function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { /* swallow */ }
  }
}

function safeRead() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.warn('trackedBills: failed to read localStorage', e);
    return {};
  }
}

function safeWrite(map) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('trackedBills: failed to write localStorage', e);
  }
}

export function billKey(congress, type, number) {
  if (!congress || !type || !number) return null;
  return `${congress}-${String(type).toLowerCase()}-${String(number).toLowerCase()}`;
}

export function getAllTrackedBills() {
  return safeRead();
}

export function isTracked(key) {
  if (!key) return false;
  return Boolean(safeRead()[key]);
}

export function trackBill(snapshot) {
  if (!snapshot) return;
  const key = snapshot.key || billKey(snapshot.congress, snapshot.type, snapshot.number);
  if (!key) return;
  const map = safeRead();
  const existing = map[key];
  map[key] = {
    ...snapshot,
    key,
    tracked_at: snapshot.tracked_at || new Date().toISOString(),
    // Preserve prefs on re-track; seed defaults on first track.
    prefs: (existing && existing.prefs) || defaultPrefsFor(PREF_TYPES.bill),
  };
  safeWrite(map);
  notify();
}

export function untrackBill(key) {
  if (!key) return;
  const map = safeRead();
  if (key in map) {
    delete map[key];
    safeWrite(map);
    notify();
  }
}

export function updateTrackedBill(key, patch) {
  if (!key) return;
  const map = safeRead();
  if (!(key in map)) return;
  map[key] = { ...map[key], ...patch };
  safeWrite(map);
  notify();
}

/**
 * Return the merged notification prefs for a tracked bill key. Falls back
 * to bill defaults if the bill isn't tracked, so UIs can still render the
 * checkboxes.
 */
export function getBillPrefs(key) {
  if (!key) return defaultPrefsFor(PREF_TYPES.bill);
  const entry = safeRead()[key];
  if (!entry) return defaultPrefsFor(PREF_TYPES.bill);
  return mergePrefs(PREF_TYPES.bill, entry.prefs || {});
}

/**
 * Patch one or more pref keys on the tracked bill entry. No-ops when the
 * bill isn't tracked. Returns the merged prefs after the patch.
 */
export function setBillPrefs(key, patch) {
  if (!key) return null;
  const map = safeRead();
  const entry = map[key];
  if (!entry) return null;
  const merged = {
    ...mergePrefs(PREF_TYPES.bill, entry.prefs || {}),
    ...(patch || {}),
  };
  map[key] = { ...entry, prefs: merged };
  safeWrite(map);
  notify();
  return merged;
}

/**
 * React hook returning a live `{ map, list }` view of tracked bills.
 *
 * `map`  — the underlying object keyed by bill key
 * `list` — array of snapshots sorted by tracked_at desc
 */
export function useTrackedBills() {
  const [tick, setTick] = useState(0);
  // `mounted` stays false on the server and during the first client render
  // so SSR output matches the first client render — only after hydration do
  // we surface localStorage values. Prevents hydration mismatches on any
  // UI that counts or lists tracked items (e.g. navbar badge).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);

    // Sync across tabs
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

  // Re-read on every tick, but stay empty until after hydration
  const map = mounted ? safeRead() : {};
  const list = Object.values(map).sort((a, b) => {
    const at = a.tracked_at || '';
    const bt = b.tracked_at || '';
    return bt.localeCompare(at);
  });
  return { map, list, tick };
}
