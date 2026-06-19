'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Android hardware / gesture back-button handler for the Capacitor
 * native shell (Task #84 follow-up).
 *
 * Why this exists: the native apps are a thin Capacitor remote-URL
 * shell loading https://civicview.app. With plain Capacitor core and
 * NO `@capacitor/app` plugin, Android's hardware/gesture back button
 * defaults to finishing the activity — i.e. it EXITS the app instead
 * of walking the in-app (WebView / Next.js) history. Testers reported
 * "back closes the app instead of going back a step."
 *
 * The fix has two halves:
 *   1. NATIVE (one-time, requires a Play release): `@capacitor/app`
 *      must be installed in the shell so the `backButton` event is
 *      emitted to the WebView and `window.Capacitor.Plugins.App` is
 *      injected. (`npm i @capacitor/app && npx cap sync android`.)
 *   2. WEB (this component, deploys via Vercel — no store review):
 *      register a `backButton` listener that navigates back through
 *      history when possible and only exits the app at the root.
 *
 * We deliberately use the INJECTED `window.Capacitor` global rather
 * than importing `@capacitor/app` as a module, so the browser bundle
 * stays free of native deps. On the web and on iOS (no hardware back
 * button) this component detects the environment and no-ops. Renders
 * nothing visible — pure side effect, mounted once at the root layout.
 */
import { useEffect } from 'react';

export default function AndroidBackButton() {
  useEffect(() => {
    const Cap = typeof window !== 'undefined' ? window.Capacitor : undefined;

    // Only manage the back button inside the native Android shell.
    // Browser + PWA + iOS all have no Android-style hardware back.
    if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) {
      return;
    }
    if (typeof Cap.getPlatform === 'function' && Cap.getPlatform() !== 'android') {
      return;
    }

    const App = Cap.Plugins && Cap.Plugins.App;
    if (!App || typeof App.addListener !== 'function') {
      // @capacitor/app isn't present in this build of the shell yet.
      // Bail quietly — the native half of the fix hasn't shipped.
      return;
    }

    let handle;
    let removed = false;

    // Registering a backButton listener disables Capacitor's default
    // back behavior, so we MUST handle navigation + exit ourselves.
    const onBackButton = (event) => {
      const canGoBack = event && typeof event.canGoBack === 'boolean'
        ? event.canGoBack
        : window.history.length > 1;

      if (canGoBack) {
        window.history.back();
      } else if (typeof App.exitApp === 'function') {
        App.exitApp();
      }
    };

    const result = App.addListener('backButton', onBackButton);
    // addListener may return a handle or a Promise<handle> depending on
    // the Capacitor version — normalize both, and honor an unmount that
    // races ahead of the promise resolving.
    Promise.resolve(result)
      .then((h) => {
        if (removed && h && typeof h.remove === 'function') {
          h.remove();
        } else {
          handle = h;
        }
      })
      .catch(() => {});

    return () => {
      removed = true;
      if (handle && typeof handle.remove === 'function') {
        handle.remove();
      }
    };
  }, []);

  return null;
}
