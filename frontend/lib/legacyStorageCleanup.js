// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * One-time wipe of the prior tracked-items localStorage keys.
 *
 * The cross-account fix moved tracked bills / officials / elections
 * from browser localStorage into the Postgres backend. Existing users
 * still have stale entries under the old keys sitting in their browser
 * storage — harmless (nothing reads them anymore) but worth cleaning
 * up so a future developer doesn't see them and assume they're live.
 *
 * Idempotent — running it twice is a no-op. We write a small marker
 * the second time we run so we don't churn through the storage API
 * on every page load.
 */

const LEGACY_KEYS = [
  'civiclens.trackedBills',
  'civiclens.trackedOfficials',
  'civiclens.trackedElections',
];

const CLEANUP_MARKER = 'civiclens.legacyTrackedCleanedAt';

export function runLegacyTrackedCleanup() {
  if (typeof window === 'undefined') return;
  let ls;
  try {
    ls = window.localStorage;
  } catch (_) {
    // Some privacy modes throw on localStorage access. Silent no-op.
    return;
  }
  if (!ls) return;
  // Fast path — we've already cleaned this browser, skip the work.
  try {
    if (ls.getItem(CLEANUP_MARKER)) return;
  } catch (_) {
    return;
  }
  for (const k of LEGACY_KEYS) {
    try {
      ls.removeItem(k);
    } catch (_) {
      /* swallow — single-key failure shouldn't abort the rest */
    }
  }
  try {
    ls.setItem(CLEANUP_MARKER, new Date().toISOString());
  } catch (_) {
    /* swallow — marker is a nice-to-have, not a correctness gate */
  }
}
