'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { joinWaitlist } from '../lib/pagesApi';
import CivicLensLogo from './brand/CivicLensLogo';
import { ModalShell, Button, EmptyState, CheckCircle } from './ui';

/**
 * Citizen waitlist modal.
 *
 * Phase 1 doesn't have verified US-citizen accounts yet — those need a KYC
 * step we haven't built — but the product story is that verified citizens
 * will be able to comment on reps' posts, vote in polls without a cookie
 * token, and RSVP to events. For the demo we capture interested emails so
 * we can come back to them when verification ships.
 *
 * Phase 3A: restyled to use design system primitives.
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
  "Comments and citizen-only polls are coming in Phase 2, gated on a one-time ID verification so every voice in the thread belongs to a real US voter. Leave your email and we'll let you in as soon as it opens.";

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

export default function CitizenWaitlistModal({
  open, onClose, clickedFrom = 'comment',
  headline = DEFAULT_HEADLINE, pitch = DEFAULT_PITCH,
}) {
  const [email, setEmail] = useState('');
  const [stateField, setStateField] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setStateField('');
      setErr(null);
      setBusy(false);
      setDone(false);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = email.trim().length > 3 && email.includes('@') && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const { error } = await joinWaitlist({
      email: email.trim(),
      clickedFrom,
      state: stateField.trim() || undefined,
    });
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setDone(true);
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      width={440}
      cardStyle={{ padding: '24px 24px 16px' }}
    >
      {/* Brand mark */}
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
          CivicView
        </span>
      </div>

      {done ? (
        <EmptyState
          icon={<CheckCircle size={36} active color="accent" />}
          headline="You're on the list"
          body={
            <>
              We&rsquo;ll email <strong>{email}</strong> the moment verified
              citizen accounts open up.
            </>
          }
          cta={{ label: 'Close', onClick: onClose }}
        />
      ) : (
        <>
          <h2 className="cl-h1" style={{ margin: 0, marginBottom: 6 }}>
            {headline}
          </h2>
          <p
            className="cl-body-sm"
            style={{ color: 'var(--cl-text-light)', margin: 0, marginBottom: 14 }}
          >
            {pitch}
          </p>

          <label htmlFor="waitlist-email" style={FIELD_LABEL}>
            Email
          </label>
          <input
            id="waitlist-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            autoFocus
            placeholder="you@example.com"
            disabled={busy}
            style={{ ...FIELD_INPUT, marginBottom: 12 }}
          />

          <label htmlFor="waitlist-state" style={FIELD_LABEL}>
            State{' '}
            <span style={{ color: 'var(--cl-text-light)', fontWeight: 400 }}>
              (optional)
            </span>
          </label>
          <input
            id="waitlist-state"
            type="text"
            value={stateField}
            onChange={(e) => setStateField(e.target.value.slice(0, 32))}
            placeholder="FL"
            disabled={busy}
            style={{ ...FIELD_INPUT, marginBottom: 12 }}
          />

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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button
              variant="outline"
              size="md"
              onClick={onClose}
              disabled={busy}
            >
              Not now
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={submit}
              loading={busy}
              disabled={!canSubmit}
            >
              Join waitlist
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
