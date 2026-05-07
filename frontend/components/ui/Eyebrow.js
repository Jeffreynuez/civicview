'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens Eyebrow — tiny ALL-CAPS label above headlines and
 * section titles ("CONSTITUENT DASHBOARD", "MOST LIKED",
 * "PRIMARY · 114 DAYS"). Mounts the .cl-eyebrow class onto a
 * configurable tag (default <div>) and supports a `tone` prop
 * for the rare cases the label color shifts (accent-green for
 * active sections, warning for tracked, etc.).
 */
const TONE_COLORS = {
  default: 'var(--cl-text-light)',
  accent:  'var(--cl-accent)',
  warning: 'var(--cl-warning-text)',
  danger:  'var(--cl-danger-text)',
  muted:   'var(--cl-text-muted)',
};

export default function Eyebrow({
  tone = 'default',
  as: Tag = 'div',
  className = '',
  style = {},
  children,
  ...rest
}) {
  const baseStyle = {
    color: TONE_COLORS[tone] || TONE_COLORS.default,
    ...style,
  };

  const cls = `cl-eyebrow${className ? ` ${className}` : ''}`;

  return (
    <Tag className={cls} style={baseStyle} {...rest}>
      {children}
    </Tag>
  );
}
