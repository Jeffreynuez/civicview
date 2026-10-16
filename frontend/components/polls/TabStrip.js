// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/*
 * TabStrip + TabContent — Polls / Posts segmented control + slide-fade
 * transition shell used by the dual-feed /polls and /posts pages.
 *
 *   TabStrip props:
 *     active   — 'polls' | 'posts'
 *     onChange — (next) => void   (parent owns the URL push)
 *
 *   TabContent props:
 *     tabKey   — same string as TabStrip.active
 *     children — the tab body
 *   Transitions: outgoing slides left + fades out; incoming slides in
 *   from the right + fades in. ~250ms each direction.
 */

import { useEffect, useState } from 'react';

export function TabStrip({ active, onChange }) {
  return (
    <div className="tabstrip" role="tablist" aria-label="Feed" data-tutorial="feed-tabs">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'polls'}
        className={`tabstrip__tab ${active === 'polls' ? 'is-active' : ''}`}
        onClick={() => onChange('polls')}
      >
        Polls
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'posts'}
        className={`tabstrip__tab ${active === 'posts' ? 'is-active' : ''}`}
        onClick={() => onChange('posts')}
      >
        Posts
      </button>
    </div>
  );
}

export function TabContent({ tabKey, children }) {
  const [displayedKey, setDisplayedKey] = useState(tabKey);
  const [displayedChildren, setDisplayedChildren] = useState(children);
  // 'out' | 'in' | 'idle' — drives the CSS keyframe.
  const [phase, setPhase] = useState('idle');

  useEffect(() => {
    if (tabKey === displayedKey) {
      // Same tab — just keep the live children in sync so prop updates
      // flow through without re-triggering the transition.
      setDisplayedChildren(children);
      return undefined;
    }
    // Tab switched — fade out the old, swap, fade in the new.
    setPhase('out');
    const t1 = setTimeout(() => {
      setDisplayedKey(tabKey);
      setDisplayedChildren(children);
      setPhase('in');
      const t2 = setTimeout(() => setPhase('idle'), 30);
      return () => clearTimeout(t2);
    }, 240);
    return () => clearTimeout(t1);
  }, [tabKey, children, displayedKey]);

  return (
    <div className={`tabcontent tabcontent--${phase}`}>
      {displayedChildren}
    </div>
  );
}

export default TabStrip;
