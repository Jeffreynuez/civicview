'use client';

// CivicView — contextual push-notification opt-in card (native app only).
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Renders nothing on the web. In the Android shell, offers push at a
// contextual moment — when a signed-in citizen is present (they just
// signed in, or launched the app signed in) and no choice has been
// recorded yet. The in-app card comes BEFORE the one-shot Android 13+
// system prompt, so a reflexive "no" costs nothing permanent.
// Mounted by app/page.js next to the other floating surfaces.

import { useEffect, useState } from 'react';
import { shouldOfferPush, enablePush, setPushChoice, refreshPushRegistration } from '@/lib/push';

export default function PushOptInPrompt({ citizen }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Refresh an existing registration on every app launch (token
  // rotation + citizen re-binding). Cheap no-op on the web.
  useEffect(() => { refreshPushRegistration(); }, []);

  // Offer only when: native shell + plugin present + no prior choice +
  // a citizen is signed in (the agreed contextual trigger).
  useEffect(() => {
    setVisible(!!citizen && shouldOfferPush());
  }, [citizen]);

  if (!visible) return null;

  const onEnable = async () => {
    setBusy(true);
    await enablePush(); // records its own choice on success/denial
    setBusy(false);
    setVisible(false);
  };
  const onNotNow = () => {
    setPushChoice('declined');
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Enable notifications"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 1100, // above map/panel, below PageView (1200) + modals
        maxWidth: 420,
        margin: '0 auto',
        background: 'white',
        border: '1px solid var(--cl-border)',
        borderRadius: 14,
        boxShadow: '0 12px 36px rgba(0,0,0,0.22)',
        padding: '14px 16px',
        fontFamily: 'var(--cl-font-sans)',
      }}
    >
      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--cl-text)', marginBottom: 4 }}>
        Get a heads-up when they post
      </div>
      <div style={{ fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--cl-text-light)', marginBottom: 12 }}>
        Turn on notifications and CivicView will alert you when officials
        you track post updates or run polls. You can change this anytime
        in your phone&rsquo;s settings.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={onNotNow}
          disabled={busy}
          style={{
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--cl-border)',
            color: 'var(--cl-text)', fontSize: '0.82rem', fontWeight: 700,
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onEnable}
          disabled={busy}
          style={{
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
            background: 'var(--cl-accent)', border: '1px solid var(--cl-accent)',
            color: 'white', fontSize: '0.82rem', fontWeight: 700,
            fontFamily: 'var(--cl-font-sans)', opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Enabling…' : 'Enable notifications'}
        </button>
      </div>
    </div>
  );
}
