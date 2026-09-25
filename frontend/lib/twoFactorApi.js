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
 * Uses request() from lib/http.js, the shared client: every identity
 * header, X-CSRF-Token with one retry on a stale token, a timeout, and
 * the same {data, error, status} shape as lib/pagesApi.js. This module
 * used to carry its own fetch and never sent the CSRF token, so every
 * 2FA write for a signed-in user was rejected with 403 (audit B1, F4).
 */
import { request } from './http';

function tfaRequest(path, { method = 'GET', body } = {}) {
  return request(path, { method, body });
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
 * POST /api/sessions/sign-out-everywhere: revokes every session of the
 * account this panel manages (rep, then candidate, then citizen), this
 * device included. Returns { signed_out: true, kind }. The caller drops
 * the stored token for `kind` and reloads.
 */
export function signOutEverywhere() {
  return tfaRequest('/api/sessions/sign-out-everywhere', { method: 'POST' });
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
