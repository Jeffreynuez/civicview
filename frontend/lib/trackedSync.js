// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Tracked-items sync coordinator.
 *
 * One module that the auth layer can call to:
 *   • bootstrap all three in-memory tracked stores from the server
 *     after a successful login / identity hydrate
 *   • clear all three stores after a logout
 *
 * The actual stores live in trackedBills.js, trackedOfficials.js, and
 * trackedElections.js — this module just orchestrates the bulk
 * /api/tracked GET (one round-trip) and dispatches its three lists
 * into the respective caches.
 *
 * Failure mode: if the server call errors, we leave the existing
 * cache untouched. The next user action (track / untrack) will
 * surface the server error via the per-store fire-and-forget call
 * — no need to surface a banner on the load-failure path.
 */
import { fetchAllTracked } from './pagesApi';
import { _bootstrapBills, _clearBills } from './trackedBills';
import { _bootstrapOfficials, _clearOfficials } from './trackedOfficials';
import { _bootstrapElections, _clearElections } from './trackedElections';
import { _bootstrapFeatured, _clearFeatured } from './featuredTracked';

let inFlight = null;

/**
 * Fetch all three tracked lists for the currently signed-in identity
 * and replace the in-memory caches. Dedupes concurrent calls (e.g.
 * a hydrate firing in parallel with an explicit re-load) so we never
 * issue two simultaneous bulk loads. Returns the promise of the
 * load so callers can await if they need to.
 */
export async function loadAllTracked() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data, error } = await fetchAllTracked();
      if (error) {
        // Leave the caches as-is; the next action will retry.
        return;
      }
      _bootstrapBills(data?.bills || []);
      _bootstrapOfficials(data?.officials || []);
      _bootstrapElections(data?.elections || []);
      _bootstrapFeatured(data?.featured || {});
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Empty all three caches. Called on logout so the navbar "My Tracked"
 * badge and modal don't leak state into the next session.
 *
 * Note: we do NOT call the server here — there's nothing to delete
 * server-side, and the new session will load its own state via
 * loadAllTracked() on the next hydrate.
 */
export function clearAllTracked() {
  _clearBills();
  _clearOfficials();
  _clearElections();
  _clearFeatured();
}
