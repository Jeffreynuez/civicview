'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * LoginChallengeStep — the second step of a 2FA-gated login flow.
 *
 * Rendered by RepLoginModal / CitizenLoginModal / CandidateLoginModal
 * when their primary `login*()` call returns
 * `{ twoFactorRequired: true, challengeToken }` instead of `{ ok: true }`.
 * Collects the user's 6-digit TOTP code (or recovery code) and
 * invokes the parent's `onVerify(code)` handler — the parent is
 * responsible for calling the matching `completeLogin*()` lib
 * function and handling success / failure.
 *
 * Identity-agnostic by design: the parent already knows whether
 * the challenge is for a rep, citizen, or candidate, so this
 * component just renders the input + buttons and delegates the
 * actual API call to the parent.
 *
 * Props:
 *   onVerify(code)  — async (code: string) → { ok, error }
 *                     Called when the user submits the code. Parent
 *                     decides what counts as success (close modal,
 *                     navigate, etc.). If the returned object has
 *                     ok=false, error is surfaced inline.
 *   onCancel()      — collapse the challenge step back to step 1
 *                     (email + password) so the user can restart.
 *                     Backend invalidates the challenge token on
 *                     code mismatch, so we need a full restart
 *                     rather than letting the user retry the code.
 *   identityLabel   — display string, e.g. "rep", "citizen",
 *                     "candidate". Shown in the helper copy so the
 *                     user knows which of their three accounts the
 *                     code is for.
 */

import { useEffect, useRef, useState } from 'react';

export default function LoginChallengeStep({ onVerify, onCancel, identityLabel = 'account' }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Auto-focus the code input so the user can paste / type immediately
  // without an extra click.
  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!code.trim()) {
      setError('Enter the 6-digit code from your authenticator app, or a recovery code.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onVerify(code.trim());
    setBusy(false);
    if (result && !result.ok) {
      setError(result.error || 'Code verification failed.');
      // The challenge token was consumed server-side regardless of
      // success — bounce the user back to the password step so they
      // can mint a fresh challenge.
      setTimeout(() => {
        onCancel?.();
      }, 1800);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        background: 'var(--cl-accent-soft, #e6f4ea)',
        border: '1px solid var(--cl-accent, #2e7d32)',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: '0.85rem',
        color: 'var(--cl-text)',
      }}>
        <strong>Two-factor authentication required.</strong> Enter the
        6-digit code from your authenticator app for this {identityLabel}{' '}
        account, or one of your saved recovery codes.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--cl-text)' }}>
          Code
        </span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={busy}
          // 6 for TOTP, 11 for the XXXXX-XXXXX recovery format.
          maxLength={11}
          style={{
            padding: '10px 12px',
            border: '1px solid var(--cl-border)',
            borderRadius: 8,
            fontSize: '1.05rem',
            fontFamily: 'monospace',
            letterSpacing: '0.1em',
            background: 'white',
            color: 'var(--cl-text)',
          }}
        />
      </label>

      {error && (
        <div style={{
          background: '#fdecea', border: '1px solid #f6b4ad',
          color: '#a3261c', borderRadius: 8, padding: '8px 12px',
          fontSize: '0.82rem',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '10px 18px', borderRadius: 8,
            background: 'var(--cl-accent, #2e7d32)', color: 'white',
            border: 'none', fontSize: '0.9rem', fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Verifying…' : 'Verify & sign in'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: '10px 14px', borderRadius: 8,
            background: 'white', color: 'var(--cl-text)',
            border: '1px solid var(--cl-border)',
            fontSize: '0.9rem', fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          Restart login
        </button>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', lineHeight: 1.5 }}>
        Lost your authenticator AND your recovery codes? Email{' '}
        <a href="mailto:civicview@civicview.app" style={{ color: 'var(--cl-accent, #2e7d32)' }}>
          civicview@civicview.app
        </a>{' '}
        for an admin-assisted reset.
      </div>
    </form>
  );
}
