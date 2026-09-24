'use client';

// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Last-resort boundary for an error in the root layout itself. It
// replaces the whole document, so it renders its own <html> and <body>
// and uses only inline styles (audit B5).
export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#f8f9fa', padding: '48px 16px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#1b263b',
      }}>
        <div style={{
          maxWidth: 480, width: '100%', background: 'white', border: '1px solid #e2e8f0',
          borderRadius: 14, padding: 24, boxSizing: 'border-box',
        }}>
          <h1 style={{ margin: '0 0 8px', fontSize: '1.4rem' }}>CivicView could not load</h1>
          <p style={{ margin: '0 0 18px', color: '#475569', lineHeight: 1.5 }}>
            Something went wrong while starting the app. Please try again. If it
            keeps happening, close and reopen CivicView.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: '#2d6a4f', color: 'white', border: 'none', borderRadius: 8,
                padding: '10px 16px', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem',
              }}
            >
              Try again
            </button>
            <a href="/" style={{ color: '#2d6a4f', fontWeight: 600, textDecoration: 'none' }}>
              Reload CivicView
            </a>
          </div>
          {error?.digest && (
            <p style={{ marginTop: 16, fontSize: '0.75rem', color: '#64748b' }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
