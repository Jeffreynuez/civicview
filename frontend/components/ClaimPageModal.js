'use client';

import { useEffect, useState } from 'react';
import { joinWaitlist } from '../lib/pagesApi';

/**
 * Claim-this-page modal.
 *
 * Shown when a visitor clicks "Claim this page" on an unclaimed rep or
 * candidate page. In the demo we don't run real verification — production
 * will need an identity check (OIG / FEC / state bar / etc.). For now we:
 *   1. Tell them what verification will actually entail.
 *   2. Capture a contact email so we can follow up once verification ships.
 *   3. Offer "I already have an account" that routes to RepLoginModal.
 *
 * Props:
 *   open           — controls mount
 *   onClose()      — dismiss
 *   onSignInInstead() — parent swaps this modal for RepLoginModal
 *   officialName   — display name for the page being claimed
 *   officialId     — seed id; stamped on the waitlist row for analytics
 */
export default function ClaimPageModal({
  open, onClose, onSignInInstead, officialName, officialId,
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setName(''); setEmail(''); setNote(''); setErr(null);
      setBusy(false); setDone(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = email.trim().length > 3 && email.includes('@') && name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    // Reuse the waitlist endpoint. The requester's legal name, the target
    // page id, and their free-form note all flow through the proper `note`
    // field so the backend can store the full blob (up to 2000 chars)
    // rather than overloading the 2-char `state` column.
    const noteBlob = [
      `claim:${officialId || 'unknown'}`,
      name.trim() && `name:${name.trim()}`,
      note.trim() && `note:${note.trim()}`,
    ].filter(Boolean).join(' | ').slice(0, 2000);
    const { error } = await joinWaitlist({
      email: email.trim(),
      clickedFrom: 'claim',
      note: noteBlob,
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
      aria-label={`Claim ${officialName || 'this page'}`}
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
          width: 'min(480px, calc(100vw - 32px))',
          padding: '22px 22px 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>
            {done ? 'Request received' : `Claim ${officialName || 'this page'}`}
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
              Thanks — once verified identity checks are live we&rsquo;ll reach out to{' '}
              <strong>{email}</strong> to finish the handoff. Until then, this page
              stays in read-only mode so nobody can post as {officialName || 'this official'}.
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
              This page is a placeholder — verified reps and candidates control
              their own content. Claiming requires identity verification
              (government ID + proof of office or candidacy). The full flow
              lands in the next phase; leave your details and we&rsquo;ll reach out.
            </p>

            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
              Your full legal name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 120))}
              autoFocus
              placeholder={officialName || 'Jane Doe'}
              style={{
                width: '100%', padding: '9px 11px', borderRadius: '8px',
                border: '1px solid var(--border)', fontSize: '0.9rem',
                marginBottom: '10px', boxSizing: 'border-box', color: 'var(--text)',
                background: 'white',
              }}
            />

            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
              Official email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourdomain.gov"
              style={{
                width: '100%', padding: '9px 11px', borderRadius: '8px',
                border: '1px solid var(--border)', fontSize: '0.9rem',
                marginBottom: '10px', boxSizing: 'border-box', color: 'var(--text)',
                background: 'white',
              }}
            />

            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)', marginBottom: '4px' }}>
              Note <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="Chief of staff, campaign manager, etc."
              style={{
                width: '100%', padding: '9px 11px', borderRadius: '8px',
                border: '1px solid var(--border)', fontSize: '0.9rem',
                marginBottom: '10px', boxSizing: 'border-box', color: 'var(--text)',
                background: 'white', resize: 'vertical', fontFamily: 'inherit',
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

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => { if (onSignInInstead) onSignInInstead(); }}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--accent)', fontSize: '0.82rem',
                  fontWeight: 600, cursor: 'pointer', padding: '4px 0',
                }}
              >
                I already have an account → sign in
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
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
                  {busy ? 'Sending…' : 'Request claim'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
