// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Tracked Officials Store — server-backed, per-identity.
 *
 * Replaces the prior localStorage-singleton implementation (which
 * survived logout/login). Mirrors trackedBills.js: in-memory cache,
 * fire-and-forget mutations with optimistic UI, bootstrapped from
 * /api/tracked on login via trackedSync.js.
 *
 * Key format: bioguide_id when present, else the backend id
 * (e.g. "fl-sen-1", "us-pres-trump"), lowercased.
 */
import { useEffect, useState } from 'react';
import { defaultPrefsFor, mergePrefs, PREF_TYPES } from './notificationPrefs';
import {
  postTrackOfficial as apiPostTrackOfficial,
  deleteTrackedOfficial as apiDeleteTrackedOfficial,
  patchTrackedOfficialPrefs as apiPatchTrackedOfficialPrefs,
} from './pagesApi';

export function prefsTypeForMember(member) {
  return member && member.role_type === 'candidate'
    ? PREF_TYPES.candidate
    : PREF_TYPES.representative;
}

let cache = {};
const listeners = new Set();
function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (_) { /* swallow */ }
  }
}

export function _bootstrapOfficials(rows) {
  cache = {};
  if (!Array.isArray(rows)) {
    notify();
    return;
  }
  for (const row of rows) {
    if (!row || !row.official_key) continue;
    const snap = (row.snapshot && typeof row.snapshot === 'object') ? row.snapshot : {};
    cache[row.official_key] = {
      key: row.official_key,
      ...snap,
      followed_at: row.followed_at || snap.followed_at || new Date().toISOString(),
      prefs: (row.prefs && typeof row.prefs === 'object')
        ? row.prefs
        : defaultPrefsFor(prefsTypeForMember(snap)),
    };
  }
  notify();
}

export function _clearOfficials() {
  cache = {};
  notify();
}

export function officialKey(member) {
  if (!member) return null;
  // Candidates are SEPARATE entities from officials even when the same
  // person — a sitting rep running for office (e.g. Byron Donalds:
  // Representative FL-19 + Governor candidate) shares a bioguide_id across
  // both. Key candidates by their OWN candidate id first so tracking /
  // un-tracking / button state never collides with the rep entity;
  // officials keep the bioguide-first key.
  const raw = member.role_type === 'candidate'
    ? (member.id || member.bioguide_id)
    : (member.bioguide_id || member.id);
  if (!raw) return null;
  return String(raw).toLowerCase();
}

export function getAllTrackedOfficials() {
  return cache;
}

export function isOfficialTracked(member) {
  const key = officialKey(member);
  if (!key) return false;
  return Boolean(cache[key]);
}

export function trackOfficial(member) {
  const key = officialKey(member);
  if (!key) return;
  const existing = cache[key];
  const prefsType = prefsTypeForMember(member);
  const prefs = (existing && existing.prefs) || defaultPrefsFor(prefsType);
  const snapshot = {
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
    prefs,
  };
  cache[key] = snapshot;
  notify();
  apiPostTrackOfficial({ official_key: key, snapshot, prefs }).catch(() => {});
}

export function untrackOfficial(member) {
  const key = officialKey(member);
  if (!key) return;
  if (key in cache) {
    delete cache[key];
    notify();
    apiDeleteTrackedOfficial(key).catch(() => {});
  }
}

export function toggleOfficial(member) {
  return isOfficialTracked(member)
    ? (untrackOfficial(member), false)
    : (trackOfficial(member), true);
}

export function getOfficialPrefs(member) {
  const key = officialKey(member);
  const type = prefsTypeForMember(member);
  if (!key) return defaultPrefsFor(type);
  const entry = cache[key];
  if (!entry) return defaultPrefsFor(type);
  return mergePrefs(type, entry.prefs || {});
}

export function setOfficialPrefs(member, patch) {
  const key = officialKey(member);
  if (!key) return null;
  const entry = cache[key];
  if (!entry) return null;
  const type = prefsTypeForMember(member);
  const merged = { ...mergePrefs(type, entry.prefs || {}), ...(patch || {}) };
  cache[key] = { ...entry, prefs: merged };
  notify();
  apiPatchTrackedOfficialPrefs(key, patch || {}).catch(() => {});
  return merged;
}

export function useTrackedOfficials() {
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
    const at = a.followed_at || '';
    const bt = b.followed_at || '';
    return bt.localeCompare(at);
  });
  return { map, list, tick };
}
