'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Per-surface scroll-position restoration for the native Android WebView.
 *
 * Desktop/mobile Chrome restores scroll on history Back via its back-forward
 * cache (bfcache), including positions inside inner scroll containers.
 * Android's WebView has NO bfcache, so Back re-renders the previous view at
 * the top. This hook saves a surface's scroll position to sessionStorage and
 * restores it on mount.
 *
 * Modes:
 *   • Container mode — pass the scroll element's ref:
 *       useScrollRestoration(scrollRef, 'pageview');
 *   • Window mode — pass null when the surface scrolls the document
 *     (e.g. the /polls + /posts feed):
 *       useScrollRestoration(null, 'feed-polls');
 *
 * Correctness notes (these were real bugs in the first cut):
 *   - The storage key is FROZEN at mount from the URL the surface represents.
 *     Computing it at save time is wrong: by unmount, window.location has
 *     already changed to the destination, so the position would be written
 *     under the wrong key and never restored.
 *   - We track the last real scroll offset synchronously on every scroll and
 *     persist THAT — never a live read at unmount. In window mode the browser
 *     often resets scroll to 0 before cleanup runs, so a live read saves 0.
 *   - A `restoring` guard stops our own programmatic restore-scrolls (and
 *     partial offsets while async content streams in) from overwriting the
 *     saved target. The instant the user scrolls we hand control back.
 */
import { useEffect } from 'react';

const STORE_PREFIX = 'cv:scroll:';
const MAX_RESTORE_MS = 2500;

export default function useScrollRestoration(ref, baseKey, opts = {}) {
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const windowMode = !ref;
    const getEl = () => (windowMode ? null : (ref && ref.current));
    if (!windowMode && !getEl()) return;

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

    // Freeze the key from the URL this surface represents, captured at mount.
    const key = STORE_PREFIX + baseKey + '|' + window.location.pathname + window.location.search;

    let lastTop = getTop();
    let restoring = false;

    const persist = () => {
      try { sessionStorage.setItem(key, String(lastTop)); } catch (e) {}
    };

    let saveTimer = null;
    const onScroll = () => {
      if (restoring) return;
      lastTop = getTop();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 120);
    };
    evtTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', persist);

    const onUser = () => { restoring = false; };
    evtTarget.addEventListener('wheel', onUser, { passive: true });
    evtTarget.addEventListener('touchstart', onUser, { passive: true });
    evtTarget.addEventListener('keydown', onUser);

    let cancelled = false;
    let saved = NaN;
    try { saved = parseInt(sessionStorage.getItem(key) || '', 10); } catch (e) {}

    if (Number.isFinite(saved) && saved > 0) {
      restoring = true;
      const start = Date.now();
      const tryRestore = () => {
        if (cancelled || !restoring) return;
        if (!windowMode && !getEl()) return;
        const maxTop = getMaxTop();
        if (maxTop >= saved - 2) {
          setTop(saved);
          lastTop = saved;
          restoring = false;
          return;
        }
        setTop(Math.max(0, Math.min(saved, maxTop)));
        if (Date.now() - start < MAX_RESTORE_MS) {
          requestAnimationFrame(() => setTimeout(tryRestore, 60));
        } else {
          restoring = false;
        }
      };
      requestAnimationFrame(tryRestore);
    }

    return () => {
      cancelled = true;
      if (saveTimer) clearTimeout(saveTimer);
      persist();
      evtTarget.removeEventListener('scroll', onScroll);
      evtTarget.removeEventListener('wheel', onUser);
      evtTarget.removeEventListener('touchstart', onUser);
      evtTarget.removeEventListener('keydown', onUser);
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', persist);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, baseKey, enabled]);
}
