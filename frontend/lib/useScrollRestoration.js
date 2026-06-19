'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Per-surface scroll-position restoration for the native Android WebView.
 *
 * Why this exists: Desktop/mobile Chrome restores scroll position on history
 * Back via its back-forward cache (bfcache) — including positions inside
 * inner scroll containers. Android's WebView has NO bfcache, so Back
 * re-renders the previous view at the top ("reloads and jumps to the top"
 * in the native app; the website is fine because the browser handles it).
 *
 * This hook manually saves a surface's scroll position to sessionStorage
 * (keyed by a stable per-surface base key + the current URL) and restores it
 * when the surface mounts — retrying until async content (feeds, profiles)
 * has grown tall enough to honor the saved offset, and bailing the instant
 * the user scrolls so we never yank the viewport.
 *
 * Two modes:
 *   • Container mode — pass the scroll element's ref:
 *       useScrollRestoration(scrollRef, 'pageview');
 *   • Window mode — pass null when the surface scrolls the document
 *     (e.g. the /polls + /posts feed):
 *       useScrollRestoration(null, 'feed-polls');
 *
 * The base key should be stable + unique per logical surface. The current
 * pathname+search is appended internally so the same surface at different
 * URLs is tracked independently.
 */
import { useEffect } from 'react';

const STORE_PREFIX = 'cv:scroll:';
const MAX_RESTORE_MS = 2500; // give async content time to stream in

export default function useScrollRestoration(ref, baseKey, opts = {}) {
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    // Resolve the scroll target. In window mode we read/write the document
    // scroller and listen on `window`; in container mode we use the element.
    const windowMode = !ref;
    const getEl = () => (windowMode ? null : (ref && ref.current));
    if (!windowMode && !getEl()) return; // container not mounted yet

    const evtTarget = windowMode ? window : getEl();

    const getTop = () => {
      if (windowMode) return window.scrollY || document.documentElement.scrollTop || 0;
      const el = getEl();
      return el ? el.scrollTop : 0;
    };
    const setTop = (v) => {
      if (windowMode) { window.scrollTo(0, v); return; }
      const el = getEl();
      if (el) el.scrollTop = v;
    };
    const getMaxTop = () => {
      if (windowMode) return document.documentElement.scrollHeight - window.innerHeight;
      const el = getEl();
      return el ? el.scrollHeight - el.clientHeight : 0;
    };

    const storeKey = () =>
      STORE_PREFIX + baseKey + '|' + window.location.pathname + window.location.search;

    // ── Save (debounced on scroll, plus on hide/unmount) ──
    let saveTimer = null;
    const save = () => {
      try { sessionStorage.setItem(storeKey(), String(getTop())); } catch {}
    };
    const onScroll = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 150);
    };
    evtTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);

    // ── Restore (retry until content is tall enough; stop if the user scrolls) ──
    let cancelled = false;
    let userScrolled = false;
    const markUser = () => { userScrolled = true; };
    evtTarget.addEventListener('wheel', markUser, { passive: true });
    evtTarget.addEventListener('touchmove', markUser, { passive: true });
    evtTarget.addEventListener('keydown', markUser);

    let saved = NaN;
    try { saved = parseInt(sessionStorage.getItem(storeKey()) || '', 10); } catch {}

    if (Number.isFinite(saved) && saved > 0) {
      const start = Date.now();
      const tryRestore = () => {
        if (cancelled || userScrolled) return;
        if (!windowMode && !getEl()) return;
        const maxTop = getMaxTop();
        if (maxTop >= saved - 2) {
          setTop(saved); // content tall enough — final restore
          return;
        }
        // Not tall enough yet: scroll as far as we can, then retry as the
        // async content streams in.
        setTop(Math.max(0, Math.min(saved, maxTop)));
        if (Date.now() - start < MAX_RESTORE_MS) {
          requestAnimationFrame(() => setTimeout(tryRestore, 60));
        }
      };
      requestAnimationFrame(tryRestore);
    }

    return () => {
      cancelled = true;
      save(); // capture the final position before navigating away
      evtTarget.removeEventListener('scroll', onScroll);
      evtTarget.removeEventListener('wheel', markUser);
      evtTarget.removeEventListener('touchmove', markUser);
      evtTarget.removeEventListener('keydown', markUser);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
      if (saveTimer) clearTimeout(saveTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, baseKey, enabled]);
}
