'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

import { useEffect, useState } from 'react';

/**
 * NotificationBanner
 * Floats as an overlay at the top of its nearest positioned ancestor (do not
 * place inside a static-flow container — it will not push siblings around).
 *
 * Visual: semi-transparent accent-green pill so the underlying view (map,
 * profile, etc.) remains visible behind the banner.
 */
export default function NotificationBanner({ message, onDismiss }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        if (onDismiss) onDismiss();
      }, 4000);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [message, onDismiss]);

  if (!visible || !message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        // Translucent accent-green so the map / window beneath shows through.
        // Falls back to a hard-coded rgba if --cl-accent-rgb is not defined.
        background:
          'rgba(var(--cl-accent-rgb, 45, 106, 79), 0.78)',
        backdropFilter: 'saturate(140%) blur(6px)',
        WebkitBackdropFilter: 'saturate(140%) blur(6px)',
        color: 'white',
        padding: '8px 16px',
        fontSize: '0.85rem',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        borderRadius: '999px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18), 0 1px 0 rgba(255,255,255,0.18) inset',
        zIndex: 50,
        maxWidth: 'calc(100% - 32px)',
        pointerEvents: 'auto',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {message}
      </span>
      <span
        role="button"
        aria-label="Dismiss notification"
        style={{ cursor: 'pointer', marginLeft: '4px', opacity: 0.75, lineHeight: 1 }}
        onClick={() => { setVisible(false); if (onDismiss) onDismiss(); }}
      >
        ✕
      </span>
    </div>
  );
}
