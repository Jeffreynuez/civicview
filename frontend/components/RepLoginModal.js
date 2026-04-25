'use client';

import { useEffect, useState } from 'react';
import { loginRep } from '../lib/auth';

/**
 * Rep / candidate login modal.
 *
 * Phase 1 is demo-only: credentials come from the seeded demo_accounts.json
 * on the backend. The modal is a thin email/password form that hits
 * /api/auth/login, which sets a signed httpOnly session cookie and returns
 * the Me payload. Success bubbles the fresh `me` up via onSuccess.
 *
 * We surface the demo credentials in a collapsed "Show demo logins" panel
 * so investors don't have to leave the room to try it — but the panel is
 * hidden by default so real users aren't confused by it.
 *
 * Props:
 *   open            — controls mount
 *   onClose()       — dismiss without signing in
 *   onSuccess(me)   — called after a successful login
 *   initialEmail    — optional pre-fill (e.g. when opened from a page's
 *                     "Claim this page" CTA we can suggest the rep's email)
 */
const DEMO_ACCOUNTS = [
  { label: 'Rep. Byron Donalds (FL-19)', email: 'byron.donalds@civiclens-demo.com' },
  { label: 'Sen. Bernie Sanders (VT)', email: 'bernie.sanders@civiclens-demo.com' },
  { label: 'Gov. Ron DeSantis (FL)', email: 'ron.desantis@civiclens-demo.com' },
  { label: 'Donalds 2026 campaign', email: 'donalds.campaign@civiclens-demo.com' },
];
const DEMO_PASSWORD = 'CivicLensDemo!2026';

export default function RepLoginModal({ open, onClose, onSuccess, initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail || '');
      setPassword('');
      setErr(null);
      setBusy(false);
      setShowDemo(false);
    }
  }, [open, initialEmail]);

  // ESC to dismiss
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const { ok, error } = await loginRep(email.trim(), password);
    setBusy(false);
    if (!ok) {
      setErr(error || 'Invalid email or password');
      return;
    }
    if (onSuccess) onSuccess();
  };

  const fillDemo = (account) => {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rep login"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,30,60,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1400,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: '14px',
          width: 'min(420px, calc(100vw - 32px))',
          // Cap the modal to the viewport with internal scrolling so the
          // demo-logins list never pushes the Sign in button off-screen
          // on short viewports (notebooks, some Windows DPI settings).
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          padding: '22px 22px 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>
            Sign in to your page
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: '1.3rem', lineHeight: 1, color: 'var(--text-light)',
            }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginBottom: '14px', lineHeight: 1.45 }}>
          Verified representatives and candidates can post updates, attach polls,
          and publish events. Demo accounts below for the preview — production
          will use a verified email + identity check.
        </p>

        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          placeholder="you@example.gov"
          style={{
            width: '100%', padding: '9px 11px', borderRadius: '8px',
            border: '1px solid var(--border)', fontSize: '0.9rem',
            marginBottom: '10px', boxSizing: 'border-box', color: 'var(--text)',
            background: 'white',
          }}
        />

        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="••••••••"
          style={{
            width: '100%', padding: '9px 11px', borderRadius: '8px',
            border: '1px solid var(--border)', fontSize: '0.9rem',
            marginBottom: '10px', boxSizing: 'border-box', color: 'var(--text)',
            background: 'white',
          }}
        />

        {err && (
          <div
            role="alert"
            style={{
              marginBottom: '10px', padding: '8px 10px',
              background: '#fde8e8', color: '#b13b3b',
              borderRadius: '8px', fontSize: '0.8rem',
              border: '1px solid #f4c7c7',
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              border: '1px solid var(--border)', background: 'white',
              color: 'var(--text-light)', padding: '8px 14px',
              borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              border: '1px solid var(--accent)',
              background: canSubmit ? 'var(--accent)' : 'var(--bg)',
              color: canSubmit ? 'white' : 'var(--text-light)',
              padding: '8px 18px', borderRadius: '8px',
              fontSize: '0.88rem', fontWeight: 700,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        {/* Collapsible demo-accounts panel — hidden by default, shown on demand */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed var(--border)' }}>
          <button
            type="button"
            onClick={() => setShowDemo((s) => !s)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600,
              padding: '0',
            }}
          >
            {showDemo ? '▾ Hide demo logins' : '▸ Show demo logins (preview only)'}
          </button>
          {showDemo && (
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => fillDemo(a)}
                  style={{
                    textAlign: 'left',
                    padding: '6px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--bg)', color: 'var(--text)',
                    fontSize: '0.78rem', cursor: 'pointer',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <div style={{ fontWeight: 700 }}>{a.label}</div>
                  <div style={{ color: 'var(--text-light)', fontSize: '0.72rem' }}>
                    {a.email}
                  </div>
                </button>
              ))}
              <div style={{ color: 'var(--text-light)', fontSize: '0.72rem', marginTop: '4px', fontStyle: 'italic' }}>
                Shared demo password: <code style={{ fontSize: '0.72rem' }}>{DEMO_PASSWORD}</code>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
