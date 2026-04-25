/**
 * Channel Preferences Store
 *
 * Browser-only persistence for the user's global delivery preferences —
 * in-app toasts, desktop push, email, SMS, mobile push — plus quiet-hours
 * and digest cadence. Backed by localStorage, with the same tiny pub/sub
 * pattern the other tracked-* stores use.
 *
 * Schema lives in notificationPrefs.js (CHANNEL_SCHEMA). Today, only the
 * `in_app` channel is actually wired to delivery; the others are declared
 * so the UI can show them as "coming soon" toggles the user can opt-in to
 * ahead of the full stack landing.
 */
import { useEffect, useState } from 'react';
import { defaultChannelPrefs, mergeChannelPrefs, CHANNEL_SCHEMA } from './notificationPrefs';

const STORAGE_KEY = 'civiclens.channelPrefs';

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
 * the patch. Silently no-ops on the server.
 */
export function setChannelPrefs(patch) {
  const current = getChannelPrefs();
  const next = { ...current, ...(patch || {}) };
  safeWrite(next);
  notify();
  return next;
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
