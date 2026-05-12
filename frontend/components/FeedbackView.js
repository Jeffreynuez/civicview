'use client';

// CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * FeedbackView — full-page overlay hosting the user feedback form.
 *
 * Implementation choice: embed a Google Form instead of building a
 * submission backend. Reasons:
 *   • Zero moderation infrastructure to maintain. Spam and abuse get
 *     funneled into a Google Sheet that's easy to triage.
 *   • Built-in email collection (optional), file uploads, and
 *     section-based form logic come free.
 *   • Survives indefinitely on Google's infra at no cost; we don't
 *     burn Render compute on a feedback endpoint nobody hits 99% of
 *     the time.
 *   • If we ever want to migrate to a custom backend, the Google
 *     Sheet acts as an export-ready archive.
 *
 * Setup steps (user-side):
 *   1. Sign in to civicview@gmail.com (create if needed).
 *   2. forms.google.com → blank form titled "CivicView feedback".
 *   3. Add fields: Type of feedback (multiple choice: Bug / Feature
 *      request / Content correction / General), Description (long
 *      answer), Email (optional, short answer), Page or URL (short
 *      answer, optional).
 *   4. Send → Embed HTML → copy the iframe src URL.
 *   5. Paste the URL into FEEDBACK_FORM_URL below; flip
 *      FEEDBACK_FORM_LIVE to true.
 *
 * Until the form is live, the overlay shows a friendly placeholder
 * pointing the user at the Help-build-this page so they have
 * somewhere to channel their energy.
 *
 * Props:
 *   onClose() — collapse the overlay
 *   compactNavbarProps — same chrome wires PageView + Help-build use
 */
import { useEffect } from 'react';
import Navbar from './Navbar';

// Drop the Google Form's embed URL here once the form exists. The
// `embedded=true` query param keeps the form's chrome minimal — no
// Google branding, no "powered by" footer interfering with our
// overlay's design.
const FEEDBACK_FORM_URL = '';
const FEEDBACK_FORM_LIVE = false;

export default function FeedbackView({ onClose, compactNavbarProps = {} }) {
  // Lock background scroll while the overlay is up — same pattern as
  // PageView and HelpBuildThisView.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      role="dialog"
      aria-label="Send feedback"
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 1200,
        background: 'var(--cl-bg)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: '0 0 auto' }}>
        <Navbar compact {...compactNavbarProps} onHome={onClose} />
      </div>

      <div
        style={{
          flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '10px 18px',
          background: 'white',
          borderBottom: '1px solid var(--cl-border)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid var(--cl-border)', background: 'white',
            color: 'var(--cl-text)', fontSize: '0.85rem', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div
          style={{
            fontSize: '0.9rem', fontWeight: 700, color: 'var(--cl-text)',
            textAlign: 'center', flex: 1, minWidth: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          Send feedback
        </div>
        <div style={{ width: 60 }} aria-hidden />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 48px' }}>
          <Intro />
          {FEEDBACK_FORM_LIVE && FEEDBACK_FORM_URL ? (
            <FormEmbed />
          ) : (
            <Placeholder />
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Intro block — what we use feedback for, what to expect.
// ─────────────────────────────────────────────────────────────────────
function Intro() {
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 12,
        padding: '16px 18px',
        marginBottom: 18,
      }}
    >
      <h1
        style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          margin: 0,
          marginBottom: 8,
          color: 'var(--cl-text)',
          fontFamily: 'var(--cl-font-display)',
        }}
      >
        Help us make CivicView better.
      </h1>
      <p style={{ fontSize: '0.92rem', lineHeight: 1.55, margin: 0, color: 'var(--cl-text-light)' }}>
        Spotted a bug, want a feature, or noticed wrong info about a
        rep or candidate? Drop a note below. We read every submission
        and either ship a fix, push the request onto the future-
        features list, or correct the underlying data.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Embedded Google Form. Sized to fill the available height; the user
// scrolls inside the iframe on long forms.
// ─────────────────────────────────────────────────────────────────────
function FormEmbed() {
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px solid var(--cl-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <iframe
        title="CivicView feedback form"
        src={FEEDBACK_FORM_URL}
        // Aspect-ratio-based height: 1200px is a reasonable default for
        // a 4–6 field form. Google's iframe handles internal scroll
        // when the form is taller than this.
        style={{
          width: '100%',
          height: 1200,
          border: 'none',
          display: 'block',
        }}
        loading="lazy"
      >
        Loading feedback form…
      </iframe>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Pre-launch placeholder. Shown until the Google Form is created and
// FEEDBACK_FORM_URL is set. Points the user at the Help-build-this
// page so they still have a way to engage.
// ─────────────────────────────────────────────────────────────────────
function Placeholder() {
  return (
    <div
      style={{
        background: 'var(--cl-card)',
        border: '1px dashed var(--cl-border)',
        borderRadius: 12,
        padding: '28px 20px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'var(--cl-accent-soft)',
          margin: '0 auto 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-hidden
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--cl-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, marginBottom: 6, color: 'var(--cl-text)' }}>
        Feedback form launching soon
      </h2>
      <p style={{ fontSize: '0.88rem', lineHeight: 1.55, margin: 0, color: 'var(--cl-text-light)' }}>
        We&rsquo;re setting up the inbox so every submission goes into a
        moderation-friendly queue. Until it&rsquo;s live, the
        &ldquo;Help build this&rdquo; tab covers what&rsquo;s shipped,
        what&rsquo;s in progress, and what&rsquo;s blocked on funding.
      </p>
    </div>
  );
}
