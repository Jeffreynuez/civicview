'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /admin — moderation queue.
 *
 * Gated server-side by ADMIN_EMAILS env var. The page itself just
 * probes /api/admin/whoami on mount and renders one of three states:
 *   - probing      → spinner
 *   - 401 / 403    → "Admin access required" with a sign-in nudge
 *   - 200          → the queue table with per-row actions
 *
 * Per-row actions:
 *   Dismiss   → resolves the report; target stays visible
 *   Hide      → soft-deletes the target + resolves the report
 *   Unhide    → restores the target (visible button only when the
 *               target is already hidden); does NOT auto-resolve
 *               outstanding reports so the admin can still review
 *               them
 *
 * The table view is intentionally simple — sortable / filterable
 * is a follow-up if volume grows. Today the queue surface is
 * "Jeff opens /admin once a day, scans, clicks through anything
 * that looks legit."
 */
import { useCallback, useEffect, useState } from 'react';
import {
  adminWhoami,
  adminListReports,
  adminDismissReport,
  adminHideTarget,
  adminUnhideTarget,
  adminSuspendUser,
} from '@/lib/pagesApi';

// Human-friendly labels for the kind enum. Keep in sync with the
// backend ReportKind literal.
const KIND_LABEL = {
  post: 'Rep post',
  post_comment: 'Comment on post',
  poll: 'Citizen poll',
  poll_comment: 'Comment on poll',
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

export default function AdminPage() {
  const [authState, setAuthState] = useState('probing'); // 'probing' | 'allowed' | 'denied' | 'unauthed'
  const [me, setMe] = useState(null);
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [error, setError] = useState(null);
  const [includeActed, setIncludeActed] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // Probe admin auth on first mount.
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

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    setError(null);
    const { data, error: err } = await adminListReports({ includeActed });
    setLoadingReports(false);
    if (err || !data) {
      setError(err || 'Could not load reports.');
      return;
    }
    setReports(data.items || []);
  }, [includeActed]);

  // Load (and re-load when the include-acted toggle flips) once
  // we know the user is allowed in.
  useEffect(() => {
    if (authState === 'allowed') loadReports();
  }, [authState, loadReports]);

  // Action handlers — all share the same busy/error/refresh shape.
  const runAction = async (key, fn) => {
    if (busyId) return;
    setBusyId(key);
    const { data, error: err } = await fn();
    setBusyId(null);
    if (err) {
      setError(err);
      return;
    }
    // Re-fetch on success so the row state matches the server.
    await loadReports();
    void data;
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
            : 'Your account isn’t on the admin allowlist. Update ADMIN_EMAILS on Render and re-deploy if this is a mistake.'}
        </p>
        <p style={{ marginTop: 20 }}>
          <a href="/" style={{ color: 'var(--cl-accent)', fontWeight: 600 }}>← Back to CivicView</a>
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: '24px 20px', fontFamily: 'var(--cl-font-sans)', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6, gap: 16 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>Moderation queue</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <a href="/admin/users" style={{ color: 'var(--cl-accent)', fontSize: '0.9rem', fontWeight: 600 }}>Suspended accounts →</a>
          <a href="/" style={{ color: 'var(--cl-accent)', fontSize: '0.9rem', fontWeight: 600 }}>← CivicView home</a>
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
          Include resolved reports
        </label>
        <button
          type="button"
          onClick={loadReports}
          disabled={loadingReports}
          style={{
            padding: '6px 14px',
            border: '1px solid var(--cl-border)',
            background: 'white',
            borderRadius: 6,
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: loadingReports ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {loadingReports ? 'Refreshing…' : 'Refresh'}
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

      {!loadingReports && reports.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--cl-border)',
            borderRadius: 12,
            padding: '28px 20px',
            textAlign: 'center',
            color: 'var(--cl-text-light)',
            fontSize: '0.9rem',
          }}
        >
          {includeActed
            ? 'No reports in the system yet.'
            : 'No open reports right now. 🎉'}
        </div>
      )}

      {reports.length > 0 && (
        <div style={{ overflow: 'auto', border: '1px solid var(--cl-border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead style={{ background: 'var(--cl-bg-soft)' }}>
              <tr>
                <Th>Type</Th>
                <Th>Content preview</Th>
                <Th>Reason</Th>
                <Th>Reporter</Th>
                <Th>When</Th>
                <Th>Status</Th>
                <Th style={{ width: 240 }}>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const key = `${r.kind}-${r.id}`;
                const isBusy = busyId === key;
                const resolved = !!r.acted_at;
                return (
                  <tr key={key} style={{ borderTop: '1px solid var(--cl-border)' }}>
                    <Td>
                      <div style={{ fontWeight: 700 }}>{KIND_LABEL[r.kind] || r.kind}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
                        id={r.target_id}
                      </div>
                    </Td>
                    <Td style={{ maxWidth: 380 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.target_preview || <em style={{ color: 'var(--cl-text-muted)' }}>(empty)</em>}
                      </div>
                    </Td>
                    <Td>
                      <div>{r.reason}</div>
                      {r.detail && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)', marginTop: 2 }}>
                          {r.detail}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div>{r.reporter_name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--cl-text-light)' }}>
                        {r.reporter_kind}
                      </div>
                    </Td>
                    <Td style={{ whiteSpace: 'nowrap' }}>{relTime(r.created_at)}</Td>
                    <Td>
                      {resolved ? (
                        <span style={{ color: 'var(--cl-text-light)', fontStyle: 'italic' }}>
                          Resolved {relTime(r.acted_at)}
                        </span>
                      ) : r.target_hidden ? (
                        <span style={{ color: '#d63031', fontWeight: 700 }}>Hidden</span>
                      ) : (
                        <span style={{ color: 'var(--cl-accent)', fontWeight: 700 }}>Open</span>
                      )}
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {/* "View" opens the hosting rep page in a new tab.
                            Useful for reading the full thread / surrounding
                            comments before deciding what to do. */}
                        {r.context_official_id && (
                          <a
                            href={`/?page=${encodeURIComponent(r.context_official_id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '4px 10px',
                              border: '1px solid var(--cl-border)',
                              background: 'white',
                              color: 'var(--cl-text)',
                              borderRadius: 6,
                              fontSize: '0.78rem',
                              fontWeight: 600,
                              textDecoration: 'none',
                            }}
                          >
                            View
                          </a>
                        )}
                        {!resolved && (
                          <ActionButton
                            label="Dismiss"
                            onClick={() => runAction(key, () => adminDismissReport(r.kind, r.id))}
                            busy={isBusy}
                          />
                        )}
                        {!resolved && !r.target_hidden && (
                          <ActionButton
                            label="Hide"
                            onClick={() => runAction(key, () => adminHideTarget(r.kind, r.id))}
                            busy={isBusy}
                            destructive
                          />
                        )}
                        {r.target_hidden && (
                          <ActionButton
                            label="Unhide"
                            onClick={() => runAction(key, () => adminUnhideTarget(r.kind, r.target_id))}
                            busy={isBusy}
                          />
                        )}
                        {/* Suspend the AUTHOR of the reported content,
                            not the reporter. Two-step confirmation:
                            first confirms the suspension, then asks
                            whether to ALSO hide all of their existing
                            content (cascade). Splitting the prompts
                            keeps the destructive-by-default ergonomic
                            ("yes suspend" → "no don't cascade" is one
                            extra click, but "yes suspend AND cascade"
                            requires explicit confirmation).
                            Hidden for rep authors with admin emails
                            because the backend will reject anyway. */}
                        {r.target_author_id && r.target_author_kind && (
                          <ActionButton
                            label={`Suspend ${r.target_author_kind === 'citizen' ? 'citizen' : 'rep'}`}
                            onClick={() => {
                              const ok = window.confirm(
                                `Suspend ${r.target_author_name}? They'll be signed out and unable to sign back in until you unsuspend them.`
                              );
                              if (!ok) return;
                              const cascade = window.confirm(
                                `ALSO hide every post / comment / poll ${r.target_author_name} has visible right now?\n\nClick OK to suspend AND hide all their content. Click Cancel to just suspend the account; their existing content stays visible.`
                              );
                              runAction(key, () => adminSuspendUser(
                                r.target_author_kind, r.target_author_id,
                                { reason: r.reason, cascadeHide: cascade },
                              ));
                            }}
                            busy={isBusy}
                            destructive
                          />
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Th({ children, style }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '8px 10px',
        fontSize: '0.72rem',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--cl-text-light)',
        fontWeight: 700,
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }) {
  return (
    <td
      style={{
        padding: '10px',
        verticalAlign: 'top',
        color: 'var(--cl-text)',
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function ActionButton({ label, onClick, busy, destructive }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: '4px 10px',
        border: '1px solid var(--cl-border)',
        background: 'white',
        color: destructive ? '#d63031' : 'var(--cl-text)',
        borderRadius: 6,
        fontSize: '0.78rem',
        fontWeight: 600,
        cursor: busy ? 'wait' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {busy ? '…' : label}
    </button>
  );
}
