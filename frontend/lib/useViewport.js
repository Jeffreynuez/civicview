'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';

/**
 * Viewport breakpoints — single source of truth for "is this a mobile /
 * tablet / desktop user". Drives layout pivots throughout the app:
 *   - mobile  (≤900px)  : map stacks above panel, panel goes full-width
 *   - tablet  (901–1024): desktop layout but tighter (panel min-width relaxed)
 *   - desktop (≥1025px) : default map + side-panel layout
 *
 * The widths are inclusive on the lower bound and exclusive on the upper:
 *   mobile if w ≤ 900, tablet if 900 < w ≤ 1024, else desktop.
 *
 * Why 900px and not the Tailwind-default 768px:
 *   - Samsung Galaxy phones with wider DPI report ~785px CSS width in
 *     portrait (confirmed in real-device testing). At 768 they fell
 *     into "tablet" and the entire mobile layout stayed inert.
 *   - iPad Mini in portrait is 744px — already in mobile.
 *   - iPad / iPad Air / iPad Pro 11" in portrait sit between 810–834px.
 *     With a 900px cutoff they get the mobile layout too, which is the
 *     right default for portrait tablets (single-column, touch-friendly).
 *   - Their landscape orientations (1080-1366px) cleanly bump into
 *     desktop.
 *
 * SSR safety: the hook returns 'desktop' on the first render (server +
 * client hydration) and updates on mount, so the server-rendered HTML
 * always reflects the desktop layout. This avoids hydration mismatches —
 * the client briefly shows desktop and then re-renders to mobile if the
 * window is small. The flicker is one frame at most.
 */
export const BREAKPOINTS = {
  mobile: 900,
  tablet: 1024,
};

function classify(width) {
  if (width <= BREAKPOINTS.mobile) return 'mobile';
  if (width <= BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

/**
 * Returns one of 'mobile' | 'tablet' | 'desktop' based on the current
 * window width. Updates on resize.
 */
export function useViewport() {
  const [viewport, setViewport] = useState('desktop');

  useEffect(() => {
    const apply = () => setViewport(classify(window.innerWidth));
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  return viewport;
}

/** Convenience — true on mobile only. */
export function useIsMobile() {
  return useViewport() === 'mobile';
}

/** Convenience — true on mobile or tablet. */
export function useIsCompact() {
  const v = useViewport();
  return v === 'mobile' || v === 'tablet';
}

/**
 * Reports whether the viewport is wider than it is tall — i.e. the user is
 * holding a phone sideways (or has a short-and-wide window on desktop).
 * Used to pivot the mobile layout: portrait stacks (map on top, panel
 * below); landscape goes side-by-side like desktop because vertical real
 * estate is too cramped for stacking on a 360–500px-tall viewport.
 *
 * SSR-safe: defaults to false on the first render, then updates on mount
 * + on resize / orientationchange.
 */
export function useIsLandscape() {
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    const apply = () => {
      // visualViewport is the most accurate signal on mobile (it excludes
      // the URL bar overlay). Fall back to innerWidth/Height.
      const vv = window.visualViewport;
      const w = vv ? vv.width : window.innerWidth;
      const h = vv ? vv.height : window.innerHeight;
      setLandscape(w > h);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', apply);
    }
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', apply);
      }
    };
  }, []);

  return landscape;
}
