// CivicView — /embed/map
// Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// The interactive map on its own, sized to fill whatever frame it is given.
// Built for jrdanimation.com's Work page, where the CivicView row shows the
// real product rather than a screenshot of it — but it is a general embed and
// the frame-ancestors allowlist in next.config.js is the only thing deciding
// who may use it.
//
// This file is a server component so it can export metadata; the interactive
// half is EmbedMap.js. That split is the App Router's rule, not a preference —
// a 'use client' module cannot export metadata.

import EmbedMap from './EmbedMap';

export const metadata = {
  title: 'CivicView — district map',
  description: 'Interactive U.S. congressional district map.',
  robots: { index: false, follow: false },
};

export default function EmbedMapPage() {
  return <EmbedMap />;
}
