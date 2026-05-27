// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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
// cl_citizen / cl_candidate cookies the backend sets on
// civicview-api.onrender.com never make it back when the frontend
// on civicview.app fetches. As a fallback we mirror each login
// token into localStorage and attach it via:
//   • `Authorization: Bearer ...`   (rep)
//   • `X-Citizen-Token: <token>`    (citizen)
//   • `X-Candidate-Token: <token>`  (candidate)
// on every request. The backend accepts either cookies or headers.
//
// In-memory fallback handles SSR / private-mode Safari where
// localStorage may throw.
const REP_TOKEN_KEY = 'cl:rep_token';
const CITIZEN_TOKEN_KEY = 'cl:citizen_token';
const CANDIDATE_TOKEN_KEY = 'cl:candidate_token';
const _memTokens = { rep: null, citizen: null, candidate: null };

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
export function getStoredCandidateToken() {
  return _memTokens.candidate || _safeStorageGet(CANDIDATE_TOKEN_KEY) || null;
}
export function setStoredCandidateToken(token) {
  _memTokens.candidate = token || null;
  _safeStorageSet(CANDIDATE_TOKEN_KEY, token || null);
}

// ── CSRF storage (Task #31) ──────────────────────────────────────────
// Per-identity CSRF tokens. Each is HMAC(SESSION_SECRET, session_token)
// computed by the backend at login time and on /api/csrf. The frontend
// stores all three and attaches the appropriate one as X-CSRF-Token on
// non-GET fetches. If the request carries multiple auth tokens (multi-
// identity browser), preference order is rep → citizen → candidate —
// arbitrary but stable; the backend's middleware accepts a match
// against any active session.
const REP_CSRF_KEY = 'cl:rep_csrf';
const CITIZEN_CSRF_KEY = 'cl:citizen_csrf';
const CANDIDATE_CSRF_KEY = 'cl:candidate_csrf';
const _memCsrfs = { rep: null, citizen: null, candidate: null };

export function getStoredRepCsrf() {
  return _memCsrfs.rep || _safeStorageGet(REP_CSRF_KEY) || null;
}
export function setStoredRepCsrf(value) {
  _memCsrfs.rep = value || null;
  _safeStorageSet(REP_CSRF_KEY, value || null);
}
export function getStoredCitizenCsrf() {
  return _memCsrfs.citizen || _safeStorageGet(CITIZEN_CSRF_KEY) || null;
}
export function setStoredCitizenCsrf(value) {
  _memCsrfs.citizen = value || null;
  _safeStorageSet(CITIZEN_CSRF_KEY, value || null);
}
export function getStoredCandidateCsrf() {
  return _memCsrfs.candidate || _safeStorageGet(CANDIDATE_CSRF_KEY) || null;
}
export function setStoredCandidateCsrf(value) {
  _memCsrfs.candidate = value || null;
  _safeStorageSet(CANDIDATE_CSRF_KEY, value || null);
}

// Pick the right CSRF for a request based on which auth tokens are
// loaded. Returns null when no identity is signed in (anonymous
// requests don't need a CSRF — the backend middleware skips the
// check on no-session paths). Preference order matches the auth
// header attachment order in request() below.
function _pickActiveCsrf() {
  if (getStoredRepToken() && getStoredRepCsrf()) return getStoredRepCsrf();
  if (getStoredCitizenToken() && getStoredCitizenCsrf()) return getStoredCitizenCsrf();
  if (getStoredCandidateToken() && getStoredCandidateCsrf()) return getStoredCandidateCsrf();
  return null;
}

