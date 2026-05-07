'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens Spinner — canonical 16px ring with accent-green leader
 * over a low-alpha track. 0.9s linear rotation per design system spec.
 *
 * Use inside buttons (the Button component already has its own copy
 * for self-containment), inside small async refresh chips, or
 * standalone for centered-loading moments.
 *
 * Props:
 *   - size:  pixel size, default 16
 *   - color: stroke color (default 'currentColor' so it inherits
 *            the parent's text color — useful inside colored buttons)
 *   - track: track color, default 'currentColor' at 0.25 opacity
 */
export default function Spinner({ size = 16, color = 'currentColor', track, className = '', style = {}, ...rest }) {
  const animId = `cl-spin-${size}`;
  return (
    <>
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        role="img"
        aria-label="Loading"
        className={className}
        style={{ animation: `${animId} 0.9s linear infinite`, ...style }}
        {...rest}
      >
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeOpacity={track ? 1 : 0.25}
          {...(track ? { stroke: track } : {})}
        />
        <path
          d="M14 8a6 6 0 0 0-6-6"
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <style jsx>{`
        @keyframes ${animId} {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
