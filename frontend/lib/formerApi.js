// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Former officials and candidates (2026-10-15). Client for the former
 * account's dashboard, the citizen card with its Served as line, the
 * former members of Congress for search, and the admin Transitions tab.
 * Same { data, error } convention as pagesApi.js.
 */
import { getJson, request } from './http';

// ── Former account (signed in as the rep or candidate) ──────────────
export function fetchFormerMe() {
  return request('/api/former/me');
}

export function linkCitizenAccount() {
  return request('/api/former/link', { method: 'POST' });
}

export function unlinkCitizenAccount() {
  return request('/api/former/unlink', { method: 'POST' });
}

/** { name?, copies?, served_as? }: only the keys you pass change. */
export function setFormerOptins(choices) {
  return request('/api/former/optins', { method: 'PUT', body: choices });
}

// ── Citizen side ─────────────────────────────────────────────────────
export function fetchCitizenCard(citizenId) {
  return request(`/api/former/citizen-card/${encodeURIComponent(citizenId)}`);
}

export function fetchMyServedAs() {
  return request('/api/former/citizen/served-as');
}

export function removeMyServedAs() {
  return request('/api/former/citizen/served-as/remove', { method: 'POST' });
}

// ── Search: former members of Congress the roster no longer lists ───
let _formerIndex = null;
export async function fetchFormerSearchIndex() {
  if (_formerIndex) return _formerIndex;
  try {
    const data = await getJson('/api/former/search-index');
    _formerIndex = data.members || [];
  } catch {
    _formerIndex = [];
  }
  return _formerIndex;
}

// ── Admin: Transitions tab ───────────────────────────────────────────
export function adminListTransitions({ stage, q, limit } = {}) {
  return request('/api/admin/transitions', { query: { stage, q, limit } });
}

export function adminTransitionDetail(pageId) {
  return request(`/api/admin/transitions/page/${encodeURIComponent(pageId)}`);
}

export function adminSetTransition(body) {
  return request('/api/admin/transitions', { method: 'POST', body });
}

export function adminRunTransitions() {
  return request('/api/admin/transitions/run', { method: 'POST' });
}

// What the daily job would send today, before anything is sent
// (2026-10-16).
export function adminPreviewTransitionsRun() {
  return request('/api/admin/transitions/run/preview');
}

export function adminApproveHandoff({ campaignPageId, officialPageId, role }) {
  return request('/api/admin/transitions/handoff', {
    method: 'POST',
    body: { campaign_page_id: campaignPageId, official_page_id: officialPageId, role: role || undefined },
  });
}

export function adminNameReviews() {
  return request('/api/admin/transitions/name-reviews');
}

export function adminDecideName(linkId, { decision, sourceUrl }) {
  return request(`/api/admin/transitions/name-reviews/${encodeURIComponent(linkId)}`, {
    method: 'POST', body: { decision, source_url: sourceUrl },
  });
}
