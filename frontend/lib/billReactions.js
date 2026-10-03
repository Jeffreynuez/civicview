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
 * Backend: backend/app/routers/bill_reactions.py, mounted at
 * /api/engagement (deliberately not /api/bills, which is edge-cached).
 */

import { useEffect, useState } from 'react';

import { request } from './http';

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

// ── store ────────────────────────────────────────────────────────────
const cache = new Map();          // key -> summary
const subscribers = new Map();    // key -> Set<fn>
let queue = new Set();
let timer = null;
let identitySig = null;

function notify(key) {
  const subs = subscribers.get(key);
  if (subs) subs.forEach((fn) => fn());
}

function store(key, summary) {
  cache.set(key, summary);
  notify(key);
}

async function flush() {
  timer = null;
  const keys = [...queue];
  queue = new Set();
  for (let i = 0; i < keys.length; i += MAX_KEYS) {
    const chunk = keys.slice(i, i + MAX_KEYS);
    const { data } = await request(PATH, { query: { keys: chunk.join(',') } });
    const rows = (data && data.reactions) || {};
    chunk.forEach((k) => {
      // A failed load leaves the key uncached; the control shows its
      // buttons without counts and the next mount retries.
      if (rows[k]) store(k, rows[k]);
    });
  }
}

function want(key) {
  if (!key || cache.has(key) || queue.has(key)) return;
  queue.add(key);
  if (!timer) timer = setTimeout(flush, 25);
}

function resetIdentities(sig) {
  if (sig === identitySig) return;
  const first = identitySig === null;
  identitySig = sig;
  if (first) return;
  cache.clear();
  subscribers.forEach((_subs, key) => {
    want(key);
    notify(key);
  });
}

/**
 * The cached summary for one bill, fetched on first use.
 * `sig` identifies the signed-in identities (see BillReactions).
 */
export function useBillReaction(key, sig) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    resetIdentities(sig);
    const fn = () => setTick((t) => t + 1);
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(fn);
    want(key);
    return () => {
      const subs = subscribers.get(key);
      if (subs) {
        subs.delete(fn);
        if (subs.size === 0) subscribers.delete(key);
      }
    };
  }, [key, sig]);
  return key ? cache.get(key) || null : null;
}

/**
 * Like or dislike as one identity. Same toggle rules as post reactions:
 * the same kind again removes it, the other kind flips it. Resolves
 * { error } like every pagesApi call; on success the store updates and
 * every control showing this bill re-renders.
 */
export async function reactToBill(key, kind, asIdentity = null) {
  const res = await request(PATH, {
    method: 'POST',
    body: { bill_key: key, kind, as_identity: asIdentity || undefined },
  });
  if (res.data) store(key, res.data);
  return res;
}

/** Remove one identity's reaction. */
export async function clearBillReaction(key, asIdentity = null) {
  const res = await request(PATH, {
    method: 'DELETE',
    query: { bill_key: key, as_identity: asIdentity || undefined },
  });
  if (res.data) store(key, res.data);
  return res;
}
