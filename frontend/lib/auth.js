'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Auth store for the Pages feature.
 *
 * The backend owns the real session via an httpOnly cookie, so this file is
 * just a tiny in-memory cache + subscribe hook so every component that cares
 * about "am I signed in?" can re-render when login/logout happens without
 * each of them rolling their own /me fetch.
 *
 * Shape of `me` mirrors the backend MeResponse:
 *   { id, email, display_name, official_id, role, ... } | null
 */
import { useEffect, useState } from 'react';
import { fetchMe, login as apiLogin, logout as apiLogout } from './pagesApi';
import { loadAllTracked, clearAllTracked } from './trackedSync';

let currentMe = null;
let loaded = false;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try { fn(currentMe); } catch { /* swallow */ }
  });
}

export function getMe() {
  return currentMe;
}

export function isAuthLoaded() {
  return loaded;
}

/**
 * Hydrate from the server if we haven't already — and remember the in-flight
 * promise so parallel callers don't fan out to multiple /me calls.
 */
let hydratePromise = null;
export async function hydrateAuth() {
  if (loaded) return currentMe;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const { data, status } = await fetchMe();
    // 401 simply means not logged in — that's a valid "loaded" state.
    currentMe = status === 200 ? data : null;
    loaded = true;
    notify();
    // Re-bootstrap the tracked-item cache against whichever identity
    // the backend now picks (citizen > rep > candidate). Fire-and-
    // forget so a slow round-trip doesn't block the auth hydrate.
    if (currentMe) loadAllTracked().catch(() => {});
    else clearAllTracked();
    return currentMe;
  })();
  const result = await hydratePromise;
  hydratePromise = null;
  return result;
}

/**
 * Force-refresh the cached /me — bypasses the `loaded` short-circuit
 * in hydrateAuth(). Used by 2FA Phase 4's Force2FAGate after enrollment
 * completes, so `needs_2fa_enrollment` flips from true → false on the
 * next render. Returns the fresh me (or null on 401).
 */
export async function refreshAuth() {
  loaded = false;
  hydratePromise = null;
  return hydrateAuth();
}

export async function loginRep(email, password) {
  const { data, error, status, payload } = await apiLogin(email, password);
  // 2FA-required branch (Task #62 Phase 3). Backend returned a
  // challenge token instead of a session — caller must collect the
  // 6-digit code and call completeLoginRep() to finish.
  if (data?.two_factor_required && data?.challenge_token) {
    return {
      ok: false,
      twoFactorRequired: true,
      challengeToken: data.challenge_token,
    };
  }
  if (data && data.rep) {
    currentMe = data.rep;
    loaded = true;
    notify();
    loadAllTracked().catch(() => {});
    return { ok: true };
  }
  return { ok: false, error: error || 'Login failed', status, payload };
}

/**
 * Finish a 2FA-gated rep login. Called from the rep login modal
 * after the user enters their TOTP / recovery code. On success
 * stores the bearer token, updates currentMe, and notifies
 * subscribers — same end state as a successful plain loginRep().
 */
export async function completeLoginRep(challengeToken, code) {
  // Lazy-import to keep the auth module's import graph minimal —
  // twoFactorApi is only needed when a user actually has 2FA.
  const { verifyLoginChallenge } = await import('./twoFactorApi');
  const { setStoredRepToken, setStoredRepCsrf } = await import('./pagesApi');
  const { data, error, status, payload } = await verifyLoginChallenge(challengeToken, code);
  if (data && data.rep) {
    if (data.session_token) setStoredRepToken(data.session_token);
    if (data.csrf_token) setStoredRepCsrf(data.csrf_token);
    currentMe = data.rep;
    loaded = true;
    notify();
    return { ok: true };
  }
  return { ok: false, error: error || 'Code verification failed', status, payload };
}

export async function logoutRep() {
  await apiLogout();
  currentMe = null;
  loaded = true;
  // Clear the cache instantly for UI; refetch so the remaining
  // active identity (if any) sees its own tracked items.
  clearAllTracked();
  loadAllTracked().catch(() => {});
  notify();
}

/**
 * React hook — returns the current `me` object (or null) and kicks off a
 * hydrate on first mount. Subscribes to future changes.
 */
export function useAuth() {
  const [me, setMe] = useState(currentMe);
  const [isLoaded, setIsLoaded] = useState(loaded);

  useEffect(() => {
    let cancelled = false;
    const fn = (next) => {
      if (cancelled) return;
      setMe(next);
      setIsLoaded(true);
    };
    listeners.add(fn);
    // Trigger hydration if nobody has yet.
    if (!loaded) {
      hydrateAuth().then(() => {
        if (!cancelled) {
          setMe(currentMe);
          setIsLoaded(true);
        }
      });
    }
    return () => { cancelled = true; listeners.delete(fn); };
  }, []);

  return { me, isLoaded };
}
