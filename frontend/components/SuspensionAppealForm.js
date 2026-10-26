'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Inline suspension appeal, shown after a sign-in comes back suspended
 * (2026-10-26). Used by the candidate sign-in, which had no way to
 * appeal; the rep and citizen sign-ins carry their own copies of the
 * same flow. Posts to /api/appeals/suspension with the email and
 * password just typed, which proves who is appealing without issuing a
 * session. The server answers the same way whatever went wrong.
 *
 * Props:
 *   message   the server's suspension message, shown first
 *   email, password   what the person just signed in with
 *   onBack()  leave the appeal and go back to the sign-in form
 */

import { useState } from 'react';

import { submitSuspensionAppeal } from '../lib/pagesApi';
import { Button } from './ui';

const MIN = 50;
const MAX = 1000;
const CONTACT_EMAIL = 'civicview@civicview.app';

export default function SuspensionAppealForm({ message, email, password, onBack }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed.length < MIN || busy) return;
    setBusy(true);
    const { data, error } = await submitSuspensionAppeal({ email: email.trim(), password, rationale: trimmed });
    setBusy(false);
    if (error || !data) {
      setResult({ ok: false, message: error || 'Could not file the appeal. Try again, or email us.' });
      return;
    }
    setResult({ ok: true, message: data.message });
  };

  if (result) {
    return (
      <div
        role="status"
        style={{
          padding: 12,
          background: result.ok ? 'var(--cl-up-soft)' : 'var(--cl-danger-soft)',
          color: result.ok ? 'var(--cl-text)' : 'var(--cl-danger-text)',
          border: `1px solid ${result.ok ? 'var(--cl-up)' : 'var(--cl-danger-border)'}`,
          borderRadius: 'var(--cl-radius-md)',
          fontSize: 'var(--cl-text-sm)',
          lineHeight: 1.5,
        }}
      >
        {result.message}
      </div>
    );
  }

  const short = text.trim().length < MIN;
  return (
    <div
      role="region"
      aria-label="Suspension appeal"
      style={{
        padding: 14,
        background: 'var(--cl-danger-soft)',
        border: '1px solid var(--cl-danger-border)',
        borderRadius: 'var(--cl-radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 'var(--cl-text-sm)', color: 'var(--cl-danger-text)', lineHeight: 1.5 }}>{message}</div>
      <label
        htmlFor="suspension-appeal-text"
        style={{ fontSize: 'var(--cl-text-xs)', color: 'var(--cl-text)', lineHeight: 1.5 }}
      >
        Think this was wrong? Tell us why in {MIN} to {MAX} characters and we&rsquo;ll review it.
        An admin will email you the outcome.
      </label>
      <textarea
        id="suspension-appeal-text"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX))}
        placeholder="Why should this suspension be reconsidered?"
        rows={5}
        disabled={busy}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--cl-border)',
          borderRadius: 'var(--cl-radius-md)',
          fontSize: 'var(--cl-text-sm)',
          fontFamily: 'inherit',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--cl-text-2xs)', color: short ? 'var(--cl-text-light)' : 'var(--cl-accent)' }}>
          {text.length}/{MAX}
          {short && `, at least ${MIN - text.trim().length} more`}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>Back</Button>
          <Button type="button" variant="primary" onClick={submit} loading={busy} disabled={short || busy}>
            Submit appeal
          </Button>
        </div>
      </div>
      <div style={{ fontSize: 'var(--cl-text-2xs)', color: 'var(--cl-text-light)' }}>
        Prefer email? Write to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--cl-accent)', textDecoration: 'underline' }}>
          {CONTACT_EMAIL}
        </a>.
      </div>
    </div>
  );
}
