'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * VerificationSection (Task #89) — identity-verification state card
 * for the citizen dashboard. Mirrors BillingSection's three-branch
 * pattern but for ID.me verification:
 *
 *   1. Backend reports ID.me not configured (no IDME_* env vars)
 *      → "Verification coming soon" card with a brief explainer.
 *
 *   2. Citizen is verified
 *      → "Verified" card with verified_method + verified_at + a
 *        tiny privacy note about what we store. No CTA — once
 *        verified, the user is done.
 *
 *   3. Configured + citizen NOT verified
 *      → "Verify with ID.me" card with a Verify CTA that opens
 *        the ID.me OAuth flow.
 *
 * Demo citizens have verified=False + verified_method='demo'. We
 * render their card as "Demo access — full ID.me verification
 * will be available once the integration is live" rather than
 * pushing them through a non-existent flow.
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchVerificationStatus, startVerification } from '@/lib/pagesApi';

export default function VerificationSection({ citizen }) {
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await fetchVerificationStatus();
      if (!cancelled) setConfig(data || { is_configured: false });
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVerify = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await startVerification();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (!data?.configured) {
      setError(
        "Identity verification isn't activated yet. We're finishing the "
        + "ID.me setup; the rest of the app works in the meantime.",
      );
      return;
    }
    if (data?.url) window.location.assign(data.url);
  }, []);

  if (!citizen) return null;

  const isVerified = !!citizen.verified;
  const isDemo = citizen.verified_method === 'demo';
  const isConfigured = !!config?.is_configured;

  return (
    <section
      style={{
        background: 'white',
        border: '1px solid var(--cl-border)',
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'var(--cl-font-sans)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
      }}>
        <h3 style={{
          margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--cl-text)',
        }}>
          Identity verification
        </h3>
        <StatusPill verified={isVerified} demo={isDemo} configured={isConfigured} />
      </div>

      {isVerified && (
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          You&rsquo;re verified via {labelMethod(citizen.verified_method)}
          {citizen.verified_at ? ` · since ${formatDate(citizen.verified_at)}` : ''}.
          We store the verification flag, your state, and a one-way hash of
          your address &mdash; nothing else from ID.me lives on our servers.
        </p>
      )}

      {!isVerified && isDemo && (
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          Demo access &mdash; engagement features (polls, comments) work
          while we finish wiring up ID.me. Once real verification goes
          live, demo accounts can opt in to convert.
        </p>
      )}

      {!isVerified && !isDemo && isConfigured && (
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          Verify your identity through ID.me to confirm your state +
          district. Verified comments + poll votes carry a checkmark
          so reps can filter for their actual constituents.
        </p>
      )}

      {!isVerified && !isDemo && !isConfigured && (
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          Identity verification isn&rsquo;t live yet &mdash; we&rsquo;re
          finishing the ID.me integration. You can still browse, track
          officials, and use demo engagement features in the meantime.
        </p>
      )}

      {!isVerified && !isDemo && isConfigured && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <button
            type="button"
            onClick={handleVerify}
            disabled={busy}
            style={primaryButton(busy)}
          >
            {busy ? 'Starting…' : 'Verify with ID.me'}
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 4,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#fdecec',
            color: '#a4131a',
            fontSize: '0.8rem',
            border: '1px solid #f5c1c4',
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}

// ── Local helpers ──

function StatusPill({ verified, demo, configured }) {
  let label, bg, color;
  if (verified) {
    label = 'Verified';
    bg = '#e0f4e7';
    color = '#1a5b34';
  } else if (demo) {
    label = 'Demo access';
    bg = '#fff4d6';
    color = '#7a5300';
  } else if (configured) {
    label = 'Unverified';
    bg = 'var(--cl-bg-soft, #f4f6f8)';
    color = 'var(--cl-text-light)';
  } else {
    label = 'Coming soon';
    bg = 'var(--cl-bg-soft, #f4f6f8)';
    color = 'var(--cl-text-light)';
  }
  return (
    <span style={{
      fontSize: '0.7rem',
      fontWeight: 700,
      letterSpacing: '0.4px',
      textTransform: 'uppercase',
      background: bg,
      color,
      padding: '3px 8px',
      borderRadius: 999,
    }}>
      {label}
    </span>
  );
}

function primaryButton(disabled) {
  return {
    padding: '9px 14px',
    borderRadius: 8,
    border: 'none',
    background: disabled ? 'var(--cl-text-light)' : 'var(--cl-accent)',
    color: 'white',
    fontSize: '0.85rem',
    fontWeight: 600,
    fontFamily: 'var(--cl-font-sans)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background var(--cl-duration-fast) var(--cl-ease-standard)',
  };
}

function labelMethod(method) {
  if (method === 'id.me') return 'ID.me';
  if (method === 'id.me-archive') return 'ID.me (restored from prior verification)';
  if (method === 'demo') return 'demo';
  return method || 'an external provider';
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return iso;
  }
}
