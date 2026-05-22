'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import React, { useEffect, useRef } from 'react';
import { useIsMobile } from '@/lib/useViewport';

/**
 * CivicLens ModalShell — the canonical centered card on a dimmed
 * backdrop. Used by every modal in the app (auth, claim-page,
 * waitlist, committees, my-tracked, etc.).
 *
 * Per design system:
 *   - z-index 1500
 *   - backdrop rgba(0,0,0,0.4) for form modals (default),
 *     rgba(0,0,0,0.85) for the lightbox variant
 *   - card max-width 440px (default; auth modals), can override
 *     via `width` prop. Some modals (committees) use 560px.
 *   - card border-radius var(--cl-radius-2xl) for the card outer
 *   - "esc to close" hint at the bottom (small muted text)
 *
 * Props:
 *   - open       : boolean, if false renders nothing
 *   - onClose    : called on backdrop click + ESC
 *   - width      : max-width of the card (default 440)
 *   - variant    : 'form' (default, dim 0.4) | 'lightbox' (dim 0.85)
 *   - showCloseX : boolean, default true. Renders top-right (×).
 *   - showEscHint: boolean, default true. Renders bottom "esc to close".
 *   - lockScroll : boolean, default true. Locks body scroll while open.
 *   - children   : modal contents.
 *
 * The shell does NOT render the brand mark / heading / body — that's
 * each modal's responsibility. ModalShell is just the chrome.
 */

const VARIANT_BACKDROP = {
  form: 'rgba(0,0,0,0.4)',
  lightbox: 'rgba(0,0,0,0.85)',
};

export default function ModalShell({
  open,
  onClose,
  width = 440,
  variant = 'form',
  showCloseX = true,
  showEscHint = true,
  lockScroll = true,
  className = '',
  cardStyle = {},
  children,
}) {
  const cardRef = useRef(null);
  // Mobile (≤768px) flips the centered card to a full-screen sheet:
  // card takes 100% of the viewport, no border-radius, no esc hint,
  // larger close × that clears 44px tap-target. Backdrop is hidden
  // because the card covers everything anyway.
  const isMobile = useIsMobile();

  // ESC key handler.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body-scroll lock.
  useEffect(() => {
    if (!open || !lockScroll) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, lockScroll]);

  if (!open) return null;

  const onBackdropClick = (e) => {
    if (e.target === e.currentTarget && onClose) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onBackdropClick}
      className={`${className} ${isMobile ? 'cl-h-screen-visible' : ''}`.trim()}
      style={{
        position: 'fixed',
        // Top/left/right pin to layout viewport edges; height is
        // governed by cl-h-screen-visible (100dvh on mobile, 100vh
        // fallback) so the modal tracks the visible viewport when
        // browser chrome shows / hides.
        top: 0,
        left: 0,
        right: 0,
        bottom: isMobile ? undefined : 0,
        zIndex: 1500,
        background: VARIANT_BACKDROP[variant] || VARIANT_BACKDROP.form,
        display: 'flex',
        // CRITICAL: align-items defaults to `stretch`, which on mobile
        // shrinks the card to exactly the container's cross-axis size
        // (100dvh). When content exceeds that — e.g. the citizen-login
        // modal with the demo-logins list expanded — the overflow
        // escapes the card's box because the card has no overflow
        // clip, and the user sees content visually extending past the
        // modal into the page behind. `flex-start` (cross-axis-wise,
        // since the outer is a row) lets the card grow with its
        // content, and the outer's overflow-y:auto handles scrolling
        // when the card exceeds the visible viewport.
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 16,
        overflowY: 'auto',
        // Prevents iOS rubber-band-scrolling from exposing the page
        // behind the modal when the user pulls the scroll past either
        // end. Harmless on Android.
        overscrollBehavior: 'contain',
        // Desktop fallback height — modal always covers the layout
        // viewport. Mobile takes its height from the className.
        ...(isMobile ? {} : { height: '100vh' }),
      }}
    >
      <div
        ref={cardRef}
        className={isMobile ? 'cl-min-h-screen-visible' : ''}
        style={{
          position: 'relative',
          background: 'var(--cl-card)',
          // Full-bleed on mobile (no rounded corners, fills the
          // viewport edge to edge). Centered card on desktop.
          borderRadius: isMobile ? 0 : 'var(--cl-radius-2xl)',
          boxShadow: isMobile ? 'none' : 'var(--cl-shadow-modal)',
          width: '100%',
          maxWidth: isMobile ? '100%' : width,
          // Slightly more padding on mobile for the close-X breathing
          // room and to keep content away from the screen edges.
          padding: isMobile ? '56px 20px 24px' : '24px 24px 16px',
          ...cardStyle,
        }}
      >
        {showCloseX && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: isMobile ? 8 : 12,
              right: isMobile ? 8 : 12,
              // 44×44 on mobile to clear the tap-target minimum;
              // 28×28 on desktop where pointer precision is better.
              width: isMobile ? 44 : 28,
              height: isMobile ? 44 : 28,
              border: 'none',
              background: 'transparent',
              borderRadius: 'var(--cl-radius-pill)',
              color: 'var(--cl-text-light)',
              fontSize: isMobile ? 26 : 18,
              lineHeight: 1,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        )}

        {children}

        {/* Esc-to-close hint is desktop-only — no physical keyboard
            on a phone, so the hint reads as cruft. */}
        {showEscHint && onClose && !isMobile && (
          <div
            style={{
              marginTop: 16,
              textAlign: 'center',
              fontSize: 'var(--cl-text-2xs)',
              color: 'var(--cl-text-muted)',
              letterSpacing: 'var(--cl-tracking-wide)',
              textTransform: 'uppercase',
            }}
          >
            <kbd
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                marginRight: 6,
                background: 'var(--cl-bg-soft)',
                border: '1px solid var(--cl-border)',
                borderRadius: 'var(--cl-radius-xs)',
                fontFamily: 'var(--cl-font-mono)',
                fontSize: 'var(--cl-text-2xs)',
                color: 'var(--cl-text-light)',
                textTransform: 'lowercase',
                letterSpacing: 0,
              }}
            >
              esc
            </kbd>
            to close
          </div>
        )}
      </div>
    </div>
  );
}
