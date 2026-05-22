'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens Avatar — circular, with initials fallback.
 *
 * Per design system: avatar fallbacks are initials on a colored
 * circle (party-tinted when a party is provided, neutral gray
 * otherwise). Real photos drop in via the `src` prop; if missing
 * or errored, we render initials.
 *
 * Sizes (px):
 *   xs: 24, sm: 32, md: 40 (default), lg: 56, xl: 72, 2xl: 96
 *
 * Party prop tints the fallback circle:
 *   'D' -> --cl-democrat
 *   'R' -> --cl-republican
 *   'I' -> --cl-independent
 *   undefined -> neutral surface-200 with text-light initials
 */
const SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 72, '2xl': 96 };

const PARTY_BG = {
  D: 'var(--cl-democrat)',
  R: 'var(--cl-republican)',
  I: 'var(--cl-independent)',
};

function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({
  src,
  name,
  party,
  size = 'md',
  alt,
  className = '',
  style = {},
  ...rest
}) {
  const px = SIZES[size] || (typeof size === 'number' ? size : 40);
  const fontSize = Math.max(10, Math.round(px * 0.36));
  const tint = PARTY_BG[party];

  const baseStyle = {
    width: px,
    height: px,
    borderRadius: '50%',
    background: tint || 'var(--cl-bg-soft)',
    color: tint ? 'var(--cl-text-on-dark)' : 'var(--cl-text-light)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--cl-font-sans)',
    fontWeight: 700,
    fontSize,
    letterSpacing: 0,
    overflow: 'hidden',
    flexShrink: 0,
    ...style,
  };

  if (src) {
    return (
      <span className={className} style={baseStyle} {...rest}>
        {/* loading="lazy" defers the network fetch until the avatar
            is close to the viewport. Critical for long lists like
            the Cabinet (17 members) — without this, all 17 images
            fire on initial mount even though only 3-4 are visible,
            and the browser decode work on full-size portraits
            (1 MB+ each from Wikipedia originals) causes scroll lag.
            decoding="async" lets the decode happen off-main-thread
            where browsers support it. */}
        <img
          src={src}
          alt={alt ?? name ?? ''}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => {
            // Fall back to initials on broken image.
            e.currentTarget.style.display = 'none';
            const sibling = e.currentTarget.nextSibling;
            if (sibling) sibling.style.display = 'flex';
          }}
        />
        <span
          style={{
            display: 'none',
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-hidden="true"
        >
          {initialsOf(name)}
        </span>
      </span>
    );
  }

  return (
    <span
      className={className}
      style={baseStyle}
      role={alt ? 'img' : undefined}
      aria-label={alt ?? name ?? undefined}
      {...rest}
    >
      {initialsOf(name)}
    </span>
  );
}
