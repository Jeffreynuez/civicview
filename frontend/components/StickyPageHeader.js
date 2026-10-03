'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * StickyPageHeader: the navbar plus a back row, pinned to the top of
 * every full-page route (Polls, Posts, Bills & Votes, Stats, the policy
 * pages, account deletion, password reset).
 *
 * Before this, each page drew its own back row in normal flow, so it
 * scrolled away (Polls), was missing (Bills & Votes), or the page had
 * no app header at all (Stats). Jeffrey, 2026-10-03: the back button
 * "should stick with a transparency", the same on every page.
 *
 * Usage:
 *   <StickyPageHeader backLabel="Back to map" onBack={goHome}>
 *     <Navbar compact ... />
 *   </StickyPageHeader>
 *
 * The navbar is passed as children because each page wires its own
 * Navbar handlers. Without onBack, the back button goes back in
 * history, or home when there is no history (a direct link).
 *
 * Height: the navbar is 56px and the back row is --cv-backbar-h (44px),
 * so anything else that sticks below this header (the Polls filter
 * row) uses top: calc(56px + var(--cv-backbar-h)).
 */

import { useRouter } from 'next/navigation';

import './StickyPageHeader.css';

export function PageBackBar({ label = 'Back', onBack }) {
  const router = useRouter();
  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    // router.back() goes nowhere useful on a direct link (no history),
    // so fall through to home.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  };
  return (
    <div className="cv-backbar">
      <button type="button" className="cv-backbar__btn" onClick={handleBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{label}</span>
      </button>
    </div>
  );
}

export default function StickyPageHeader({ children, backLabel = 'Back', onBack }) {
  return (
    <div className="cv-sticky-head">
      {children}
      <PageBackBar label={backLabel} onBack={onBack} />
    </div>
  );
}
