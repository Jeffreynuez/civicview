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
// Mounted at the ROOT LAYOUT (2026-07-26) — it used to mount only in
// app/page.js, which meant the 'cv:tracked-item' contextual trigger
// fired into the void on every other route: tracking an official from
// their PAGE HEADER (the primary flow since 863db06) never offered
// push, so devices never registered at all. Root mount = the card can
// appear wherever the track action happens.

import { useEffect, useRef, useState } from 'react';
import { useCitizenAuth } from '@/lib/citizenAuth';
import {
  shouldOfferPush, enablePush, declinePushOffer, refreshPushRegistration,
  bindPushToAccount, unbindPushDevice, initPushStatusWatch,
  canOpenNotificationSettings, openNotificationSettings, getPushChoice,
} from '@/lib/push';

export default function PushOptInPrompt() {
  const { citizen, isLoaded: citizenLoaded } = useCitizenAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  // Android said no (2026-10-17): the card then offers Android settings.
  const [denied, setDenied] = useState(false);

  // Refresh an existing registration on every app launch (token
  // rotation + citizen re-binding), and watch Android's notification
  // setting at launch and on every resume (lib/push.js). Cheap no-op
  // on the web.
  useEffect(() => {
    initPushStatusWatch();
    refreshPushRegistration();
  }, []);

  // Sign-in binds this phone to the citizen at once; sign-out (any
  // path: the menu, sign out everywhere, an expired session) unbinds
  // it, so a shared phone never keeps the last account's alerts
  // (2026-10-16). Mounted at the root, so this sees every transition.
  // The first value is the launch state, which the refresh above
  // already registered.
  const lastCitizenId = useRef(undefined);
  useEffect(() => {
    if (!citizenLoaded) return;
    const id = citizen?.id || null;
    const prev = lastCitizenId.current;
    lastCitizenId.current = id;
    if (prev === undefined || prev === id) return;
    if (id) bindPushToAccount(id);
    else {
      unbindPushDevice();
      // An offer made to the account goes with it (nothing recorded,
      // so it can come back at the next sign-in or track).
      setVisible(false);
      setDenied(false);
    }
  }, [citizen?.id, citizenLoaded]);

  // Offer only when: native shell + plugin present + no prior choice +
  // a citizen is signed in (the agreed contextual trigger). After a
  // "Not now" this never brings it back (2026-10-17): only a track can.
  useEffect(() => {
    if (citizen && shouldOfferPush('signin')) setVisible(true);
  }, [citizen]);

  // Second contextual trigger (2026-07-25, Jeffrey's ask): the moment
  // the user TRACKS something — official, bill, or election — is the
  // most natural time to offer push ("you just said you care about
  // this — want alerts when it moves?"). The tracked stores dispatch
  // 'cv:tracked-item' on every track action. No citizen requirement
  // here: anonymous devices get tracked-activity pushes too
  // (Notifications v2 part 3), so the offer is meaningful signed out.
  // Since 2026-10-17 this is also the one second chance: someone who
  // tapped "Not now" sees the card once more, the next time they track
  // something at least 30 days later (shouldOfferPush('track')).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onTracked = () => { if (shouldOfferPush('track')) setVisible(true); };
    window.addEventListener('cv:tracked-item', onTracked);
    return () => window.removeEventListener('cv:tracked-item', onTracked);
  }, []);

  if (!visible) return null;

  const onEnable = async () => {
    setBusy(true);
    const res = await enablePush(); // records its own choice on success/denial
    setBusy(false);
    if (res && res.reason === 'denied' && canOpenNotificationSettings()) {
      setDenied(true); // Android will not ask again: offer its settings
      return;
    }
    setVisible(false);
  };
  const onNotNow = () => {
    if (getPushChoice() !== 'denied') declinePushOffer();
    setVisible(false);
  };
  const onOpenSettings = async () => {
    await openNotificationSettings();
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
        {denied ? 'Notifications are off' : 'Get a heads-up when things move'}
      </div>
      <div style={{ fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--cl-text-light)', marginBottom: 12 }}>
        {/* Only alerts that exist (2026-10-17). A signed-out phone only
            gets posts and polls from officials it tracks. Federal bills
            only: state bills cannot be tracked yet. */}
        {denied
          ? 'Android has notifications turned off for CivicView. Turn them on in Android settings.'
          : citizen
            ? 'Get alerts when officials you track post or schedule events, when someone replies to your comment, when federal bills you track move, when polls you voted in close, and before election deadlines. Choose which in notification settings.'
            : 'Get alerts when officials you track post updates or polls. Sign in for replies, bill updates, poll results and election reminders.'}
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
          onClick={denied ? onOpenSettings : onEnable}
          disabled={busy}
          style={{
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
            background: 'var(--cl-accent)', border: '1px solid var(--cl-accent)',
            color: 'white', fontSize: '0.82rem', fontWeight: 700,
            fontFamily: 'var(--cl-font-sans)', opacity: busy ? 0.6 : 1,
          }}
        >
          {denied ? 'Open settings' : busy ? 'Enabling…' : 'Enable notifications'}
        </button>
      </div>
    </div>
  );
}
