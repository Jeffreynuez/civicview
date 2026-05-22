'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /account/delete — full-screen account deletion surface (Task #81).
 *
 * Renders the navbar + a back button + the deletion UI. The UI offers
 * two modes:
 *   • Archive for 30 days — soft delete; recoverable by signing back
 *     in within the grace window.
 *   • Delete immediately — hard delete; no recovery.
 *
 * Both modes require typing the signed-in account's email to confirm
 * (GitHub-style). Sign-out doesn't happen here — the user explicitly
 * picks one of the two delete modes.
 *
 * Identity priority for the active delete target: rep > candidate >
 * citizen. If the user has multiple identities signed in (legitimate
 * — citizens can also be reps, etc.), we delete the highest-priority
 * one. The page surfaces which identity is being acted on so the user
 * has no ambiguity.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import Navbar from '@/components/Navbar';
import { useAuth } from '@/lib/auth';
import { useCandidateAuth } from '@/lib/candidateAuth';
import { useCitizenAuth } from '@/lib/citizenAuth';
import {
  deleteCandidateAccount,
  deleteCitizenAccount,
  deleteRepAccount,
} from '@/lib/pagesApi';

const KIND_COPY = {
  rep: {
    label: 'representative',
    contentSummary: 'your rep page posts, polls, events, and engagement',
  },
  candidate: {
    label: 'candidate',
    contentSummary: 'your candidate page posts, polls, events, and engagement',
  },
  citizen: {
    label: 'citizen',
    contentSummary: 'your comments, poll votes, reactions, and tracked items',
  },
};

