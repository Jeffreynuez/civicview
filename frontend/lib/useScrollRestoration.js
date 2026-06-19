'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Per-surface scroll-position restoration for the native Android WebView.
 *
 * Desktop/mobile Chrome restores scroll on history Back via its back-forward
 * cache (bfcache), including positions inside scroll containers. Android's
 * WebView has NO bfcache, so Back re-renders the previous view at the top.
 * This hook saves a surface's scroll position to sessionStorage and restores
 * it on mount.
 *
 * Modes:
 *   • Container mode — pass the scroll element's ref:
 *       useScrollRestoration(scrollRef, 'pageview');
 *   • Window/document mode — pass null when the surface scrolls the page
 *     (e.g. the /polls + /posts feed):
 *       useScrollRestoration(null, 'feed-polls');
 *
 * Window-mode subtlety (this was the bug behind "always lands at the top"):
 * the app's body is `height:100dvh; overflow-y:auto`, so on the mobile
 * WebView the BODY is the actual scroller and window.scrollY / documentElement
 * .scrollTop stay 0 — while on desktop the document scrolls. We therefore read
 * the max of body / documentElement / window, write all three on restore, and
 * listen for scroll on `document` with capture (scroll events from the body
 * scroller don't reach a plain window listener).
 *
 * Other correctness notes:
 *   - The storage key is FROZEN at mount from the surface's own URL; computing
 *     it at save time is wrong because window.location has already changed by
 *     the time the surface unmounts.
 *   - We track the last real offset synchronously on each scroll and persist
 *     THAT (never a live read at unmount, which is often already 0).
 *   - A `restoring` guard stops our own programmatic restore-scrolls (and
 *     partial offsets while async content streams in) from overwriting the
 *     saved target; a real user wheel/touch/keydown hands control back.
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

    const de = document.documentElement;
    const body = document.body;

    const getTop = () => {
      if (windowMode) {
        return Math.max(window.scrollY || 0, de.scrollTop || 0, body.scrollTop || 0);
      }
      const el = getEl();
      return el ? el.scrollTop : 0;
    };
    const setTop = (v) => {
      if (windowMode) {
        try { window.scrollTo(0, v); } catch (e) {}
        de.scrollTop = v;
        body.scrollTop = v;
        return;
      }
      const el = getEl();
      if (el) el.scrollTop = v;
    };
    const getMaxTop = () => {
      if (windowMode) {
        return Math.max(de.scrollHeight - window.innerHeight, body.scrollHeight - body.clientHeight, 0);
      }
      const el = getEl();
      return el ? el.scrollHeight - el.clientHeight : 0;
    };

    // Listen targets. In window mode the scroll fires on the body scroller,
    // which a plain window listener misses — use document + capture.
    const addScroll = (fn) => {
      if (windowMode) document.addEventListener('scroll', fn, true);
      else getEl().addEventListener('scroll', fn, { passive: true });
    };
    const removeScroll = (fn) => {
      if (windowMode) document.removeEventListener('scroll', fn, true);
      else { const el = getEl(); if (el) el.removeEventListener('scroll', fn); }
    };
    const userTarget = windowMode ? document : getEl();

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
    addScroll(onScroll);
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', persist);

    const onUser = () => { restoring = false; };
    userTarget.addEventListener('wheel', onUser, { passive: true });
    userTarget.addEventListener('touchstart', onUser, { passive: true });
    userTarget.addEventListener('keydown', onUser);

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
      removeScroll(onScroll);
      userTarget.removeEventListener('wheel', onUser);
      userTarget.removeEventListener('touchstart', onUser);
      userTarget.removeEventListener('keydown', onUser);
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', persist);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, baseKey, enabled]);
}
