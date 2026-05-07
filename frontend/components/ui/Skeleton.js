'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React from 'react';

/**
 * CivicLens Skeleton — shape-matching loading placeholders.
 *
 * Per design system: skeletons match the SHAPE of the content
 * they precede (no generic gray rectangles where a real card has
 * specific layout). Shimmer is 1.4s ease-in-out — calm, not anxious.
 *
 * Variants:
 *   - 'bar'    : single horizontal bar (set width/height props)
 *   - 'circle' : circular placeholder (avatar / icon)
 *   - 'card'   : full PostCard skeleton (avatar + 60/40 header bars
 *                + 3 body lines at 100/95/70% + optional thumbnail)
 *   - 'list'   : 4 abbreviated card skeletons stacked, stepped opacity
 *                (100→90→80→70%) so it reads as "more loading below."
 *
 * The shimmer is implemented with a moving white-to-transparent
 * gradient inside the bar (translateX from -100% to 100%).
 */

function Bar({ width = '100%', height = 12, radius = 'var(--cl-radius-sm)', style = {} }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'var(--cl-bg-soft)',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
          animation: 'cl-skeleton-shimmer 1.4s ease-in-out infinite',
        }}
      />
    </span>
  );
}

function Circle({ size = 40, style = {} }) {
  return (
    <Bar
      width={size}
      height={size}
      radius="50%"
      style={{ flexShrink: 0, ...style }}
    />
  );
}

function CardSkeleton({ withThumbnail = false }) {
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 'var(--cl-radius-xl)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Circle size={40} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Bar width="60%" height={10} />
          <Bar width="40%" height={8} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Bar width="100%" height={10} />
        <Bar width="95%" height={10} />
        <Bar width="70%" height={10} />
      </div>
      {withThumbnail && (
        <Bar width="100%" height={140} radius="var(--cl-radius-md)" />
      )}
    </div>
  );
}

function ListSkeleton({ count = 4 }) {
  const opacities = [1, 0.9, 0.8, 0.7];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ opacity: opacities[i] ?? 0.6 }}>
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}

const KEYFRAMES = (
  <style jsx global>{`
    @keyframes cl-skeleton-shimmer {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
  `}</style>
);

export default function Skeleton({ variant = 'bar', ...props }) {
  let content;
  if (variant === 'bar') content = <Bar {...props} />;
  else if (variant === 'circle') content = <Circle {...props} />;
  else if (variant === 'card') content = <CardSkeleton {...props} />;
  else if (variant === 'list') content = <ListSkeleton {...props} />;
  else content = <Bar {...props} />;

  return (
    <>
      {content}
      {KEYFRAMES}
    </>
  );
}

// Named exports so callers can also import individual variants directly.
Skeleton.Bar = Bar;
Skeleton.Circle = Circle;
Skeleton.Card = CardSkeleton;
Skeleton.List = ListSkeleton;
