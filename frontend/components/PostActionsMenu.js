// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/*
 * PostActionsMenu — kebab (⋮) dropdown that consolidates the per-card
 * actions previously surfaced as separate header buttons. Used by:
 *
 *   • PostCard (rep/candidate PageView feed)
 *   • FeedCard (home National activity, /polls, /posts)
 *
 * Behavior:
 *   • Renders a 24×24 kebab trigger in the top-right of the card.
 *   • Clicking opens a small dropdown beneath the trigger with one row
 *     per item. Items that are conditionally available — Edit only
 *     for the author within the edit window, Delete only for the
 *     author, Report only for non-authors — are passed in by the
 *     parent; this component doesn't know the gates, just renders
 *     what it's given.
 *   • If `items` is empty, the trigger renders grayed + disabled —
 *     the safety-net state for a viewer with zero actions (rare in
 *     practice; mostly anonymous users on their own non-existent
 *     content).
 *   • Click-outside dismiss, Escape closes, items that opt in via
 *     `destructive: true` render in red (used by Delete).
 *
 * Props:
 *   items     — Array<{ id, label, onClick, destructive?, disabled? }>
 *               Order is preserved. Destructive items typically go
 *               last so they're not the default keyboard target.
 *   ariaLabel — Optional accessible label for the trigger button
 *               (defaults to "Post actions"). Override when the menu
 *               is for a comment or other non-post content.
 */

import { useEffect, useRef, useState } from 'react';

export default function PostActionsMenu({ items = [], ariaLabel = 'Post actions' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  const activeItems = items.filter(Boolean);
  const disabled = activeItems.length === 0;

  // Close on click outside.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    // mousedown rather than click so a click that lands on a menu
    // item still fires the item's onClick (which itself sets open
    // to false). Click would race with the outside-close logic.
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        // Return focus to the trigger so a keyboard user lands
        // somewhere sensible.
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={disabled ? 'No actions available' : ariaLabel}
        style={{
          // Same 24×24 footprint as the prior feed-card__close button
          // so the card top-row layout doesn't shift when we swap
          // the affordance in.
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '1px solid var(--cl-border)',
          background: 'white',
          color: disabled ? 'var(--cl-text-muted)' : 'var(--cl-text-light)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          fontFamily: 'inherit',
          transition: 'background 120ms, border-color 120ms, color 120ms',
        }}
        onMouseOver={(e) => {
          if (disabled) return;
          e.currentTarget.style.background = 'var(--cl-bg-soft)';
          e.currentTarget.style.color = 'var(--cl-text)';
        }}
        onMouseOut={(e) => {
          if (disabled) return;
          e.currentTarget.style.background = 'white';
          e.currentTarget.style.color = 'var(--cl-text-light)';
        }}
      >
        {/* Vertical kebab — three round dots stacked. Drawn as
            an inline SVG (12×12) so the icon scales with the
            button's currentColor and stays crisp on retina. */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <circle cx="6" cy="2"  r="1.2" fill="currentColor" />
          <circle cx="6" cy="6"  r="1.2" fill="currentColor" />
          <circle cx="6" cy="10" r="1.2" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={ariaLabel}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            // Match the post-card surface: white card on subtle border
            // with a soft drop shadow so it floats above the card body.
            background: 'white',
            border: '1px solid var(--cl-border)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
            padding: '4px 0',
            minWidth: 140,
            zIndex: 50,
            fontFamily: 'inherit',
          }}
        >
          {activeItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                // Close BEFORE invoking the handler so an item that
                // triggers a confirmation modal or navigation lands
                // in a clean state.
                setOpen(false);
                if (!item.disabled) item.onClick?.();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 14px',
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                opacity: item.disabled ? 0.5 : 1,
                fontSize: '0.85rem',
                fontWeight: 600,
                color: item.destructive ? '#d63031' : 'var(--cl-text)',
                fontFamily: 'inherit',
              }}
              onMouseOver={(e) => {
                if (item.disabled) return;
                e.currentTarget.style.background = item.destructive
                  ? 'var(--cl-down-soft, #fee2e2)'
                  : 'var(--cl-bg-soft)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
