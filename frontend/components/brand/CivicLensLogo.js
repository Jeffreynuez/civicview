'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React, { useId } from 'react';

/**
 * CivicLens brand mark — magnifying lens with a US flag canton inside.
 *
 * Three variants per the design system spec:
 *   - 'color'   (default): navy ring/handle, navy canton, muted-red stripes,
 *                          white field + stars. Use on light surfaces.
 *   - 'mono'              : navy ring/handle, navy canton, navy stripes,
 *                          white field + stars. Use when single-color is needed.
 *   - 'reverse'           : WHITE ring/handle (so it stands on dark chrome),
 *                          muted-red canton, navy stripes, white field + stars.
 *                          Use on the navy navbar / dark backgrounds.
 *
 * The mark uses an internal clipPath + symbol; we generate unique IDs per
 * instance so two logos on the same page don't collide.
 */
export default function CivicLensLogo({
  size = 32,
  variant = 'color',
  className,
  title = 'CivicView',
  ...rest
}) {
  const uid = useId();
  const clipId = `cl-lens-${uid}`;
  const starId = `cl-star-${uid}`;

  // Per-variant palette. Stripes + canton + ring/handle change; the flag
  // field (white) and the stars (white) are constant across variants.
  const palette = {
    color:   { stripe: '#8a2929', canton: '#1a1a2e', ring: '#1a1a2e' },
    mono:    { stripe: '#1a1a2e', canton: '#1a1a2e', ring: '#1a1a2e' },
    reverse: { stripe: '#1a1a2e', canton: '#8a2929', ring: '#ffffff' },
  }[variant] || { stripe: '#8a2929', canton: '#1a1a2e', ring: '#1a1a2e' };

  // Stars filling the canton — 3x3 grid centered.
  const starPositions = [
    [9, 9], [13.8, 9], [18.6, 9],
    [9, 13.8], [13.8, 13.8], [18.6, 13.8],
    [9, 18.6], [13.8, 18.6], [18.6, 18.6],
  ];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
      {...rest}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="26" cy="26" r="20.75" />
        </clipPath>
        <symbol id={starId} viewBox="-1 -1 2 2" overflow="visible">
          <polygon
            fill="#ffffff"
            points="0,-1 0.2245,-0.309 0.951,-0.309 0.363,0.118 0.588,0.809 0,0.382 -0.588,0.809 -0.363,0.118 -0.951,-0.309 -0.2245,-0.309"
          />
        </symbol>
      </defs>

      {/* Flag interior, clipped to the lens circle. */}
      <g clipPath={`url(#${clipId})`}>
        {/* Field (white) */}
        <rect x="5" y="5" width="42" height="42" fill="#ffffff" />

        {/* Six stripes */}
        <rect x="5" y="11.7" width="42" height="2.86" fill={palette.stripe} />
        <rect x="5" y="17.43" width="42" height="2.86" fill={palette.stripe} />
        <rect x="5" y="23.14" width="42" height="2.86" fill={palette.stripe} />
        <rect x="5" y="28.86" width="42" height="2.86" fill={palette.stripe} />
        <rect x="5" y="34.57" width="42" height="2.86" fill={palette.stripe} />
        <rect x="5" y="40.29" width="42" height="2.86" fill={palette.stripe} />

        {/* Canton */}
        <rect x="5" y="5" width="20" height="20" fill={palette.canton} />

        {/* Star constellation */}
        <g>
          {starPositions.map(([x, y]) => (
            <use
              key={`${x}-${y}`}
              href={`#${starId}`}
              x={x}
              y={y}
              width="2.4"
              height="2.4"
            />
          ))}
        </g>

        {/* Subtle highlight on the lens — only on the color variant */}
        {variant === 'color' && (
          <line
            x1="9"
            y1="14"
            x2="20"
            y2="6"
            stroke="#ffffff"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.14"
          />
        )}
      </g>

      {/* Lens ring */}
      <circle
        cx="26"
        cy="26"
        r="20.75"
        fill="none"
        stroke={palette.ring}
        strokeWidth="2.5"
      />

      {/* Lens handle */}
      <rect
        x="42"
        y="44"
        width="14"
        height="4.6"
        rx="1.4"
        transform="rotate(45 42 44)"
        fill={palette.ring}
      />
    </svg>
  );
}
