'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
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
    return currentMe;
  })();
  const result = await hydratePromise;
  hydratePromise = null;
  return result;
}

export async function loginRep(email, password) {
  const { data, error, status } = await apiLogin(email, password);
  if (data && data.rep) {
    currentMe = data.rep;
    loaded = true;
    notify();
    return { ok: true };
  }
  return { ok: false, error: error || 'Login failed', status };
}

export async function logoutRep() {
  await apiLogout();
  currentMe = null;
  loaded = true;
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
