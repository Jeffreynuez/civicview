// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Who is allowed to put CivicView inside an iframe.
//
// Until now the answer was "anyone", because the site sends neither
// X-Frame-Options nor a frame-ancestors directive. That is worth fixing on its
// own account: an app with login, 2FA enrollment and account settings that any
// page can frame invisibly is the setup clickjacking needs. The rule below
// closes it for the whole site and opens a single door for /embed/*.
//
// WHY A CSP AND NOT X-Frame-Options
// XFO cannot express an allowlist — it is DENY, SAMEORIGIN, or a single
// ALLOW-FROM that no current browser implements. frame-ancestors supersedes it
// and takes a list.
//
// ON THE VERCEL WILDCARD
// Preview deploys of the marketing site get a generated hostname per commit
// (jrd-animation-website-<hash>.vercel.app), and CSP host sources only accept a
// wildcard for a whole leading label — 'https://jrd-animation-website-*.vercel.app'
// is not valid syntax and is silently ignored. So it is all of *.vercel.app or
// no previews at all. Chosen deliberately: what sits behind that door is a
// public map with no session-bound action on it, and the rest of the site —
// everything with a login on it — is 'self' only.
//
// Two mutually exclusive rules, and they must stay mutually exclusive. Next
// emits a header for every rule that matches, and two CSP headers on one
// response are enforced as their INTERSECTION — so if the site-wide rule also
// matched /embed, the effective policy would be 'self' and the iframe would go
// blank. The negative lookahead is what keeps them apart.
const EMBED_FRAME_ANCESTORS = [
  "'self'",
  'https://jrdanimation.com',
  'https://www.jrdanimation.com',
  'https://*.vercel.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
].join(' ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'unitedstates.github.io',
      },
    ],
  },
  // Allow the dev server to serve /_next/* assets to phones / other
  // devices on the local network or Tailscale tunnel. Without this
  // Next.js 14+ logs a "Cross origin request detected" warning, and
  // future versions will block the request outright. Add any host
  // you want to test from — wildcards work.
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '192.168.*.*',     // standard home LAN range
    '10.*.*.*',        // alt LAN range
    '100.*.*.*',       // CGNAT (apartment networks) + Tailscale
  ],
  async headers() {
    return [
      {
        source: '/embed/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${EMBED_FRAME_ANCESTORS};`,
          },
          // The <meta> robots tag in app/embed/layout.js does not travel with
          // a page fetched as a subresource. This does.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // Everything that is not an embed. Written as a bare regex after the
        // slash — the form Next documents for path exclusions — so it also
        // matches '/' itself.
        source: '/((?!embed).*)',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self';" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
