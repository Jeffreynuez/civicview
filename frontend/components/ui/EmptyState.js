'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens EmptyState — the reusable shell for "nothing here yet"
 * moments. Per design system principles:
 *
 *   - Never blame the user. "No recent activity yet" — never
 *     "You haven't followed anyone."
 *   - Every empty has an exit. CTA or implicit next action — except
 *     for in-context emptiness (empty comment thread on a post, where
 *     the composer below carries the intent).
 *   - Calm, not anxious. Plain typography, no exclamation points.
 *
 * Slots:
 *   - icon          : ReactNode, rendered above the headline. Convention
 *                     is a Phosphor Duotone glyph at 56-64px in accent-green
 *                     at ~30% opacity, sat on a soft accent-green plate.
 *   - headline      : string, sentence case, concise.
 *   - body          : string or node, 1-2 sentences explaining what's next.
 *   - cta           : { label, onClick, href? } — primary CTA below body.
 *   - secondary     : { label, onClick, href? } — optional learn-more link.
 *   - tone          : 'default' (accent green) | 'warning' (yellow plate)
 *                     | 'danger' (muted red plate). Tone affects the icon
 *                     plate color, not the body copy color.
 *   - dense         : boolean, if true reduces vertical padding.
 *
 * The component renders a centered column inside a transparent
 * container — wrap in a Card or place anywhere padding is provided.
 */

const TONE_PLATE = {
  default: { plate: 'var(--cl-accent-soft)', icon: 'var(--cl-accent)' },
  warning: { plate: 'var(--cl-warning-soft)', icon: 'var(--cl-warning-text)' },
  danger:  { plate: 'var(--cl-danger-soft)',  icon: 'var(--cl-danger-text)' },
  muted:   { plate: 'var(--cl-bg-soft)',       icon: 'var(--cl-text-light)' },
};

export default function EmptyState({
  icon,
  headline,
  body,
  cta,
  secondary,
  tone = 'default',
  dense = false,
  className = '',
  style = {},
  children,
}) {
  const palette = TONE_PLATE[tone] || TONE_PLATE.default;
  const padY = dense ? 24 : 40;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: `${padY}px 16px`,
        gap: 12,
        ...style,
      }}
    >
      {icon && (
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: palette.plate,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: palette.icon,
          }}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      {headline && (
        <div
          className="cl-h3"
          style={{ marginTop: 4, color: 'var(--cl-text)' }}
        >
          {headline}
        </div>
      )}
      {body && (
        <div
          className="cl-body-sm"
          style={{
            color: 'var(--cl-text-light)',
            maxWidth: 380,
            lineHeight: 'var(--cl-leading-normal)',
          }}
        >
          {body}
        </div>
      )}
      {(cta || secondary) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
          }}
        >
          {cta && (
            cta.href ? (
              <a
                href={cta.href}
                onClick={cta.onClick}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 'var(--cl-radius-md)',
                  background: 'var(--cl-accent)',
                  color: 'var(--cl-text-on-dark)',
                  fontFamily: 'var(--cl-font-sans)',
                  fontWeight: 600,
                  fontSize: 'var(--cl-text-sm)',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {cta.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={cta.onClick}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  padding: '0 14px',
                  border: '1px solid var(--cl-accent)',
                  borderRadius: 'var(--cl-radius-md)',
                  background: 'var(--cl-accent)',
                  color: 'var(--cl-text-on-dark)',
                  fontFamily: 'var(--cl-font-sans)',
                  fontWeight: 600,
                  fontSize: 'var(--cl-text-sm)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {cta.label}
              </button>
            )
          )}
          {secondary && (
            secondary.href ? (
              <a
                href={secondary.href}
                onClick={secondary.onClick}
                style={{
                  fontSize: 'var(--cl-text-xs)',
                  color: 'var(--cl-accent)',
                  textDecoration: 'underline',
                }}
              >
                {secondary.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={secondary.onClick}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 'var(--cl-text-xs)',
                  color: 'var(--cl-accent)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {secondary.label}
              </button>
            )
          )}
        </div>
      )}
      {children}
    </div>
  );
}
