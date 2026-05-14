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

// ── Token storage ─────────────────────────────────────────────────────
// Mobile browsers (Samsung Internet, Safari with ITP, etc.) block
// cross-site cookies by default, so the httpOnly cl_session /
// cl_citizen cookies the backend sets on civicview-api.onrender.com
// never make it back when the frontend on civicview.app fetches.
// As a fallback we mirror each login token into localStorage and
// attach it via `Authorization: Bearer ...` (rep) or `X-Citizen-Token`
// (citizen) on every request. The backend accepts either path.
//
// In-memory fallback handles SSR / private-mode Safari where
// localStorage may throw.
const REP_TOKEN_KEY = 'cl:rep_token';
const CITIZEN_TOKEN_KEY = 'cl:citizen_token';
const _memTokens = { rep: null, citizen: null };

function _safeStorageGet(key) {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch { return null; }
}
function _safeStorageSet(key, value) {
  try {
    if (typeof window === 'undefined') return;
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* ignore — fall back to in-memory */ }
}

export function getStoredRepToken() {
  return _memTokens.rep || _safeStorageGet(REP_TOKEN_KEY) || null;
}
export function setStoredRepToken(token) {
  _memTokens.rep = token || null;
  _safeStorageSet(REP_TOKEN_KEY, token || null);
}
export function getStoredCitizenToken() {
  return _memTokens.citizen || _safeStorageGet(CITIZEN_TOKEN_KEY) || null;
}
export function setStoredCitizenToken(token) {
  _memTokens.citizen = token || null;
  _safeStorageSet(CITIZEN_TOKEN_KEY, token || null);
}

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
    // Build headers. Cookies still ride along via credentials:'include'
    // wherever they work; the token headers are belt-and-suspenders for
    // environments that strip cross-site cookies.
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const repToken = getStoredRepToken();
    const citizenToken = getStoredCitizenToken();
    if (repToken) headers['Authorization'] = `Bearer ${repToken}`;
    if (citizenToken) headers['X-Citizen-Token'] = citizenToken;

    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
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

// ── AI features ───────────────────────────────────────────────────────
// Lightweight client wrappers for /api/ai/*. The endpoints degrade
// gracefully when ANTHROPIC_API_KEY isn't set on the server — they
// return `error: 'not_configured'` and the UI shows a "Coming soon"
// state. The frontend can short-circuit by checking aiHealth() first.
export async function aiHealth() {
  return request('/api/ai/health');
}

// Natural-language comment filter. Returns:
//   { matched_ids: number[], method: 'author'|'structured'|'semantic'|'passthrough', explanation: string }
// `method` lets the UI label the result accurately; the IDs are a
// subset of the comment list the caller already has, so the frontend
// can filter locally without re-fetching the thread.
export async function filterComments({ source, sourceId, prompt }) {
  return request('/api/ai/filter-comments', {
    method: 'POST',
    body: { source, source_id: sourceId, prompt },
  });
}

// Natural-language filter for the /polls feed. Same response shape
// as filterComments; `kind` (optional) narrows the search to a
// specific poll kind ('rep' | 'citizen' | 'standalone') and mirrors
// the chip-row selection on the /polls page.
export async function filterPolls({ prompt, kind } = {}) {
  return request('/api/ai/filter-polls', {
    method: 'POST',
    body: { prompt, kind },
  });
}

// TL;DR of a single rep post. Returns:
//   { summary: string, word_count_original: number, word_count_summary: number }
// Endpoint returns 503 when AI is unconfigured / budget-exceeded; the
// UI surfaces those as "Summary unavailable" and hides the button on
// subsequent loads via the aiHealth() probe.
export async function summarizePost(postId) {
  return request(`/api/ai/summarize-post/${encodeURIComponent(postId)}`);
}

// ── Reports (signed-in only) ─────────────────────────────────────────
// Backend gates these to a valid rep or citizen session (401 anon).
// Idempotent per (target, reporter) — re-clicking returns
// already_reported=true rather than 500ing on the unique index.
export async function reportPost(postId, { reason = 'other', detail } = {}) {
  return request(`/api/pages/posts/${encodeURIComponent(postId)}/reports`, {
    method: 'POST',
    body: { reason, detail },
  });
}

export async function reportComment(commentId, { reason = 'other', detail } = {}) {
  return request(`/api/pages/comments/${encodeURIComponent(commentId)}/reports`, {
    method: 'POST',
    body: { reason, detail },
  });
}

