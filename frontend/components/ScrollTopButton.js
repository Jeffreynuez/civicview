'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useRef, useState } from 'react';

/**
 * Global "Back to top" floating button. Mounted ONCE (in the root
 * layout). Fades IN while the user is actively scrolling (once past
 * `threshold`) and fades OUT after `idleMs` of stillness — so it only
 * nudges while you're moving and gets out of the way when you stop.
 *
 * Scroll detection uses a capture-phase listener on `document`: scroll
 * events don't bubble, but capture propagates window -> document ->
 * target, so this catches scrolling from ANY container — the window OR
 * an inner overflow:auto panel (e.g. the home SidePanel, the /polls
 * feed) — without each page wiring a ref. Horizontal-only scrollers
 * (chip rows, the compare carousel) are ignored.
 */
export default function ScrollTopButton({ threshold = 600, idleMs = 1500 }) {
  const [visible, setVisible] = useState(false);
  const idleTimer = useRef(null);
  const lastEl = useRef(null);

  useEffect(() => {
    const rootEl = () => document.scrollingElement || document.documentElement;
    const resolve = (t) => {
      if (!t || t === document || t === window || t === document.documentElement || t === document.body) {
        return rootEl();
      }
      return t;
    };
    const hide = () => setVisible(false);
    const onScroll = (e) => {
      const el = resolve(e.target);
      if (!el || typeof el.scrollTop !== 'number') return;
      // Ignore horizontal-only scrollers so swiping a carousel doesn't
      // toggle the button.
      if (el !== rootEl() && el.scrollHeight - el.clientHeight < 4) return;
      lastEl.current = el;
      if ((el.scrollTop || 0) > threshold) {
        setVisible(true);
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(hide, idleMs);
      } else {
        setVisible(false);
        if (idleTimer.current) clearTimeout(idleTimer.current);
      }
    };
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [threshold, idleMs]);

  const onClick = () => {
    const el = lastEl.current || document.scrollingElement || window;
    el.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to top"
      title="Back to top"
      tabIndex={visible ? 0 : -1}
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: 'var(--cl-primary, #1b263b)',
        color: 'white',
        border: 'none',
        boxShadow: '0 6px 18px rgba(0,0,0,0.28)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        zIndex: 90,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
