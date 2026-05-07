'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef, useState } from 'react';

/**
 * PanelResizer — draggable divider between the map and the side-panel.
 *
 * Two orientations, one component:
 *
 *   - vertical (desktop / tablet): a 6-px-wide bar between the map (left)
 *     and the side panel (right). Drag left/right to widen/narrow the
 *     panel. `onResize` receives the new panel width in pixels, clamped
 *     to [minWidth, maxFraction × window.innerWidth].
 *
 *   - horizontal (mobile): a 14-px-tall bar between the map (top) and
 *     the side panel (bottom). Drag up/down to shrink/grow the map.
 *     `onResize` receives the new map height in pixels, clamped to
 *     [0, maxHeight].
 *
 * Both modes wear a centered "Map" label pill so the user knows what
 * the handle is for. Per spec: drag toward the navbar collapses the
 * map; the bar can't be dragged below its starting position on mobile.
 *
 * Both mouse and touch events are wired so the handle works on phones
 * as well as desktops.
 */
export default function PanelResizer({
  // Common
  orientation = 'vertical',
  onResize,
  label = 'Map',
  // True on touch devices regardless of orientation. Drives the chunky
  // navy chrome — wider/taller bar, primary fill, white indicator
  // lines/label — so the handle is easy to grab with a thumb. False
  // gives the desktop-pointer chrome (thin neutral 6px bar with a tiny
  // rotated label).
  isMobile = false,
  // Vertical-only (desktop panel-width resizing)
  minWidth = 380,
  maxFraction = 0.5,
  // Horizontal-only (mobile map-height resizing)
  maxHeight = 0,        // px — caller passes the starting (max) map height
  minHeight = 0,        // px — usually 0 so the user can fully collapse
  topOffset = 0,        // px — distance from viewport top to where the map
                        // starts (navbar height). Subtracted from clientY
                        // so the height we report = current touch Y minus
                        // wherever the map area begins.
}) {
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);

  const isVertical = orientation === 'vertical';

  // Single drag handler used by both mouse and touch — extracts a clientX
  // / clientY from either MouseEvent or TouchEvent and dispatches.
  const beginDrag = (clientX, clientY, fromTouch) => {
    setDragging(true);

    const prevBodyUserSelect = document.body.style.userSelect;
    const prevBodyCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = isVertical ? 'ew-resize' : 'ns-resize';

    const handleMove = (moveX, moveY) => {
      if (isVertical) {
        const maxW = Math.max(minWidth, window.innerWidth * maxFraction);
        const raw = window.innerWidth - moveX;
        const clamped = Math.min(maxW, Math.max(minWidth, raw));
        onResizeRef.current?.(clamped);
      } else {
        // Horizontal: new map height = touch Y minus the offset to
        // the top of the map area (typically the navbar height). That
        // way dragging the handle to clientY=300 with topOffset=56
        // yields a map height of 244 — the bar visually follows the
        // finger.
        const raw = moveY - topOffset;
        const clamped = Math.min(maxHeight, Math.max(minHeight, raw));
        onResizeRef.current?.(clamped);
      }
    };

    const onMouseMove = (e) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (t) handleMove(t.clientX, t.clientY);
      // Prevent the page from also scrolling while dragging the handle.
      if (e.cancelable) e.preventDefault();
    };

    const cleanup = () => {
      setDragging(false);
      document.body.style.userSelect = prevBodyUserSelect;
      document.body.style.cursor = prevBodyCursor;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', cleanup);
      window.removeEventListener('touchcancel', cleanup);
    };

    if (fromTouch) {
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', cleanup);
      window.addEventListener('touchcancel', cleanup);
    } else {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', cleanup);
    }
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    beginDrag(e.clientX, e.clientY, false);
  };

  const handleTouchStart = (e) => {
    const t = e.touches[0];
    if (!t) return;
    beginDrag(t.clientX, t.clientY, true);
  };

  const active = hovering || dragging;

  // Three chrome variants — picked by orientation × isMobile:
  //
  //   1. vertical   + !isMobile  → "thin desktop bar" (6px neutral)
  //   2. vertical   + isMobile   → "chunky navy column" (28px navy)
  //   3. horizontal              → "chunky navy row" (28px tall navy)
  //
  // The chunky variants share the same fill / indicator / label
  // treatment. They just differ in axis (column vs row) and orientation
  // of the handle dashes + label.
  const useChunkyChrome = isMobile || !isVertical;

  let containerStyle;
  if (isVertical && !isMobile) {
    // Variant 1 — thin desktop bar.
    containerStyle = {
      width: 6,
      flexShrink: 0,
      cursor: 'ew-resize',
      position: 'relative',
      zIndex: 5,
      background: active ? 'var(--primary, #457b9d)' : 'transparent',
      opacity: active ? 0.6 : 1,
      borderLeft: active ? 'none' : '1px solid var(--cl-border)',
      transition: 'background 0.15s ease, opacity 0.15s ease',
      // On vertical we want the label pill to overflow the 6px-wide
      // strip horizontally so it's actually readable.
      overflow: 'visible',
    };
  } else if (isVertical && isMobile) {
    // Variant 2 — chunky navy column for mobile-landscape side-by-side
    // mode. 28px wide so a thumb can land on it, navy fill, white
    // indicator dashes and label so it reads as a distinct affordance
    // instead of blending into the map or the panel.
    containerStyle = {
      width: 28,
      flexShrink: 0,
      cursor: 'ew-resize',
      position: 'relative',
      zIndex: 5,
      background: active ? 'var(--cl-primary-light, #415a77)' : 'var(--cl-primary, #1b263b)',
      borderLeft: '1px solid var(--cl-primary, #1b263b)',
      borderRight: '1px solid var(--cl-primary, #1b263b)',
      transition: 'background 0.15s ease',
      touchAction: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
  } else {
    // Variant 3 — chunky navy row for mobile-portrait stacked mode.
    containerStyle = {
      height: 28,
      flexShrink: 0,
      cursor: 'ns-resize',
      position: 'relative',
      zIndex: 5,
      background: active ? 'var(--cl-primary-light, #415a77)' : 'var(--cl-primary, #1b263b)',
      borderTop: '1px solid var(--cl-primary, #1b263b)',
      borderBottom: '1px solid var(--cl-primary, #1b263b)',
      transition: 'background 0.15s ease',
      touchAction: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
  }

  // Indicator + label sub-elements for the chunky variants. Layout
  // direction flips by orientation so the same building blocks read
  // correctly as a vertical column or a horizontal row.
  const renderChunkyContent = () => (
    <div
      aria-hidden="true"
      style={{
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        alignItems: 'center',
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: isVertical ? 3 : 32,
          height: isVertical ? 32 : 3,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.85)',
          opacity: active ? 1 : 0.7,
          transition: 'opacity 0.15s ease',
        }}
      />
      {label && (
        <span
          style={{
            fontSize: 'var(--cl-text-xs)',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.92)',
            // For vertical: rotate the label so it reads bottom-to-top
            // alongside the column. Horizontal: leave upright.
            writingMode: isVertical ? 'vertical-rl' : undefined,
            transform: isVertical ? 'rotate(180deg)' : undefined,
          }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          width: isVertical ? 3 : 32,
          height: isVertical ? 32 : 3,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.85)',
          opacity: active ? 1 : 0.7,
          transition: 'opacity 0.15s ease',
        }}
      />
    </div>
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onTouchStart={handleTouchStart}
      style={containerStyle}
      aria-label={isVertical ? 'Resize panel' : 'Resize map'}
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
    >
      {useChunkyChrome ? (
        renderChunkyContent()
      ) : (
        <>
          {/* Variant 1 — thin neutral bar. A 2px line + a label pill
              that pokes out to the left, where it sits over the map
              area without crowding the panel. */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 2,
              height: 28,
              borderRadius: 2,
              background: active ? 'white' : 'var(--text-light, #888)',
              opacity: active ? 0.9 : 0.35,
              pointerEvents: 'none',
              transition: 'background 0.15s ease, opacity 0.15s ease',
            }}
          />
          {label && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '50%',
                right: 'calc(100% + 6px)',
                transform: 'translateY(-50%) rotate(-90deg)',
                transformOrigin: 'right center',
                fontSize: 'var(--cl-text-2xs)',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--cl-text-light)',
                background: 'var(--cl-card)',
                border: '1px solid var(--cl-border)',
                padding: '2px 8px',
                borderRadius: 'var(--cl-radius-pill)',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </div>
          )}
        </>
      )}
    </div>
  );
}
