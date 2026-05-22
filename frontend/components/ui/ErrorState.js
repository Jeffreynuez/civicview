'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';
import { CircleAlert } from 'lucide-react';
import EmptyState from './EmptyState';

/**
 * CivicLens ErrorState — same shell as EmptyState but with warning
 * iconography and a tone shift. Per design system: network errors
 * and 404s use the burgundy "down-react" token (NOT destructive red),
 * while informational issues (scope mismatch) use warning yellow.
 *
 * Three preset kinds:
 *   - 'network' : "Couldn't reach CivicLens" / Retry CTA
 *   - 'notFound': "We couldn't find that page"
 *   - 'scope'   : "This is scoped to a different district" (informational)
 *
 * Custom errors can pass headline/body/cta directly — the component
 * accepts the same prop shape as EmptyState plus a `kind` shortcut.
 */

const PRESETS = {
  network: {
    headline: "Couldn't reach CivicView",
    body: 'Check your connection and try again.',
    tone: 'danger',
  },
  notFound: {
    headline: "We couldn't find that page",
    body: 'It may have been removed or the link is wrong.',
    tone: 'danger',
  },
  scope: {
    headline: 'This is scoped to a different district',
    body: 'Only verified voters in this district can see it.',
    tone: 'warning',
  },
};

const WarningIcon = ({ size = 36 }) => (
  <CircleAlert size={32} strokeWidth={2} />
);

export default function ErrorState({
  kind,
  icon,
  headline,
  body,
  cta,
  secondary,
  tone,
  ...rest
}) {
  const preset = kind ? PRESETS[kind] || {} : {};
  return (
    <EmptyState
      icon={icon ?? <WarningIcon />}
      headline={headline ?? preset.headline}
      body={body ?? preset.body}
      tone={tone ?? preset.tone ?? 'danger'}
      cta={cta}
      secondary={secondary}
      {...rest}
    />
  );
}
