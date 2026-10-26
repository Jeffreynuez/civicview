'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /unsubscribe?token=... (2026-10-16). The footer link in the weekly
 * digest, the notices about pages you track, election reminder emails
 * and (2026-10-17) the emails about bills you track. It says which email the link turns off and asks once, so a
 * link scanner opening the email turns nothing off. Mail apps that
 * support one-click unsubscribe (RFC 8058) skip this page and POST to
 * the API directly. Nothing here turns anything back on; the settings
 * do that.
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import Navbar from '@/components/Navbar';
import StickyPageHeader from '@/components/StickyPageHeader';
import { request } from '@/lib/http';

// Where each email is turned back on (2026-10-17: one settings list, in
// the bell's Settings and in the dashboard's Settings, Notifications).
const WHERE_TO_TURN_ON = {
  digest: 'the bell, Settings, Weekly email digest',
  page_changes: 'the bell, Settings, Changes to pages you track (on a representative or candidate page: Dashboard, Notification settings)',
  election_reminders: 'the bell, Settings, Election reminders',
  bill_updates: 'the bell, Settings, Bill updates',
};

function UnsubscribeInner() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [info, setInfo] = useState(null);
  const [state, setState] = useState(token ? 'loading' : 'invalid');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const { data } = await request(`/api/email/unsubscribe/${encodeURIComponent(token)}/info`);
      if (cancelled) return;
      if (!data) { setState('invalid'); return; }
      setInfo(data);
      setState(data.already_off ? 'done' : 'ask');
    })();
    return () => { cancelled = true; };
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    const { data } = await request(`/api/email/unsubscribe/${encodeURIComponent(token)}`, { method: 'POST' });
    setBusy(false);
    if (!data) { setState('error'); return; }
    setInfo(data);
    setState('done');
  };

  const label = info?.label || 'these emails';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', flexShrink: 0, background: 'var(--cl-bg)' }}>
      <StickyPageHeader backLabel="Back">
        <Navbar compact onHome={() => router.push('/')} />
      </StickyPageHeader>
      <main style={{ flex: 1, padding: '32px 18px 48px', fontFamily: 'var(--cl-font-sans)', color: 'var(--cl-text)' }}>
        <div style={{
          maxWidth: 460, margin: '0 auto', background: 'white', border: '1px solid var(--cl-border)',
          borderRadius: 14, padding: '28px 26px', boxShadow: '0 1px 2px rgba(15,30,45,0.04)',
        }}>
          <h1 style={{ margin: '0 0 14px 0', fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.25 }}>
            {state === 'done' ? 'You’re unsubscribed' : 'Unsubscribe'}
          </h1>
          {state === 'loading' && <p style={{ color: 'var(--cl-text-light)' }}>Checking the link…</p>}
          {state === 'invalid' && (
            <p style={{ lineHeight: 1.5, color: 'var(--cl-text-light)' }} data-testid="unsubscribe-invalid">
              This unsubscribe link isn&apos;t valid. You can turn emails off in your notification settings.
            </p>
          )}
          {state === 'error' && (
            <p style={{ lineHeight: 1.5, color: '#b3261e' }}>
              That didn&apos;t work. Please try again in a moment.
            </p>
          )}
          {state === 'ask' && (
            <>
              <p style={{ lineHeight: 1.5, margin: '0 0 18px 0' }}>
                Turn off {label}? Only these emails stop. Anything you see in the app stays as it is.
              </p>
              <button
                type="button" onClick={confirm} disabled={busy} data-testid="unsubscribe-confirm"
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 8, border: 'none',
                  background: 'var(--cl-accent)', color: 'white', fontWeight: 700, fontSize: '0.95rem',
                  cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1, fontFamily: 'inherit',
                }}
              >
                {busy ? 'Turning off…' : `Turn off ${label}`}
              </button>
            </>
          )}
          {state === 'done' && (
            <p style={{ lineHeight: 1.5 }} data-testid="unsubscribe-done">
              We won&apos;t send you {label} any more. To turn this back on, go to{' '}
              {WHERE_TO_TURN_ON[info?.email_type] || 'your notification settings'}.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
