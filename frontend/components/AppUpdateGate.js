'use client';

// CivicView — force-update gate for the native app shell.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Renders nothing on the web. In the Android shell, compares the
// installed shell's versionCode (Capacitor App plugin getInfo().build)
// against GET /api/app/version:
//
//   build < min_version_code    → full-screen BLOCKING overlay with an
//                                 "Update CivicView" Play Store button.
//                                 The app cannot be used underneath.
//   build < latest_version_code → dismissible "Update available" banner
//                                 (once per session).
//
// Thresholds are Render env vars (APP_MIN_VERSION_CODE /
// APP_LATEST_VERSION_CODE); both default 0 = gate fully inert. Because
// the shell loads the LIVE site, most features never need this — the
// hard gate exists for the rare release where an old shell is
// genuinely broken (e.g. a missing plugin becomes load-bearing).
//
// Fail-open by design: no network, missing App plugin (older shells),
// or a malformed response all render nothing — an update gate must
// never be the thing that breaks the app.

import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/push';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const NUDGE_DISMISSED_KEY = 'cv:update-nudge-dismissed';

async function installedBuild() {
  try {
    const App = window.Capacitor?.Plugins?.App;
    if (!App || typeof App.getInfo !== 'function') return null;
    const info = await App.getInfo();
    const build = parseInt(info && info.build, 10);
    return Number.isFinite(build) && build > 0 ? build : null;
  } catch { return null; }
}

export default function AppUpdateGate() {
  // mode: null | {kind: 'block'|'nudge', storeUrl: string}
  const [mode, setMode] = useState(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    (async () => {
      const build = await installedBuild();
      if (build == null) return; // old shell without the App plugin — fail open
      let cfg = null;
      try {
        const res = await fetch(`${API_BASE_URL}/api/app/version`);
        if (res.ok) cfg = await res.json();
      } catch { /* offline — fail open */ }
      if (cancelled || !cfg) return;
      const min = cfg.min_version_code || 0;
      const latest = cfg.latest_version_code || 0;
      const storeUrl = cfg.store_url || 'https://play.google.com/store/apps/details?id=app.civicview';
      if (min > 0 && build < min) {
        setMode({ kind: 'block', storeUrl });
        return;
      }
      if (latest > 0 && build < latest) {
        let dismissed = false;
        try { dismissed = window.sessionStorage.getItem(NUDGE_DISMISSED_KEY) === '1'; } catch { /* ignore */ }
        if (!dismissed) setMode({ kind: 'nudge', storeUrl });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!mode) return null;

  const openStore = () => {
    try { window.open(mode.storeUrl, '_blank'); } catch { /* ignore */ }
  };

  if (mode.kind === 'block') {
    return (
      <div
        role="alertdialog"
        aria-label="Update required"
        style={{
          position: 'fixed', inset: 0, zIndex: 4000,
          background: 'var(--cl-primary, #1b263b)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 24, textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'white', marginBottom: 10 }}>
          Update required
        </div>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.85)', maxWidth: 340, marginBottom: 20 }}>
          This version of CivicView is out of date and can&rsquo;t connect
          safely anymore. Install the latest update from Google Play to
          keep going — it only takes a moment.
        </div>
        <button
          type="button"
          onClick={openStore}
          style={{
            padding: '12px 22px', borderRadius: 10, border: 'none',
            background: 'var(--cl-accent, #2a9d8f)', color: 'white',
            fontSize: '0.95rem', fontWeight: 800, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Update CivicView
        </button>
      </div>
    );
  }

  // Soft nudge — dismissible banner.
  const dismiss = () => {
    try { window.sessionStorage.setItem(NUDGE_DISMISSED_KEY, '1'); } catch { /* ignore */ }
    setMode(null);
  };
  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 1090,
        maxWidth: 420, margin: '0 auto',
        background: 'white', border: '1px solid var(--cl-border)',
        borderRadius: 14, boxShadow: '0 12px 36px rgba(0,0,0,0.22)',
        padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--cl-text)' }}>
          A new version is available
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--cl-text-light)' }}>
          Update on Google Play for the latest improvements.
        </div>
      </div>
      <button
        type="button"
        onClick={openStore}
        style={{
          padding: '8px 12px', borderRadius: 8, border: 'none',
          background: 'var(--cl-accent)', color: 'white',
          fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Update
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update notice"
        style={{
          padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--cl-border)',
          color: 'var(--cl-text-light)', fontSize: '0.78rem', fontWeight: 700,
          fontFamily: 'inherit',
        }}
      >
        Later
      </button>
    </div>
  );
}
