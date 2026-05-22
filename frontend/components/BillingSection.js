'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * BillingSection (Task #88) — subscription state card for the citizen
 * dashboard. Three render branches based on the citizen + billing-
 * configuration state:
 *
 *   1. Billing not yet configured server-side (Stripe creds missing)
 *      → "Subscription coming soon" card with a brief explainer.
 *
 *   2. Configured + citizen subscribed
 *      → "You're subscribed" card with current_period_end + a
 *        "Manage billing" CTA that opens the Stripe Customer Portal.
 *
 *   3. Configured + citizen NOT subscribed
 *      → "Subscribe for $5/mo" card with a "Subscribe" CTA that
 *        opens Stripe Checkout.
 *
 * Demo citizens have is_subscribed=true with subscription_status='demo'
 * — we render their card with a "Demo access — real billing coming
 * after ID.me + Stripe go live" note instead of the manage-billing CTA.
 *
 * Layout assumes the rep+candidate Account Security pattern: a single
 * card with consistent border + padding that the dashboard's right
 * rail can stack alongside TwoFactorSection.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  fetchBillingStatus,
  startCheckoutSession,
  startPortalSession,
} from '@/lib/pagesApi';

export default function BillingSection({ citizen }) {
  const [billingConfig, setBillingConfig] = useState(null);  // { is_configured, price_id_present }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Fetch billing status on mount so we can branch correctly. Cheap
  // call — no auth required, just an env-var probe.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await fetchBillingStatus();
      if (!cancelled) setBillingConfig(data || { is_configured: false, price_id_present: false });
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSubscribe = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await startCheckoutSession({
      // Come back to the dashboard's billing card after checkout so
      // the user sees the freshly-active subscription state. (The
      // Stripe webhook will have updated is_subscribed by the time
      // they're redirected back.)
      successUrl: typeof window !== 'undefined'
        ? `${window.location.origin}/?subscribed=1`
        : null,
      cancelUrl: typeof window !== 'undefined'
        ? `${window.location.origin}/?subscribed=0`
        : null,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (!data?.configured) {
      // Dev backend handed back a placeholder URL. Don't navigate
      // away — show the user an honest "not yet activated" message.
      setError(
        "Billing isn't activated yet. We're finishing the Stripe + "
        + 'ID.me setup; you can still use the rest of the app in the '
        + 'meantime.',
      );
      return;
    }
    if (data?.url) window.location.assign(data.url);
  }, []);

  const handleManage = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await startPortalSession({
      returnUrl: typeof window !== 'undefined' ? window.location.href : null,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (!data?.configured) {
      setError("Billing portal isn't activated yet.");
      return;
    }
    if (data?.url) window.location.assign(data.url);
  }, []);

  if (!citizen) return null;

  // ── Render branches ──
  const isDemo = citizen.subscription_status === 'demo';
  const isSubscribed = !!citizen.is_subscribed;
  const isConfigured = !!billingConfig?.is_configured;

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
          Subscription
        </h3>
        <StatusPill subscribed={isSubscribed} demo={isDemo} configured={isConfigured} />
      </div>

      {/* Body copy varies by branch */}
      {isDemo && (
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          Demo access &mdash; you have full engagement features (creating
          polls, commenting) while we finish wiring up Stripe + ID.me.
          When we flip on real accounts, your demo grant will roll over
          into a one-month trial.
        </p>
      )}

      {!isDemo && isSubscribed && (
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          Thank you for supporting CivicView.{' '}
          {citizen.current_period_end
            ? `Your subscription renews on ${formatDate(citizen.current_period_end)}.`
            : 'Manage your payment method or cancel any time.'}
        </p>
      )}

      {!isDemo && !isSubscribed && isConfigured && (
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          $5/month unlocks creating polls on the polls page + commenting
          on posts and polls. Cancel any time from the billing portal.
        </p>
      )}

      {!isDemo && !isSubscribed && !isConfigured && (
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--cl-text-light)' }}>
          Billing isn&rsquo;t live yet &mdash; we&rsquo;re finishing up
          Stripe + ID.me. Engagement features unlock once subscriptions
          go live. For now you can browse, track officials, and join
          the waitlist.
        </p>
      )}

      {/* CTA row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        {!isDemo && isSubscribed && citizen.has_billing_account && (
          <button
            type="button"
            onClick={handleManage}
            disabled={busy}
            style={primaryButton(busy)}
          >
            {busy ? 'Opening…' : 'Manage billing'}
          </button>
        )}
        {!isDemo && !isSubscribed && isConfigured && (
          <button
            type="button"
            onClick={handleSubscribe}
            disabled={busy}
            style={primaryButton(busy)}
          >
            {busy ? 'Starting checkout…' : 'Subscribe — $5/mo'}
          </button>
        )}
      </div>

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

function StatusPill({ subscribed, demo, configured }) {
  let label, bg, color;
  if (demo) {
    label = 'Demo access';
    bg = '#fff4d6';
    color = '#7a5300';
  } else if (subscribed) {
    label = 'Active';
    bg = '#e0f4e7';
    color = '#1a5b34';
  } else if (configured) {
    label = 'Not subscribed';
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

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return iso;
  }
}
