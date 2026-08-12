'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Suppresses the root-layout chrome on /embed/* routes.
//
// WHY THIS EXISTS
// The App Router has exactly one root layout, and every route inherits it.
// That is right for the app — ScrollTopButton, the tutorial overlay, the
// push prompt and the update gate all need to exist on every real page.
// It is wrong for an embed: /embed/map is rendered inside a ~570px iframe on
// someone else's site, where a floating back-to-top button and a "turn on
// notifications" card are not chrome, they are litter.
//
// The documented way to skip a root layout is route groups with a second
// root layout, which means moving every existing route into a group and
// maintaining two <html>/<body> trees forever. That is a large, risky change
// to a live app in exchange for one iframe. This is the small one: a client
// component that reads the path and renders nothing under /embed.
//
// Deliberately NOT gated here: LegacyStorageCleanup, RecoveryBanner and
// Force2FAGate. All three are correctness, not decoration — they render
// nothing visible for an anonymous visitor, and an embed that quietly opted
// out of the 2FA gate would be a security hole rather than a tidier iframe.
//
// usePathname() is available during SSR in the App Router, so the embed does
// not flash the chrome on first paint and then remove it.

import { usePathname } from 'next/navigation';

export default function EmbedGate({ children }) {
  const pathname = usePathname();
  if (pathname && pathname.startsWith('/embed')) return null;
  return children;
}
