// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Tracked Elections Store — server-backed, per-identity.
 *
 * Replaces the prior localStorage-singleton implementation (which
 * survived logout/login). Mirrors trackedBills.js / trackedOfficials.js.
 *
 * Key format: backend `id` lowercased, falling back to a composite of
 * state|office|date when no id is present.
 */
import { useEffect, useState } from 'react';
import { defaultPrefsFor, mergePrefs, PREF_TYPES } from './notificationPrefs';
import {
  postTrackElection as apiPostTrackElection,
  deleteTrackedElection as apiDeleteTrackedElection,
  patchTrackedElectionPrefs as apiPatchTrackedElectionPrefs,
} from './pagesApi';

let cache = {};
const listeners = new Set();
function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (_) { /* swallow */ }
  }
}

export function _bootstrapElections(rows) {
  cache = {};
  if (!Array.isArray(rows)) {
    notify();
    return;
  }
  for (const row of rows) {
    if (!row || !row.election_key) continue;
    const snap = (row.snapshot && typeof row.snapshot === 'object') ? row.snapshot : {};
    cache[row.election_key] = {
      key: row.election_key,
      ...snap,
      tracked_at: row.tracked_at || snap.tracked_at || new Date().toISOString(),
      prefs: (row.prefs && typeof row.prefs === 'object')
        ? row.prefs
        : defaultPrefsFor(PREF_TYPES.election),
    };
  }
  notify();
}

export function _clearElections() {
  cache = {};
  notify();
}

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
  return cache;
}

export function isElectionTracked(election) {
  const key = typeof election === 'string' ? election.toLowerCase() : electionKey(election);
  if (!key) return false;
  return Boolean(cache[key]);
}

export function trackElection(election) {
  const key = electionKey(election);
  if (!key) return;
  const existing = cache[key];
  const prefs = (existing && existing.prefs) || defaultPrefsFor(PREF_TYPES.election);
  const snapshot = {
    key,
    id: election.id || null,
    name: election.name || election.office || '',
    office: election.office || null,
    date: election.date || null,
    state: election.state || null,
    district: election.district || null,
    type: election.type || null,
    level: election.level || null,
    candidates_count: Array.isArray(election.candidates)
      ? election.candidates.length
      : (election.candidates_count || 0),
    tracked_at: new Date().toISOString(),
    prefs,
  };
  cache[key] = snapshot;
  notify();
  apiPostTrackElection({ election_key: key, snapshot, prefs }).catch(() => {});
  // Contextual push offer — see trackedOfficials._announceTrack.
  import('./trackedOfficials').then((m) => m._announceTrack && m._announceTrack()).catch(() => {});
}

export function untrackElection(election) {
  const key = typeof election === 'string' ? election.toLowerCase() : electionKey(election);
  if (!key) return;
  if (key in cache) {
    delete cache[key];
    notify();
    apiDeleteTrackedElection(key).catch(() => {});
  }
}

export function toggleElection(election) {
  return isElectionTracked(election)
    ? (untrackElection(election), false)
    : (trackElection(election), true);
}

export function getElectionPrefs(election) {
  const key = typeof election === 'string' ? election.toLowerCase() : electionKey(election);
  if (!key) return defaultPrefsFor(PREF_TYPES.election);
  const entry = cache[key];
  if (!entry) return defaultPrefsFor(PREF_TYPES.election);
  return mergePrefs(PREF_TYPES.election, entry.prefs || {});
}

export function setElectionPrefs(election, patch) {
  const key = typeof election === 'string' ? election.toLowerCase() : electionKey(election);
  if (!key) return null;
  const entry = cache[key];
  if (!entry) return null;
  const merged = {
    ...mergePrefs(PREF_TYPES.election, entry.prefs || {}),
    ...(patch || {}),
  };
  cache[key] = { ...entry, prefs: merged };
  notify();
  apiPatchTrackedElectionPrefs(key, patch || {}).catch(() => {});
  return merged;
}

export function useTrackedElections() {
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
    const ad = a.date || '9999-12-31';
    const bd = b.date || '9999-12-31';
    return ad.localeCompare(bd);
  });
  return { map, list, tick };
}
