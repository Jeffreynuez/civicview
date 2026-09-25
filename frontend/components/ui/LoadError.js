'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * Compact "could not load" notice for a list or tab (audit B7).
 *
 * Use it where an empty list would otherwise be read as a fact ("this
 * official has no bills", "no officials in this state") when the real
 * cause was an outage or a timeout. ErrorState is the full-size version
 * for a whole page or panel; this one sits inline above or instead of a
 * list.
 *
 * Props:
 *   message  what failed, in plain words. Defaults to a generic line.
 *   detail   optional second line (the client's error text).
 *   onRetry  when given, shows a Retry button.
 *   style    extra styles for the outer box.
 */
export default function LoadError({
  message = 'Could not load this right now.',
  detail,
  onRetry,
  style,
}) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 12px',
        margin: '8px 0',
        border: '1px solid var(--cl-border)',
        borderLeft: '3px solid var(--cl-danger-text)',
        borderRadius: 'var(--cl-radius-md, 8px)',
        background: 'var(--cl-bg)',
        color: 'var(--cl-text)',
        fontFamily: 'var(--cl-font-sans)',
        fontSize: '0.85rem',
        lineHeight: 1.4,
        ...style,
      }}
    >
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{message}</div>
        {detail && (
          <div style={{ color: 'var(--cl-text-light)', marginTop: 2 }}>{detail}</div>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            flexShrink: 0,
            height: 32,
            padding: '0 14px',
            border: '1px solid var(--cl-border)',
            borderRadius: 'var(--cl-radius-md, 8px)',
            background: 'var(--cl-bg)',
            color: 'var(--cl-text)',
            fontFamily: 'var(--cl-font-sans)',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
