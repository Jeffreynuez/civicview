// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Tracked Officials Store
 *
 * Browser-only persistence for the user's followed representatives &
 * officials (Congress, federal exec/SCOTUS, state gov/cabinet/legislators/
 * judges, local mayors/council, etc.).
 *
 * Mirrors trackedBills.js: localStorage + tiny pub/sub + cross-tab sync.
 *
 * Stored shape: { [key]: snapshot } where snapshot is:
 *   { key, id, bioguide_id, name, party, title, role, role_type,
 *     chamber, state, district, photoUrl,
 *     followed_at }
 *
 * Key format: bioguide_id if present, else the backend id (e.g. "fl-sen-1",
 * "us-pres-trump"). We lowercase for stability.
 */
import { useEffect, useState } from 'react';
import { defaultPrefsFor, mergePrefs, PREF_TYPES } from './notificationPrefs';

const STORAGE_KEY = 'civiclens.trackedOfficials';

/**
 * Map a member's role_type to the correct prefs schema key. Candidates use
 * the candidate schema; everyone else (Congress, state legislators, mayors,
 * judges, executive officials) uses the representative schema.
 */
export function prefsTypeForMember(member) {
  return member && member.role_type === 'candidate'
    ? PREF_TYPES.candidate
    : PREF_TYPES.representative;
}

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
    console.warn('trackedOfficials: failed to read localStorage', e);
    return {};
  }
}

function safeWrite(map) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('trackedOfficials: failed to write localStorage', e);
  }
}

/**
 * Canonical key for a member/official. Prefers bioguide_id (Congress),
 * falls back to the backend id.
 */
export function officialKey(member) {
  if (!member) return null;
  const raw = member.bioguide_id || member.id;
  if (!raw) return null;
  return String(raw).toLowerCase();
}

export function getAllTrackedOfficials() {
  return safeRead();
}

export function isOfficialTracked(member) {
  const key = officialKey(member);
  if (!key) return false;
  return Boolean(safeRead()[key]);
}

/**
 * Persist a member snapshot. Pass the same shape you'd render in a card —
 * we only keep the identity + display fields, not live bills/votes.
 */
export function trackOfficial(member) {
  const key = officialKey(member);
  if (!key) return;
  const map = safeRead();
  // Preserve existing prefs if this is a re-track (user toggled off then on)
  const existing = map[key];
  const prefsType = prefsTypeForMember(member);
  map[key] = {
    key,
    id: member.id || null,
    bioguide_id: member.bioguide_id || null,
    name: member.name,
    party: member.party || null,
    title: member.title || member.role || '',
    role: member.role || null,
    role_type: member.role_type || null,
    chamber: member.chamber || null,
    state: member.state || null,
    district: member.district || null,
    photoUrl: member.photoUrl || member.image || null,
    followed_at: new Date().toISOString(),
    prefs: (existing && existing.prefs) || defaultPrefsFor(prefsType),
  };
  safeWrite(map);
  notify();
}

export function untrackOfficial(member) {
  const key = officialKey(member);
  if (!key) return;
  const map = safeRead();
  if (key in map) {
    delete map[key];
    safeWrite(map);
    notify();
  }
}

export function toggleOfficial(member) {
  return isOfficialTracked(member)
    ? (untrackOfficial(member), false)
    : (trackOfficial(member), true);
}

/**
 * Return the merged notification prefs for a tracked member. Any new keys
 * introduced since this entry was first stored fill in from defaults.
 * Returns the full default prefs for the member's type if not tracked, so
 * UIs can still render the checkboxes.
 */
export function getOfficialPrefs(member) {
  const key = officialKey(member);
  const type = prefsTypeForMember(member);
  if (!key) return defaultPrefsFor(type);
  const entry = safeRead()[key];
  if (!entry) return defaultPrefsFor(type);
  return mergePrefs(type, entry.prefs || {});
}

/**
 * Patch one or more pref keys on the tracked entry. Silently no-ops if the
 * member isn't tracked yet (callers should track first). Returns the merged
 * prefs after the patch.
 */
export function setOfficialPrefs(member, patch) {
  const key = officialKey(member);
  if (!key) return null;
  const map = safeRead();
  const entry = map[key];
  if (!entry) return null;
  const type = prefsTypeForMember(member);
  const merged = { ...mergePrefs(type, entry.prefs || {}), ...(patch || {}) };
  map[key] = { ...entry, prefs: merged };
  safeWrite(map);
  notify();
  return merged;
}

/**
 * React hook returning a live `{ map, list }` view of tracked officials.
 * `list` is sorted by followed_at desc (most recent first).
 */
export function useTrackedOfficials() {
  const [tick, setTick] = useState(0);
  // See useTrackedBills for the mounted-gate rationale — prevents SSR
  // hydration mismatches when a navbar badge or list counts tracked items.
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
    const at = a.followed_at || '';
    const bt = b.followed_at || '';
    return bt.localeCompare(at);
  });
  return { map, list, tick };
}
