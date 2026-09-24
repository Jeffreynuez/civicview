// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// 404 page inside the normal app chrome (audit B5). Before this, an
// unknown URL got Next's bare default page.
import Link from 'next/link';

// Next adds a noindex robots tag to this page on its own.
export const metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <main style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '48px 16px', background: 'var(--cl-bg, #f8f9fa)',
    }}>
      <div style={{
        maxWidth: 480, width: '100%', background: 'white',
        border: '1px solid var(--cl-border, #e2e8f0)', borderRadius: 14, padding: 24,
      }}>
        <div style={{
          fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.6px', color: 'var(--cl-accent, #2d6a4f)', marginBottom: 6,
        }}>
          404
        </div>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.4rem', color: 'var(--cl-text, #1b263b)' }}>
          We could not find that page
        </h1>
        <p style={{ margin: '0 0 18px', color: 'var(--cl-text-light, #475569)', lineHeight: 1.5 }}>
          The link may be out of date, or the page may have moved.
        </p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--cl-accent, #2d6a4f)', fontWeight: 700, textDecoration: 'none' }}>
            Go to the map
          </Link>
          <Link href="/bills" style={{ color: 'var(--cl-accent, #2d6a4f)', fontWeight: 600, textDecoration: 'none' }}>
            Bills and votes
          </Link>
          <Link href="/polls" style={{ color: 'var(--cl-accent, #2d6a4f)', fontWeight: 600, textDecoration: 'none' }}>
            Polls
          </Link>
        </div>
      </div>
    </main>
  );
}