// Poll-comment moderation. Backend is /api/citizen-polls/comments/{id}
// (delete) and /reports (report) — author-only delete, signed-in
// non-self report, idempotent on dedup. Same shape as the rep-post
// comment endpoints; we keep the helpers separate so the frontend
// call sites stay readable.
export async function deletePollComment(commentId) {
  return request(`/api/citizen-polls/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
  });
}

export async function reportPollComment(commentId, { reason = 'other', detail } = {}) {
  return request(`/api/citizen-polls/comments/${encodeURIComponent(commentId)}/reports`, {
    method: 'POST',
    body: { reason, detail },
  });
}

// ── Admin moderation queue ──────────────────────────────────────────
// Endpoints under /api/admin/* gated by an ADMIN_EMAILS env-var
// allowlist server-side. The whoami probe is the cheapest signal
// to gate UI on; the queue and actions are admin-only.
export async function adminWhoami() {
  return request('/api/admin/whoami');
}

export async function adminListReports({ includeActed = false } = {}) {
  return request('/api/admin/reports', {
    query: { include_acted: includeActed ? 'true' : undefined },
  });
}

export async function adminDismissReport(kind, reportId) {
  return request(
    `/api/admin/reports/${encodeURIComponent(kind)}/${encodeURIComponent(reportId)}/dismiss`,
    { method: 'POST' },
  );
}

export async function adminHideTarget(kind, reportId) {
  return request(
    `/api/admin/reports/${encodeURIComponent(kind)}/${encodeURIComponent(reportId)}/hide`,
    { method: 'POST' },
  );
}

export async function adminUnhideTarget(kind, targetId) {
  return request(
    `/api/admin/targets/${encodeURIComponent(kind)}/${encodeURIComponent(targetId)}/unhide`,
    { method: 'POST' },
  );
}

// Suspend / unsuspend a user account. `kind` is 'rep' | 'citizen';
// `userId` is the account row id (returned in ReportRow.target_author_id).
// `cascadeHide=true` ALSO soft-deletes every piece of content this user
// has currently visible (posts, comments, citizen polls, poll comments).
export async function adminSuspendUser(kind, userId, { reason, cascadeHide = false } = {}) {
  return request(
    `/api/admin/users/${encodeURIComponent(kind)}/${encodeURIComponent(userId)}/suspend`,
    { method: 'POST', body: { reason, cascade_hide: cascadeHide } },
  );
}

export async function adminUnsuspendUser(kind, userId) {
  return request(
    `/api/admin/users/${encodeURIComponent(kind)}/${encodeURIComponent(userId)}/unsuspend`,
    { method: 'POST' },
  );
}

// Lightweight count for the navbar badge. Polled every ~30s when
// an admin is signed in; doesn't pull the full report list.
export async function adminUnreadCount() {
  return request('/api/admin/reports/unread-count');
}

// List all suspended user accounts (rep + citizen) for the admin
// /admin/users page. Newest suspension first, capped at 200.
export async function adminListSuspendedUsers() {
  return request('/api/admin/users/suspended');
}

// ── Home-page feed (National activity + Popular polls) ───────────────
// Lightweight aggregates that power the two large landing-page
// sections in NationalOfficialsPanel. Both return { items: [...] }
// with an empty array when no data has been authored yet — the
// frontend renders an empty state in that case instead of stale
// demo content.
export async function fetchNationalActivity({ limit = 6 } = {}) {
  return request('/api/feed/national-activity', { query: { limit } });
}

export async function fetchPopularPolls({ limit = 9 } = {}) {
  return request('/api/feed/popular-polls', { query: { limit } });
}

// Full polls feed — every active poll across the app (rep + citizen +
// standalone). Used by the /polls page. Supports a kind filter
// ('rep' | 'citizen' | 'standalone'); omit to get everything.
export async function fetchPollsFeed({ limit = 100, kind } = {}) {
  return request('/api/feed/polls', { query: { limit, kind } });
}

// Create a standalone citizen poll (no target rep page). Returns the
// freshly-created CitizenPollRead with vote counts at 0. Per-citizen
// cap of 1 standalone active at a time is enforced server-side; a
// 400 with a clear detail message comes back if the cap is hit.
export async function createStandalonePoll({ question, options, closesAt, presentationMode } = {}) {
  return request('/api/citizen-polls', {
    method: 'POST',
    body: {
      poll: {
        question,
        options: options.map((label) => ({ text: label })),
        closes_at: closesAt || null,
        presentation_mode: presentationMode || 'full',
      },
    },
  });
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
    // Same Authorization fallback as request() — mobile browsers
    // strip cross-site cookies, so we have to carry the rep token in
    // the Bearer header for the image upload to authenticate too.
    const headers = {};
    const repToken = getStoredRepToken();
    if (repToken) headers['Authorization'] = `Bearer ${repToken}`;
    const res = await fetch(`${API_BASE_URL}/api/pages/images/upload`, {
      method: 'POST',
      credentials: 'include',
      body: form,
      headers: Object.keys(headers).length ? headers : undefined,
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
// Session model: ONE active role per browser. The backend uses
// distinct cookies (`cl_session` for reps, `cl_citizen` for citizens)
// and we keep distinct Bearer tokens in localStorage, but on the
// client we treat them as mutually exclusive — logging in as one
// role explicitly tears down the other's session. Without this an
// orphaned rep token from a previous session would leak through
// every request the citizen makes, making the backend report
// `is_owner=true` and surfacing rep-only affordances (the post
// composer, comment Delete buttons) to non-rep viewers.
//
// To switch roles deliberately: sign out, then sign in as the
// other role. Or use a second browser / incognito tab.
async function _tearDownOtherRole(otherEndpoint, clearFn) {
  // Fire-and-forget — we don't block the new login on whether the
  // cleanup call succeeds. The localStorage clear happens
  // regardless so a network failure doesn't leave a stale token
  // in place client-side.
  try {
    await request(otherEndpoint, { method: 'POST' });
  } catch { /* ignore */ }
  clearFn(null);
}

export async function login(email, password) {
  // Tear down any active citizen session before we mint a rep one.
  await _tearDownOtherRole('/api/citizen-auth/logout', setStoredCitizenToken);
  const result = await request('/api/auth/login', {
    method: 'POST', body: { email, password },
  });
  // Persist the mirror token so subsequent requests can authenticate
  // via Authorization: Bearer when the httpOnly cookie path is
  // blocked (cross-site cookie restrictions on mobile).
  if (result?.data?.session_token) {
    setStoredRepToken(result.data.session_token);
  }
  return result;
}

export async function logout() {
  // Belt-and-suspenders: clear BOTH role tokens on either logout
  // path. Defensive against the case where a previous session was
  // left in a half-clean state.
  const result = await request('/api/auth/logout', { method: 'POST' });
  setStoredRepToken(null);
  await _tearDownOtherRole('/api/citizen-auth/logout', setStoredCitizenToken);
  return result;
}

export async function fetchMe() {
  return request('/api/auth/me');
}

// ── Citizen auth (demo) ───────────────────────────────────────────────
// Parallel rep-auth surface. See the comment block above _tearDownOtherRole
// for the mutually-exclusive session contract — we tear down any active
// rep session before minting a citizen one, and vice versa.
export async function loginCitizenApi(email, password) {
  await _tearDownOtherRole('/api/auth/logout', setStoredRepToken);
  const result = await request('/api/citizen-auth/login', {
    method: 'POST', body: { email, password },
  });
  if (result?.data?.citizen_token) {
    setStoredCitizenToken(result.data.citizen_token);
  }
  return result;
}

// Self-serve demo signup. Mints a fresh CitizenAccount (verified=False)
// and auto-logs the caller in. Returns the freshly-generated email +
// password alongside the standard login payload so the UI can show
// the user their credentials (they're persisted; the user can come
// back and sign in with them from any device).
export async function signupDemoCitizen({
  displayName, state, congressionalDistrict, city,
} = {}) {
  // Same mutually-exclusive contract as loginCitizenApi.
  await _tearDownOtherRole('/api/auth/logout', setStoredRepToken);
  const result = await request('/api/citizen-auth/demo-signup', {
    method: 'POST',
    body: {
      display_name: displayName,
      state: state || null,
      congressional_district: congressionalDistrict || null,
      city: city || null,
    },
  });
  if (result?.data?.citizen_token) {
    setStoredCitizenToken(result.data.citizen_token);
  }
  return result;
}

export async function logoutCitizenApi() {
  // Same belt-and-suspenders cleanup as the rep logout: clear BOTH
  // tokens so a previous half-clean state can't linger.
  const result = await request('/api/citizen-auth/logout', { method: 'POST' });
  setStoredCitizenToken(null);
  await _tearDownOtherRole('/api/auth/logout', setStoredRepToken);
  return result;
}

export async function fetchCitizenMe() {
  return request('/api/citizen-auth/me');
}

// ── Citizen polls (on unclaimed rep pages) ────────────────────────────
// The page-scoped list endpoint returns active + archived buckets, the
// caller's role, and the rate-limit signals (caller_has_active_poll,
// active_count, active_cap) so the create button knows whether to
// disable itself before the user types a question.
export async function fetchCitizenPolls(officialId, { scope } = {}) {
  if (!officialId) return { data: null, error: 'officialId is required', status: 0 };
  return request(`/api/pages/${encodeURIComponent(officialId)}/citizen-polls`, {
    query: { scope },
  });
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
