'use client';

import { useEffect, useState } from 'react';
import { loginRep } from '../lib/auth';
import CivicLensLogo from './brand/CivicLensLogo';
import { ModalShell, Button } from './ui';

/**
 * Rep / candidate login modal.
 *
 * Phase 1 is demo-only: credentials come from the seeded demo_accounts.json
 * on the backend. The modal is a thin email/password form that hits
 * /api/auth/login, which sets a signed httpOnly session cookie and returns
 * the Me payload. Success bubbles the fresh `me` up via onSuccess.
 *
 * Demo credentials surface in a collapsed "Show demo logins" panel — hidden
 * by default so real users aren't confused.
 *
 * Phase 3A: restyled to use the design system. Combined "Email or password"
 * error message (security best practice — don't leak email existence).
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

const FIELD_LABEL = {
  display: 'block',
  fontSize: 'var(--cl-text-xs)',
  fontWeight: 600,
  color: 'var(--cl-text)',
  marginBottom: 4,
};

const FIELD_INPUT = {
  width: '100%',
  height: 38,
  padding: '0 12px',
  borderRadius: 'var(--cl-radius-md)',
  border: '1px solid var(--cl-border)',
  fontSize: 'var(--cl-text-sm)',
  fontFamily: 'var(--cl-font-sans)',
  color: 'var(--cl-text)',
  background: 'var(--cl-card)',
  boxSizing: 'border-box',
  outline: 'none',
};

export default function RepLoginModal({ open, onClose, onSuccess, initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail || '');
      setPassword('');
      setShowPw(false);
      setErr(null);
      setBusy(false);
      setShowDemo(false);
    }
  }, [open, initialEmail]);

  if (!open) return null;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const { ok, error } = await loginRep(email.trim(), password);
    setBusy(false);
    if (!ok) {
      // Security note: do NOT reveal whether the email exists.
      // Combined message keeps enumeration attacks at bay.
      setErr(error || "Email or password didn't match. Try again or reset it.");
      return;
    }
    if (onSuccess) onSuccess();
  };

  const fillDemo = (account) => {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    setErr(null);
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      width={440}
      cardStyle={{ padding: '24px 24px 16px' }}
    >
      {/* Brand mark + heading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <CivicLensLogo size={28} variant="color" />
        <span
          style={{
            fontFamily: 'var(--cl-font-display)',
            fontWeight: 700,
            fontSize: 'var(--cl-text-md)',
            color: 'var(--cl-text)',
          }}
        >
          CivicLens
        </span>
      </div>

      <h2 className="cl-h1" style={{ margin: 0, marginBottom: 6 }}>
        Sign in to your page
      </h2>
      <p
        className="cl-body-sm"
        style={{ color: 'var(--cl-text-light)', margin: 0, marginBottom: 18 }}
      >
        Verified representatives and candidates can post updates, attach polls,
        and publish events.
      </p>

      {/* Email */}
      <label htmlFor="rep-login-email" style={FIELD_LABEL}>
        Email
      </label>
      <input
        id="rep-login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
        placeholder="you@example.gov"
        disabled={busy}
        style={{ ...FIELD_INPUT, marginBottom: 12 }}
      />

      {/* Password with show/hide */}
      <label htmlFor="rep-login-password" style={FIELD_LABEL}>
        Password
      </label>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <input
          id="rep-login-password"
          type={showPw ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="••••••••"
          disabled={busy}
          style={{ ...FIELD_INPUT, paddingRight: 56 }}
        />
        <button
          type="button"
          onClick={() => setShowPw((s) => !s)}
          tabIndex={-1}
          aria-label={showPw ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute',
            right: 10,
            top: 0,
            bottom: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--cl-text-light)',
            fontSize: 'var(--cl-text-xs)',
            cursor: 'pointer',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          {showPw ? 'Hide' : 'Show'}
        </button>
      </div>

      {err && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: '8px 10px',
            background: 'var(--cl-danger-soft)',
            color: 'var(--cl-danger-text)',
            borderRadius: 'var(--cl-radius-md)',
            fontSize: 'var(--cl-text-xs)',
            border: '1px solid var(--cl-danger-border)',
          }}
        >
          {err}
        </div>
      )}

      {/* Actions */}
      <Button
        variant="primary"
        size="lg"
        onClick={submit}
        loading={busy}
        disabled={!canSubmit}
        style={{ width: '100%', marginBottom: 8 }}
      >
        Sign in
      </Button>

      {/* Demo accounts — collapsed by default */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px dashed var(--cl-border)',
        }}
      >
        <button
          type="button"
          onClick={() => setShowDemo((s) => !s)}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--cl-accent)',
            fontSize: 'var(--cl-text-xs)',
            fontWeight: 600,
            padding: 0,
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          {showDemo ? '▾ Hide demo logins' : '▸ Show demo logins (preview only)'}
        </button>
        {showDemo && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => fillDemo(a)}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: '1px solid var(--cl-border)',
                  borderRadius: 'var(--cl-radius-sm)',
                  background: 'var(--cl-bg)',
                  color: 'var(--cl-text)',
                  fontSize: 'var(--cl-text-xs)',
                  cursor: 'pointer',
                  fontFamily: 'var(--cl-font-sans)',
                  transition: 'border-color var(--cl-duration-fast) var(--cl-ease-standard)',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'var(--cl-accent)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--cl-border)';
                }}
              >
                <div style={{ fontWeight: 700 }}>{a.label}</div>
                <div
                  style={{
                    color: 'var(--cl-text-light)',
                    fontSize: 'var(--cl-text-2xs)',
                    fontFamily: 'var(--cl-font-mono)',
                  }}
                >
                  {a.email}
                </div>
              </button>
            ))}
            <div
              style={{
                color: 'var(--cl-text-muted)',
                fontSize: 'var(--cl-text-2xs)',
                marginTop: 4,
                fontStyle: 'italic',
              }}
            >
              Shared demo password:{' '}
              <code
                style={{
                  fontSize: 'var(--cl-text-2xs)',
                  fontFamily: 'var(--cl-font-mono)',
                  background: 'var(--cl-bg-soft)',
                  padding: '1px 5px',
                  borderRadius: 'var(--cl-radius-xs)',
                }}
              >
                {DEMO_PASSWORD}
              </code>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
