// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Two-factor authentication API client — wraps /api/2fa/*.
 *
 * The backend resolves which of the three sessions (citizen / rep /
 * candidate) is active and operates on that account. The frontend
 * doesn't pass an identity hint — whichever bearer / cookie is set
 * when the request fires wins, with the rep > candidate > citizen
 * priority enforced server-side.
 *
 * Mirrors the {data, error, status} response shape used elsewhere
 * in lib/pagesApi.js so callers don't have to special-case this
 * module. Shares the same multi-identity bearer-header pattern via
 * direct fetch (no helper to import — keeps this module standalone).
 */
import {
  getStoredCandidateToken,
  getStoredCitizenToken,
  getStoredRepToken,
} from './pagesApi';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function tfaRequest(path, { method = 'GET', body } = {}) {
  try {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const repToken = getStoredRepToken();
    const citizenToken = getStoredCitizenToken();
    const candidateToken = getStoredCandidateToken();
    if (repToken) headers['Authorization'] = `Bearer ${repToken}`;
    if (citizenToken) headers['X-Citizen-Token'] = citizenToken;
    if (candidateToken) headers['X-Candidate-Token'] = candidateToken;

    const res = await fetch(`${API_BASE_URL}${path}`, {
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
        if (Array.isArray(detail)) {
          detail = detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
        }
      } catch {
        detail = res.statusText;
      }
      return { data: null, error: detail || `HTTP ${res.status}`, status: res.status };
    }
    if (res.status === 204) return { data: null, error: null, status: 204 };
    return { data: await res.json(), error: null, status: res.status };
  } catch (e) {
    return { data: null, error: e?.message || 'Network error', status: 0 };
  }
}

/**
 * GET /api/2fa/status — returns
 *   { enabled: bool, enabled_at: ISO|null, recovery_codes_remaining: int }
 * Use this on Account Security mount to render the right panel state.
 */
export function fetchTwoFactorStatus() {
  return tfaRequest('/api/2fa/status');
}

/**
 * POST /api/2fa/enroll/start — kicks off enrollment. Returns
 *   { secret, provisioning_uri, pending_token, issuer, label }
 * Caller MUST show secret + render QR from provisioning_uri
 * immediately; the secret isn't recoverable after this call.
 */
export function startEnrollment() {
  return tfaRequest('/api/2fa/enroll/start', { method: 'POST' });
}

/**
 * POST /api/2fa/enroll/verify — completes enrollment. Returns
 *   { enabled: true, recovery_codes: string[] }
 * The recovery codes are shown ONCE — caller MUST display them to
 * the user with copy + download affordances. Backend stores only
 * hashes from this point on; the plaintext is not recoverable.
 */
export function verifyEnrollment(pendingToken, code) {
  return tfaRequest('/api/2fa/enroll/verify', {
    method: 'POST',
    body: { pending_token: pendingToken, code },
  });
}

/**
 * POST /api/2fa/verify — yes/no check on a TOTP or recovery code.
 * Used for the "prove who you are before doing X" gate (disable,
 * regenerate). Returns { verified: true } or 400 with detail on
 * mismatch.
 */
export function verifyCode(code) {
  return tfaRequest('/api/2fa/verify', { method: 'POST', body: { code } });
}

/**
 * POST /api/2fa/regenerate-recovery-codes — invalidates every existing
 * recovery code (used or unused) and issues a fresh batch of 10.
 * Requires a current TOTP/recovery code in `code`. Returns
 *   { recovery_codes: string[] } — same one-time-display contract
 * as enrollment.
 */
export function regenerateRecoveryCodes(code) {
  return tfaRequest('/api/2fa/regenerate-recovery-codes', {
    method: 'POST',
    body: { code },
  });
}

/**
 * POST /api/2fa/disable — clears the encrypted secret + wipes all
 * recovery codes. Requires a current TOTP/recovery code. Returns
 *   { disabled: true } on success; { disabled: true, noop: true }
 * if 2FA wasn't enabled in the first place.
 */
export function disableTwoFactor(code) {
  return tfaRequest('/api/2fa/disable', { method: 'POST', body: { code } });
}

/**
 * Admin-only: POST /api/admin/accounts/{kind}/{id}/reset-2fa
 * Wipes the target user's TOTP + recovery codes so they can re-enroll
 * at next login. Caller must be in ADMIN_EMAILS (gated server-side).
 */
export function adminResetTwoFactor(kind, accountId) {
  return tfaRequest(
    `/api/admin/accounts/${encodeURIComponent(kind)}/${encodeURIComponent(accountId)}/reset-2fa`,
    { method: 'POST' },
  );
}

/**
 * POST /api/2fa/login-challenge — completes a login that paused for
 * 2FA. Called after the matching login endpoint returns
 * `{ two_factor_required: true, challenge_token }`. On success the
 * server sets the appropriate session cookie AND returns the same
 * user payload the original login would have, plus the matching
 * bearer token (session_token / citizen_token / candidate_token).
 *
 * The challenge token is single-use server-side — if the code
 * verification fails, the user must restart the entire login flow
 * (re-enter password) to mint a fresh challenge. We don't expose a
 * retry-without-replay flow because the security model assumes a
 * stolen-password attacker should be forced to re-prove the
 * password between each code attempt.
 */
export function verifyLoginChallenge(challengeToken, code) {
  return tfaRequest('/api/2fa/login-challenge', {
    method: 'POST',
    body: { challenge_token: challengeToken, code },
  });
}
