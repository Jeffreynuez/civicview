// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Pages feature API client.
 *
 * All fetches use `credentials: 'include'` so the httpOnly session
 * cookie set by POST /api/auth/login rides along on subsequent calls
 * without the frontend having to touch it.
 *
 * Response convention mirrors lib/api.js: `{ data, error }` tuples so
 * callers don't need try/catch around every fetch.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function request(path, { method = 'GET', body, query } = {}) {
  try {
    let url = `${API_BASE_URL}${path}`;
    if (query) {
      const q = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
      );
      const qs = q.toString();
      if (qs) url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const payload = await res.json();
        detail = payload?.detail || payload?.error || res.statusText;
        if (Array.isArray(detail)) detail = detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
      } catch {
        detail = res.statusText;
      }
      return { data: null, error: detail || `HTTP ${res.status}`, status: res.status };
    }
    if (res.status === 204) return { data: null, error: null, status: 204 };
    const data = await res.json();
    return { data, error: null, status: res.status };
  } catch (e) {
    return { data: null, error: e?.message || 'Network error', status: 0 };
  }
}

// ── Page payload ──────────────────────────────────────────────────────
export async function fetchPage(officialId, { voterToken, scope } = {}) {
  if (!officialId) return { data: null, error: 'officialId is required', status: 0 };
  return request(`/api/pages/${encodeURIComponent(officialId)}`, {
    query: { voter_token: voterToken, scope },
  });
}

// ── Owner dashboard (Step 7) ────────────────────────────────────────
// Aggregated engagement rollup across all of the official's posts.
// 403s for non-owner reps; UI only exposes this to the page owner.
export async function fetchOwnerDashboard(officialId, { scope } = {}) {
  if (!officialId) return { data: null, error: 'officialId is required', status: 0 };
  return request(`/api/pages/${encodeURIComponent(officialId)}/dashboard`, {
    query: { scope },
  });
}

