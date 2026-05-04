'use client';

import { useEffect, useState } from 'react';

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
      style={{
        background: 'var(--cl-accent)', color: 'white', padding: '8px 20px',
        fontSize: '0.85rem', display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: '8px', zIndex: 50,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <span>{message}</span>
      <span
        style={{ cursor: 'pointer', marginLeft: '12px', opacity: 0.7 }}
        onClick={() => { setVisible(false); if (onDismiss) onDismiss(); }}
      >
        ✕
      </span>
    </div>
  );
}
