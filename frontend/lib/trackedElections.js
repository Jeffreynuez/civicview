/**
 * Tracked Elections Store
 *
 * Browser-only persistence for the user's tracked elections (federal,
 * state, and local). Mirrors trackedBills.js / trackedOfficials.js:
 * localStorage + tiny pub/sub + cross-tab sync.
 *
 * Stored shape: { [key]: snapshot } where snapshot is:
 *   { key, id, name, office, date, state, district, type, level,
 *     candidates_count, prefs, tracked_at }
 *
 * Key format: the election's backend `id` lowercased, falling back to a
 * composite of state-office-date when no id is present.
 */
import { useEffect, useState } from 'react';
import { defaultPrefsFor, mergePrefs, PREF_TYPES } from './notificationPrefs';

const STORAGE_KEY = 'civiclens.trackedElections';

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
    console.warn('trackedElections: failed to read localStorage', e);
    return {};
  }
}

function safeWrite(map) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('trackedElections: failed to write localStorage', e);
  }
}

/**
 * Canonical key for an election. Prefers the backend id; falls back to a
 * composite of state-office-date so ad-hoc election objects still key
 * stably.
 */
export function electionKey(election) {
  if (!election) return null;
  if (election.id) return String(election.id).toLowerCase();
  const parts = [
    election.state || '',
    election.office || election.name || '',
    election.date || '',
  ].map((p) => String(p).toLowerCase().replace(/\s+/g, '-'));
  const composed = parts.filter(Boolean).join('|');
  return composed || null;
}

export function getAllTrackedElections() {
  return safeRead();
}

export function isElectionTracked(election) {
  const key = typeof election === 'string' ? election.toLowerCase() : electionKey(election);
  if (!key) return false;
  return Boolean(safeRead()[key]);
}

/**
 * Persist an election snapshot. Pass the same shape you'd render in a card
 * — we only keep identity + display fields.
 */
export function trackElection(election) {
  const key = electionKey(election);
  if (!key) return;
  const map = safeRead();
  const existing = map[key];
  map[key] = {
    key,
    id: election.id || null,
    name: election.name || election.office || '',
    office: election.office || null,
    date: election.date || null,
    state: election.state || null,
    district: election.district || null,
    type: election.type || null,          // 'primary' | 'general' | 'special' | ...
    level: election.level || null,        // 'federal' | 'state' | 'local'
    candidates_count: Array.isArray(election.candidates)
      ? election.candidates.length
      : (election.candidates_count || 0),
    tracked_at: new Date().toISOString(),
    prefs: (existing && existing.prefs) || defaultPrefsFor(PREF_TYPES.election),
  };
  safeWrite(map);
  notify();
}

export function untrackElection(election) {
  const key = typeof election === 'string' ? election.toLowerCase() : electionKey(election);
  if (!key) return;
  const map = safeRead();
  if (key in map) {
    delete map[key];
    safeWrite(map);
    notify();
  }
}

export function toggleElection(election) {
  return isElectionTracked(election)
    ? (untrackElection(election), false)
    : (trackElection(election), true);
}

/**
 * Return merged notification prefs for a tracked election. Falls back to
 * election defaults (including the weekly reminder slider) when the
 * election isn't tracked, so UIs can render the controls.
 */
export function getElectionPrefs(election) {
  const key = typeof election === 'string' ? election.toLowerCase() : electionKey(election);
  if (!key) return defaultPrefsFor(PREF_TYPES.election);
  const entry = safeRead()[key];
  if (!entry) return defaultPrefsFor(PREF_TYPES.election);
  return mergePrefs(PREF_TYPES.election, entry.prefs || {});
}

/**
 * Patch one or more pref keys on the tracked election. No-ops when the
 * election isn't tracked. Returns the merged prefs after the patch.
 */
export function setElectionPrefs(election, patch) {
  const key = typeof election === 'string' ? election.toLowerCase() : electionKey(election);
  if (!key) return null;
  const map = safeRead();
  const entry = map[key];
  if (!entry) return null;
  const merged = {
    ...mergePrefs(PREF_TYPES.election, entry.prefs || {}),
    ...(patch || {}),
  };
  map[key] = { ...entry, prefs: merged };
  safeWrite(map);
  notify();
  return merged;
}

/**
 * React hook returning a live `{ map, list }` view of tracked elections.
 * `list` is sorted by election date ascending (soonest first); elections
 * without a date fall to the bottom.
 */
export function useTrackedElections() {
  const [tick, setTick] = useState(0);
  // See useTrackedBills for the mounted-gate rationale — keeps SSR output
  // and the first client render in sync.
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

  const map = mounted ? safeRead() : {};
  const list = Object.values(map).sort((a, b) => {
    const ad = a.date || '9999-12-31';
    const bd = b.date || '9999-12-31';
    return ad.localeCompare(bd);
  });
  return { map, list, tick };
}
