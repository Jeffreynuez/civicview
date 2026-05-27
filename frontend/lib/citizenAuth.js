'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Citizen auth store — parallel to lib/auth.js.
 *
 * The backend owns the real session via an httpOnly `cl_citizen` cookie
 * (distinct from the rep cookie `cl_session`). This module is a tiny
 * in-memory cache + subscribe hook so any component that cares about
 * "am I signed in as a citizen?" can re-render on login/logout without
 * each of them running its own /me fetch.
 *
 * Shape of `citizen` mirrors the backend CitizenMeResponse:
 *   {
 *     id, email, display_name,
 *     city, county, state, zip_code, congressional_district,
 *     verified: boolean
 *   } | null
 *
 * `verified` is always false in Phase 1.5 — any UI that surfaces the
 * citizen's geography should honor it and label the data "Unverified".
 */
import { useEffect, useState } from 'react';
import {
  fetchCitizenMe,
  loginCitizenApi,
  logoutCitizenApi,
  signupDemoCitizen as signupDemoCitizenApi,
} from './pagesApi';
// Tracked-items sync — bootstrap the in-memory caches on login /
// hydrate, clear them on logout. Without this, the navbar "My Tracked"
// badge would persist across identity changes in the same browser
// (the cross-account bug we shipped this fix for).
import { loadAllTracked, clearAllTracked } from './trackedSync';

let currentCitizen = null;
let loaded = false;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try { fn(currentCitizen); } catch { /* swallow */ }
  });
}

export function getCitizen() {
  return currentCitizen;
}

export function isCitizenAuthLoaded() {
  return loaded;
}

// Parallel hydrate with in-flight dedupe, same pattern as hydrateAuth().
let hydratePromise = null;
export async function hydrateCitizenAuth() {
  if (loaded) return currentCitizen;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const { data, status } = await fetchCitizenMe();
    currentCitizen = status === 200 ? data : null;
    loaded = true;
    notify();
    // Bootstrap tracked-item caches from the server. Fire-and-forget
    // so a slow /api/tracked round-trip doesn't block the auth
    // hydrate; the caches just stay empty for a moment longer.
    if (currentCitizen) {
      loadAllTracked().catch(() => { /* swallow */ });
    } else {
      clearAllTracked();
    }
    return currentCitizen;
  })();
  const result = await hydratePromise;
  hydratePromise = null;
  return result;
}

/**
 * Force-refresh — bypass the `loaded` short-circuit so the next /me
 * call actually hits the backend. Used by the post-2FA-enroll flow
 * AND by the account recovery flow (Task #81) so self_deleted_at
 * flips back to null after the user clicks Recover.
 */
export async function refreshCitizenAuth() {
  loaded = false;
  hydratePromise = null;
  return hydrateCitizenAuth();
}

export async function loginCitizen(email, password) {
  const { data, error, status, payload } = await loginCitizenApi(email, password);
  // 2FA-required branch (Task #62 Phase 3). See lib/auth.js for the
  // matching rep flow; same shape on the citizen side.
  if (data?.two_factor_required && data?.challenge_token) {
    return {
      ok: false,
      twoFactorRequired: true,
      challengeToken: data.challenge_token,
    };
  }
  if (data && data.citizen) {
    currentCitizen = data.citizen;
    loaded = true;
    notify();
    // Bootstrap tracked caches for the freshly-signed-in citizen.
    loadAllTracked().catch(() => {});
    return { ok: true };
  }
  return { ok: false, error: error || 'Login failed', status, payload };
}

/**
 * Finish a 2FA-gated citizen login. Mirror of completeLoginRep.
 */
export async function completeLoginCitizen(challengeToken, code) {
  const { verifyLoginChallenge } = await import('./twoFactorApi');
  const { setStoredCitizenToken, setStoredCitizenCsrf } = await import('./pagesApi');
  const { data, error, status } = await verifyLoginChallenge(challengeToken, code);
  if (data && data.citizen) {
    if (data.citizen_token) setStoredCitizenToken(data.citizen_token);
    if (data.csrf_token) setStoredCitizenCsrf(data.csrf_token);
    currentCitizen = data.citizen;
    loaded = true;
    notify();
    loadAllTracked().catch(() => {});
    return { ok: true };
  }
  return { ok: false, error: error || 'Code verification failed', status, payload };
}

export async function logoutCitizen() {
  await logoutCitizenApi();
  currentCitizen = null;
  loaded = true;
  // Clear the in-memory tracked caches so the next identity (or the
  // signed-out navbar) doesn't see the previous user's items.
  clearAllTracked();
  notify();
}

/**
 * Mint a new demo citizen account and auto-sign them in.
 * Returns:
 *   { ok: true, email, password, citizen } on success — the modal
 *     stashes email/password locally so the user can copy them.
 *   { ok: false, error, status }           on failure (429, 400, etc.)
 */
export async function signupDemoCitizen(payload) {
  const { data, error, status } = await signupDemoCitizenApi(payload);
  if (data && data.citizen) {
    currentCitizen = data.citizen;
    loaded = true;
    notify();
    loadAllTracked().catch(() => {});
    return { ok: true, email: data.email, password: data.password, citizen: data.citizen };
  }
  return { ok: false, error: error || 'Demo signup failed', status, payload };
}

/**
 * React hook — returns `{ citizen, isLoaded }`. Fires a hydrate on first
 * mount and subscribes to future login/logout events.
 */
export function useCitizenAuth() {
  const [citizen, setCitizen] = useState(currentCitizen);
  const [isLoaded, setIsLoaded] = useState(loaded);

  useEffect(() => {
    let cancelled = false;
    const fn = (next) => {
      if (cancelled) return;
      setCitizen(next);
      setIsLoaded(true);
    };
    listeners.add(fn);
    if (!loaded) {
      hydrateCitizenAuth().then(() => {
        if (!cancelled) {
          setCitizen(currentCitizen);
          setIsLoaded(true);
        }
      });
    }
    return () => { cancelled = true; listeners.delete(fn); };
  }, []);

  return { citizen, isLoaded };
}
