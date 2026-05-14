'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /admin/users — suspended user accounts.
 *
 * Sibling to /admin (which is the report queue). Lists every rep +
 * citizen account currently in a suspended state, with quick
 * Unsuspend buttons. Useful when:
 *   - an appeal email comes in and you need to find + restore the
 *     account
 *   - you forgot who you've suspended this week
 *   - you want to confirm a suspension actually took effect
 *
 * Same admin auth gate as /admin (probes /api/admin/whoami).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  adminWhoami,
  adminListSuspendedUsers,
  adminUnsuspendUser,
} from '@/lib/pagesApi';

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function AdminUsersPage() {
  const [authState, setAuthState] = useState('probing');
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

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
    const { data, error: err } = await adminListSuspendedUsers();
    setLoading(false);
    if (err || !data) {
      setError(err || 'Could not load suspended users.');
      return;
    }
    setUsers(data.items || []);
  }, []);

  useEffect(() => {
    if (authState === 'allowed') load();
  }, [authState, load]);

  const unsuspend = async (u) => {
    const key = `${u.kind}-${u.id}`;
    if (busyKey) return;
    const ok = typeof window !== 'undefined'
      ? window.confirm(`Lift suspension on ${u.display_name} (${u.email})?`)
      : true;
    if (!ok) return;
    setBusyKey(key);
    const { error: err } = await adminUnsuspendUser(u.kind, u.id);
    setBusyKey(null);
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
    <main style={{ padding: '24px 20px', fontFamily: 'var(--cl-font-sans)', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>Suspended accounts</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <a href="/admin" style={{ color: 'var(--cl-accent)', fontSize: '0.9rem', fontWeight: 600 }}>← Moderation queue</a>
          <a href="/" style={{ color: 'var(--cl-accent)', fontSize: '0.9rem', fontWeight: 600 }}>CivicView home</a>
        </div>
      </div>
      <p style={{ color: 'var(--cl-text-light)', fontSize: '0.9rem', marginTop: 0, marginBottom: 20 }}>
        Signed in as <strong>{me?.email}</strong> ({me?.kind}).
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
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
        <span style={{ fontSize: '0.85rem', color: 'var(--cl-text-light)' }}>
          {users.length} suspended account{users.length === 1 ? '' : 's'}
        </span>
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

      {!loading && users.length === 0 && (
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
          No accounts are currently suspended.
        </div>
      )}

      {users.length > 0 && (
        <div style={{ overflow: 'auto', border: '1px solid var(--cl-border)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead style={{ background: 'var(--cl-bg-soft)' }}>
              <tr>
                <Th>Kind</Th>
                <Th>Display name</Th>
                <Th>Email</Th>
                <Th>Suspended</Th>
                <Th>Reason</Th>
                <Th style={{ width: 140 }}>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const key = `${u.kind}-${u.id}`;
                const isBusy = busyKey === key;
                return (
                  <tr key={key} style={{ borderTop: '1px solid var(--cl-border)' }}>
                    <Td>
                      <span
                        style={{
                          padding: '2px 8px',
                          background: u.kind === 'citizen' ? 'var(--cl-accent-soft)' : '#fff7e6',
                          color: u.kind === 'citizen' ? 'var(--cl-accent)' : '#8a6100',
                          borderRadius: 999,
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {u.kind}
                      </span>
                    </Td>
                    <Td><strong>{u.display_name}</strong></Td>
                    <Td style={{ color: 'var(--cl-text-light)', fontFamily: 'var(--cl-font-mono)', fontSize: '0.8rem' }}>
                      {u.email}
                    </Td>
                    <Td style={{ whiteSpace: 'nowrap' }}>{relTime(u.suspended_at)}</Td>
                    <Td>
                      {u.suspended_reason || <em style={{ color: 'var(--cl-text-muted)' }}>(no reason given)</em>}
                    </Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => unsuspend(u)}
                        disabled={isBusy}
                        style={{
                          padding: '4px 10px',
                          border: '1px solid var(--cl-border)',
                          background: 'white',
                          color: 'var(--cl-text)',
                          borderRadius: 6,
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: isBusy ? 'wait' : 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {isBusy ? '…' : 'Unsuspend'}
                      </button>
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
    <td style={{ padding: '10px', verticalAlign: 'top', color: 'var(--cl-text)', ...style }}>
      {children}
    </td>
  );
}
