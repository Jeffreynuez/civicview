'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens Button — token-first, used across every surface.
 *
 * Variants:
 *   - 'primary'   (default) : solid accent-green, white text. Main CTA.
 *   - 'secondary'           : white surface, accent-green text + 1px border.
 *   - 'outline'             : transparent fill, --cl-border stroke, --cl-text.
 *   - 'icon'                : square; renders only children, no padding chrome.
 *   - 'danger'              : --cl-danger fill for destructive actions.
 *   - 'subscribe'           : --cl-warning yellow fill (Subscribe-style CTA).
 *
 * Sizes:
 *   - 'sm' : 28px tall, 0.75rem text
 *   - 'md' : 36px tall, 0.82rem text  (default)
 *   - 'lg' : 44px tall, 0.92rem text
 *
 * State:
 *   - loading : disables interaction, swaps label for inline spinner
 *   - disabled: 0.5 opacity, no pointer events
 *
 * Hover lightens (per design system spec — never darkens). Press
 * adds a 1px translateY on primary CTAs only.
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  leadingIcon = null,
  trailingIcon = null,
  type = 'button',
  className = '',
  style = {},
  children,
  ...rest
}) {
  const isDisabled = disabled || loading;

  const sizeStyle = {
    sm: { height: 28, padding: '0 10px', fontSize: 'var(--cl-text-xs)', borderRadius: 'var(--cl-radius-sm)' },
    md: { height: 36, padding: '0 14px', fontSize: 'var(--cl-text-sm)', borderRadius: 'var(--cl-radius-md)' },
    lg: { height: 44, padding: '0 18px', fontSize: 'var(--cl-text-md)', borderRadius: 'var(--cl-radius-md)' },
  }[size];

  const variantStyle = {
    primary: {
      background: 'var(--cl-accent)',
      color: 'var(--cl-text-on-dark)',
      border: '1px solid var(--cl-accent)',
    },
    secondary: {
      background: 'var(--cl-card)',
      color: 'var(--cl-accent)',
      border: '1px solid var(--cl-border)',
    },
    outline: {
      background: 'transparent',
      color: 'var(--cl-text)',
      border: '1px solid var(--cl-border)',
    },
    icon: {
      background: 'transparent',
      color: 'var(--cl-text-light)',
      border: 'none',
      width: sizeStyle.height,
      height: sizeStyle.height,
      padding: 0,
    },
    danger: {
      background: 'var(--cl-danger)',
      color: 'var(--cl-text-on-dark)',
      border: '1px solid var(--cl-danger)',
    },
    subscribe: {
      background: 'var(--cl-warning)',
      color: 'var(--cl-warning-text)',
      border: '1px solid var(--cl-warning)',
    },
  }[variant];

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--cl-space-2)',
    fontFamily: 'var(--cl-font-sans)',
    fontWeight: 600,
    lineHeight: 1,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.5 : 1,
    transition: 'background var(--cl-duration-fast) var(--cl-ease-standard), border-color var(--cl-duration-fast) var(--cl-ease-standard), color var(--cl-duration-fast) var(--cl-ease-standard)',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    ...sizeStyle,
    ...variantStyle,
    ...style,
  };

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={className}
      style={baseStyle}
      {...rest}
    >
      {loading ? (
        <Spinner16 />
      ) : (
        <>
          {leadingIcon}
          {children}
          {trailingIcon}
        </>
      )}
    </button>
  );
}

// Inline spinner so Button is self-contained. Phase 2B exports a
// canonical <Spinner /> component that this matches.
function Spinner16() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.25"
      />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 8 8"
          to="360 8 8"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
