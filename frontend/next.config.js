// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

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
};

module.exports = nextConfig;
