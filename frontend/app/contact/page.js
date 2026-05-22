'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /contact — single-email contact surface with routing hints for
 * common categories (general, press, rep onboarding, privacy,
 * security disclosure, bugs / features). Links into the existing
 * help-build + feedback overlays where they make sense.
 */

import LegalPageLayout from '@/components/LegalPageLayout';

export default function ContactPage() {
  return (
    <LegalPageLayout title="Contact" eyebrow="Get in touch" lastUpdated="May 20, 2026">
      <p>
        We're a small team. One inbox handles everything — but using a
        descriptive subject line helps us route faster + get you a
        useful response sooner.
      </p>

      <p style={{ fontSize: '1.1rem', textAlign: 'center', margin: '24px 0' }}>
        <a href="mailto:civicview@civicview.app" style={{ fontWeight: 700 }}>
          civicview@civicview.app
        </a>
      </p>
      <p style={{ textAlign: 'center', color: 'var(--cl-text-light)', fontSize: '0.86rem' }}>
        Typical response time: 24-48 hours during the work week.
      </p>

      <h2>What to put in the subject line</h2>

      <h3>General questions</h3>
      <p>
        Use a plain descriptive subject ("Question about the polls
        feature", "How do I track a rep?"). We read every message.
      </p>

      <h3>Press + media inquiries</h3>
      <p>
        Subject: <code>Press inquiry — [outlet name]</code>. Include
        your deadline and what kind of comment you're looking for —
        on-record statement, background interview, data access for a
        story, etc.
      </p>

      <h3>Rep or candidate page claim</h3>
      <p>
        Subject: <code>Page claim — [your full name] — [office]</code>.
        Include the URL of the page you're claiming + a way to verify
        you (official email address ending in <code>.gov</code>,
        campaign-website contact info, or other primary-source link).
        We respond personally to confirm before activating the
        account.
      </p>

      <h3>Privacy or data requests</h3>
      <p>
        Subject: <code>Privacy request — [type]</code>. Types include:
        export my data, delete my account, correct my data,
        question about the privacy policy. See the{' '}
        <a href="/privacy">Privacy policy</a> for the rights you have
        under GDPR / CCPA / general principles.
      </p>
      <p>
        Account deletion is also available directly in your dashboard at{' '}
        <a href="/account/delete">/account/delete</a> — no email needed.
      </p>

      <h3>Security vulnerability disclosure</h3>
      <p>
        Subject: <code>Security disclosure</code>. Please report
        privately before any public disclosure. We aim to acknowledge
        within 24 hours, triage within 72 hours, and credit responsible
        reporters in our security log (with permission).
      </p>

      <h3>Bug reports + feature requests</h3>
      <p>
        Easiest path: use the Feedback button in the app's hamburger
        menu (sends to the same inbox but pre-fills useful context like
        your viewport size + browser). Or email directly with subject{' '}
        <code>Bug</code> or <code>Feature request</code>.
      </p>
      <p>
        Want to know what we're already working on? See{' '}
        <a href="/?help-build">Help build this</a> for the public
        roadmap.
      </p>

      <h3>Legal notices (DMCA, court orders, etc.)</h3>
      <p>
        Subject: <code>Legal notice</code> or <code>DMCA notice</code>.
        See our <a href="/editorial-standards">Editorial standards</a>{' '}
        for what should be in a DMCA takedown notice. We handle legal
        process within statutory timeframes and require all formal
        notices in writing.
      </p>

      <h2>What we won't respond to</h2>
      <ul>
        <li>Unsolicited marketing pitches, "growth hacking" services, or SEO offers — we'll silently archive these.</li>
        <li>Requests to add advertising, sponsored content, or affiliate links to CivicView. Our editorial position rules these out and won't change.</li>
        <li>Requests to remove content because you ideologically disagree with it (vs. it actually violating our <a href="/editorial-standards">Editorial standards</a>).</li>
      </ul>

      <h2>Mailing address</h2>
      <p>
        For physical correspondence (subpoenas, legal notices, etc.):
      </p>
      <p>
        [PLACEHOLDER — registered business address]
      </p>
      <p>
        Most communication should go through email first; we only need
        physical mail for documents requiring wet signatures or
        formal service of process.
      </p>
    </LegalPageLayout>
  );
}
