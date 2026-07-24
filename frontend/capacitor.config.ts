// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Capacitor config — Task #84 (remote-URL shell architecture).
 *
 * The native iOS/Android apps are thin shells that load the LIVE
 * https://civicview.app site. Consequences (the whole point):
 *
 *   • Every Vercel deploy updates the store apps instantly — no store
 *     review, no resubmission, no version bump.
 *   • Store releases are only needed when THIS shell changes: app id,
 *     icon/splash, plugins, permissions, allowNavigation list.
 *   • The browser version is untouched — same site, same deploys.
 *
 * webDir points at mobile-shell/, a tiny branded offline-fallback
 * page that only renders if the webview can't reach the network on
 * first load. It is NOT the app.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.civicview',
  appName: 'CivicView',
  webDir: 'mobile-shell',
  server: {
    url: 'https://civicview.app',
    cleartext: false,
    // Domains allowed to load INSIDE the webview (anything else opens
    // in the system browser). Stripe Checkout + the customer portal
    // must stay in-app so the citizen session cookies are present when
    // Stripe redirects back to civicview.app after payment.
    // Add ID.me domains here when identity verification ships
    // (e.g. 'api.id.me', 'groups.id.me').
    allowNavigation: [
      'civicview.app',
      'checkout.stripe.com',
      'billing.stripe.com',
    ],
  },
  plugins: {
    // Push notifications (FCM). presentationOptions governs how a
    // push renders when the app is FOREGROUND (background delivery is
    // the OS's job). Sound + badge + banner matches user expectation.
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
