'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * LegalPageLayout — shared chrome for the About-column footer pages
 * (Methodology, Editorial standards, Privacy, Terms of service,
 * Contact). One layout means consistent header / back-button /
 * content container styling across all 5 surfaces, plus one place
 * to wire global concerns like Force2FAGate / RecoveryBanner (which
 * already mount in app/layout.js so they cover these pages too).
 *
 * The layout intentionally stays minimal:
 *   - Compact navbar at top so users can still reach search, login,
 *     identity switcher, etc.
 *   - Back button row that calls router.back() — gracefully degrades
 *     to /home for users who landed here via direct link with no
 *     history.
 *   - Centered max-width content container so 60-char-ish line
 *     length stays comfortable on wide desktops while still
 *     filling the column on mobile.
 *   - Footer-style "last updated" date below the content so the
 *     user can tell at a glance whether a policy is current.
 *
 * Props:
 *   title         — h1 string at the top of the content area.
 *   eyebrow       — small label above the title (e.g. "Policy").
 *   lastUpdated   — display string ("May 20, 2026"). Renders at
 *                   the bottom; null hides the line.
 *   children      — the page body (paragraphs, lists, sections).
 */

import { useRouter } from 'next/navigation';

import Navbar from '@/components/Navbar';

export default function LegalPageLayout({ title, eyebrow, lastUpdated, children }) {
  const router = useRouter();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--cl-bg)' }}>
      <Navbar compact onHome={() => router.push('/')} />

      {/* Back row — matches the pattern used on PageView +
          /account/delete for navigation consistency. */}
      <div style={{
        background: 'white', borderBottom: '1px solid var(--cl-border)',
        padding: '10px 18px',
      }}>
        <button
          type="button"
          onClick={() => {
            // router.back() throws on stale history (e.g. user
            // landed via direct link). Fall through to home.
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back();
            } else {
              router.push('/');
            }
          }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid var(--cl-border)', background: 'white',
            color: 'var(--cl-text)', fontSize: '0.85rem', cursor: 'pointer',
            fontFamily: 'var(--cl-font-sans)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
      </div>

      <main style={{
        flex: 1,
        padding: '32px 18px 48px',
        fontFamily: 'var(--cl-font-sans)',
        color: 'var(--cl-text)',
      }}>
        <article style={{ maxWidth: 760, margin: '0 auto' }}>
          {eyebrow && (
            <div style={{
              fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.6px', color: 'var(--cl-text-light)',
              marginBottom: 8,
            }}>
              {eyebrow}
            </div>
          )}
          <h1 style={{
            fontSize: '1.8rem', fontWeight: 800, color: 'var(--cl-text)',
            margin: '0 0 24px', lineHeight: 1.2,
          }}>
            {title}
          </h1>

          {/* Content area. The default styles below apply to plain
              <p>, <h2>, <h3>, <ul>, <ol> children inside via the
              `.legal-content` className the consumer can rely on. */}
          <div className="legal-content" style={{ fontSize: '0.95rem', lineHeight: 1.65 }}>
            {children}
          </div>

          {lastUpdated && (
            <div style={{
              marginTop: 40, paddingTop: 16,
              borderTop: '1px solid var(--cl-border)',
              fontSize: '0.78rem', color: 'var(--cl-text-light)',
            }}>
              Last updated: {lastUpdated}
            </div>
          )}
        </article>
      </main>

      <style jsx global>{`
        .legal-content h2 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--cl-text);
          margin: 32px 0 10px;
          line-height: 1.3;
        }
        .legal-content h3 {
          font-size: 1rem;
          font-weight: 700;
          color: var(--cl-text);
          margin: 20px 0 8px;
        }
        .legal-content p {
          margin: 0 0 14px;
        }
        .legal-content ul, .legal-content ol {
          margin: 0 0 14px;
          padding-left: 22px;
        }
        .legal-content li {
          margin-bottom: 6px;
        }
        .legal-content a {
          color: var(--cl-accent, #2e7d32);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .legal-content code {
          font-family: var(--cl-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
          font-size: 0.88em;
          background: var(--cl-bg-soft, #f6f7f9);
          padding: 1px 5px;
          border-radius: 4px;
        }
        .legal-content strong { font-weight: 700; }
        .legal-content em { font-style: italic; }
        .legal-content blockquote {
          margin: 16px 0;
          padding: 12px 16px;
          border-left: 3px solid var(--cl-accent, #2e7d32);
          background: var(--cl-bg-soft, #f6f7f9);
          color: var(--cl-text);
          font-size: 0.92rem;
        }
      `}</style>
    </div>
  );
}
