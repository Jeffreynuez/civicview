'use client';

import { useEffect, useState } from 'react';
import { joinWaitlist } from '../lib/pagesApi';

/**
 * Citizen waitlist modal.
 *
 * Phase 1 doesn't have verified US-citizen accounts yet — those need a KYC
 * step we haven't built — but the product story is that verified citizens
 * will be able to comment on reps' posts, vote in polls without a cookie
 * token, and RSVP to events. For the demo we capture interested emails so
 * we can come back to them when verification ships.
 *
 * Props:
 *   open            — controls mount
 *   onClose()       — dismiss
 *   clickedFrom     — 'comment' | 'subscribe' | 'claim'  (analytics hint)
 *   headline        — optional override for the <h2>
 *   pitch           — optional override for the body paragraph
 */
const DEFAULT_HEADLINE = 'Join the citizen waitlist';
const DEFAULT_PITCH =
  'Comments and citizen-only polls are coming in Phase 2, gated on a one-time ID verification so every voice in the thread belongs to a real US voter. Leave your email and we\'ll let you in as soon as it opens.';

export default function CitizenWaitlistModal({
  open, onClose, clickedFrom = 'comment',
  headline = DEFAULT_HEADLINE, pitch = DEFAULT_PITCH,
}) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(''); setState(''); setErr(null); setBusy(false); setDone(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = email.trim().length > 3 && email.includes('@') && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const { error } = await joinWaitlist({
      email: email.trim(),
      clickedFrom,
      state: state.trim() || undefined,
    });
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setDone(true);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={headline}
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
          width: 'min(440px, calc(100vw - 32px))',
          padding: '22px 22px 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>
            {done ? 'You\'re on the list' : headline}
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

        {done ? (
          <>
            <p style={{ fontSize: '0.88rem', color: 'var(--text)', lineHeight: 1.5 }}>
              Thanks — we&rsquo;ll email you at <strong>{email}</strong> the moment verified
              citizen accounts open up.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  border: '1px solid var(--accent)', background: 'var(--accent)',
                  color: 'white', padding: '8px 18px', borderRadius: '8px',
                  fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', lineHeight: 1.5, marginBottom: '14px' }}>
              {pitch}
            </p>

            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              autoFocus
              placeholder="you@example.com"
              style={{
                width: '100%', padding: '9px 11px', borderRadius: '8px',
                border: '1px solid var(--border)', fontSize: '0.9rem',
                marginBottom: '10px', boxSizing: 'border-box', color: 'var(--text)',
                background: 'white',
              }}
            />

            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
              State <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              type="text"
              value={state}
              onChange={(e) => setState(e.target.value.slice(0, 32))}
              placeholder="FL"
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
                Not now
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
                {busy ? 'Saving…' : 'Join waitlist'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
