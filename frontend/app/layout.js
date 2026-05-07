// CivicView — frontend root layout.
// Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import './globals.css';

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
        {/* Theme boot script — runs synchronously before the
            stylesheet applies so we set <html data-theme="dark">
            (or "light") before the first paint, preventing a
            flash-of-wrong-theme when a returning dark-mode user
            reloads. Reads the same localStorage key as
            lib/useTheme.js. dangerouslySetInnerHTML is the
            standard React pattern for this — the script is
            inlined into the static HTML at build time. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var t = window.localStorage.getItem('civiclens:theme:v1');
                  if (t === 'dark') {
                    document.documentElement.dataset.theme = 'dark';
                  } else {
                    document.documentElement.dataset.theme = 'light';
                  }
                } catch (e) {
                  document.documentElement.dataset.theme = 'light';
                }
              })();
            `,
          }}
        />
      </head>
      {/* overflow-x: hidden as a safety net so a transient layout
          overflow (e.g. mid-orientation-change before the visualViewport
          listener fires) can't expose horizontal scrollbars / white
          gutters when the user pinch-zooms out. */}
      <body className="h-screen flex flex-col" style={{ overflowX: 'hidden' }}>{children}</body>
    </html>
  );
}
