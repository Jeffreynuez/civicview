'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useRef } from 'react';
import { useHScroll } from '../lib/useHScroll';

/**
 * EdgeArrow — the standard green, thick scroll-affordance chevron shown
 * at the left/right edge of any horizontally-scrollable row when content
 * is clipped in that direction. Fades out (and leaves the tab order)
 * once that end is reached. Exported so TabStrip and any bespoke scroller
 * can render the exact same affordance.
 */
export function EdgeArrow({ side, show, onClick, label }) {
  const isLeft = side === 'left';
  return (
    <button
      type="button"
      aria-label={label || (isLeft ? 'Scroll left' : 'Scroll right')}
      tabIndex={show ? 0 : -1}
      onClick={onClick}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [isLeft ? 'left' : 'right']: 0,
        width: 38,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isLeft ? 'flex-start' : 'flex-end',
        padding: isLeft ? '0 0 0 2px' : '0 2px 0 0',
        border: 'none',
        cursor: 'pointer',
        background: isLeft
          ? 'linear-gradient(to right, var(--cl-card, #fff) 42%, rgba(255,255,255,0))'
          : 'linear-gradient(to left, var(--cl-card, #fff) 42%, rgba(255,255,255,0))',
        color: 'var(--cl-accent)',
        opacity: show ? 1 : 0,
        pointerEvents: show ? 'auto' : 'none',
        transition: 'opacity 0.18s ease',
        zIndex: 3,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 12 12" aria-hidden="true">
        <path
          d={isLeft ? 'M8 1.5L3 6l5 4.5' : 'M4 1.5L9 6l-5 4.5'}
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </button>
  );
}

/**
 * HScroll — drop-in wrapper that makes its children a horizontally
 * scrollable row with the mandatory edge-arrow affordance + desktop
 * click-drag (mobile keeps native touch scroll). Use this for any chip
 * row / card tray / pill row that can overflow horizontally.
 *
 * Props:
 *   children          — the row content (rendered inside the scroller)
 *   style             — style for the outer (positioned) wrapper, e.g. { maxWidth: 520 }
 *   scrollerStyle     — extra style for the inner scroller, e.g. { gap: '6px' }
 *   className          — class for the outer wrapper
 *   scrollerClassName — class for the inner scroller
 *   ariaLabel         — accessible label for the scroller
 *   step              — px per arrow click (default 160)
 *   itemCount         — pass the number of items so overflow re-checks when it changes
 */
export default function HScroll({
  children,
  style,
  scrollerStyle,
  className,
  scrollerClassName = '',
  ariaLabel,
  step = 160,
  itemCount,
}) {
  const ref = useRef(null);
  const { overflow, scrollByDir, dragHandlers } = useHScroll(ref, {
    step,
    deps: [itemCount],
  });

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <div
        ref={ref}
        className={`cl-no-scrollbar ${scrollerClassName}`.trim()}
        aria-label={ariaLabel}
        style={{
          display: 'flex',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          cursor: 'grab',
          ...scrollerStyle,
        }}
        {...dragHandlers}
      >
        {children}
      </div>
      <EdgeArrow side="left" show={overflow.left} onClick={() => scrollByDir(-1)} />
      <EdgeArrow side="right" show={overflow.right} onClick={() => scrollByDir(1)} />
    </div>
  );
}