export default function AccountDeletePage() {
  const router = useRouter();
  const { me } = useAuth();
  const { candidate } = useCandidateAuth();
  const { citizen } = useCitizenAuth();

  // Priority order — rep > candidate > citizen. Same as RecoveryBanner
  // and Force2FAGate, for consistency.
  const target = useMemo(() => {
    if (me) return { kind: 'rep', account: me, deleteFn: deleteRepAccount };
    if (candidate) return { kind: 'candidate', account: candidate, deleteFn: deleteCandidateAccount };
    if (citizen) return { kind: 'citizen', account: citizen, deleteFn: deleteCitizenAccount };
    return null;
  }, [me, candidate, citizen]);

  const [confirmEmail, setConfirmEmail] = useState('');
  const [mode, setMode] = useState('soft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const emailMatches = !!target?.account?.email
    && confirmEmail.trim().toLowerCase() === target.account.email.toLowerCase();
  const canDelete = emailMatches && !busy && !!target;

  const handleDelete = useCallback(async () => {
    if (!canDelete) return;
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await target.deleteFn({ confirmEmail, mode });
      if (err) {
        setError(err);
        setBusy(false);
        return;
      }
      setResult(data);
      // For hard delete, the cookie is cleared server-side. For soft,
      // the user stays signed in so the RecoveryBanner can offer
      // recovery. Either way, route them home — the banner / sign-in
      // modal will handle the rest.
      setTimeout(() => {
        router.push('/');
        // Force a reload so the auth hooks flush. Cheaper than
        // wiring full refresh helpers here, and this is a terminal
        // action — extra reload doesn't hurt UX.
        if (typeof window !== 'undefined') window.location.reload();
      }, mode === 'hard' ? 2200 : 1800);
    } catch (e) {
      setError(e?.message || 'Delete failed — please try again.');
      setBusy(false);
    }
  }, [canDelete, target, confirmEmail, mode, router]);

  if (!target) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--cl-bg)' }}>
        <Navbar compact onHome={() => router.push('/')} />
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, fontFamily: 'var(--cl-font-sans)',
        }}>
          <div style={{
            maxWidth: 480, textAlign: 'center', background: 'white',
            padding: 32, borderRadius: 14, border: '1px solid var(--cl-border)',
          }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--cl-text)', marginBottom: 12 }}>
              Sign in required
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--cl-text-light)', marginBottom: 18 }}>
              You need to be signed in before you can delete an account.
            </p>
            <button
              type="button"
              onClick={() => router.push('/')}
              style={{
                padding: '8px 16px', borderRadius: 8,
                background: 'var(--cl-accent, #2e7d32)', color: 'white',
                border: 'none', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const copy = KIND_COPY[target.kind];
  const accountEmail = target.account.email;
  const accountName = target.account.display_name || accountEmail;

  // Successful-deletion confirmation card (brief — page auto-redirects).
  if (result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--cl-bg)' }}>
        <Navbar compact onHome={() => router.push('/')} />
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, fontFamily: 'var(--cl-font-sans)',
        }}>
          <div style={{
            maxWidth: 480, background: 'white', padding: 32,
            borderRadius: 14, border: '1px solid var(--cl-border)', textAlign: 'center',
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 999,
              background: '#e6f4ea', color: '#1d5a2c',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 14px',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--cl-text)', marginBottom: 8 }}>
              {result.mode === 'hard'
                ? 'Your account has been deleted.'
                : 'Your account is now scheduled for deletion.'}
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--cl-text-light)' }}>
              {result.mode === 'hard'
                ? 'You\'ve been signed out. Returning to the home page…'
                : `It will be permanently removed on ${new Date(result.purge_after).toLocaleDateString()}. Sign back in any time before then to recover. Returning to the home page…`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--cl-bg)' }}>
      <Navbar compact onHome={() => router.push('/')} />

      {/* Back button row — matches the pattern used on PageView +
          ConstituentDashboard for navigation consistency. */}
      <div style={{
        background: 'white', borderBottom: '1px solid var(--cl-border)',
        padding: '10px 18px',
      }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid var(--cl-border)', background: 'white',
            color: 'var(--cl-text)', fontSize: '0.85rem', cursor: 'pointer',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
      </div>

      <div style={{
        flex: 1, padding: '32px 18px 64px',
        fontFamily: 'var(--cl-font-sans)',
        color: 'var(--cl-text)',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {/* Page header */}
          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.6px', color: '#a3261c', marginBottom: 6,
            }}>
              Permanent action
            </div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--cl-text)', margin: 0, lineHeight: 1.2 }}>
              Delete your CivicView {copy.label} account
            </h1>
            <div style={{ fontSize: '0.9rem', color: 'var(--cl-text-light)', marginTop: 8 }}>
              You're acting on <strong>{accountName}</strong> ({accountEmail}).
            </div>
          </div>

          {/* What gets deleted */}
          <div style={{
            background: 'white', border: '1px solid var(--cl-border)',
            borderRadius: 14, padding: 20, marginBottom: 18,
          }}>
            <div style={{
              fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.6px', color: 'var(--cl-text-light)', marginBottom: 8,
            }}>
              What happens when you delete
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6, color: 'var(--cl-text)' }}>
              <li>Your account profile, email, and password are removed.</li>
              <li>{copy.contentSummary.charAt(0).toUpperCase() + copy.contentSummary.slice(1)} are deleted.</li>
              <li>Any 2FA secrets + recovery codes are wiped.</li>
              {target.kind === 'citizen' && (
                <li>
                  <strong>Your ID.me verification status is preserved.</strong> If you ever
                  create a new CivicView account with the same email, you won't need to
                  re-verify your identity. We keep only a one-way hash of your email +
                  the original verification date — no other personal data is retained.
                </li>
              )}
              {target.kind !== 'citizen' && (
                <li>Your page reverts to "unclaimed" state. Other identities you have on CivicView (citizen, etc.) are unaffected.</li>
              )}
            </ul>
          </div>

          {/* Mode selector */}
          <div style={{
            background: 'white', border: '1px solid var(--cl-border)',
            borderRadius: 14, padding: 20, marginBottom: 18,
          }}>
            <div style={{
              fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.6px', color: 'var(--cl-text-light)', marginBottom: 12,
            }}>
              Choose how to delete
            </div>

            <ModeRadio
              checked={mode === 'soft'}
              onChange={() => setMode('soft')}
              title="Archive for 30 days"
              badge="Recoverable"
              badgeColor="#2e7d32"
              description="Your account is hidden and content removed from public view, but kept on file for 30 days. Sign back in any time within that window and click Recover to restore everything exactly as it was. After 30 days the archive is permanently purged."
            />

            <div style={{ height: 1, background: 'var(--cl-border)', margin: '12px 0' }} />

            <ModeRadio
              checked={mode === 'hard'}
              onChange={() => setMode('hard')}
              title="Delete immediately"
              badge="Permanent"
              badgeColor="#a3261c"
              description="Your account and content are removed right now. No recovery window. The verification preservation rule still applies for citizens — your ID.me record is kept as a one-way hash so a future signup doesn't pay for re-verification."
            />
          </div>

          {/* Confirmation */}
          <div style={{
            background: 'white', border: '1px solid #f5c6c6',
            borderRadius: 14, padding: 20, marginBottom: 18,
          }}>
            <div style={{
              fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.6px', color: '#a3261c', marginBottom: 8,
            }}>
              Confirm
            </div>
            <label htmlFor="confirm-email" style={{ display: 'block', fontSize: '0.9rem', color: 'var(--cl-text)', marginBottom: 6 }}>
              Type <strong>{accountEmail}</strong> below to confirm.
            </label>
            <input
              ref={inputRef}
              id="confirm-email"
              type="email"
              autoComplete="off"
              value={confirmEmail}
              onChange={(e) => { setConfirmEmail(e.target.value); setError(null); }}
              disabled={busy}
              placeholder={accountEmail}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: emailMatches ? '1px solid #2e7d32' : '1px solid var(--cl-border)',
                fontSize: '0.95rem',
                fontFamily: 'var(--cl-font-sans)',
                background: 'white',
                color: 'var(--cl-text)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {error && (
              <div style={{ marginTop: 10, fontSize: '0.85rem', color: '#a3261c' }}>
                {error}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => router.back()}
              disabled={busy}
              style={{
                padding: '10px 18px', borderRadius: 8,
                background: 'white', color: 'var(--cl-text)',
                border: '1px solid var(--cl-border)',
                fontSize: '0.9rem', fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete}
              style={{
                padding: '10px 18px', borderRadius: 8,
                background: canDelete ? '#a3261c' : '#d99e9e',
                color: 'white',
                border: 'none',
                fontSize: '0.9rem', fontWeight: 700,
                cursor: canDelete ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'Deleting…' : mode === 'hard' ? 'Delete account permanently' : 'Archive my account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeRadio({ checked, onChange, title, badge, badgeColor, description }) {
  return (
    <label
      style={{
        display: 'flex', gap: 12, padding: 10, borderRadius: 8,
        cursor: 'pointer', alignItems: 'flex-start',
        background: checked ? 'var(--cl-bg-soft, #f6f7f9)' : 'transparent',
        border: checked ? '1px solid var(--cl-accent, #2e7d32)' : '1px solid transparent',
        transition: 'background 0.12s ease, border-color 0.12s ease',
      }}
    >
      <input
        type="radio"
        name="delete-mode"
        checked={checked}
        onChange={onChange}
        style={{ marginTop: 4, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--cl-text)' }}>
            {title}
          </span>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 999,
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.3px',
            background: `${badgeColor}22`, color: badgeColor,
          }}>
            {badge}
          </span>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--cl-text-light)', lineHeight: 1.5, marginTop: 4 }}>
          {description}
        </div>
      </div>
    </label>
  );
}
