'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Bill likes and dislikes: API calls plus a small shared store.
 *
 * A rep profile's Bills tab can list dozens of bills, so components
 * don't fetch one bill at a time. Each BillReactions control asks the
 * store for its key; the store collects the keys asked for in the same
 * tick and fetches them in one request (up to 100 per request, the
 * backend's limit). Every control showing the same bill reads the same
 * cached summary, so a like on the /bills page and on the profile
 * stay in step.
 *
 * The summary carries the caller's own reaction per identity, so the
 * cache is dropped whenever the set of signed-in identities changes
 * (sign in, sign out, a second identity added).
 *
 * State and district counts: pass a geography (normalizeGeo) and the
 * summary also carries scoped.state / scoped.district. Entries are kept
 * per (bill, geography), and requests are batched per geography.
 *
 * Backend: backend/app/routers/bill_reactions.py, mounted at
 * /api/engagement (deliberately not /api/bills, which is edge-cached).
 */

import { useEffect, useState } from 'react';

import { request } from './http';
import { isAtLarge } from './usStates';

const PATH = '/api/engagement/bills/reactions';
const MAX_KEYS = 100;

// Same formats the backend accepts (BILL_KEY_RE): federal
// "{congress}-{type}-{number}" and Open States "ocd-bill/<uuid>".
const FEDERAL_RE = /^\d{2,3}-(?:hr|s|hjres|sjres|hconres|sconres|hres|sres)-\d{1,5}$/;
const STATE_RE = /^ocd-bill\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Canonical key for any bill id we show, or null when it isn't one. */
export function normalizeBillKey(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return FEDERAL_RE.test(key) || STATE_RE.test(key) ? key : null;
}

/**
 * Key from a printed citation, e.g. (119, "S. 2403") -> "119-s-2403",
 * (119, "H.J.Res. 5") -> "119-hjres-5". Null for anything that is not a
 * bill or resolution (nominations, procedural votes, amendments).
 */
export function billKeyFromCitation(congress, citation) {
  if (!congress || !citation) return null;
  const m = String(citation).toLowerCase().replace(/[.\s]/g, '')
    .match(/^(hr|s|hjres|sjres|hconres|sconres|hres|sres)(\d{1,5})$/);
  if (!m) return null;
  return normalizeBillKey(`${congress}-${m[1]}-${m[2]}`);
}

/**
 * A geography for the State / District counts, or null. Accepts
 * { state: 'FL', district: 'FL-17' } (district optional); anything that
 * isn't a two-letter state and an "XX-N" (or at-large "XX-AL") district
 * in that state is dropped, so the request never 422s on odd profile
 * data.
 */
export function normalizeGeo(geo) {
  if (!geo) return null;
  const state = String(geo.state || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return null;
  const district = String(geo.district || '').trim().toUpperCase();
  return {
    state,
    district: /^[A-Z]{2}-(?:\d{1,2}|AL)$/.test(district) && district.startsWith(`${state}-`) ? district : null,
  };
}

/**
 * Geography of a profile's member: state, plus the House seat: "XX-N",
 * or "XX-AL" for an at-large state, DC or a territory (citizens there
 * store the same, see lib/usStates.js).
 */
export function geoForMember(member, { withDistrict = true } = {}) {
  if (!member) return null;
  const state = String(member.state || '').trim().toUpperCase();
  const n = Number(member.district);
  const house = String(member.chamber || '').toLowerCase().includes('house');
  let district = null;
  if (withDistrict && house) {
    if (isAtLarge(state)) district = `${state}-AL`;
    else if (Number.isInteger(n) && n > 0) district = `${state}-${n}`;
  }
  return normalizeGeo({ state, district });
}

// ── store ────────────────────────────────────────────────────────────
// Entries are per (bill, geography): the same bill can be on screen
// with the rep's geography on a profile and the viewer's on /bills.
const cache = new Map();          // entryId -> summary
const stale = new Set();          // entryIds shown but due a refetch
const subscribers = new Map();    // entryId -> Set<fn>
const queues = new Map();         // geoSig -> Set<key>
let timer = null;
let identitySig = null;

const geoSig = (geo) => (geo ? `${geo.state}|${geo.district || ''}` : '');
const entryId = (key, geo) => `${key}#${geoSig(geo)}`;
const geoFromSig = (sig) => {
  if (!sig) return null;
  const [state, district] = sig.split('|');
  return { state, district: district || null };
};
const geoQuery = (geo) => (geo ? { state: geo.state, district: geo.district || undefined } : {});

function notify(id) {
  const subs = subscribers.get(id);
  if (subs) subs.forEach((fn) => fn());
}

function want(key, geo) {
  const id = entryId(key, geo);
  if (!key || (cache.has(id) && !stale.has(id))) return;
  const sig = geoSig(geo);
  if (!queues.has(sig)) queues.set(sig, new Set());
  queues.get(sig).add(key);
  if (!timer) timer = setTimeout(flush, 25);
}

async function flush() {
  timer = null;
  const batches = [...queues.entries()];
  queues.clear();
  for (const [sig, keySet] of batches) {
    const geo = geoFromSig(sig);
    const keys = [...keySet];
    for (let i = 0; i < keys.length; i += MAX_KEYS) {
      const chunk = keys.slice(i, i + MAX_KEYS);
      const { data } = await request(PATH, { query: { keys: chunk.join(','), ...geoQuery(geo) } });
      const rows = (data && data.reactions) || {};
      chunk.forEach((k) => {
        // A failed load leaves the entry uncached; the control shows
        // its buttons without counts and the next mount retries.
        if (rows[k]) {
          cache.set(entryId(k, geo), rows[k]);
          stale.delete(entryId(k, geo));
          notify(entryId(k, geo));
        }
      });
    }
  }
}

// After a write, the response is fresh for its own geography; every
// other cached geography of that bill is stale. The ones on screen keep
// showing their old numbers until a refetch replaces them (no flicker);
// the rest are dropped.
function storeAfterWrite(key, geo, summary) {
  const fresh = entryId(key, geo);
  cache.set(fresh, summary);
  stale.delete(fresh);
  notify(fresh);
  [...cache.keys()].forEach((id) => {
    if (id !== fresh && id.startsWith(`${key}#`)) {
      if (subscribers.has(id)) {
        stale.add(id);
        want(key, geoFromSig(id.slice(key.length + 1)));
      } else {
        cache.delete(id);
      }
    }
  });
}

function resetIdentities(sig) {
  if (sig === identitySig) return;
  const first = identitySig === null;
  identitySig = sig;
  if (first) return;
  cache.clear();
  stale.clear();
  subscribers.forEach((_subs, id) => {
    const cut = id.indexOf('#');
    want(id.slice(0, cut), geoFromSig(id.slice(cut + 1)));
    notify(id);
  });
}

/**
 * The cached summary for one bill, fetched on first use (batched with
 * every other bill on screen). `sig` identifies the signed-in
 * identities; `geo` (normalizeGeo) adds the State / District counts.
 */
export function useBillReaction(key, sig, geo = null) {
  const [, setTick] = useState(0);
  const gSig = geoSig(geo);
  useEffect(() => {
    if (!key) return undefined;
    resetIdentities(sig);
    const g = geoFromSig(gSig);
    const id = entryId(key, g);
    const fn = () => setTick((t) => t + 1);
    if (!subscribers.has(id)) subscribers.set(id, new Set());
    subscribers.get(id).add(fn);
    want(key, g);
    return () => {
      const subs = subscribers.get(id);
      if (subs) {
        subs.delete(fn);
        if (subs.size === 0) subscribers.delete(id);
      }
    };
  }, [key, sig, gSig]);
  return key ? cache.get(entryId(key, geo)) || null : null;
}

/**
 * Like or dislike as one identity. Same toggle rules as post reactions:
 * the same kind again removes it, the other kind flips it. Resolves
 * { error } like every pagesApi call; on success the store updates and
 * every control showing this bill re-renders.
 */
export async function reactToBill(key, kind, asIdentity = null, geo = null) {
  const res = await request(PATH, {
    method: 'POST',
    body: { bill_key: key, kind, as_identity: asIdentity || undefined, ...geoQuery(geo) },
  });
  if (res.data) storeAfterWrite(key, geo, res.data);
  return res;
}

/** Remove one identity's reaction. */
export async function clearBillReaction(key, asIdentity = null, geo = null) {
  const res = await request(PATH, {
    method: 'DELETE',
    query: { bill_key: key, as_identity: asIdentity || undefined, ...geoQuery(geo) },
  });
  if (res.data) storeAfterWrite(key, geo, res.data);
  return res;
}
