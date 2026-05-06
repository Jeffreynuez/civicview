'use client';

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

  // Layout / chrome differs by orientation. Vertical = thin column with
  // a vertical accent line; horizontal = short row with a horizontal
  // accent pill.
  const containerStyle = isVertical
    ? {
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
      }
    : {
        height: 18,
        flexShrink: 0,
        cursor: 'ns-resize',
        position: 'relative',
        zIndex: 5,
        background: active ? 'var(--cl-bg)' : 'var(--cl-bg-soft, #f1f3f5)',
        borderTop: '1px solid var(--cl-border)',
        borderBottom: '1px solid var(--cl-border)',
        transition: 'background 0.15s ease',
        // Touch-action: none so the OS doesn't interpret the swipe as
        // a page-scroll while the user is actively resizing.
        touchAction: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      };

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
      {isVertical ? (
        <>
          {/* Vertical: a 2px line + a label pill that pokes out to the
              left, where it sits over the map area without crowding
              the panel. */}
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
      ) : (
        <>
          {/* Horizontal: a small grab-handle indicator + the same Map
              label pill, both centered. */}
          <div
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                width: 28,
                height: 3,
                borderRadius: 2,
                background: 'var(--cl-text-muted, #adb5bd)',
                opacity: active ? 0.9 : 0.55,
                transition: 'opacity 0.15s ease',
              }}
            />
            {label && (
              <span
                style={{
                  fontSize: 'var(--cl-text-2xs)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--cl-text-light)',
                }}
              >
                {label}
              </span>
            )}
            <div
              style={{
                width: 28,
                height: 3,
                borderRadius: 2,
                background: 'var(--cl-text-muted, #adb5bd)',
                opacity: active ? 0.9 : 0.55,
                transition: 'opacity 0.15s ease',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
