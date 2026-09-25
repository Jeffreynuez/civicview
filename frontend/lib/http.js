// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * The one HTTP client for the CivicView API (audit F4, 2026-09-25).
 *
 * Before this file there were four copies of the "attach the session
 * tokens, attach the CSRF token, retry once on a stale CSRF token"
 * logic (pagesApi.js, twoFactorApi.js, push.js, and about 50 bare
 * fetch() calls in api.js) and they had drifted: the 2FA screens and
 * image upload never sent the CSRF token, and push.js read the wrong
 * field from /api/csrf for months. Every module now goes through the
 * helpers below.
 *
 * Three entry points:
 *
 *   request(path, opts)      Signed-in or anonymous call. Never throws.
 *                            Resolves { data, error, status, payload }.
 *                            `aborted: true` is added when the caller
 *                            cancelled it through opts.signal.
 *   sendWithAuth(path, opts) Same headers and CSRF retry, but resolves
 *                            the raw Response (throws on network error)
 *                            for callers that read the body themselves.
 *   getJson(path, opts)      Public read with no identity headers, so the
 *                            Cloudflare edge can cache it. Resolves the
 *                            parsed JSON or throws an ApiError.
 *
 * All three take `signal` (an AbortSignal, so a screen can cancel a
 * request it no longer needs) and `timeoutMs`. A request that hangs is
 * reported as an error instead of spinning forever.
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// How long to wait before calling a request failed. Most public reads
// are edge-cached and answer in well under a second, but a cold cache
// can make the backend wait on Congress.gov, GovTrack or Open States,
// so the default is generous; the slowest proxied reads pass
// UPSTREAM_TIMEOUT_MS. Cloudflare itself gives up at 100 seconds.
export const PUBLIC_TIMEOUT_MS = 45000;
export const UPSTREAM_TIMEOUT_MS = 90000;
const REQUEST_TIMEOUT_MS = 45000;
const UPLOAD_TIMEOUT_MS = 120000;
const CSRF_TIMEOUT_MS = 10000;

// ── Token storage ─────────────────────────────────────────────────────
// Mobile browsers (Samsung Internet, Safari with ITP, the Capacitor
// webview) do not reliably send the httpOnly cl_session / cl_citizen /
// cl_candidate cookies cross-origin, so each login token is also kept
// in localStorage and sent as a header on every call:
//   Authorization: Bearer <token>   (rep)
//   X-Citizen-Token: <token>        (citizen)
//   X-Candidate-Token: <token>      (candidate)
// The backend accepts either the cookie or the header. The in-memory
// copy covers SSR and private-mode Safari, where localStorage throws.
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
  } catch { /* storage unavailable: the in-memory copy still works */ }
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

/** Identity headers for every signed-in identity in this browser. */
export function identityHeaders() {
  const headers = {};
  const repToken = getStoredRepToken();
  const citizenToken = getStoredCitizenToken();
  const candidateToken = getStoredCandidateToken();
  if (repToken) headers['Authorization'] = `Bearer ${repToken}`;
  if (citizenToken) headers['X-Citizen-Token'] = citizenToken;
  if (candidateToken) headers['X-Candidate-Token'] = candidateToken;
  return headers;
}

// ── CSRF storage (Task #31) ──────────────────────────────────────────
// One CSRF token per identity: HMAC(SESSION_SECRET, session token),
// issued at login and by GET /api/csrf. Non-GET requests send one of
// them as X-CSRF-Token. The backend accepts a match against any active
// session on the request, so which one we pick only has to be stable.
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

// The CSRF token to send, or null when nobody is signed in (the
// backend skips the check for requests that carry no session).
function _pickActiveCsrf() {
  if (getStoredRepToken() && getStoredRepCsrf()) return getStoredRepCsrf();
  if (getStoredCitizenToken() && getStoredCitizenCsrf()) return getStoredCitizenCsrf();
  if (getStoredCandidateToken() && getStoredCandidateCsrf()) return getStoredCandidateCsrf();
  return null;
}

/**
 * Refresh all three CSRF tokens from GET /api/csrf. Called after a
 * csrf_token_mismatch (see _send) and by the auth flows after login and
 * logout. Never throws; on a network error the stored tokens stay.
 */
