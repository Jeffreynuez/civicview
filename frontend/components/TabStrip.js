'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef, useState } from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';
/**
 * TabStrip — horizontally-scrollable row of tab buttons with fade
 * indicators on the left/right edges when more content is hidden in
 * that direction. Universal across viewports: fades only render when
 * actual overflow exists, so on a wide desktop where every tab fits
 * they're invisible.
 *
 * Props:
 *   tabs       — [{ id, label }, ...]   — id used as key + onSelect arg
 *   activeId   — currently-active tab id
 *   onSelect   — (id) => void
 *   isMobile   — boolean. Drives padding / minHeight / minWidth so tap
 *                targets clear the 44px minimum on touch.
 *   useFlexFill — when true (default), desktop tabs share the row equally
 *                via flex:1. When false, tabs are auto-width on every
 *                viewport (rarely needed; the default works for both
 *                short and long tab labels).
 *
 * Behavior:
 *   - Always allows horizontalscroll on the strip itself.
 *   - Hides the native scrollbar via the cl-no-scrollbar utility (defined
 *     in globals.css) so the fades are the only visual cue.
 *   - Listens to scroll + ResizeObserver to keep overflow flags fresh.
 *   - Each fade is a clickable button that scroll-snaps the strip 120px
 *     in that direction so the user can advance one tab at a time
 *     without dragging.
 *   - tabIndex on the fade buttons toggles to -1 when overflow doesn't
 *     exist on that side, keeping keyboard tab-order clean.
 */
export default function TabStrip({
  tabs,
  activeId,
  onSelect,
  isMobile = false,
  useFlexFill = true,
}) {
  const scrollerRef = useRef(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      // 4px slack to avoid flicker at the exact boundary (subpixel
      // rounding can leave 0.5–2px of residue otherwise).
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
  }, [tabs.length]);

  const scrollByOne = (dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 120, behavior: 'smooth' });
  };

  // Keyboard navigation per the ARIA tablist authoring practices:
  //   ←/→     move focus to prev/next tab
  //   Home    jump to first tab
  //   End     jump to last tab
  // We also activate-on-arrow (call onSelect immediately) which is the
  // automatic-activation pattern; works well for our shallow tab
  // panels that don't trigger heavy network work on selection.
  const handleKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.id === activeId);
    if (i < 0) return;
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    onSelect(tabs[next].id);
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div
        ref={scrollerRef}
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className="cl-no-scrollbar"
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--cl-border)',
          background: 'white',
          overflowX: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeId === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              // tabIndex per the WAI-ARIA "roving tabindex" pattern:
              // only the active tab is in the keyboard tab order; the
              // others are reachable via arrow keys (handled above).
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              style={{
                flex: useFlexFill && !isMobile ? 1 : '0 0 auto',
                minWidth: isMobile ? 92 : undefined,
                padding: isMobile ? '14px 16px' : '10px 14px',
                fontSize: isMobile ? '0.88rem' : '0.8rem',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: isActive ? 'var(--cl-accent)' : 'var(--cl-text-light)',
                borderBottom: isActive ? '2px solid var(--cl-accent)' : '2px solid transparent',
                marginBottom: '-1px',
                transition: 'color 0.15s',
                whiteSpace: 'nowrap',
                minHeight: isMobile ? 44 : undefined,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Left-edge fade — visible when scrollLeft > 4. */}
      <button
        type="button"
        aria-label="Scroll tabs left"
        tabIndex={overflow.left ? 0 : -1}
        onClick={() => scrollByOne(-1)}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 1,
          left: 0,
          width: 32,
          background: 'linear-gradient(to right, white 30%, rgba(255,255,255,0))',
          border: 'none',
          padding: '0 0 0 4px',
          cursor: 'pointer',
          opacity: overflow.left ? 1 : 0,
          pointerEvents: overflow.left ? 'auto' : 'none',
          transition: 'opacity 0.18s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          color: 'var(--cl-text-light)',
        }}
      >
        <ChevronLeft size={12} strokeWidth={1.6} />
      </button>

      {/* Right-edge fade. */}
      <button
        type="button"
        aria-label="Scroll tabs right"
        tabIndex={overflow.right ? 0 : -1}
        onClick={() => scrollByOne(1)}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 1,
          right: 0,
          width: 32,
          background: 'linear-gradient(to left, white 30%, rgba(255,255,255,0))',
          border: 'none',
          padding: '0 4px 0 0',
          cursor: 'pointer',
          opacity: overflow.right ? 1 : 0,
          pointerEvents: overflow.right ? 'auto' : 'none',
          transition: 'opacity 0.18s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          color: 'var(--cl-text-light)',
        }}
      >
        <ChevronRight size={12} strokeWidth={1.6} />
      </button>
    </div>
  );
}
