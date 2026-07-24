'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Registers /sw.js so civicview.app is installable as a desktop PWA
// (Windows / macOS / Linux / ChromeOS "Install CivicView" in the
// browser menu) and lays the groundwork for browser Web Push later.
// Renders nothing. Mounted once in the root layout.
//
// Guards:
//   • Capacitor native shell — the Android app has FCM for push and
//     its own shell; a SW inside the remote-URL webview buys nothing
//     and risks update-flow weirdness. Skip it there.
//   • SSR / unsupported browsers — feature-detect first.
// Registration is deferred to window 'load' so it never competes with
// first-paint resources.

import { useEffect } from 'react';
import { isNativeApp } from '@/lib/push';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (isNativeApp()) return;
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => { /* non-fatal — the site works fine without it */ });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);
  return null;
}
