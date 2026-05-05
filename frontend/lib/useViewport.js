'use client';

import { useEffect, useState } from 'react';

/**
 * Viewport breakpoints — single source of truth for "is this a mobile /
 * tablet / desktop user". Drives layout pivots throughout the app:
 *   - mobile  (≤768px)  : map stacks above panel, panel goes full-width
 *   - tablet  (769–1024): desktop layout but tighter (panel min-width relaxed)
 *   - desktop (≥1025px) : default map + side-panel layout
 *
 * The widths are inclusive on the lower bound and exclusive on the upper:
 *   mobile if w ≤ 768, tablet if 768 < w ≤ 1024, else desktop.
 *
 * SSR safety: the hook returns 'desktop' on the first render (server +
 * client hydration) and updates on mount, so the server-rendered HTML
 * always reflects the desktop layout. This avoids hydration mismatches —
 * the client briefly shows desktop and then re-renders to mobile if the
 * window is small. The flicker is one frame at most.
 */
export const BREAKPOINTS = {
  mobile: 768,
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