// Fetch /api/csrf and persist all three tokens. Called on:
//   • A 403 csrf_token_mismatch response (auto-recovery, see request()).
//   • Explicit invocation from auth flows after login / logout to keep
//     the CSRF store fresh alongside the session tokens themselves.
// Safe to call at any time. Always returns a Promise that resolves
// once storage is updated (or quietly resolves on network error so
// callers can retry on their own schedule).
export async function fetchCsrf() {
  try {
    const repToken = getStoredRepToken();
    const citizenToken = getStoredCitizenToken();
    const candidateToken = getStoredCandidateToken();
    const headers = {};
    if (repToken) headers['Authorization'] = `Bearer ${repToken}`;
    if (citizenToken) headers['X-Citizen-Token'] = citizenToken;
    if (candidateToken) headers['X-Candidate-Token'] = candidateToken;
    const res = await fetch(`${API_BASE_URL}/api/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
    });
    if (!res.ok) return;
    const data = await res.json();
    setStoredRepCsrf(data?.rep_csrf || null);
    setStoredCitizenCsrf(data?.citizen_csrf || null);
    setStoredCandidateCsrf(data?.candidate_csrf || null);
  } catch {
    // Network error — leave whatever's in storage. Next non-GET
    // attempt will retry via the 403-recovery path in request().
  }
}

// Methods that need CSRF protection on the client side. GET/HEAD/OPTIONS
// don't carry CSRF — the backend skips the check on safe methods.
const _UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Internal worker that does the actual fetch. Pulled out of request()
// so the csrf-mismatch retry path can re-invoke it without re-running
// the URL/query-string assembly.
async function _doFetch(url, method, body, extraCsrfOverride) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const repToken = getStoredRepToken();
  const citizenToken = getStoredCitizenToken();
  const candidateToken = getStoredCandidateToken();
  if (repToken) headers['Authorization'] = `Bearer ${repToken}`;
  if (citizenToken) headers['X-Citizen-Token'] = citizenToken;
  if (candidateToken) headers['X-Candidate-Token'] = candidateToken;
  // Attach CSRF on non-GET. extraCsrfOverride lets the retry path
  // force-use a freshly-fetched token without re-reading storage.
  if (_UNSAFE_METHODS.has(method.toUpperCase())) {
    const csrf = extraCsrfOverride !== undefined ? extraCsrfOverride : _pickActiveCsrf();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  return fetch(url, {
    method,
    credentials: 'include',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function request(path, { method = 'GET', body, query } = {}) {
  try {
    let url = `${API_BASE_URL}${path}`;
    if (query) {
      // Build the query string by hand so array values append repeated
      // params (e.g. { kind: ['rep', 'standalone'] } → "?kind=rep&kind=standalone").
      // URLSearchParams's array support is implementation-specific, so
      // we iterate explicitly to keep behavior identical across runtimes.
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item === undefined || item === null || item === '') continue;
            q.append(k, String(item));
          }
        } else {
          q.append(k, String(v));
        }
      }
      const qs = q.toString();
      if (qs) url += `?${qs}`;
    }
    let res = await _doFetch(url, method, body);

    // CSRF auto-recovery (Task #31). If the backend rejects with
    // 403 + code='csrf_token_mismatch' (stale stored CSRF, session
    // rotated, fresh browser tab on an existing session, etc.),
    // fetch a fresh batch from /api/csrf and retry the original
    // request ONCE. If the retry still fails, fall through to the
    // normal error path so the caller sees a real failure.
    if (res.status === 403 && _UNSAFE_METHODS.has(method.toUpperCase())) {
      let code = null;
      // Peek at the body without consuming res twice — clone.
      try {
        const peek = await res.clone().json();
        code = peek?.code || null;
      } catch { /* not JSON, fall through */ }
      if (code === 'csrf_token_mismatch') {
        await fetchCsrf();
        res = await _doFetch(url, method, body);
      }
    }

    if (!res.ok) {
      let detail = '';
      let parsedPayload = null;
      try {
        parsedPayload = await res.json();
        detail = parsedPayload?.detail || parsedPayload?.error || res.statusText;
        if (Array.isArray(detail)) {
          detail = detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
        }
        // Structured detail (Task #56 revision — 423 Locked carries
        // {message, code, locked_until} so the UI can render a
        // countdown). Extract a string for the `error` field; the
        // full object is still available via `payload` below.
        if (detail && typeof detail === 'object') {
          detail = detail.message || detail.detail || JSON.stringify(detail);
        }
      } catch {
        detail = res.statusText;
      }
      return {
        data: null,
        error: detail || `HTTP ${res.status}`,
        status: res.status,
        payload: parsedPayload,
      };
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
//
// In-flight dedupe: adminWhoami fires from Force2FAGate (root layout),
// Navbar (mounted 10+ places — main page, polls, PageView, dashboard,
// FeedbackView, HelpBuildThisView, LegalPageLayout, /admin landing,
// account/delete branches, etc.), and the /admin page itself. On a
// typical signed-in page load that's 3-4 simultaneous identical
// requests in the same tick. They overwhelm uvicorn's request queue
// on Render and a fraction return 429 from Render's edge — and edge
// 429s ship without our FastAPI CORSMiddleware headers, so the
// browser flags them as CORS errors. Hence "429 + CORS storm" in
// DevTools when really it's a frontend over-fetch.
//
// Fix: a module-level in-flight promise. When N callers race in the
// same tick, the first one creates the fetch promise; the next N-1
// receive the same promise. Once it resolves (success OR failure),
// `_adminWhoamiInFlight` clears via .finally() so the next sequential
// caller (e.g. a 60s polling tick) gets a fresh request. No TTL, no
// staleness, no invalidation needed on login/logout — the dedupe only
// lives for the duration of one in-flight request.
let _adminWhoamiInFlight = null;
export async function adminWhoami() {
  if (_adminWhoamiInFlight) return _adminWhoamiInFlight;
  const p = request('/api/admin/whoami').finally(() => {
    _adminWhoamiInFlight = null;
  });
  _adminWhoamiInFlight = p;
  return p;
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
// Same in-flight dedupe as adminWhoami above. Each mounted Navbar
// runs its own setInterval(60_000) polling adminUnreadCount when
// the viewer is admin — without dedupe, every interval tick fires
// N simultaneous identical requests (one per mount) and re-creates
// the 429 storm on a 60s cadence.
let _adminUnreadCountInFlight = null;
export async function adminUnreadCount() {
  if (_adminUnreadCountInFlight) return _adminUnreadCountInFlight;
  const p = request('/api/admin/reports/unread-count').finally(() => {
    _adminUnreadCountInFlight = null;
  });
  _adminUnreadCountInFlight = p;
  return p;
}

// ── Appeals (user side) ─────────────────────────────────────────────
// "Hidden by moderation" content for the dashboard surface — every
// piece of moderation-hidden content the caller authored, within
// the 30-day appeal window, with current appeal status per row.
export async function fetchMyHiddenContent() {
  return request('/api/me/hidden-content');
}

// Caller's full appeal history (pending + resolved). Currently
// powers any view that wants to show resolved appeals beyond the
// 30-day "Hidden by moderation" window.
export async function fetchMyAppeals() {
  return request('/api/me/appeals');
}

// Submit an appeal on a piece of hidden content the caller authored.
// `targetKind` is 'post' | 'post_comment' | 'poll' | 'poll_comment'.
// rationale must be 50-1000 chars (server enforces; UI should too).
// Returns 409 if already appealed (denied is final).
export async function submitAppeal({ targetKind, targetId, rationale }) {
  return request('/api/appeals', {
    method: 'POST',
    body: { target_kind: targetKind, target_id: targetId, rationale },
  });
}

// Suspended-user appeal — public endpoint that re-verifies email +
// password (no session granted). Used in the login modal's 403
// fallback flow. Per-IP rate-limited server-side (5/24h).
export async function submitSuspensionAppeal({ email, password, rationale }) {
  return request('/api/appeals/suspension', {
    method: 'POST',
    body: { email, password, rationale },
  });
}

// List all suspended user accounts (rep + citizen) for the admin
// /admin/users page. Newest suspension first, capped at 200.
export async function adminListSuspendedUsers() {
  return request('/api/admin/users/suspended');
}

// Admin appeals queue. Pending first by default; pass
// includeActed=true for the audit view.
export async function adminListAppeals({ includeActed = false } = {}) {
  return request('/api/admin/appeals', {
    query: { include_acted: includeActed ? 'true' : undefined },
  });
}

// Grant or deny an appeal. Both take an optional admin_note that
// surfaces to the appellant in their dashboard view + decision email.
export async function adminGrantAppeal(appealId, { adminNote } = {}) {
  return request(`/api/admin/appeals/${encodeURIComponent(appealId)}/grant`, {
    method: 'POST',
    body: { admin_note: adminNote },
  });
}

export async function adminDenyAppeal(appealId, { adminNote } = {}) {
  return request(`/api/admin/appeals/${encodeURIComponent(appealId)}/deny`, {
    method: 'POST',
    body: { admin_note: adminNote },
  });
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
// standalone + candidate). Used by the /polls page.
//
// `kinds` accepts an ARRAY for additive multi-select
//   (e.g. ['rep', 'standalone'] returns rep polls + standalone polls).
// `kind` (singular) is still accepted as a string for backwards-compat;
//   callers that already pass `kind: 'rep'` keep working.
// `state` is a 2-letter code — filters to polls whose author lives in
//   (citizen polls) or represents (rep + candidate polls) that state.
export async function fetchPollsFeed({ limit = 100, kind, kinds, state } = {}) {
  // Normalize the kind param: array wins; fall back to scalar.
  const kindParam = Array.isArray(kinds) && kinds.length
    ? kinds
    : (kind || undefined);
  return request('/api/feed/polls', {
    query: { limit, kind: kindParam, state: state || undefined },
  });
}

// Full posts feed — every non-deleted post from verified reps +
// candidates. Used by the /posts page (PR #3 wires it). Same filter
// surface as fetchPollsFeed except `kinds` is ['rep' | 'candidate'].
// Sort is engagement-score DESC server-side; the response items
// already arrive in display order.
export async function fetchPostsFeed({ limit = 100, kinds, state } = {}) {
  const kindParam = Array.isArray(kinds) && kinds.length ? kinds : undefined;
  return request('/api/feed/posts', {
    query: { limit, kind: kindParam, state: state || undefined },
  });
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

// ── Reactions (multi-identity, Phase 6) ──────────────────────────────
// asIdentity is 'citizen' | 'rep' | 'candidate' | null. When null
// the backend picks via cookie priority (rep > candidate > citizen).
// The IdentityPicker sends this whenever the user is signed in to
// more than one identity so the reaction lands on the right row.
export async function reactToPost(postId, kind, asIdentity = null) {
  return request(`/api/pages/posts/${postId}/reactions`, {
    method: 'POST',
    body: { kind, as_identity: asIdentity || undefined },
  });
}

export async function clearReaction(postId, asIdentity = null) {
  // Phase 6 multi-identity: pass as_identity as a query param so
  // toggle-off targets the picker's exact chosen identity. DELETE
  // requests don't normally carry bodies so query is the cleanest
  // way; backend reads it via FastAPI dep injection.
  return request(`/api/pages/posts/${postId}/reactions`, {
    method: 'DELETE',
    query: asIdentity ? { as_identity: asIdentity } : undefined,
  });
}

// ── Comments ────────────────────────────────────────────────────────
export async function listComments(postId, { scope, sort, filterBy, limit } = {}) {
  return request(`/api/pages/posts/${postId}/comments`, {
    // Server expects `filter_by` (snake case). We translate so callers
    // can use the camelCase convention the rest of this module uses.
    query: { scope, sort, filter_by: filterBy, limit },
  });
}

// Phase 3 reply threading: pass parentCommentId to post a reply
// under an existing top-level comment. Backend enforces the
// two-party rule (post creator OR parent author only).
// Phase 6: pass asIdentity to author the comment as a specific
// identity (citizen / rep / candidate) when the user is signed
// in to multiple.
export async function createComment(postId, body, parentCommentId = null, asIdentity = null) {
  return request(`/api/pages/posts/${postId}/comments`, {
    method: 'POST',
    body: {
      body,
      parent_comment_id: parentCommentId || undefined,
      as_identity: asIdentity || undefined,
    },
  });
}

export async function deleteComment(commentId) {
  return request(`/api/pages/comments/${commentId}`, { method: 'DELETE' });
}

// ── Comment reactions (multi-identity, Phase 6) ─────────────────────
export async function reactToComment(commentId, kind, asIdentity = null) {
  return request(`/api/pages/comments/${commentId}/reactions`, {
    method: 'POST',
    body: { kind, as_identity: asIdentity || undefined },
  });
}

export async function clearCommentReaction(commentId, asIdentity = null) {
  // Same as_identity contract as clearReaction.
  return request(`/api/pages/comments/${commentId}/reactions`, {
    method: 'DELETE',
    query: asIdentity ? { as_identity: asIdentity } : undefined,
  });
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

// ── Edit (Task #41) ───────────────────────────────────────────────────
// PATCH a post's body. Backend enforces author + 24h window + body
// non-empty. Returns the updated post (PostRead).
export async function updatePost(post_id, body) {
  return request(`/api/pages/posts/${post_id}`, {
    method: 'PATCH',
    body: { body },
  });
}

// PATCH a comment's body. Backend enforces author + lock-on-reply (with
// 60s grace) + body non-empty. Returns the updated comment (CommentRead).
// Edits within 60s of creation are silent on the server (edited_at stays
// NULL); after 60s the response will have edited_at set and the UI
// should render the "Edited" chip.
export async function updateComment(comment_id, body) {
  return request(`/api/pages/comments/${comment_id}`, {
    method: 'PATCH',
    body: { body },
  });
}


// ── Poll vote (multi-identity, Phase 6) ──────────────────────────────
export async function votePoll(officialId, pollId, { optionId, voterToken, asIdentity }) {
  return request(
    `/api/pages/${encodeURIComponent(officialId)}/polls/${pollId}/vote`,
    {
      method: 'POST',
      body: {
        option_id: optionId,
        voter_token: voterToken,
        as_identity: asIdentity || undefined,
      },
    },
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
// Session model (Phase 6 update): MULTI-IDENTITY by default. The
// backend supports three independent cookies (cl_session for reps,
// cl_citizen for citizens, cl_candidate for candidates) and they
// can all coexist in the same browser. The IdentityPicker UI
// disambiguates which identity performs each action — see the
// _apply_as_identity_filter helper on the backend and the
// useActiveIdentities hook + IdentityPicker component on the
// frontend.
//
// Earlier versions enforced one-active-role-per-browser via a
// _tearDownTwoOtherRoles helper that fired the other two logout
// endpoints on each login. That helper has been removed — the
// per-action picker now handles the disambiguation that the
// tear-down was originally trying to enforce. A user signed in
// as both their citizen and rep accounts will see the picker on
// every like / vote / comment, ensuring intent is explicit.

export async function login(email, password) {
  // Phase 6: multi-identity is supported — no tear-down of other
  // sessions on login. The user can sign in as rep + citizen +
  // candidate simultaneously; the IdentityPicker disambiguates.
  const result = await request('/api/auth/login', {
    method: 'POST', body: { email, password },
  });
  if (result?.data?.session_token) {
    setStoredRepToken(result.data.session_token);
  }
  return result;
}

export async function logout() {
  // Phase 6: signing out clears ONLY the rep session. Citizen +
  // candidate sessions (if present) are preserved — the user
  // signs them out individually via their own sign-out buttons.
  const result = await request('/api/auth/logout', { method: 'POST' });
  setStoredRepToken(null);
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
  // Phase 6: multi-identity — no tear-down of other sessions.
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
  // Phase 6: multi-identity — no tear-down of other sessions on
  // demo-signup either.
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
  // Phase 6: signing out clears ONLY the citizen session. Rep +
  // candidate sessions (if present) are preserved.
  const result = await request('/api/citizen-auth/logout', { method: 'POST' });
  setStoredCitizenToken(null);
  return result;
}

export async function fetchCitizenMe() {
  return request('/api/citizen-auth/me');
}

// ── Candidate auth ────────────────────────────────────────────────────
// Parallel surface to loginCitizenApi / login (rep). Same mutual-
// exclusivity rule: signing in as a candidate tears down any
// existing rep + citizen session. The backend's /api/candidate-auth/
// login endpoint refuses pending-approval and suspended accounts
// with explicit 403s — the modal shows those messages verbatim
// rather than collapsing into a generic 401.
export async function loginCandidateApi(email, password) {
  // Phase 6: multi-identity — no tear-down of other sessions.
  const result = await request('/api/candidate-auth/login', {
    method: 'POST', body: { email, password },
  });
  if (result?.data?.candidate_token) {
    setStoredCandidateToken(result.data.candidate_token);
  }
  return result;
}

export async function logoutCandidateApi() {
  // Phase 6: signing out clears ONLY the candidate session. Rep +
  // citizen sessions (if present) are preserved.
  const result = await request('/api/candidate-auth/logout', { method: 'POST' });
  setStoredCandidateToken(null);
  return result;
}

export async function fetchCandidateMe() {
  return request('/api/candidate-auth/me');
}

// ── Notifications (in-app, Phase 5 MVP) ──────────────────────────────
// Returns { unread_count, items: [{id, kind, payload, created_at, read_at, recipient_kind}] }
// Anonymous callers get unread_count=0 + items=[] (no auth error).
export async function fetchNotifications({ limit = 50, unreadOnly = false } = {}) {
  return request('/api/notifications', {
    query: { limit, unread_only: unreadOnly ? 'true' : undefined },
  });
}

export async function markNotificationRead(notificationId) {
  return request(`/api/notifications/${notificationId}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead() {
  return request('/api/notifications/read-all', { method: 'POST' });
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

export async function voteOnCitizenPoll(pollId, optionId, asIdentity = null) {
  return request(`/api/citizen-polls/${pollId}/vote`, {
    method: 'POST',
    body: {
      option_id: optionId,
      as_identity: asIdentity || undefined,
    },
  });
}

export async function closeCitizenPoll(pollId) {
  return request(`/api/citizen-polls/${pollId}/close`, { method: 'POST' });
}


// ── Reactions on citizen polls (Phase 7 — PollReaction parity) ──────
// Mirror reactToPost / clearReaction shape. asIdentity narrows to the
// IdentityPicker's chosen identity; null falls back to the backend's
// default precedence (citizen → rep → candidate).
export async function reactToCitizenPoll(pollId, kind, asIdentity = null) {
  return request(`/api/citizen-polls/${pollId}/reactions`, {
    method: 'POST',
    body: { kind, as_identity: asIdentity || undefined },
  });
}

export async function clearCitizenPollReaction(pollId, asIdentity = null) {
  return request(`/api/citizen-polls/${pollId}/reactions`, {
    method: 'DELETE',
    query: asIdentity ? { as_identity: asIdentity } : undefined,
  });
}


// ── Reactions on PollComments (PR #9 — parity with reactToComment) ──
export async function reactToPollComment(commentId, kind, asIdentity = null) {
  return request(`/api/citizen-polls/comments/${commentId}/reactions`, {
    method: 'POST',
    body: { kind, as_identity: asIdentity || undefined },
  });
}

export async function clearPollCommentReaction(commentId, asIdentity = null) {
  return request(`/api/citizen-polls/comments/${commentId}/reactions`, {
    method: 'DELETE',
    query: asIdentity ? { as_identity: asIdentity } : undefined,
  });
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

export async function createCitizenPollComment(
  pollId, body, parentCommentId = null, asIdentity = null,
) {
  // Phase 3 reply threading — pass parentCommentId to post a reply
  // inside an existing top-level thread. Backend two-party rule
  // applies.
  // Phase 6 — asIdentity selects which identity authors the comment
  // when the user is signed in to multiple.
  return request(`/api/citizen-polls/${pollId}/comments`, {
    method: 'POST',
    body: {
      body,
      parent_comment_id: parentCommentId || undefined,
      as_identity: asIdentity || undefined,
    },
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

// ── Self-serve account deletion (Task #81) ───────────────────────────
// Identity-aware wrappers. The frontend's /account/delete page picks
// the right one based on which session is signed in. Mode is 'soft'
// (archive 30 days) or 'hard' (immediate). Returns { mode,
// purge_after } on success.
export async function deleteRepAccount({ confirmEmail, mode } = {}) {
  return request('/api/auth/delete', {
    method: 'POST',
    body: { confirm_email: confirmEmail, mode },
  });
}
export async function deleteCitizenAccount({ confirmEmail, mode } = {}) {
  return request('/api/citizen-auth/delete', {
    method: 'POST',
    body: { confirm_email: confirmEmail, mode },
  });
}
export async function deleteCandidateAccount({ confirmEmail, mode } = {}) {
  return request('/api/candidate-auth/delete', {
    method: 'POST',
    body: { confirm_email: confirmEmail, mode },
  });
}

// Recovery — called when a soft-deleted user wants to undo the
// archive within the 30-day window. Returns the refreshed me object
// so the auth hooks can flip self_deleted_at back to null.
export async function recoverRepAccount() {
  return request('/api/auth/recover', { method: 'POST' });
}
export async function recoverCitizenAccount() {
  return request('/api/citizen-auth/recover', { method: 'POST' });
}
export async function recoverCandidateAccount() {
  return request('/api/candidate-auth/recover', { method: 'POST' });
}

// ── Password reset (Task #87) ─────────────────────────────────────────
// One shared frontend page (/password-reset) handles all three identity
// kinds — kind is carried in the URL search params. These wrappers map
// kind → backend route so the page only knows about a single helper.
//
// Backend ALWAYS returns 200/{ok:true} on the request endpoint regardless
// of whether the email matches an account — see the anti-enumeration
// note on services/password_reset.request_password_reset. The frontend
// shows a single neutral "if that email exists, we sent a link" message
// either way to mirror that protection.
const _RESET_PATHS = {
  rep: '/api/auth/password-reset',
  citizen: '/api/citizen-auth/password-reset',
  candidate: '/api/candidate-auth/password-reset',
};

export async function requestPasswordReset({ identityKind, email } = {}) {
  const base = _RESET_PATHS[identityKind];
  if (!base) {
    return { data: null, error: `Unknown identity kind: ${identityKind}`, status: 0 };
  }
  return request(`${base}/request`, {
    method: 'POST',
    body: { email },
  });
}

export async function confirmPasswordReset({ identityKind, token, newPassword } = {}) {
  const base = _RESET_PATHS[identityKind];
  if (!base) {
    return { data: null, error: `Unknown identity kind: ${identityKind}`, status: 0 };
  }
  return request(`${base}/confirm`, {
    method: 'POST',
    body: { token, new_password: newPassword },
  });
}

// ── Billing / subscription (Task #88) ────────────────────────────────
// Stripe Checkout + Customer Portal wrappers. Only citizens subscribe
// in the current product — these endpoints sit behind the citizen
// auth dep on the backend, so they 401 if no citizen session is
// active.
//
// Usage pattern:
//   const { data, error } = await startCheckoutSession();
//   if (error) return showError(error);
//   if (!data.configured) return showComingSoonMessage();
//   window.location.assign(data.url);
//
// The `configured` flag distinguishes "real Stripe" from "dev
// backend placeholder" — when it's false the URL is an `about:blank`
// placeholder and the frontend should render "billing isn't
// activated yet" instead of redirecting.
export async function fetchBillingStatus() {
  return request('/api/billing/status');
}

export async function startCheckoutSession({ successUrl, cancelUrl } = {}) {
  return request('/api/billing/checkout-session', {
    method: 'POST',
    body: {
      success_url: successUrl || null,
      cancel_url: cancelUrl || null,
    },
  });
}

export async function startPortalSession({ returnUrl } = {}) {
  return request('/api/billing/portal-session', {
    method: 'POST',
    body: { return_url: returnUrl || null },
  });
}

// ── Identity verification (Task #89) ─────────────────────────────────
// ID.me OAuth flow wrappers. Same configured-vs-dev pattern as the
// billing wrappers — if {configured: false} comes back, the URL is
// an `about:blank` placeholder and the UI should render a
// "verification not yet activated" message instead of redirecting.
//
// Usage:
//   const { data, error } = await startVerification();
//   if (error) return showError(error);
//   if (!data.configured) return showComingSoonMessage();
//   window.location.assign(data.url);
//
// The /start endpoint also handles the cost-skip case — if the
// citizen's email matches a row in the verified-identity archive
// (left behind by a previously-deleted account), the backend flips
// `verified=True` immediately and returns a URL that bounces the
// user back to the dashboard without an ID.me round-trip. The
// `&via=archive` query param in the returned URL lets the frontend
// optionally surface a "Restored from your previous verification"
// notice.
export async function fetchVerificationStatus() {
  return request('/api/identity-verification/status');
}

export async function startVerification() {
  return request('/api/identity-verification/start', { method: 'POST' });
}

// ── Tracked items (server-side per-identity) ────────────────────────
//
// Replaces the prior localStorage-singleton store. Each frontend store
// (trackedBills, trackedOfficials, trackedElections) calls these
// wrappers and keeps an in-memory cache of the response. Login/logout
// hooks bootstrap and clear that cache.
//
// All endpoints share the standard auth path (cookie + bearer token);
// when no identity is signed in, GETs return empty payloads (200) and
// writes return 401 — matches the notifications router's convention.

export async function fetchAllTracked() {
  return request('/api/tracked');
}

export async function fetchTrackedBills() {
  return request('/api/tracked/bills');
}

export async function postTrackBill({ bill_key, snapshot, prefs }) {
  return request('/api/tracked/bills', {
    method: 'POST',
    body: { bill_key, snapshot: snapshot || {}, prefs: prefs ?? undefined },
  });
}

export async function deleteTrackedBill(billKey) {
  return request(`/api/tracked/bills/${encodeURIComponent(billKey)}`, {
    method: 'DELETE',
  });
}

export async function patchTrackedBillPrefs(billKey, prefs) {
  return request(`/api/tracked/bills/${encodeURIComponent(billKey)}/prefs`, {
    method: 'PATCH',
    body: { prefs: prefs || {} },
  });
}

export async function fetchTrackedOfficials() {
  return request('/api/tracked/officials');
}

export async function postTrackOfficial({ official_key, snapshot, prefs }) {
  return request('/api/tracked/officials', {
    method: 'POST',
    body: { official_key, snapshot: snapshot || {}, prefs: prefs ?? undefined },
  });
}

export async function deleteTrackedOfficial(officialKey) {
  return request(`/api/tracked/officials/${encodeURIComponent(officialKey)}`, {
    method: 'DELETE',
  });
}

export async function patchTrackedOfficialPrefs(officialKey, prefs) {
  return request(`/api/tracked/officials/${encodeURIComponent(officialKey)}/prefs`, {
    method: 'PATCH',
    body: { prefs: prefs || {} },
  });
}

export async function fetchTrackedElections() {
  return request('/api/tracked/elections');
}

export async function postTrackElection({ election_key, snapshot, prefs }) {
  return request('/api/tracked/elections', {
    method: 'POST',
    body: { election_key, snapshot: snapshot || {}, prefs: prefs ?? undefined },
  });
}

export async function deleteTrackedElection(electionKey) {
  return request(`/api/tracked/elections/${encodeURIComponent(electionKey)}`, {
    method: 'DELETE',
  });
}

export async function patchTrackedElectionPrefs(electionKey, prefs) {
  return request(`/api/tracked/elections/${encodeURIComponent(electionKey)}/prefs`, {
    method: 'PATCH',
    body: { prefs: prefs || {} },
  });
}
