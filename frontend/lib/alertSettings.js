// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * The notification settings list (2026-10-17), from the server.
 *
 * GET /api/alert-settings returns the signed-in citizen's rows; a change
 * PATCHes ONE row ({ row, value }). The list lives on the account, not
 * in this browser, so it is the same on every device and the server
 * enforces it on every send path. It is not part of the synced prefs
 * blob (lib/channelPrefs.js), which a device replaces whole: a device
 * sync could otherwise undo a change made elsewhere, or an email's
 * unsubscribe link.
 *
 * One shared cache with a tiny pub/sub, so the bell and the dashboard
 * show the same values without fetching twice.
 */
import { useEffect, useState } from 'react';
import { request } from './http';

let cache = null;        // { settings, choices, digest, email_available }
let cacheOwner = null;   // citizen id the cache belongs to
let inflight = null;
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch { /* one listener cannot block the rest */ }
  }
}

export async function loadAlertSettings(citizenId, { force = false } = {}) {
  if (!citizenId) return null;
  if (!force && cache && cacheOwner === citizenId) return cache;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const { data } = await request('/api/alert-settings');
    inflight = null;
    if (data) {
      cache = data;
      cacheOwner = citizenId;
      notify();
    }
    return data;
  })();
  return inflight;
}

/** Change one row. Resolves { ok, data }. */
export async function setAlertSetting(row, value) {
  const before = cache;
  if (cache) {
    // Optimistic, so the dropdown answers at once.
    cache = row === 'digest'
      ? { ...cache, digest: value }
      : { ...cache, settings: { ...cache.settings, [row]: value } };
    notify();
  }
  const { data } = await request('/api/alert-settings', { method: 'PATCH', body: { row, value } });
  if (data) {
    cache = data;
  } else {
    cache = before;
  }
  notify();
  return { ok: !!data, data };
}

export function clearAlertSettings() {
  cache = null;
  cacheOwner = null;
  notify();
}

/** React hook: the citizen's settings (null while loading or signed out). */
export function useAlertSettings(citizenId) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  useEffect(() => {
    if (citizenId) loadAlertSettings(citizenId, { force: true });
    else clearAlertSettings();
  }, [citizenId]);
  return citizenId && cacheOwner === citizenId ? cache : null;
}
