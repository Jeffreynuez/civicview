// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Featured Tracked Store — server-backed, per-identity.
 *
 * Holds the ONE tracked item the user has pinned to the top of their
 * dashboard Overview for each of the four categories. Mirrors the
 * trackedOfficials / trackedBills store shape: in-memory cache, a
 * subscribe hook, and a fire-and-forget optimistic setter that writes
 * through to PUT /api/tracked/featured. Bootstrapped from the bulk
 * /api/tracked GET (data.featured) on login via trackedSync.js.
 *
 * Keys are the SAME canonical strings the tracked stores use
 * (official_key / bill_key / election_key) so spotlight lookups are a
 * plain map[key] hit. Candidates and representatives are separate
 * categories even though both live in the officials store.
 */
import { useEffect, useState } from 'react';
import { putFeaturedTracked } from './pagesApi';

export const FEATURED_CATEGORIES = ['representative', 'candidate', 'bill', 'election'];

const EMPTY = { representative: null, candidate: null, bill: null, election: null };

let featured = { ...EMPTY };
const listeners = new Set();
function notify() {
  for (const fn of listeners) {
    try { fn(); } catch (_) { /* swallow */ }
  }
}

export function _bootstrapFeatured(map) {
  featured = {
    representative: (map && map.representative) || null,
    candidate: (map && map.candidate) || null,
    bill: (map && map.bill) || null,
    election: (map && map.election) || null,
  };
  notify();
}

export function _clearFeatured() {
  featured = { ...EMPTY };
  notify();
}

export function getFeatured() {
  return featured;
}

export function getFeaturedKey(category) {
  return featured[category] || null;
}

export function isFeatured(category, key) {
  return Boolean(key) && featured[category] === key;
}

/**
 * Pin `key` as the featured item for `category`. Re-selecting the
 * already-featured key un-pins it (toggle). Optimistic: updates the
 * cache + notifies subscribers immediately, then writes through.
 * Returns the new value for the category (key or null).
 */
export function setFeatured(category, key) {
  if (!FEATURED_CATEGORIES.includes(category)) return null;
  const next = featured[category] === key ? null : (key || null);
  featured = { ...featured, [category]: next };
  notify();
  putFeaturedTracked({ category, key: next }).catch(() => {});
  return next;
}

export function useFeaturedTracked() {
  const [, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  // Return the empty default until mounted to avoid a hydration
  // mismatch (server render has no featured picks).
  return { featured: mounted ? featured : EMPTY };
}
