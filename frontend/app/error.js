'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Route-level error boundary. Without one, any exception thrown while
// rendering a page white-screened the whole app, including inside the
// Play Store and Microsoft Store shells (audit B5). This keeps the root
// layout mounted and offers a retry and a way home.
import { useEffect } from 'react';

export default function RouteError({ error, reset }) {
  useEffect(() => {
    // Leave a trace for the browser console; nothing is sent anywhere.
    console.error('CivicView page error:', error);
  }, [error]);

  return (
    <main style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.eyebrow}>Something went wrong</div>
        <h1 style={styles.title}>This page hit an error</h1>
        <p style={styles.text}>
          The rest of CivicView is still working. Try loading this page again,
          or head back to the map.
        </p>
        <div style={styles.row}>
          <button type="button" onClick={() => reset()} style={styles.primary}>
            Try again
          </button>
          {/* A full page load on purpose: after an error, start clean
              rather than keep the broken client state. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={styles.secondary}>Go to the home page</a>
        </div>
        {error?.digest && (
          <p style={styles.ref}>Reference: {error.digest}</p>
        )}
      </div>
    </main>
  );
}

const styles = {
  wrap: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '48px 16px', background: 'var(--cl-bg, #f8f9fa)',
  },
  card: {
    maxWidth: 480, width: '100%', background: 'white',
    border: '1px solid var(--cl-border, #e2e8f0)', borderRadius: 14, padding: 24,
  },
  eyebrow: {
    fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.6px', color: 'var(--cl-accent, #2d6a4f)', marginBottom: 6,
  },
  title: { margin: '0 0 8px', fontSize: '1.4rem', color: 'var(--cl-text, #1b263b)' },
  text: { margin: '0 0 18px', color: 'var(--cl-text-light, #475569)', lineHeight: 1.5 },
  row: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  primary: {
    background: 'var(--cl-accent, #2d6a4f)', color: 'white', border: 'none',
    borderRadius: 8, padding: '10px 16px', fontWeight: 700, cursor: 'pointer',
    fontSize: '0.95rem', fontFamily: 'inherit',
  },
  secondary: {
    color: 'var(--cl-accent, #2d6a4f)', fontWeight: 600, textDecoration: 'none',
    padding: '10px 4px',
  },
  ref: { marginTop: 16, fontSize: '0.75rem', color: 'var(--cl-text-light, #64748b)' },
};
