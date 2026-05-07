'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens Card — the canonical white surface.
 *
 * Per design system:
 *   background: var(--cl-card)
 *   border: 1px solid var(--cl-border)
 *   border-radius: var(--cl-radius-xl)  (12px, 'card' geometry)
 *   padding: 14px (default)
 *   no resting shadow; shadow only on overlays
 *
 * Variants:
 *   - 'default'  : standard 12px-radius card, no shadow
 *   - 'hero'     : 14px radius, 18px padding (page-header card)
 *   - 'elevated' : adds the level-1 'card' shadow for raised surfaces
 *   - 'sticky'   : adds level-2 'sticky' shadow + sticky scroll affordance
 *
 * Padding can be overridden via the `padding` prop or via inline style.
 */
export default function Card({
  variant = 'default',
  padding,
  as: Tag = 'div',
  className = '',
  style = {},
  children,
  ...rest
}) {
  const variantStyle = {
    default: {
      borderRadius: 'var(--cl-radius-xl)',
      padding: padding ?? '14px',
      boxShadow: 'none',
    },
    hero: {
      borderRadius: 'var(--cl-radius-2xl)',
      padding: padding ?? '18px',
      boxShadow: 'none',
    },
    elevated: {
      borderRadius: 'var(--cl-radius-xl)',
      padding: padding ?? '14px',
      boxShadow: 'var(--cl-shadow-card)',
    },
    sticky: {
      borderRadius: 'var(--cl-radius-xl)',
      padding: padding ?? '14px',
      boxShadow: 'var(--cl-shadow-sticky)',
    },
  }[variant];

  const baseStyle = {
    background: 'var(--cl-card)',
    border: '1px solid var(--cl-border)',
    color: 'var(--cl-text)',
    ...variantStyle,
    ...style,
  };

  return (
    <Tag className={className} style={baseStyle} {...rest}>
      {children}
    </Tag>
  );
}
