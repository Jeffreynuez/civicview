'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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
  // When true, the resizer behaves as a binary open/close toggle
  // instead of a continuous slider. Drag with resistance until the
  // gesture passes a threshold, then snap to either the open or
  // closed target. A double-tap also toggles instantly. Works for
  // BOTH orientations:
  //   horizontal (portrait stacked) — snaps between 0 and maxHeight
  //   vertical   (landscape side-by-side) — snaps between openWidth
  //              and closedWidth (caller passes these)
  // The continuous (analog) behavior stays on desktop because
  // precision dragging works better with a mouse.
  binaryMode = false,
  // Required for binary mode — the current "is the map open?" boolean.
  // Drives the snap-back target when the drag doesn't exceed threshold,
  // and the double-tap action.
  isOpen = true,
  // Vertical-binary-only: target widths the panel snaps to on release.
  // openWidth   — the "map visible" width (smaller panel; map gets
  //               the remaining horizontal space).
  // closedWidth — the "map hidden" width (larger panel; covers the
  //               map area). Caller should leave at least the
  //               resizer's own width worth of room — typically
  //               windowWidth - 28 — so the resizer + panel together
  //               don't overflow the viewport.
  openWidth = 0,
  closedWidth = 0,
}) {
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);

  const isVertical = orientation === 'vertical';

  // Track the last tap time for double-tap detection (binary mode only).
  // A double-tap toggles the open/closed state instantly without the
  // user having to drag past the threshold. Stored in a ref so it
  // survives renders without triggering them.
  const lastTapTimeRef = useRef(0);

  // Tuning constants for binary mode.
  //   DRAG_RESISTANCE — how much the visible handle moves per pixel of
  //     finger travel. 2.5 means a 100px finger drag yields a 40px
  //     visual movement, giving the "tug" feel the user requested.
  //   SNAP_THRESHOLD_FRAC — fraction of maxHeight the gesture must
  //     accumulate (after resistance) before we commit the toggle on
  //     release. 0.20 = ~20% of map height.
  //   DOUBLE_TAP_MS — max gap between two taps that counts as a
  //     double-tap. 350ms is roomy enough that a deliberate
  //     double-tap registers without conflicting with a slow
  //     press-and-release.
  //   TAP_DRAG_THRESHOLD_PX — if the finger moves more than this
  //     between touchstart and touchend, treat as a drag, not a tap.
  const DRAG_RESISTANCE = 2.5;
  const SNAP_THRESHOLD_FRAC = 0.20;
  const DOUBLE_TAP_MS = 350;
  const TAP_DRAG_THRESHOLD_PX = 6;

  // Single drag handler used by both mouse and touch — extracts a clientX
  // / clientY from either MouseEvent or TouchEvent and dispatches.
  // In binary mode (horizontal-only), we apply resistance during the
  // drag so the handle visually lags the finger, then snap to fully
  // open / closed on release based on direction + threshold.
  const beginDrag = (clientX, clientY, fromTouch) => {
    setDragging(true);

    const prevBodyUserSelect = document.body.style.userSelect;
    const prevBodyCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = isVertical ? 'ew-resize' : 'ns-resize';

    // For binary mode we accumulate the drag distance from start so
    // the snap-on-release decision has a clean signed delta to read.
    const startX = clientX;
    const startY = clientY;
    const startHeight = isOpen ? maxHeight : 0;
    // Vertical-binary: drag-LEFT (negative deltaX) grows the panel
    // (i.e. closes the map). startWidth is whichever target the panel
    // currently sits at.
    const startWidth = isOpen ? openWidth : closedWidth;
    let lastDelta = 0; // axis-appropriate signed delta from start
    let dragExceededTapThreshold = false;

    const handleMove = (moveX, moveY) => {
      if (isVertical) {
        // ── Vertical-binary mode ────────────────────────────────
        // fingerDelta in X: positive = right (shrink panel = open
        // map), negative = left (grow panel = close map). Apply
        // resistance + clamp to [openWidth, closedWidth] so the
        // visible panel can't leak past either snap target during
        // the gesture.
        if (binaryMode) {
          const fingerDelta = moveX - startX;
          lastDelta = fingerDelta;
          if (Math.abs(fingerDelta) > TAP_DRAG_THRESHOLD_PX) {
            dragExceededTapThreshold = true;
          }
          const visualDelta = -fingerDelta / DRAG_RESISTANCE;
          const newWidth = Math.max(
            openWidth,
            Math.min(closedWidth, startWidth + visualDelta),
          );
          onResizeRef.current?.(newWidth);
          return;
        }
        // Legacy continuous vertical mode (desktop pointer).
        const maxW = Math.max(minWidth, window.innerWidth * maxFraction);
        const raw = window.innerWidth - moveX;
        const clamped = Math.min(maxW, Math.max(minWidth, raw));
        onResizeRef.current?.(clamped);
        return;
      }

      // Horizontal axis. If binary mode is on, apply resistance.
      // Visible height = startHeight + (fingerDelta / resistance),
      // clamped to [0, maxHeight] so it can't visually leak past the
      // ends. The actual commit to open / closed happens on release.
      const fingerDelta = moveY - startY;
      lastDelta = fingerDelta;
      if (Math.abs(fingerDelta) > TAP_DRAG_THRESHOLD_PX) {
        dragExceededTapThreshold = true;
      }

      if (binaryMode) {
        const visualDelta = fingerDelta / DRAG_RESISTANCE;
        const newHeight = Math.max(
          minHeight,
          Math.min(maxHeight, startHeight + visualDelta),
        );
        onResizeRef.current?.(newHeight);
      } else {
        // Legacy continuous mode — finger position maps 1:1 to height.
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

    const cleanup = (releasedNormally = true) => {
      setDragging(false);
      document.body.style.userSelect = prevBodyUserSelect;
      document.body.style.cursor = prevBodyCursor;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);

      // Snap-on-release for binary mode (both axes).
      // The drag direction has to match a sensible toggle:
      //   horizontal: open → drag UP (negative delta) → close
      //               closed → drag DOWN (positive delta) → open
      //   vertical:   open → drag LEFT (negative delta) → close
      //               closed → drag RIGHT (positive delta) → open
      // Threshold is a fraction of the open↔closed travel distance;
      // partial gestures snap back to where they started.
      if (binaryMode) {
        if (isVertical) {
          // openWidth < closedWidth (panel widens as map closes), so
          // the travel distance is (closedWidth - openWidth). Scale
          // the threshold to the same fraction the horizontal axis
          // uses.
          const threshold = Math.max(
            (closedWidth - openWidth) * SNAP_THRESHOLD_FRAC,
            20, // floor so very small travel distances still need a deliberate gesture
          );
          let target;
          if (isOpen && lastDelta < -threshold) {
            target = closedWidth; // close map
          } else if (!isOpen && lastDelta > threshold) {
            target = openWidth;   // open map
          } else {
            target = isOpen ? openWidth : closedWidth; // snap back
          }
          onResizeRef.current?.(target);
        } else {
          const threshold = maxHeight * SNAP_THRESHOLD_FRAC;
          let target;
          if (isOpen && lastDelta < -threshold) {
            target = 0;       // close
          } else if (!isOpen && lastDelta > threshold) {
            target = maxHeight; // open
          } else {
            target = isOpen ? maxHeight : 0; // snap back
          }
          onResizeRef.current?.(target);
        }

        // Touchend without crossing the drag threshold = tap. We
        // treat it as a double-tap candidate. Don't apply double-tap
        // detection on mouse releases (desktop won't be in binary
        // mode anyway, but be defensive) or on touchcancel (the
        // system stole the gesture; that's not a user-intended tap).
        if (releasedNormally && fromTouch && !dragExceededTapThreshold) {
          const now = Date.now();
          if (now - lastTapTimeRef.current < DOUBLE_TAP_MS) {
            // Second tap landed inside the window — fire the toggle.
            if (isVertical) {
              onResizeRef.current?.(isOpen ? closedWidth : openWidth);
            } else {
              onResizeRef.current?.(isOpen ? 0 : maxHeight);
            }
            lastTapTimeRef.current = 0; // reset so a third tap doesn't toggle
          } else {
            lastTapTimeRef.current = now;
          }
        }
      }
    };

    // Wrap cleanup so the released-normally flag is set correctly per
    // event source.
    const onMouseUp = () => cleanup(true);
    const onTouchEnd = () => cleanup(true);
    const onTouchCancel = () => cleanup(false);

    if (fromTouch) {
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
      window.addEventListener('touchcancel', onTouchCancel);
    } else {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
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
  // Chunky navy chrome on ALL variants now — desktop's vertical divider
  // adopts the mobile look (label inside the bar) instead of the old thin
  // 6px bar with a 'MAP' pill poking out. Drag behavior is unchanged
  // (continuous on desktop, binary on touch); only the chrome is shared.
  const useChunkyChrome = true;

  let containerStyle;
  if (isVertical) {
    // Chunky navy column for the vertical divider — used on BOTH desktop
    // (continuous drag) and mobile-landscape (binary). 28px wide so it's
    // an easy target and a distinct affordance; the label sits INSIDE the
    // bar (no more poking-out pill on desktop). Drag behavior is decided
    // separately by binaryMode/isMobile, not by this chrome.
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
