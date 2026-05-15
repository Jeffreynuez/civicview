'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /admin/appeals — appeals queue.
 *
 * Sibling of /admin (reports) and /admin/users (suspended accounts).
 * Lists every pending appeal — content + suspension — with target
 * preview, appellant identity, rationale, and Grant / Deny buttons.
 *
 * Granting restores the underlying content (clear deleted_at /
 * archived_at + hide_reason) OR lifts the suspension. Denying just
 * records the outcome; target stays hidden / suspended.
 *
 * Both actions accept an optional admin_note that surfaces in the
 * appellant's dashboard view + (Phase 4) the decision email.
 *
 * Same admin auth gate as the rest of /admin/*.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  adminWhoami,
  adminListAppeals,
  adminGrantAppeal,
  adminDenyAppeal,
} from '@/lib/pagesApi';

const KIND_LABEL = {
  post: 'Hidden post',
  post_comment: 'Hidden comment',
  poll: 'Hidden poll',
  poll_comment: 'Hidden poll comment',
  suspension_rep: 'Rep suspension',
  suspension_citizen: 'Citizen suspension',
};

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function AdminAppealsPage() {
  const [authState, setAuthState] = useState('probing');
  const [me, setMe] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [includeActed, setIncludeActed] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, status, error: err } = await adminWhoami();
      if (cancelled) return;
      if (status === 200 && data) {
        setMe(data);
        setAuthState('allowed');
      } else if (status === 403) {
        setAuthState('denied');
        setError(err || 'Admin access required.');
      } else if (status === 401) {
        setAuthState('unauthed');
      } else {
        setAuthState('denied');
        setError(err || 'Could not reach admin API.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await adminListAppeals({ includeActed });
    setLoading(false);
    if (err || !data) {
      setError(err || 'Could not load appeals.');
      return;
    }
    setItems(data.items || []);
  }, [includeActed]);

  useEffect(() => {
    if (authState === 'allowed') load();
  }, [authState, load]);

  const decide = async (appeal, decision) => {
    const verb = decision === 'granted' ? 'Grant' : 'Deny';
    // Two-step prompt: confirm action, then optional admin note.
    // The note is what the appellant sees alongside the decision —
    // worth thinking through, so we don't bury it in a small detail
    // field below the button.
    const ok = window.confirm(
      `${verb} this appeal from ${appeal.appellant_name}?\n\n` +
        (decision === 'granted'
          ? 'Their content will be restored / their suspension lifted.'
          : 'Their content stays hidden / suspension stands. They cannot re-appeal.'),
    );
    if (!ok) return;
    const note = window.prompt(
      `Optional note to ${appeal.appellant_name} (they'll see this in their dashboard / decision email). Leave empty to skip.`,
      '',
    );
    if (note === null) return;
    setBusyId(appeal.id);
    const fn = decision === 'granted' ? adminGrantAppeal : adminDenyAppeal;
    const { error: err } = await fn(appeal.id, { adminNote: note.trim() || null });
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    await load();
  };

  if (authState === 'probing') {
    return (
      <main style={{ padding: 40, fontFamily: 'var(--cl-font-sans)' }}>
        <p style={{ color: 'var(--cl-text-light)' }}>Checking admin access…</p>
      </main>
    );
  }

  if (authState === 'unauthed' || authState === 'denied') {
    return (
      <main style={{ padding: 40, fontFamily: 'var(--cl-font-sans)', maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 10 }}>
          {authState === 'unauthed' ? 'Sign in required' : 'Admin access required'}
        </h1>
        <p style={{ color: 'var(--cl-text-light)', lineHeight: 1.55 }}>
          {authState === 'unauthed'
            ? 'Sign in as a citizen or rep with an email on the ADMIN_EMAILS allowlist.'
            : 'Your account isn’t on the admin allowlist.'}
        </p>
        <p style={{ marginTop: 20 }}>
          <a href="/" style={{ color: 'var(--cl-accent)', fontWeight: 600 }}>← Back to CivicView</a>
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: '24px 20px 60px', fontFamily: 'var(--cl-font-sans)', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>Appeals queue</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <a href="/admin" style={{ color: 'var(--cl-accent)', fontSize: '0.9rem', fontWeight: 600 }}>← Reports</a>
          <a href="/admin/users" style={{ color: 'var(--cl-accent)', fontSize: '0.9rem', fontWeight: 600 }}>Suspended →</a>
          <a href="/" style={{ color: 'var(--cl-accent)', fontSize: '0.9rem', fontWeight: 600 }}>CivicView home</a>
        </div>
      </div>
      <p style={{ color: 'var(--cl-text-light)', fontSize: '0.9rem', marginTop: 0, marginBottom: 20 }}>
        Signed in as <strong>{me?.email}</strong> ({me?.kind}).
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--cl-text)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includeActed}
            onChange={(e) => setIncludeActed(e.target.checked)}
          />
          Include resolved appeals
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          style={{
            padding: '6px 14px',
            border: '1px solid var(--cl-border)',
            background: 'white',
            borderRadius: 6,
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--cl-danger-soft)',
            color: 'var(--cl-danger-text)',
            border: '1px solid var(--cl-danger-border)',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 14,
            fontSize: '0.86rem',
          }}
        >
          {error}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--cl-border)',
            borderRadius: 12,
            padding: '40px 24px',
            textAlign: 'center',
            color: 'var(--cl-text-light)',
            fontSize: '0.9rem',
          }}
        >
          {includeActed ? 'No appeals on file yet.' : 'No appeals waiting. 🎉'}
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((a) => (
            <AppealCard key={a.id} appeal={a} busy={busyId === a.id} onDecide={decide} />
          ))}
        </div>
      )}
    </main>
  );
}

function AppealCard({ appeal, busy, onDecide }) {
  const resolved = !!appeal.acted_at;
  const decisionTone =
    appeal.decision === 'granted'
      ? { bg: 'var(--cl-up-soft)', fg: 'var(--cl-up)' }
      : appeal.decision === 'denied'
      ? { bg: 'var(--cl-danger-soft)', fg: 'var(--cl-danger-text)' }
      : null;
  return (
    <article
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--cl-text)' }}>
            {KIND_LABEL[appeal.target_kind] || appeal.target_kind}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)' }}>
            Appellant: <strong>{appeal.appellant_name}</strong> ({appeal.appellant_kind})
            {' · '}
            <span style={{ fontFamily: 'var(--cl-font-mono)', fontSize: '0.74rem' }}>{appeal.appellant_email}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {decisionTone ? (
            <span
              style={{
                padding: '3px 10px',
                background: decisionTone.bg,
                color: decisionTone.fg,
                borderRadius: 999,
                fontSize: '0.74rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {appeal.decision} {relTime(appeal.acted_at)}
            </span>
          ) : (
            <span style={{ color: 'var(--cl-accent)', fontSize: '0.78rem', fontWeight: 700 }}>
              Filed {relTime(appeal.created_at)}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          background: 'var(--cl-bg-soft)',
          border: '1px solid var(--cl-border)',
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: '0.86rem',
          color: 'var(--cl-text)',
        }}
      >
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cl-text-light)', fontWeight: 700, marginBottom: 4 }}>
          What was {appeal.target_kind.startsWith('suspension') ? 'suspended' : 'hidden'}
        </div>
        <div>{appeal.target_preview || <em style={{ color: 'var(--cl-text-muted)' }}>(no preview)</em>}</div>
        {appeal.target_hidden_at && (
          <div style={{ fontSize: '0.7rem', color: 'var(--cl-text-light)', marginTop: 4 }}>
            Action taken {relTime(appeal.target_hidden_at)}
          </div>
        )}
      </div>

      <div
        style={{
          background: 'white',
          border: '1px solid var(--cl-border)',
          borderRadius: 8,
          padding: '8px 10px',
          fontSize: '0.86rem',
          color: 'var(--cl-text)',
          whiteSpace: 'pre-wrap',
        }}
      >
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cl-text-light)', fontWeight: 700, marginBottom: 4 }}>
          Appellant rationale
        </div>
        {appeal.rationale}
      </div>

      {appeal.admin_note && (
        <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', fontStyle: 'italic' }}>
          Admin note (visible to appellant): {appeal.admin_note}
        </div>
      )}

      {!resolved && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={() => onDecide(appeal, 'denied')}
            disabled={busy}
            style={{
              padding: '6px 14px',
              border: '1px solid var(--cl-border)',
              background: 'white',
              color: '#d63031',
              borderRadius: 8,
              fontSize: '0.84rem',
              fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => onDecide(appeal, 'granted')}
            disabled={busy}
            style={{
              padding: '6px 14px',
              border: '1px solid var(--cl-accent)',
              background: 'var(--cl-accent)',
              color: 'white',
              borderRadius: 8,
              fontSize: '0.84rem',
              fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {busy ? '…' : 'Grant'}
          </button>
        </div>
      )}
    </article>
  );
}
