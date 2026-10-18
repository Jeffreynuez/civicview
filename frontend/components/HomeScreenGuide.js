'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// The Add to Home Screen guide (2026-10-18). iPhone and iPad (iOS 16.4
// and later) send web alerts only to apps on the Home Screen, so when
// someone in a Safari tab tries to turn alerts on (Turn on in
// notification settings, or Enable on the opt-in card) this short guide
// shows in place of the browser's prompt. Opening CivicView from the
// Home Screen then offers the opt-in (components/PushOptInPrompt.js).
// The wording lives in lib/webPush.js (HOME_SCREEN_GUIDE).

import { HOME_SCREEN_GUIDE } from '@/lib/webPush';

export { HOME_SCREEN_GUIDE };

export default function HomeScreenGuide({ onClose, tooOld = false, compact = false }) {
  const text = { fontSize: compact ? '0.72rem' : '0.8rem', lineHeight: 1.45, color: 'var(--cl-text-light)' };
  return (
    <div
      role="note"
      aria-label={tooOld ? 'iOS version needed' : HOME_SCREEN_GUIDE.title}
      data-testid="home-screen-guide"
      style={{
        border: '1px solid var(--cl-border)', borderRadius: 10, background: 'white',
        padding: compact ? '8px 10px' : '10px 12px', margin: '4px 0 6px', fontFamily: 'var(--cl-font-sans)',
      }}
    >
      {tooOld ? (
        <div style={text}>{HOME_SCREEN_GUIDE.tooOld}</div>
      ) : (
        <>
          <div style={{ fontSize: compact ? '0.78rem' : '0.86rem', fontWeight: 700, color: 'var(--cl-text)', marginBottom: 4 }}>
            {HOME_SCREEN_GUIDE.title}
          </div>
          <div style={{ ...text, marginBottom: 6 }}>{HOME_SCREEN_GUIDE.intro}</div>
          <ol style={{ ...text, margin: 0, paddingLeft: 18, listStyle: 'decimal' }}>
            {HOME_SCREEN_GUIDE.steps.map((s) => <li key={s} style={{ marginBottom: 2 }}>{s}</li>)}
          </ol>
        </>
      )}
      {onClose && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--cl-accent)',
              border: '1px solid var(--cl-accent)', color: 'white', fontSize: '0.76rem', fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
