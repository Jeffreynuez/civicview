'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Force2FAOverlay — full-screen enforcement surface (2FA Phase 4).
 *
 * Mounted at the app root. When any active session (rep / candidate /
 * admin — citizens stay opt-in) carries `needs_2fa_enrollment=true`
 * from its /me payload, this overlay covers the entire viewport with
 * an unskippable enrollment flow. Sign-out is the only escape hatch.
 *
 * UX rationale: blocking the dashboard until enrollment completes is
 * the simplest way to guarantee 2FA coverage for the credential-theft-
 * sensitive identity types. A soft banner (the discarded alternative)
 * leaves the door open to "I'll do it later" indefinitely, which on a
 * civic-engagement platform — where a hijacked rep / candidate
 * account can post under a verified identity to thousands of
 * constituents — isn't a posture we'd want to live in.
 *
 * Props:
 *   identityKind  — 'rep' | 'candidate' | 'admin' for display copy
 *   identityName  — display name (shown so user knows which account
 *                   they're enrolling)
 *   onComplete    — called after successful enrollment so the parent
 *                   can refresh the underlying /me + drop the overlay
 *   onSignOut     — escape hatch; signs the user out of the
 *                   identity that's being enforced
 */

import { useEffect } from 'react';
import { Shield } from 'lucide-react';
import TwoFactorSection from './TwoFactorSection';

const KIND_LABEL = {
  rep: 'representative',
  candidate: 'candidate',
  admin: 'admin',
};

export default function Force2FAOverlay({
  identityKind = 'rep',
  identityName,
  onComplete,
  onSignOut,
}) {
  // Lock the underlying page from scrolling while the overlay is up.
  // The overlay has its own scroll container so the user can still
  // reach the enrollment buttons on short viewports.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-2fa-title"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        // z-index: above everything (PageView=1200, MyTracked=1300)
        // so an unwitting user can't navigate around the enforcement
        // by opening their dashboard or a modal.
        zIndex: 2000,
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: 'max(env(safe-area-inset-top, 24px), 24px) 16px 32px',
        fontFamily: 'var(--cl-font-sans)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'white',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div
            aria-hidden="true"
            style={{
              flexShrink: 0,
              width: 40, height: 40, borderRadius: 999,
              background: 'var(--cl-accent-soft, #e6f4ea)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--cl-accent, #2e7d32)',
            }}
          >
            <Shield size={32} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.6px', color: 'var(--cl-text-light)',
              marginBottom: 4,
            }}>
              Required step
            </div>
            <h2 id="force-2fa-title" style={{
              fontSize: '1.35rem', fontWeight: 800, color: 'var(--cl-text)',
              margin: 0, lineHeight: 1.25,
            }}>
              Set up two-factor authentication
            </h2>
          </div>
        </div>

        <p style={{
          fontSize: '0.92rem', color: 'var(--cl-text)', margin: '0 0 16px',
          lineHeight: 1.5,
        }}>
          CivicView now requires every {KIND_LABEL[identityKind] || 'account'} to enable
          two-factor authentication before continuing.
          {identityName ? (
            <> You're enrolling <strong>{identityName}</strong>.</>
          ) : null}
        </p>

        <ul style={{
          fontSize: '0.88rem', color: 'var(--cl-text-light)',
          margin: '0 0 16px', padding: '0 0 0 18px', lineHeight: 1.6,
        }}>
          <li>You'll need an authenticator app (Google Authenticator, Authy, 1Password, Microsoft Authenticator, …).</li>
          <li>Save the recovery codes somewhere you can find them — they're the only way back in if you lose your phone.</li>
          <li>One-time setup. After this you'll just enter a 6-digit code at sign-in.</li>
        </ul>

        {/* Re-use the same enrollment surface that runs inside the
            Dashboard's Account Security card. It self-manages the
            full enroll → verify → recovery-codes flow and calls
            onClose after the recovery codes are dismissed. We hook
            onClose to onComplete here so the parent can refetch
            /me, see needs_2fa_enrollment flip to false, and drop
            the overlay automatically. */}
        <TwoFactorSection onClose={onComplete} />

        {/* Escape hatch — sign out of THIS identity (the one being
            enforced). Multi-identity users can drop the enforcing
            session and keep their others. */}
        <div style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: '1px solid var(--cl-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--cl-text-light)', flex: 1, minWidth: 200 }}>
            Need to come back to this later? Sign out and we'll prompt again next time.
          </div>
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                background: 'white',
                color: 'var(--cl-text)',
                border: '1px solid var(--cl-border)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
