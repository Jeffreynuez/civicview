'use client';

/**
 * leaningPrefs — localStorage store for ballot-measure leanings.
 *
 * The BallotTab is a research tool, not a voting interface. We let the
 * citizen privately mark whether they're "leaning yes" or "leaning no"
 * on a measure as they research it, but we NEVER record actual votes.
 * Per the design system (BallotTab review §4):
 *
 *   "Your preference is private and only stored on your device."
 *
 * No backend round-trip, no aggregation, no analytics. Just a localStorage
 * key the BallotTab reads/writes. If the user clears their browser
 * storage, the leanings are gone — by design.
 *
 * Schema:
 *   { [measureId]: { lean: 'yes' | 'no' | null, ts: ISO } }
 *
 * The `null` lean is stored explicitly when the user clears a previous
 * pick (so we can distinguish "unset" from "actively cleared"); the
 * `ts` is for future "you last leaned this 3 days ago" UI.
 */

const STORAGE_KEY = 'civiclens.leanings.v1';

function readAll() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed != null ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(blob) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    // Notify same-tab listeners. Cross-tab listeners get the native
    // 'storage' event for free.
    window.dispatchEvent(new CustomEvent('civiclens:leaning-changed'));
  } catch {
    // QuotaExceededError or storage disabled — degrade gracefully to
    // session-only state. Caller will just see leanings reset on reload.
  }
}

/**
 * Get the current lean for a measure: 'yes' | 'no' | null.
 */
export function getLean(measureId) {
  if (!measureId) return null;
  const all = readAll();
  return all[measureId]?.lean || null;
}

/**
 * Set the lean. Pass `null` to clear. Toggling the same value clears it
 * (so a second click on "Yes" un-leans rather than re-asserting Yes).
 */
export function setLean(measureId, lean) {
  if (!measureId) return null;
  const all = readAll();
  const current = all[measureId]?.lean || null;
  const next = lean === current ? null : lean;
  if (next === null) {
    delete all[measureId];
  } else {
    all[measureId] = { lean: next, ts: new Date().toISOString() };
  }
  writeAll(all);
  return next;
}

/**
 * Subscribe to changes. Returns an unsubscribe function. Used by React
 * components via useSyncExternalStore-style patterns or plain useEffect.
 */
export function subscribe(listener) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener();
  window.addEventListener('civiclens:leaning-changed', handler);
  // Cross-tab updates fire the native 'storage' event.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) handler();
  });
  return () => {
    window.removeEventListener('civiclens:leaning-changed', handler);
    window.removeEventListener('storage', handler);
  };
}

/**
 * Get a count of current leanings — useful for the BallotTab header
 * ("You've previewed 3 measures") if we want to surface that later.
 */
export function getLeanCount() {
  return Object.keys(readAll()).length;
}
