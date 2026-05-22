'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * AppealModal — collects an appeal rationale and submits it.
 *
 * Used from the citizen / rep dashboard's "Hidden by moderation"
 * surface (one click per row). The same component handles every
 * target_kind because the UX is identical — only the preview text +
 * target metadata differ, and those are passed in as props.
 *
 * On success: calls onSuccess(updatedAppealRow) so the parent can
 * swap the row's UI from "Appeal" button to "Pending" pill without
 * a refetch round-trip. On failure (409 already-appealed, 400
 * window-closed, etc.): surfaces the server's detail message
 * inline so the user can decide whether to retry or close.
 *
 * Props:
 *   open              — boolean, controls mount
 *   onClose()         — dismiss without submitting
 *   onSuccess(appeal) — fired after a successful submit; parent
 *                       decides whether to refetch or just patch
 *                       the row in place
 *   target            — { kind, id, preview, hide_reason, hidden_at }
 *                       describing what's being appealed (for the
 *                       modal's title + preview block)
 */
import { useEffect, useState } from 'react';
import { submitAppeal } from '@/lib/pagesApi';

const KIND_LABEL = {
  post: 'post',
  post_comment: 'comment',
  poll: 'poll',
  poll_comment: 'poll comment',
};

const MIN_CHARS = 50;
const MAX_CHARS = 1000;

export default function AppealModal({ open, onClose, onSuccess, target }) {
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset state when reopened. Without this, a previous error or
  // half-typed rationale persists after the user dismisses + reopens.
  useEffect(() => {
    if (open) {
      setRationale('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open || !target) return null;

  const charCount = rationale.length;
  const canSubmit = charCount >= MIN_CHARS && charCount <= MAX_CHARS && !submitting;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await submitAppeal({
      targetKind: target.kind,
      targetId: target.id,
      rationale: rationale.trim(),
    });
    setSubmitting(false);
    if (err || !data) {
      setError(err || 'Could not submit appeal.');
      return;
    }
    onSuccess?.(data);
  };

  return (
    <div
      role="dialog"
      aria-label="Appeal moderation decision"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 250,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          padding: 20,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
            Appeal this hidden {KIND_LABEL[target.kind] || 'content'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--cl-text-light)',
              fontSize: '0.9rem', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
        </div>

        <p style={{ fontSize: '0.86rem', color: 'var(--cl-text-light)', margin: 0, lineHeight: 1.5 }}>
          Explain why you believe the moderation decision was wrong.
          An admin will review and either grant the appeal (your
          content is restored) or deny it (the moderation stands —
          and that&rsquo;s the final word). You only get one shot
          per item.
        </p>

        <div
          style={{
            background: 'var(--cl-bg-soft)',
            border: '1px solid var(--cl-border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: '0.86rem',
            color: 'var(--cl-text)',
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cl-text-light)', fontWeight: 700, marginBottom: 4 }}>
            Hidden content
          </div>
          {target.preview || <em style={{ color: 'var(--cl-text-muted)' }}>(empty)</em>}
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
            Your rationale ({MIN_CHARS}–{MAX_CHARS} characters)
          </span>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value.slice(0, MAX_CHARS))}
            placeholder="What context is the moderator missing? Why should this be restored?"
            rows={6}
            style={{
              padding: '8px 10px',
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              fontSize: '0.92rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <span
            style={{
              fontSize: '0.7rem',
              color: charCount < MIN_CHARS ? 'var(--cl-text-light)' : 'var(--cl-accent)',
              alignSelf: 'flex-end',
            }}
          >
            {charCount}/{MAX_CHARS}
            {charCount < MIN_CHARS && ` — at least ${MIN_CHARS - charCount} more characters needed`}
          </span>
        </label>

        {error && (
          <div
            role="alert"
            style={{
              color: '#d63031',
              fontSize: '0.84rem',
              background: 'var(--cl-danger-soft)',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--cl-danger-border)',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px',
              background: 'white',
              border: '1px solid var(--cl-border)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: '8px 16px',
              background: canSubmit ? 'var(--cl-accent)' : 'var(--cl-border)',
              color: canSubmit ? 'white' : 'var(--cl-text-light)',
              border: '1px solid var(--cl-accent)',
              borderRadius: 8,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit appeal'}
          </button>
        </div>
      </form>
    </div>
  );
}
