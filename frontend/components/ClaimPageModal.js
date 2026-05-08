'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';
import { joinWaitlist, fetchCitizenPolls } from '../lib/pagesApi';
import CivicLensLogo from './brand/CivicLensLogo';
import { ModalShell, Button, EmptyState, CheckCircle } from './ui';

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
 * Phase 3A: restyled to use design system primitives.
 *
 * Props:
 *   open            — controls mount
 *   onClose()       — dismiss
 *   onSignInInstead() — parent swaps this modal for RepLoginModal
 *   officialName    — display name for the page being claimed
 *   officialId      — seed id; stamped on the waitlist row for analytics
 */

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

export default function ClaimPageModal({
  open, onClose, onSignInInstead, officialName, officialId,
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  // Number of in-flight citizen polls on this page. We surface the
  // count + a brief explanation so a rep claiming the page knows
  // those polls will move into a Pre-claim discussion archive once
  // they're verified — no surprises after the fact. Fire-and-forget;
  // a fetch failure just hides the section.
  const [citizenPollCount, setCitizenPollCount] = useState(null);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setNote('');
      setErr(null);
      setBusy(false);
      setDone(false);
      setCitizenPollCount(null);
      if (officialId) {
        let cancelled = false;
        (async () => {
          const { data } = await fetchCitizenPolls(officialId);
          if (cancelled) return;
          setCitizenPollCount(
            data?.active_count != null ? data.active_count : (data?.active?.length ?? null),
          );
        })();
        return () => { cancelled = true; };
      }
    }
    return undefined;
  }, [open, officialId]);

  if (!open) return null;

  const canSubmit =
    email.trim().length > 3 &&
    email.includes('@') &&
    name.trim().length > 0 &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const noteBlob = [
      `claim:${officialId || 'unknown'}`,
      name.trim() && `name:${name.trim()}`,
      note.trim() && `note:${note.trim()}`,
    ]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 2000);
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
    <ModalShell
      open={open}
      onClose={onClose}
      width={480}
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
          headline="Request received"
          body={
            <>
              Once verified identity checks are live we&rsquo;ll reach out to{' '}
              <strong>{email}</strong> to finish the handoff. Until then, this
              page stays in read-only mode so nobody can post as{' '}
              {officialName || 'this official'}.
            </>
          }
          cta={{ label: 'Close', onClick: onClose }}
        />
      ) : (
        <>
          <h2 className="cl-h1" style={{ margin: 0, marginBottom: 6 }}>
            Claim {officialName || 'this page'}
          </h2>
          <p
            className="cl-body-sm"
            style={{ color: 'var(--cl-text-light)', margin: 0, marginBottom: 14 }}
          >
            This page is a placeholder — verified reps and candidates control
            their own content. Claiming requires identity verification
            (government ID + proof of office or candidacy). The full flow
            lands in the next phase; leave your details and we&rsquo;ll reach
            out.
          </p>

          {/* Heads-up about pre-claim discussion. Hidden when the count
              is null (still loading or fetch failed) or zero (nothing to
              archive — common case for less-trafficked pages). */}
          {citizenPollCount > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                background: 'var(--cl-accent-soft, #e6f4ea)',
                border: '1px solid var(--cl-accent-soft, #d8eedd)',
                borderRadius: 'var(--cl-radius-md)',
                fontSize: 'var(--cl-text-xs)',
                color: 'var(--cl-text)',
                lineHeight: 1.4,
              }}
            >
              <strong>Heads up:</strong> {citizenPollCount} citizen
              {citizenPollCount === 1 ? ' has' : 's have'} started{' '}
              {citizenPollCount === 1 ? 'a poll' : 'polls'} on this page
              already. After verification, {citizenPollCount === 1 ? 'it' : "they'll"} move into a
              "Pre-claim discussion" archive on your page so you can see what
              the community has been talking about. You can dismiss the
              section with one click.
            </div>
          )}

          <label htmlFor="claim-name" style={FIELD_LABEL}>
            Your full legal name
          </label>
          <input
            id="claim-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 120))}
            autoFocus
            placeholder={officialName || 'Jane Doe'}
            disabled={busy}
            style={{ ...FIELD_INPUT, marginBottom: 12 }}
          />

          <label htmlFor="claim-email" style={FIELD_LABEL}>
            Official email
          </label>
          <input
            id="claim-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourdomain.gov"
            disabled={busy}
            style={{ ...FIELD_INPUT, marginBottom: 12 }}
          />

          <label htmlFor="claim-note" style={FIELD_LABEL}>
            Note{' '}
            <span style={{ color: 'var(--cl-text-light)', fontWeight: 400 }}>
              (optional)
            </span>
          </label>
          <textarea
            id="claim-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="Chief of staff, campaign manager, etc."
            disabled={busy}
            style={{
              ...FIELD_INPUT,
              height: 'auto',
              padding: '8px 12px',
              marginBottom: 12,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
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

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (onSignInInstead) onSignInInstead();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--cl-accent)',
                fontSize: 'var(--cl-text-xs)',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '4px 0',
                fontFamily: 'var(--cl-font-sans)',
              }}
            >
              I already have an account → sign in
            </button>
            <Button
              variant="primary"
              size="md"
              onClick={submit}
              loading={busy}
              disabled={!canSubmit}
            >
              Request claim
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
