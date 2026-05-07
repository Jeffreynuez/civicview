'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
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
} from './pagesApi';

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
    return currentCitizen;
  })();
  const result = await hydratePromise;
  hydratePromise = null;
  return result;
}

export async function loginCitizen(email, password) {
  const { data, error, status } = await loginCitizenApi(email, password);
  if (data && data.citizen) {
    currentCitizen = data.citizen;
    loaded = true;
    notify();
    return { ok: true };
  }
  return { ok: false, error: error || 'Login failed', status };
}

export async function logoutCitizen() {
  await logoutCitizenApi();
  currentCitizen = null;
  loaded = true;
  notify();
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