// ── Post images (rep-gated upload, public read) ──────────────────────
// Multipart upload. Returns {id, url, content_type, sort_order}; the
// `url` is a relative path that resolveImageUrl() prefixes with the
// API base so the <img src> works cross-origin in dev.
export async function uploadPostImage(file) {
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE_URL}/api/pages/images/upload`, {
      method: 'POST',
      credentials: 'include',
      body: form,
      // NOTE: do NOT set Content-Type here — the browser will set the
      // multipart boundary automatically.
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail; } catch { detail = res.statusText; }
      return { data: null, error: detail || `HTTP ${res.status}`, status: res.status };
    }
    const data = await res.json();
    return { data, error: null, status: res.status };
  } catch (e) {
    return { data: null, error: e?.message || 'Upload failed', status: 0 };
  }
}

export function resolveImageUrl(url) {
  // The backend returns paths like "/api/pages/images/42". Concat with
  // the configured API base so images load cross-origin in dev.
  if (!url) return '';
  if (url.startsWith('http')) return url;  // already absolute
  return `${API_BASE_URL}${url}`;
}

// ── Reactions (citizen-gated) ────────────────────────────────────────
export async function reactToPost(postId, kind) {
  return request(`/api/pages/posts/${postId}/reactions`, {
    method: 'POST', body: { kind },
  });
}

export async function clearReaction(postId) {
  return request(`/api/pages/posts/${postId}/reactions`, { method: 'DELETE' });
}

// ── Comments ────────────────────────────────────────────────────────
export async function listComments(postId, { scope, sort, filterBy, limit } = {}) {
  return request(`/api/pages/posts/${postId}/comments`, {
    // Server expects `filter_by` (snake case). We translate so callers
    // can use the camelCase convention the rest of this module uses.
    query: { scope, sort, filter_by: filterBy, limit },
  });
}

export async function createComment(postId, body) {
  return request(`/api/pages/posts/${postId}/comments`, {
    method: 'POST', body: { body },
  });
}

export async function deleteComment(commentId) {
  return request(`/api/pages/comments/${commentId}`, { method: 'DELETE' });
}

// ── Comment reactions (citizen-gated) ───────────────────────────────
export async function reactToComment(commentId, kind) {
  return request(`/api/pages/comments/${commentId}/reactions`, {
    method: 'POST', body: { kind },
  });
}

export async function clearCommentReaction(commentId) {
  return request(`/api/pages/comments/${commentId}/reactions`, { method: 'DELETE' });
}

// ── Post CRUD ─────────────────────────────────────────────────────────
export async function createPost(officialId, { body, poll, imageIds } = {}) {
  return request(`/api/pages/${encodeURIComponent(officialId)}/posts`, {
    method: 'POST',
    body: {
      body,
      poll: poll || null,
      // Backend expects snake_case. Order preserved by the caller —
      // gallery will render in the same order as this array.
      image_ids: Array.isArray(imageIds) ? imageIds : [],
    },
  });
}

export async function deletePost(postId) {
  return request(`/api/pages/posts/${postId}`, { method: 'DELETE' });
}

// ── Poll vote ─────────────────────────────────────────────────────────
export async function votePoll(officialId, pollId, { optionId, voterToken }) {
  return request(
    `/api/pages/${encodeURIComponent(officialId)}/polls/${pollId}/vote`,
    { method: 'POST', body: { option_id: optionId, voter_token: voterToken } },
  );
}

// ── Rep events ────────────────────────────────────────────────────────
export async function createRepEvent(officialId, payload) {
  return request(`/api/pages/${encodeURIComponent(officialId)}/events`, {
    method: 'POST', body: payload,
  });
}

export async function deleteRepEvent(eventId) {
  return request(`/api/pages/events/${eventId}`, { method: 'DELETE' });
}

// ── Auth ──────────────────────────────────────────────────────────────
export async function login(email, password) {
  return request('/api/auth/login', {
    method: 'POST', body: { email, password },
  });
}

export async function logout() {
  return request('/api/auth/logout', { method: 'POST' });
}

export async function fetchMe() {
  return request('/api/auth/me');
}

// ── Citizen auth (demo) ───────────────────────────────────────────────
// Parallel rep-auth surface — the two endpoints set distinct cookies
// (`cl_session` for reps, `cl_citizen` for citizens) so the same browser
// can carry both at once and a component can ask "who's the rep?" and
// "who's the citizen?" independently.
export async function loginCitizenApi(email, password) {
  return request('/api/citizen-auth/login', {
    method: 'POST', body: { email, password },
  });
}

export async function logoutCitizenApi() {
  return request('/api/citizen-auth/logout', { method: 'POST' });
}

export async function fetchCitizenMe() {
  return request('/api/citizen-auth/me');
}

// ── Citizen polls (on unclaimed rep pages) ────────────────────────────
// The page-scoped list endpoint returns active + archived buckets, the
// caller's role, and the rate-limit signals (caller_has_active_poll,
// active_count, active_cap) so the create button knows whether to
// disable itself before the user types a question.
export async function fetchCitizenPolls(officialId) {
  if (!officialId) return { data: null, error: 'officialId is required', status: 0 };
  return request(`/api/pages/${encodeURIComponent(officialId)}/citizen-polls`);
}

export async function createCitizenPoll(officialId, pollPayload) {
  // pollPayload is the same shape as the rep PollCreate (question +
  // options + closes_at + presentation_mode). The backend wraps it
  // under a top-level `poll` key so the request shape stays parallel
  // with PostCreate where polls hang under the post.
  return request(`/api/pages/${encodeURIComponent(officialId)}/citizen-polls`, {
    method: 'POST',
    body: { poll: pollPayload },
  });
}

export async function voteOnCitizenPoll(pollId, optionId) {
  return request(`/api/citizen-polls/${pollId}/vote`, {
    method: 'POST',
    body: { option_id: optionId },
  });
}

export async function closeCitizenPoll(pollId) {
  return request(`/api/citizen-polls/${pollId}/close`, { method: 'POST' });
}

export async function reportCitizenPoll(pollId, { reason, detail } = {}) {
  return request(`/api/citizen-polls/${pollId}/report`, {
    method: 'POST',
    body: { reason, detail: detail || null },
  });
}

export async function listCitizenPollComments(pollId) {
  return request(`/api/citizen-polls/${pollId}/comments`);
}

export async function createCitizenPollComment(pollId, body) {
  return request(`/api/citizen-polls/${pollId}/comments`, {
    method: 'POST',
    body: { body },
  });
}

export async function dismissPreClaimArchive(officialId) {
  return request(
    `/api/pages/${encodeURIComponent(officialId)}/citizen-polls/dismiss-archive`,
    { method: 'POST' },
  );
}

// "My polls" tab on the citizen dashboard. status='active'|'archived'|'all'.
export async function fetchMyCitizenPolls({ status = 'all' } = {}) {
  return request('/api/citizens/me/polls', { query: { status } });
}

// ── Citizen waitlist ──────────────────────────────────────────────────
// `note` is used by the claim-this-page flow to carry the requester's
// legal name + relationship to the official; the citizen waitlist path
// leaves it undefined.
export async function joinWaitlist({ email, clickedFrom, state, note } = {}) {
  return request('/api/waitlist', {
    method: 'POST',
    body: {
      email,
      clicked_from: clickedFrom,
      state: state || null,
      note: note || null,
    },
  });
}
