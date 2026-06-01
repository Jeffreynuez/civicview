'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useRef } from 'react';
import { useHScroll } from '../lib/useHScroll';
import { EdgeArrow } from './HScroll';

/**
 * TabStrip — horizontally-scrollable row of tab buttons with the
 * standard green edge arrows when content is clipped left/right. Built
 * on the shared useHScroll hook + EdgeArrow so its overflow detection,
 * arrow affordance, and desktop click-drag match every other scrollable
 * row in the app (see lib/useHScroll.js + components/HScroll.js).
 *
 * Props:
 *   tabs       — [{ id, label }, ...]   — id used as key + onSelect arg
 *   activeId   — currently-active tab id
 *   onSelect   — (id) => void
 *   isMobile   — boolean. Drives padding / minHeight / minWidth so tap
 *                targets clear the 44px minimum on touch.
 *   useFlexFill — when true (default), desktop tabs share the row equally
 *                via flex:1. When false, tabs are auto-width on every
 *                viewport.
 *
 * Behavior:
 *   - Always allows horizontal scroll on the strip itself; native scrollbar
 *     hidden via cl-no-scrollbar so the green arrows are the only cue.
 *   - Arrows fade in only when real overflow exists on that side and are
 *     clickable to advance ~one tab; arrow tab-order is dropped at the end.
 *   - Desktop click-hold-drag scrolls the strip (mouse only); mobile keeps
 *     native touch scroll. A drag never fires a tab selection.
 *   - Roving tabindex + ←/→/Home/End keyboard nav per WAI-ARIA tablist.
 */
export default function TabStrip({
  tabs,
  activeId,
  onSelect,
  isMobile = false,
  useFlexFill = true,
}) {
  const scrollerRef = useRef(null);
  const { overflow, scrollByDir, dragHandlers } = useHScroll(scrollerRef, {
    step: 120,
    deps: [tabs.length],
  });

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
          cursor: 'grab',
        }}
        {...dragHandlers}
      >
        {tabs.map((tab) => {
          const isActive = activeId === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
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

      <EdgeArrow side="left" show={overflow.left} onClick={() => scrollByDir(-1)} label="Scroll tabs left" />
      <EdgeArrow side="right" show={overflow.right} onClick={() => scrollByDir(1)} label="Scroll tabs right" />
    </div>
  );
}
