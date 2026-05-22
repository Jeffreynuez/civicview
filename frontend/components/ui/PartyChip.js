'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens PartyChip — the small party-letter pill.
 *
 * Per design system: party-coded reds/blues are PILL-ONLY,
 * never CTA fills, never backgrounds. Use this component
 * everywhere a party affiliation is displayed inline.
 *
 * Variants:
 *   - 'solid'  (default): solid party color, white text. Compact pill.
 *   - 'soft'            : soft-tint background, party-text. Body-friendly.
 *
 * Sizes:
 *   - 'xs' : tiny adjacent-to-name chip (used in PostCard headers)
 *   - 'sm' : default
 *   - 'md' : larger, used in profile headers
 *
 * party prop accepts letter codes ('D' / 'R' / 'I') OR full names
 * ('Democrat' / 'Republican' / 'Independent'). Unknown values render
 * a neutral chip.
 */
const PARTY_KEY = {
  D: 'D', d: 'D', democrat: 'D', democratic: 'D', dem: 'D',
  R: 'R', r: 'R', republican: 'R', gop: 'R', rep: 'R',
  I: 'I', i: 'I', independent: 'I', ind: 'I', IND: 'I',
  // Florida ballot codes for non-major-party candidates. We render
  // these as their own chips so a No-Party-Affiliation candidate
  // doesn't read the same as an Independent candidate (they're
  // different ballot statuses under FL law).
  NPA: 'NPA', npa: 'NPA',
  LPF: 'LPF', lpf: 'LPF', libertarian: 'LPF', lib: 'LPF',
  CPF: 'CPF', cpf: 'CPF', constitution: 'CPF',
  WRI: 'WRI', wri: 'WRI', 'write-in': 'WRI', writein: 'WRI',
};

const PARTY_COLORS = {
  D: { solid: 'var(--cl-democrat)', soft: 'var(--cl-democrat-soft)' },
  R: { solid: 'var(--cl-republican)', soft: 'var(--cl-republican-soft)' },
  I: { solid: 'var(--cl-independent)', soft: 'var(--cl-independent-soft)' },
  // Minor-party / no-party chips intentionally use neutral surface
  // tokens — no party-coded color — so they sit outside the R/D/I
  // visual hierarchy without inventing new brand colors.
  NPA: null,
  LPF: null,
  CPF: null,
  WRI: null,
};

const PARTY_LABEL = {
  D: 'D',
  R: 'R',
  I: 'I',
  NPA: 'NPA',
  LPF: 'LIB',
  CPF: 'CON',
  WRI: 'WI',
};

const PARTY_FULL = {
  D: 'Democrat',
  R: 'Republican',
  I: 'Independent',
  NPA: 'No Party Affiliation',
  LPF: 'Libertarian',
  CPF: 'Constitution Party',
  WRI: 'Write-in',
};

export default function PartyChip({
  party,
  variant = 'solid',
  size = 'sm',
  label,
  className = '',
  style = {},
  ...rest
}) {
  const key = PARTY_KEY[String(party).trim()] || null;
  const colors = key ? PARTY_COLORS[key] : null;
  const text = label ?? (key ? PARTY_LABEL[key] : '?');

  // Wider sizes for multi-letter labels (NPA / LIB / CON / WI) so the
  // text doesn't get clipped inside the pill.
  const isWide = key === 'NPA' || key === 'LPF' || key === 'CPF' || key === 'WRI';
  const sizeStyle = {
    xs: { height: 16, padding: isWide ? '0 6px' : '0 5px', fontSize: 10, minWidth: isWide ? 28 : 16 },
    sm: { height: 18, padding: isWide ? '0 7px' : '0 6px', fontSize: 11, minWidth: isWide ? 32 : 18 },
    md: { height: 22, padding: isWide ? '0 9px' : '0 8px', fontSize: 12, minWidth: isWide ? 36 : 22 },
  }[size];

  let visual;
  if (!colors) {
    visual = {
      background: 'var(--cl-bg-soft)',
      color: 'var(--cl-text-light)',
      border: '1px solid var(--cl-border)',
    };
  } else if (variant === 'soft') {
    visual = {
      background: colors.soft,
      color: colors.solid,
      border: `1px solid ${colors.solid}`,
    };
  } else {
    visual = {
      background: colors.solid,
      color: 'var(--cl-text-on-dark)',
      border: `1px solid ${colors.solid}`,
    };
  }

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--cl-radius-pill)',
    fontFamily: 'var(--cl-font-sans)',
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: 0,
    flexShrink: 0,
    ...sizeStyle,
    ...visual,
    ...style,
  };

  return (
    <span
      className={className}
      style={baseStyle}
      role="img"
      aria-label={key ? PARTY_FULL[key] : 'Party unknown'}
      {...rest}
    >
      {text}
    </span>
  );
}
