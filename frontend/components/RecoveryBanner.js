'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * RecoveryBanner — surfaces a "your account is scheduled for deletion"
 * notice at the top of every route when any signed-in identity is in
 * the 30-day soft-delete grace window (Task #81).
 *
 * Mounted at the app root (app/layout.js). Reads useAuth +
 * useCitizenAuth + useCandidateAuth. If multiple identities are
 * soft-deleted at once (rare), shows the highest-priority one first
 * (rep > candidate > citizen) — same priority order Force2FAGate uses.
 *
 * Two actions:
 *   • Recover account — calls /api/{identity}/recover, refreshes the
 *     local me cache, banner drops on the next render.
 *   • Sign out — clears the session for that identity only. The
 *     account stays in soft-delete state and will purge on schedule
 *     unless the user signs back in and recovers.
 */

import { useCallback, useState } from 'react';

import { AlertTriangle } from 'lucide-react';
import { useAuth, logoutRep, refreshAuth } from '../lib/auth';
import { useCandidateAuth, logoutCandidate, refreshCandidateAuth } from '../lib/candidateAuth';
import { useCitizenAuth, logoutCitizen, refreshCitizenAuth } from '../lib/citizenAuth';
import {
  recoverCandidateAccount,
  recoverCitizenAccount,
  recoverRepAccount,
} from '../lib/pagesApi';

const KIND_LABEL = {
  rep: 'representative',
  candidate: 'candidate',
  citizen: 'citizen',
};

function formatPurgeDate(iso) {
  if (!iso) return 'soon';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}

export default function RecoveryBanner() {
  const { me } = useAuth();
  const { candidate } = useCandidateAuth();
  const { citizen } = useCitizenAuth();

  // Priority — rep first because rep credentials carry the most
  // posting-under-verified-identity blast radius. Citizens last
  // because they have the least asymmetric impact if abandoned.
  let kind = null;
  let session = null;
  let onRecover = null;
  let onSignOut = null;
  if (me?.self_deleted_at) {
    kind = 'rep'; session = me;
    onRecover = async () => { await recoverRepAccount(); await refreshAuth(); };
    onSignOut = logoutRep;
  } else if (candidate?.self_deleted_at) {
    kind = 'candidate'; session = candidate;
    onRecover = async () => { await recoverCandidateAccount(); await refreshCandidateAuth(); };
    onSignOut = logoutCandidate;
  } else if (citizen?.self_deleted_at) {
    kind = 'citizen'; session = citizen;
    onRecover = async () => { await recoverCitizenAccount(); await refreshCitizenAuth(); };
    onSignOut = logoutCitizen;
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleRecover = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      await onRecover?.();
    } catch (e) {
      setError(e?.message || 'Recovery failed — please try again.');
    } finally {
      setBusy(false);
    }
  }, [onRecover]);

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    try { await onSignOut?.(); } finally { setBusy(false); }
  }, [onSignOut]);

  if (!kind) return null;

  const purgeDateStr = formatPurgeDate(session?.purge_after);
  const displayName = session?.display_name || session?.email || 'this account';

  return (
    <div
      role="alert"
      style={{
        position: 'sticky', top: 0, zIndex: 1500,
        // Bright amber bar so it's hard to miss but still readable.
        // Distinct from any other banner / overlay layer.
        background: '#fff8e1',
        borderBottom: '1px solid #f0c419',
        color: '#5c3a00',
        padding: '10px 14px',
        fontFamily: 'var(--cl-font-sans)',
        fontSize: '0.86rem',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}
    >
      <AlertTriangle size={16} strokeWidth={2} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>Your {KIND_LABEL[kind]} account ({displayName}) is scheduled for deletion on {purgeDateStr}.</strong>
        {' '}If you don't recover it before then, it will be permanently removed.
        {error && (
          <div style={{ marginTop: 4, color: '#a3261c' }}>{error}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleRecover}
          disabled={busy}
          style={{
            padding: '6px 14px', borderRadius: 6,
            background: '#2e7d32', color: 'white',
            border: '1px solid #2e7d32',
            fontSize: '0.85rem', fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Working…' : 'Recover account'}
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={busy}
          style={{
            padding: '6px 14px', borderRadius: 6,
            background: 'white', color: '#5c3a00',
            border: '1px solid #f0c419',
            fontSize: '0.85rem', fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
