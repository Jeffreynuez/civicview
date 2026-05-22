'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /password-reset — shared password reset surface for all three identity
 * types (Task #87). The URL carries everything the page needs to pick
 * the right backend:
 *
 *   /password-reset?kind=<rep|citizen|candidate>
 *       → "Request a link" mode. User types their email, we POST to
 *         /api/<kind>-auth/password-reset/request, render a neutral
 *         "if this matches, we sent a link" confirmation.
 *
 *   /password-reset?kind=<rep|citizen|candidate>&token=<raw>
 *       → "Confirm" mode. User entered through the email link.
 *         The page renders the new-password + confirm-password
 *         form. POST /api/<kind>-auth/password-reset/confirm.
 *
 * Why one page handles both:
 *   - The user reaches Request mode by clicking "Forgot password?"
 *     in a login modal; they reach Confirm mode by clicking the
 *     email link. Same /password-reset URL, the presence of ?token
 *     decides which UI shows. Keeps the routing surface small.
 *
 * Anti-enumeration: the request path always shows the same neutral
 * "check your inbox" message, whether or not the email exists.
 * Backend returns 200 either way. Don't reveal account existence to
 * casual probes.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import Navbar from '@/components/Navbar';
import { confirmPasswordReset, requestPasswordReset } from '@/lib/pagesApi';

const KIND_LABEL = {
  rep: 'representative',
  citizen: 'citizen',
  candidate: 'candidate',
};

// Identity-aware copy for the success state. Mirrors the language in
// the Postmark template so the in-app + emailed flows feel cohesive.
const REQUEST_SUCCESS_COPY = (
  "If that email matches a CivicView account, we've sent a password-reset "
  + 'link. Check your inbox — and your spam folder — for an email from '
  + 'civicview@civicview.app. The link expires in 1 hour.'
);

function PasswordResetInner() {
  const router = useRouter();
  const search = useSearchParams();

  // Read URL state once on mount + whenever it changes. We tolerate
  // missing/invalid kind by defaulting to citizen — the most common
  // reset path — rather than blowing up. The backend will also
  // validate.
  const rawKind = (search.get('kind') || 'citizen').toLowerCase();
  const identityKind = ['rep', 'citizen', 'candidate'].includes(rawKind) ? rawKind : 'citizen';
  const token = search.get('token') || '';

  // Mode selection lives in derived state so the page can flip
  // between Request and Confirm without a remount.
  const mode = token ? 'confirm' : 'request';

  // Request form state.
  const [email, setEmail] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestError, setRequestError] = useState(null);

  // Confirm form state.
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [confirmError, setConfirmError] = useState(null);

  const kindLabel = KIND_LABEL[identityKind] || 'account';

  // ── Submit handlers ──
  const submitRequest = useCallback(async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setRequestError('Enter the email address on your account.');
      return;
    }
    setRequestBusy(true);
    setRequestError(null);
    const result = await requestPasswordReset({ identityKind, email: trimmed });
    setRequestBusy(false);
    if (result.error) {
      // Backend should always return 200 here for anti-enumeration —
      // a real error means a 500 / network issue. Surface a generic
      // failure so the user can retry.
      setRequestError('Something went wrong. Please try again in a moment.');
      return;
    }
    setRequestSent(true);
  }, [email, identityKind]);

  const submitConfirm = useCallback(async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (newPassword.length < 8) {
      setConfirmError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setConfirmError("Passwords don't match.");
      return;
    }
    setConfirmBusy(true);
    setConfirmError(null);
    const result = await confirmPasswordReset({ identityKind, token, newPassword });
    setConfirmBusy(false);
    if (result.error) {
      setConfirmError(result.error);
      return;
    }
    setConfirmDone(true);
  }, [confirmPassword, identityKind, newPassword, token]);

  // After a successful confirm we wait a couple seconds then bounce
  // to home — gives the user time to read the success message but
  // avoids stranding them on a now-meaningless page.
  useEffect(() => {
    if (!confirmDone) return undefined;
    const t = setTimeout(() => router.push('/'), 2500);
    return () => clearTimeout(t);
  }, [confirmDone, router]);

  // ── Shared style fragments ──
  const labelStyle = useMemo(() => ({
    display: 'block',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'var(--cl-text-light)',
    marginBottom: 6,
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
  }), []);
  const inputStyle = useMemo(() => ({
    width: '100%',
    padding: '11px 12px',
    borderRadius: 8,
    border: '1px solid var(--cl-border)',
    fontSize: '0.95rem',
    fontFamily: 'var(--cl-font-sans)',
    color: 'var(--cl-text)',
    background: 'white',
    outline: 'none',
    boxSizing: 'border-box',
  }), []);
  const primaryButton = (disabled) => ({
    width: '100%',
    padding: '12px 14px',
    borderRadius: 8,
    border: 'none',
    background: disabled ? 'var(--cl-text-light)' : 'var(--cl-accent)',
    color: 'white',
    fontSize: '0.95rem',
    fontWeight: 600,
    fontFamily: 'var(--cl-font-sans)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background var(--cl-duration-fast) var(--cl-ease-standard)',
  });

  // ── Render ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--cl-bg)' }}>
      <Navbar compact onHome={() => router.push('/')} />

      <div style={{
        background: 'white',
        borderBottom: '1px solid var(--cl-border)',
        padding: '10px 18px',
      }}>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back();
            } else {
              router.push('/');
            }
          }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid var(--cl-border)', background: 'white',
            color: 'var(--cl-text)', fontSize: '0.85rem', cursor: 'pointer',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
      </div>

      <main style={{
        flex: 1,
        padding: '32px 18px 48px',
        fontFamily: 'var(--cl-font-sans)',
        color: 'var(--cl-text)',
      }}>
        <div style={{
          maxWidth: 460,
          margin: '0 auto',
          background: 'white',
          border: '1px solid var(--cl-border)',
          borderRadius: 14,
          padding: '28px 26px',
          boxShadow: '0 1px 2px rgba(15,30,45,0.04)',
        }}>
          <div style={{
            fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.6px', color: 'var(--cl-text-light)',
            marginBottom: 6,
          }}>
            {`${kindLabel} account`}
          </div>
          <h1 style={{
            margin: '0 0 18px 0',
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--cl-text)',
            lineHeight: 1.25,
          }}>
            {mode === 'confirm' ? 'Choose a new password' : 'Reset your password'}
          </h1>

          {/* ── Request mode ── */}
          {mode === 'request' && !requestSent && (
            <form onSubmit={submitRequest}>
              <p style={{
                fontSize: '0.92rem',
                lineHeight: 1.5,
                color: 'var(--cl-text-light)',
                margin: '0 0 18px 0',
              }}>
                Enter the email on your {kindLabel} account. If we recognize it,
                we&apos;ll send you a link to choose a new password. The link
                expires in 1 hour.
              </p>

              <label style={labelStyle} htmlFor="reset-email">Email</label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setRequestError(null); }}
                style={inputStyle}
                placeholder="you@example.com"
                disabled={requestBusy}
                required
              />

              {requestError && (
                <div style={{
                  marginTop: 12,
                  padding: '9px 11px',
                  borderRadius: 8,
                  background: '#fdecec',
                  color: '#a4131a',
                  fontSize: '0.85rem',
                  border: '1px solid #f5c1c4',
                }}>
                  {requestError}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <button
                  type="submit"
                  disabled={requestBusy || !email.trim()}
                  style={primaryButton(requestBusy || !email.trim())}
                >
                  {requestBusy ? 'Sending…' : 'Send reset link'}
                </button>
              </div>
            </form>
          )}

          {/* ── Request mode — sent confirmation ── */}
          {mode === 'request' && requestSent && (
            <div>
              <div style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: '#e6f4ec',
                border: '1px solid #b4dcc4',
                color: '#1a5b34',
                fontSize: '0.92rem',
                lineHeight: 1.5,
                marginBottom: 16,
              }}>
                {REQUEST_SUCCESS_COPY}
              </div>
              <p style={{
                fontSize: '0.85rem',
                color: 'var(--cl-text-light)',
                lineHeight: 1.5,
                margin: 0,
              }}>
                Didn&apos;t get the email? Check the address you entered and try
                again, or contact{' '}
                <a
                  href="mailto:civicview@civicview.app"
                  style={{ color: 'var(--cl-accent)', fontWeight: 600 }}
                >
                  civicview@civicview.app
                </a>.
              </p>
              <div style={{ marginTop: 18 }}>
                <button
                  type="button"
                  onClick={() => {
                    // Let the user re-submit with a corrected address
                    // without making them navigate away + back.
                    setRequestSent(false);
                    setEmail('');
                  }}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--cl-border)',
                    background: 'white',
                    color: 'var(--cl-text)',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    fontFamily: 'var(--cl-font-sans)',
                    cursor: 'pointer',
                  }}
                >
                  Try a different email
                </button>
              </div>
            </div>
          )}

          {/* ── Confirm mode ── */}
          {mode === 'confirm' && !confirmDone && (
            <form onSubmit={submitConfirm}>
              <p style={{
                fontSize: '0.92rem',
                lineHeight: 1.5,
                color: 'var(--cl-text-light)',
                margin: '0 0 18px 0',
              }}>
                Choose a new password for your {kindLabel} account. Pick something
                you haven&apos;t used elsewhere — at least 8 characters.
              </p>

              <label style={labelStyle} htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setConfirmError(null); }}
                style={inputStyle}
                minLength={8}
                disabled={confirmBusy}
                required
              />

              <label style={{ ...labelStyle, marginTop: 14 }} htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setConfirmError(null); }}
                style={inputStyle}
                minLength={8}
                disabled={confirmBusy}
                required
              />

              {confirmError && (
                <div style={{
                  marginTop: 12,
                  padding: '9px 11px',
                  borderRadius: 8,
                  background: '#fdecec',
                  color: '#a4131a',
                  fontSize: '0.85rem',
                  border: '1px solid #f5c1c4',
                }}>
                  {confirmError}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <button
                  type="submit"
                  disabled={confirmBusy || newPassword.length < 8 || newPassword !== confirmPassword}
                  style={primaryButton(
                    confirmBusy || newPassword.length < 8 || newPassword !== confirmPassword,
                  )}
                >
                  {confirmBusy ? 'Saving…' : 'Update password'}
                </button>
              </div>
            </form>
          )}

          {/* ── Confirm mode — success ── */}
          {mode === 'confirm' && confirmDone && (
            <div>
              <div style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: '#e6f4ec',
                border: '1px solid #b4dcc4',
                color: '#1a5b34',
                fontSize: '0.92rem',
                lineHeight: 1.5,
              }}>
                Your password has been updated. We sent a confirmation email
                so you have a record of the change. Sending you home…
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Next.js requires useSearchParams to live under a Suspense boundary
// during the client-side render of pages that use SSR — wrapping here
// keeps the build from emitting the standard
// "useSearchParams() should be wrapped in Suspense" warning.
export default function PasswordResetPage() {
  return (
    <Suspense fallback={null}>
      <PasswordResetInner />
    </Suspense>
  );
}
