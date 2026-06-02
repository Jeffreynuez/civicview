'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useHScroll — the shared behavior behind every horizontally-scrollable
 * row in the app (MANDATORY for any list that can clip at the left/right
 * edge: tab strips, chip rows, card trays, etc.). Pair it with the
 * <HScroll> wrapper (or the exported <EdgeArrow>) so the affordance and
 * the drag behavior stay identical everywhere.
 *
 * What it provides for a scroller element (via `ref`):
 *   - overflow {left,right}: whether content is clipped on each side, so
 *     the caller can show/hide the edge arrows. Kept fresh on scroll +
 *     ResizeObserver + whenever `deps` change (pass the item count).
 *   - scrollByDir(dir): smooth-scroll one step (arrow-click handler).
 *   - dragHandlers: spread onto the scroller to enable DESKTOP
 *     click-hold-drag (mouse only — touch keeps native momentum scroll).
 *     A drag past a small threshold suppresses the trailing click so a
 *     drag never also selects a tab / opens a card.
 *
 * @param {React.RefObject} scrollerRef  the overflow-x:auto element
 * @param {{ step?: number, deps?: any[] }} opts
 */
export function useHScroll(scrollerRef, { step = 160, deps = [] } = {}) {
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const drag = useRef({ pending: false, active: false, startX: 0, startLeft: 0, moved: false, pointerId: null });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      // 4px slack avoids flicker at the exact boundary (subpixel rounding).
      setOverflow({
        left: scrollLeft > 4,
        right: scrollLeft + clientWidth < scrollWidth - 4,
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(update) : null;
    if (ro) ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      if (ro) ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollByDir = useCallback((dir) => {
    scrollerRef.current?.scrollBy({ left: dir * step, behavior: 'smooth' });
  }, [scrollerRef, step]);

  // Desktop click-drag. Mouse only: on touch/pen we leave the browser's
  // native horizontal scroll alone so momentum + overscroll feel right.
  const onPointerDown = useCallback((e) => {
    // Mouse only — touch/pen keep native scroll. Critically we do NOT
    // capture the pointer or mark a drag here: a plain click must reach
    // the tab/card underneath. Capturing on pointerdown swallowed the
    // click on desktop (tabs couldn't be selected). Dragging only begins
    // once the pointer moves past a small threshold (see onPointerMove).
    if (e.pointerType !== 'mouse') return;
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = {
      pending: true, active: false, moved: false,
      startX: e.clientX, startLeft: el.scrollLeft, pointerId: e.pointerId,
    };
  }, [scrollerRef]);

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d.pending && !d.active) return;
    const el = scrollerRef.current;
    if (!el) return;
    const dx = e.clientX - d.startX;
    if (!d.active) {
      // Below the threshold this is still a potential click — don't
      // hijack it or capture the pointer.
      if (Math.abs(dx) < 5) return;
      d.active = true;
      d.moved = true;
      try { el.setPointerCapture(d.pointerId); } catch (_) { /* noop */ }
    }
    el.scrollLeft = d.startLeft - dx;
  }, [scrollerRef]);

  const endDrag = useCallback((e) => {
    const d = drag.current;
    const el = scrollerRef.current;
    if (d.active && el && e.pointerId != null) {
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    }
    d.pending = false;
    d.active = false;
    // d.moved is left as-is so the click immediately following a real
    // drag is suppressed by onClickCapture (which resets it).
  }, [scrollerRef]);

  // Swallow the click that fires at the end of a drag (capture phase, so
  // it stops before reaching the tab/card the pointer landed on).
  const onClickCapture = useCallback((e) => {
    if (drag.current.moved) {
      e.stopPropagation();
      e.preventDefault();
      drag.current.moved = false;
    }
  }, []);

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerLeave: endDrag,
    onClickCapture,
  };

  return { overflow, scrollByDir, dragHandlers };
}
