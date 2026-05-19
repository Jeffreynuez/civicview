'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Candidate auth store — parallel to lib/auth.js (rep) and
 * lib/citizenAuth.js (citizen).
 *
 * The backend owns the real session via an httpOnly `cl_candidate`
 * cookie (distinct from `cl_session` and `cl_citizen`). This module
 * is a tiny in-memory cache + subscribe hook so any component that
 * cares about "am I signed in as a candidate?" can re-render on
 * login/logout without each running its own /me fetch.
 *
 * Shape of `candidate` mirrors the backend CandidateMeResponse:
 *   {
 *     id, candidate_id, email, display_name,
 *     owner_state, owner_district, owner_city,
 *     claim_status: 'active'
 *   } | null
 *
 * The auth path only returns 'active' candidates — pending and
 * suspended accounts 401 at /me so the cache never holds them.
 */
import { useEffect, useState } from 'react';
import {
  fetchCandidateMe,
  loginCandidateApi,
  logoutCandidateApi,
} from './pagesApi';

let currentCandidate = null;
let loaded = false;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try { fn(currentCandidate); } catch { /* swallow */ }
  });
}

export function getCandidate() {
  return currentCandidate;
}

export function isCandidateAuthLoaded() {
  return loaded;
}

// Parallel hydrate with in-flight dedupe, same pattern as
// hydrateAuth() / hydrateCitizenAuth().
let hydratePromise = null;
export async function hydrateCandidateAuth() {
  if (loaded) return currentCandidate;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const { data, status } = await fetchCandidateMe();
    currentCandidate = status === 200 ? data : null;
    loaded = true;
    notify();
    return currentCandidate;
  })();
  const result = await hydratePromise;
  hydratePromise = null;
  return result;
}

export async function loginCandidate(email, password) {
  const { data, error, status } = await loginCandidateApi(email, password);
  // 2FA-required branch (Task #62 Phase 3). See lib/auth.js for
  // matching rep flow.
  if (data?.two_factor_required && data?.challenge_token) {
    return {
      ok: false,
      twoFactorRequired: true,
      challengeToken: data.challenge_token,
    };
  }
  if (data && data.candidate) {
    currentCandidate = data.candidate;
    loaded = true;
    notify();
    return { ok: true };
  }
  // Surface the backend message verbatim so suspended / pending
  // accounts get a meaningful explanation instead of "Login failed".
  return { ok: false, error: error || 'Login failed', status };
}

/**
 * Finish a 2FA-gated candidate login. Mirror of completeLoginRep.
 */
export async function completeLoginCandidate(challengeToken, code) {
  const { verifyLoginChallenge } = await import('./twoFactorApi');
  const { setStoredCandidateToken } = await import('./pagesApi');
  const { data, error, status } = await verifyLoginChallenge(challengeToken, code);
  if (data && data.candidate) {
    if (data.candidate_token) setStoredCandidateToken(data.candidate_token);
    currentCandidate = data.candidate;
    loaded = true;
    notify();
    return { ok: true };
  }
  return { ok: false, error: error || 'Code verification failed', status };
}

export async function logoutCandidate() {
  await logoutCandidateApi();
  currentCandidate = null;
  loaded = true;
  notify();
}

/**
 * React hook — returns `{ candidate, isLoaded }`. Fires a hydrate
 * on first mount and subscribes to future login/logout events.
 */
export function useCandidateAuth() {
  const [candidate, setCandidate] = useState(currentCandidate);
  const [isLoaded, setIsLoaded] = useState(loaded);

  useEffect(() => {
    let cancelled = false;
    const fn = (next) => {
      if (cancelled) return;
      setCandidate(next);
      setIsLoaded(true);
    };
    listeners.add(fn);
    if (!loaded) {
      hydrateCandidateAuth().then(() => {
        if (!cancelled) {
          setCandidate(currentCandidate);
          setIsLoaded(true);
        }
      });
    }
    return () => { cancelled = true; listeners.delete(fn); };
  }, []);

  return { candidate, isLoaded };
}
