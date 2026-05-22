// CivicView — frontend root layout.
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import './globals.css';
import Force2FAGate from '@/components/Force2FAGate';
import RecoveryBanner from '@/components/RecoveryBanner';

export const metadata = {
  title: 'CivicView - Know Your Representatives',
  description: 'Track your elected officials, legislation, and upcoming elections',
  // PWA hooks. The manifest is the primary signal that triggers the
  // browser's "Add to Home Screen" prompt; theme-color drives the
  // address-bar tint on Android Chrome and the title-bar tint when
  // the app is installed standalone.
  manifest: '/manifest.webmanifest',
  themeColor: '#1b263b',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CivicView',
  },
  icons: {
    icon: '/logo/civiclens-glyph-color.svg',
    apple: '/logo/civiclens-glyph-color.svg',
  },
};

// Viewport metadata — Next.js 14 App Router pattern. Without this,
// mobile browsers default to a 980px-wide "desktop" viewport and
// auto-zoom the page to fit, which means our ≤768px breakpoint
// never fires and the entire mobile layout (split map / panel,
// compressed navbar, fullscreen profile takeovers, larger tap
// targets) stays inert on a real phone. `width: 'device-width'`
// makes the CSS pixel width match the actual screen width;
// `initialScale: 1` opens the page at 1:1 zoom. We deliberately
// do NOT set `maximumScale` or `userScalable: false` — letting
// users pinch-zoom the page is an accessibility requirement.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Viewport meta tag — belt-and-suspenders alongside the
            `viewport` metadata export above. Some Next.js setups
            haven't been picking up the export reliably during dev,
            and a missing viewport tag silently breaks the entire
            mobile layout. Placing the raw <meta> here guarantees
            the tag is in the HTML the phone receives, regardless
            of what the metadata API does. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.1.1/dist/maplibre-gl.css" />
        {/* Theme boot script previously lived here for the in-app
            dark-mode toggle. Removed in favor of letting the OS handle
            dark mode at the chrome level — many components hardcode
            white backgrounds and the half-themed result was worse than
            no theming. globals.css explicitly declares `color-scheme:
            light` on :root so the browser doesn't auto-darken native
            form controls, even if the OS is in dark mode. */}
      </head>
      {/* cl-h-screen-visible tracks the *visible* viewport on mobile
          browsers via `dvh` (with a `vh` fallback). With h-screen
          (100vh only) the navbar would slide above the visible top
          edge after returning from a full-screen view like
          CandidateProfile — the URL bar reappears but 100vh still
          claims the larger "chrome collapsed" height, so the flex
          column extends past the screen.
          overflow-x: hidden is a safety net so a transient layout
          overflow (e.g. mid-orientation-change before the visualViewport
          listener fires) can't expose horizontal scrollbars / white
          gutters when the user pinch-zooms out. */}
      <body
        className="cl-h-screen-visible flex flex-col"
        style={{ overflowX: 'hidden' }}
      >
        {/* Force2FAGate (2FA Phase 4) — wraps every route so the
            enforcement overlay can mount above any page when an
            active rep / candidate / admin session carries
            needs_2fa_enrollment=true. Citizens are never enforced
            (their /me always returns False for the flag). Gated by
            the FORCE_2FA_ENABLED env var on the backend; this
            component renders the overlay if and only if the backend
            opts the user in. */}
        {/* RecoveryBanner (Task #81) sits ABOVE the Force2FAGate
            so a soft-deleted user sees their recovery prompt first,
            before any 2FA enrollment surface. Both render at top
            of every route via this layout wrapping. */}
        <RecoveryBanner />
        <Force2FAGate>
          {children}
        </Force2FAGate>
      </body>
    </html>
  );
}
