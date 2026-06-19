'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPollsFeed, fetchPostsFeed } from '@/lib/pagesApi';

const HOLD_MS = 60000;       // an item must be >= 60s old before it counts (no scroll-spam)
const POLL_MS = 30000;       // re-check the feed head every 30s
const SCROLL_SHOW_AT = 300;  // only surface once the user has scrolled down

/**
 * "N new posts/polls" pill (X-style), client-side only. Polls the feed head
 * for items that are (a) newer than the newest loaded item, (b) at least 60s
 * old, and (c) not already loaded — counting posts and polls only within
 * their own feed. Detection + display start once the user scrolls down.
 * Tapping scrolls to top and refreshes the feed (new items land in their
 * ranked position). No backend change.
 */
export default function NewItemsPill({ tab = 'polls', serverKinds, stateFilter, items, onApply }) {
  const [count, setCount] = useState(0);
  const [scrolledDown, setScrolledDown] = useState(false);
  const lastScrollEl = useRef(null);
  const baselineRef = useRef(0);          // newest loaded created_at (ms)
  const knownIdsRef = useRef(new Set());

  const noun = tab === 'posts' ? 'post' : 'poll';

  // Track the newest loaded item + known ids. Only reset the count when the
  // feed actually gains newer items (refresh / own new poll); loadMore (older
  // items appended) must NOT wipe the pill.
  useEffect(() => {
    let maxTs = 0;
    const ids = new Set();
    for (const it of items || []) {
      if (it && it.id != null) ids.add(it.id);
      const t = it && it.created_at ? Date.parse(it.created_at) : 0;
      if (t > maxTs) maxTs = t;
    }
    knownIdsRef.current = ids;
    if (maxTs > baselineRef.current) {
      baselineRef.current = maxTs;
      setCount(0);
    } else if (baselineRef.current === 0) {
      baselineRef.current = maxTs;
    }
  }, [items]);

  // Scroll detection — capture phase catches the inner feed scroll container
  // as well as the window. Ignores horizontal-only scrollers.
  useEffect(() => {
    const rootEl = () => document.scrollingElement || document.documentElement;
    const resolve = (t) =>
      (!t || t === document || t === window || t === document.documentElement || t === document.body)
        ? rootEl()
        : t;
    const onScroll = (e) => {
      const el = resolve(e.target);
      if (!el || typeof el.scrollTop !== 'number') return;
      if (el !== rootEl() && el.scrollHeight - el.clientHeight < 4) return;
      lastScrollEl.current = el;
      setScrolledDown((el.scrollTop || 0) > SCROLL_SHOW_AT);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  // Poll the feed head — only after the user has scrolled down.
  useEffect(() => {
    if (!scrolledDown) return undefined;
    let cancelled = false;
    const feedFn = tab === 'posts' ? fetchPostsFeed : fetchPollsFeed;
    const check = async () => {
      try {
        const { data } = await feedFn({
          kinds: serverKinds,
          state: stateFilter || undefined,
          limit: 30,
        });
        if (cancelled || !data) return;
        const now = Date.now();
        let c = 0;
        for (const it of data.items || []) {
          const t = it && it.created_at ? Date.parse(it.created_at) : 0;
          if (!t) continue;
          if (t > baselineRef.current && now - t >= HOLD_MS && !knownIdsRef.current.has(it.id)) {
            c += 1;
          }
        }
        if (!cancelled) setCount(c);
      } catch {
        /* transient — ignore, retry next interval */
      }
    };
    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scrolledDown, tab, serverKinds, stateFilter]);

  const onClick = useCallback(() => {
    const el = lastScrollEl.current || document.scrollingElement || window;
    try {
      el.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      /* noop */
    }
    setCount(0);
    if (onApply) onApply();
  }, [onApply]);

  const visible = count > 0 && scrolledDown;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Show ${count} new ${noun}${count === 1 ? '' : 's'}`}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      style={{
        position: 'fixed',
        top: 70,
        left: '50%',
        transform: visible
          ? 'translateX(-50%) translateY(0)'
          : 'translateX(-50%) translateY(-10px)',
        zIndex: 85,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '8px 16px',
        borderRadius: 999,
        background: 'var(--cl-accent)',
        color: 'white',
        border: 'none',
        fontWeight: 700,
        fontSize: '0.82rem',
        fontFamily: 'var(--cl-font-sans)',
        boxShadow: '0 6px 20px rgba(45, 106, 79, 0.4), 0 2px 6px rgba(0, 0, 0, 0.14)',
        cursor: 'pointer',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        whiteSpace: 'nowrap',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
      {count} new {noun}{count === 1 ? '' : 's'}
    </button>
  );
}
