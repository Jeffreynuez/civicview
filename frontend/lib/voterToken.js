// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Anonymous per-browser voter token for Phase 1 poll voting.
 *
 * One token per browser, stored in localStorage. The backend enforces
 * unique (poll_id, voter_token) so a single browser can only vote once
 * per poll (but can switch its choice by re-submitting).
 *
 * Phase 2 replaces this token with a foreign key to a verified citizen
 * account — but the backend endpoint stays shape-compatible, so the
 * frontend change is scoped to this file.
 */
const STORAGE_KEY = 'civiclens_voter_token';

function randomToken() {
  // 24 hex chars (12 random bytes). Fits inside the 64-char DB column
  // with lots of room. `crypto.getRandomValues` is available in every
  // browser we care about; SSR fallback never persists (server-rendered
  // HTML shouldn't carry a token).
  if (typeof window === 'undefined' || !window.crypto) {
    return '';
  }
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getVoterToken() {
  if (typeof window === 'undefined') return '';
  try {
    let t = window.localStorage.getItem(STORAGE_KEY);
    if (!t) {
      t = randomToken();
      if (t) window.localStorage.setItem(STORAGE_KEY, t);
    }
    return t || '';
  } catch {
    return '';
  }
}