export async function fetchCsrf() {
  const link = _linkSignal(null, CSRF_TIMEOUT_MS);
  try {
    const headers = identityHeaders();
    const res = await fetch(`${API_BASE_URL}/api/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      signal: link.signal,
    });
    if (!res.ok) return;
    const data = await res.json();
    setStoredRepCsrf(data?.rep_csrf || null);
    setStoredCitizenCsrf(data?.citizen_csrf || null);
    setStoredCandidateCsrf(data?.candidate_csrf || null);
  } catch {
    // Network error or timeout. The next write retries through the
    // mismatch path.
  } finally {
    link.done();
  }
}

// ── URLs ─────────────────────────────────────────────────────────────

/**
 * API path plus query object to a full URL. Array values repeat the
 * parameter ({ kind: ['rep', 'standalone'] } gives kind=rep&kind=standalone);
 * undefined, null and '' are left out. Absolute URLs pass through.
 */
export function buildUrl(path, query) {
  let url = /^https?:\/\//i.test(path) ? path : `${API_BASE_URL}${path}`;
  if (query) {
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
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  return url;
}

// ── Errors ───────────────────────────────────────────────────────────

/** Thrown by getJson(); also what sendWithAuth throws on a timeout. */
export class ApiError extends Error {
  constructor(message, {
    status = 0, payload = null, detail = null, aborted = false, timedOut = false, refused = false,
  } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    // The backend's own reason, when it sent one. Some callers match
    // on it ('not_configured', 'budget_exceeded'), so it is kept as is.
    this.detail = detail;
    this.aborted = aborted;
    this.timedOut = timedOut;
    // A programming error (a full URL to another host), not an outage.
    this.refused = refused;
  }
}

export const OFFLINE_MESSAGE = 'Could not reach CivicView. Check your connection and try again.';
export const TIMEOUT_MESSAGE = 'CivicView took too long to answer. Try again in a moment.';

/** True when the caller cancelled the request (not an outage). */
export function isAbortError(e) {
  return !!(e && (e.aborted || e.name === 'AbortError'));
}

/**
 * Error text for a failed public read, or null when the backend
 * answered 404. A 404 from our API means "no such record" (a state or
 * person we have no data for), which is an answer, not an outage, so
 * callers show their normal empty state for it.
 */
export function loadErrorText(e) {
  if (e && e.status === 404) return null;
  return describeError(e);
}

/** A short message for the screen, for any error these helpers produce. */
export function describeError(e) {
  if (!e) return OFFLINE_MESSAGE;
  if (typeof e === 'string') return e;
  if (e.timedOut) return TIMEOUT_MESSAGE;
  if (e.refused) return e.message;
  if (e instanceof ApiError && e.status) {
    if (e.detail) return e.detail;
    if (e.status >= 500) return 'CivicView is having trouble right now. Try again in a moment.';
    return e.message || `Request failed (${e.status})`;
  }
  // fetch() rejects with a TypeError on DNS, TLS, CORS and offline.
  return OFFLINE_MESSAGE;
}

// Pull a readable message out of an error body. FastAPI sends
// {detail: "..."}, {detail: [{msg}]} for validation errors, or a
// structured {detail: {message, code, ...}} (423 lockouts).
function _detailFrom(payload, fallback) {
  let detail = payload?.detail || payload?.error || fallback;
  if (Array.isArray(detail)) {
    detail = detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
  }
  if (detail && typeof detail === 'object') {
    detail = detail.message || detail.detail || JSON.stringify(detail);
  }
  return detail;
}

// ── Timeouts and cancellation ─────────────────────────────────────────
// AbortSignal.any() and AbortSignal.timeout() are missing from older
// Android WebViews, so combine the caller's signal and the timer by hand.
function _linkSignal(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const onAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onAbort, { once: true });
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  }
  return {
    signal: controller.signal,
    wasTimeout: () => timedOut,
    done: () => {
      if (timer) clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', onAbort);
    },
  };
}

// ── Sending ──────────────────────────────────────────────────────────

const _UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function _isForm(body) {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

async function _fetchOnce(url, { method, body, headers: extra, signal }) {
  const isForm = _isForm(body);
  const headers = { ...identityHeaders(), ...(extra || {}) };
  // The browser sets the multipart boundary itself for FormData.
  if (body !== undefined && body !== null && !isForm) headers['Content-Type'] = 'application/json';
  if (_UNSAFE_METHODS.has(method)) {
    const csrf = _pickActiveCsrf();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  return fetch(url, {
    method,
    credentials: 'include',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined || body === null ? undefined : (isForm ? body : JSON.stringify(body)),
    signal,
  });
}

/**
 * Send with every identity header and the CSRF token, retrying once
 * after a csrf_token_mismatch (stale token, rotated session, a new tab
 * on an old session). Resolves the Response; rejects on network error,
 * cancellation (err.name === 'AbortError') or timeout (ApiError with
 * timedOut). Used by request() and by callers that read the body
 * themselves.
 */
export async function sendWithAuth(path, opts = {}) {
  const { body, signal, timeoutMs } = opts;
  const limit = timeoutMs ?? (_isForm(body) ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  const link = _linkSignal(signal, limit);
  try {
    return await _sendLinked(path, opts, link);
  } finally {
    link.done();
  }
}

// The body of sendWithAuth, with the timeout owned by the caller so
// request() can keep it running while it reads the response body.
async function _sendLinked(path, { method = 'GET', body, query, headers } = {}, link) {
  const verb = String(method).toUpperCase();
  const url = buildUrl(path, query);
  // Session tokens and CSRF go to the CivicView API only. A full URL to
  // any other host is refused rather than sent the identity headers.
  if (!url.startsWith(`${API_BASE_URL}/`)) {
    throw new ApiError('Refusing to send CivicView credentials to another host.', { refused: true });
  }
  try {
    let res = await _fetchOnce(url, { method: verb, body, headers, signal: link.signal });
    if (res.status === 403 && _UNSAFE_METHODS.has(verb)) {
      let code = null;
      try { code = (await res.clone().json())?.code || null; } catch { /* not JSON */ }
      if (code === 'csrf_token_mismatch') {
        await fetchCsrf();
        res = await _fetchOnce(url, { method: verb, body, headers, signal: link.signal });
      }
    }
    return res;
  } catch (e) {
    if (link.wasTimeout()) throw new ApiError(TIMEOUT_MESSAGE, { timedOut: true });
    throw e;
  }
}

/**
 * The standard call. Never throws. Resolves:
 *   { data, error: null, status }                on 2xx (data null on 204)
 *   { data: null, error, status, payload }       on an HTTP error
 *   { data: null, error, status: 0 }             on network error or timeout
 *   { data: null, error, status: 0, aborted }    when opts.signal aborted it
 * `error` is a string fit for the screen; `payload` is the parsed error
 * body for callers that need structured fields (423 locked_until).
 */
export async function request(path, opts = {}) {
  const limit = opts.timeoutMs ?? (_isForm(opts.body) ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  // One timer covers the whole call, response body included.
  const link = _linkSignal(opts.signal, limit);
  const failed = (e) => {
    if (link.wasTimeout() || e?.timedOut) return { data: null, error: TIMEOUT_MESSAGE, status: 0 };
    if (isAbortError(e)) return { data: null, error: 'aborted', status: 0, aborted: true };
    return { data: null, error: describeError(e), status: 0 };
  };
  try {
    let res;
    try {
      res = await _sendLinked(path, opts, link);
    } catch (e) {
      return failed(e);
    }
    if (!res.ok) {
      let payload = null;
      try { payload = await res.json(); } catch { /* not JSON */ }
      const detail = _detailFrom(payload, res.statusText);
      return { data: null, error: detail || `HTTP ${res.status}`, status: res.status, payload };
    }
    if (res.status === 204) return { data: null, error: null, status: 204 };
    try {
      return { data: await res.json(), error: null, status: res.status };
    } catch (e) {
      if (link.wasTimeout() || isAbortError(e)) return failed(e);
      return { data: null, error: 'The server sent a response CivicView could not read.', status: res.status };
    }
  } finally {
    link.done();
  }
}

/**
 * Public read: no identity headers and no cookies, so the response is
 * the same for everyone and Cloudflare can cache it. Resolves the parsed
 * JSON; throws ApiError with `status` (0 for network and timeout),
 * `timedOut` and `aborted` so the caller can tell an outage from a
 * 404 and from its own cancellation. Pass `method` and `body` for the
 * few anonymous POSTs (AI explainers).
 */
export async function getJson(path, {
  query, signal, timeoutMs = PUBLIC_TIMEOUT_MS, method = 'GET', body,
} = {}) {
  const url = buildUrl(path, query);
  // One timer covers the whole call, response body included.
  const link = _linkSignal(signal, timeoutMs);
  const networkError = (e) => {
    if (link.wasTimeout()) return new ApiError(TIMEOUT_MESSAGE, { timedOut: true });
    if (isAbortError(e)) return new ApiError('aborted', { aborted: true });
    return new ApiError(OFFLINE_MESSAGE);
  };
  try {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: link.signal,
      });
    } catch (e) {
      throw networkError(e);
    }
    if (!res.ok) {
      let payload = null;
      try { payload = await res.json(); } catch { /* not JSON */ }
      const detail = _detailFrom(payload, '') || null;
      throw new ApiError(detail || `Request failed (${res.status})`, { status: res.status, payload, detail });
    }
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch (e) {
      if (link.wasTimeout() || isAbortError(e)) throw networkError(e);
      throw new ApiError('The server sent a response CivicView could not read.', { status: res.status });
    }
  } finally {
    link.done();
  }
}
