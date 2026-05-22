'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /terms — Terms of Service. DRAFT v1.
 *
 * IMPORTANT: This is a reasonable starting point but is NOT a
 * lawyer-reviewed document. Before going to general public launch
 * (and definitely before submitting to Apple's App Store), have a
 * qualified attorney review + adapt this to your jurisdiction and
 * the specific entity structure CivicView ships under.
 *
 * Placeholders explicitly marked with [PLACEHOLDER — ...] tags so
 * a lawyer (or future-you) can spot what still needs concrete
 * decisions before publishing.
 */

import LegalPageLayout from '@/components/LegalPageLayout';

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of service" eyebrow="Legal" lastUpdated="May 20, 2026">
      <blockquote>
        <strong>Pre-launch draft.</strong> This is CivicView's working
        Terms of Service. The language below is a reasonable starting
        point but has not yet been reviewed by counsel. If you are a
        user reading this before public launch, you can rely on it
        operationally — but expect a revised version before CivicView
        opens to the general public, and we'll notify users in advance
        of any material changes.
      </blockquote>

      <p>
        These Terms of Service ("Terms") govern your use of CivicView
        (the "Service") at civicview.app and the associated iOS and
        Android applications. By creating an account, signing in, or
        using the Service, you agree to these Terms. If you don't
        agree, don't use the Service.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 13 years old to use CivicView (16 in the
        EU and UK). The Service is designed for U.S. residents and
        focuses on U.S. elected officials; access from other countries
        is permitted but the service is not tailored for them.
      </p>
      <p>
        Citizen accounts requiring address verification (via ID.me) are
        only available to U.S. residents who can pass identity proofing.
        Rep + candidate accounts require manual verification by
        CivicView staff and are limited to actual elected officials,
        declared candidates, and authorized staff.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You're responsible for providing accurate information at signup. Misrepresenting yourself as someone else — especially as an elected official or candidate — is grounds for immediate termination.</li>
        <li>You're responsible for keeping your password and 2FA recovery codes secure. We strongly recommend enabling 2FA on all rep, candidate, and admin accounts (and encourage it for citizen accounts).</li>
        <li>You're responsible for activity on your account. Notify us immediately at civicview@civicview.app if you suspect unauthorized access.</li>
        <li>One human, one account per identity type — you can hold a citizen + rep + candidate account simultaneously, but only one of each.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Post content that is unlawful, threatening, defamatory, obscene, infringing, or designed to harass.</li>
        <li>Impersonate any person or entity — particularly an elected official, candidate, or their staff. Verified rep + candidate accounts go through a manual claim process for exactly this reason.</li>
        <li>Doxx others (post their address, phone, or other private contact info without consent).</li>
        <li>Scrape the Service, use automated tools to extract content, or run bots without prior written permission.</li>
        <li>Attempt to gain unauthorized access to any part of the Service or other accounts.</li>
        <li>Engage in coordinated inauthentic behavior, including operating multiple accounts to amplify content or manipulate poll results.</li>
        <li>Violate federal, state, or local election or campaign-finance law. CivicView surfaces public political discourse; it is not a vehicle for unreported coordinated political advocacy.</li>
        <li>Use the Service to distribute malware, phishing, or other harmful code.</li>
        <li>Reverse-engineer, decompile, or attempt to extract source code from any CivicView application.</li>
      </ul>
      <p>
        We may suspend, restrict, or terminate accounts that violate
        these rules. See <a href="/editorial-standards">Editorial standards</a>{' '}
        for the detailed moderation process, including how appeals work.
      </p>

      <h2>4. Your content</h2>
      <p>
        You retain ownership of the content you post on CivicView (your
        comments, polls you create as a citizen, posts you publish as a
        verified rep or candidate, images you upload). By posting, you
        grant CivicView a worldwide, non-exclusive, royalty-free license
        to host, display, distribute, and adapt the content as needed
        to operate the Service — including showing it to other users,
        displaying it in search results, and storing backup copies.
      </p>
      <p>
        This license terminates when you delete your content or your
        account, except for: (a) backups we may retain for a reasonable
        period for operational and legal compliance reasons; (b)
        anonymized or aggregated data that no longer identifies you.
      </p>
      <p>
        You're responsible for the content you post. CivicView is not
        liable for user content; we don't pre-screen it. We may remove
        content that violates these Terms or applicable law.
      </p>

      <h2>5. CivicView's content</h2>
      <p>
        The Service itself — the CivicView name, logo, software, design,
        AI-generated bill summaries, and curated editorial content —
        is owned by CivicView. You may not copy, modify, distribute,
        sell, or lease any part of the Service without our written
        permission.
      </p>
      <p>
        Public data we surface (Congressional rosters, bill texts,
        voting records, candidate-stated positions) is in the public
        domain or sourced under permissive terms. You can use that
        underlying data; you cannot scrape CivicView to obtain it.
      </p>

      <h2>6. Subscriptions and payments</h2>
      <p>
        CivicView's free tier provides access to public officials' pages,
        public discussion, and basic engagement features. The paid
        subscription (currently $5/month USD) provides additional
        features as described on the subscription signup page.
      </p>
      <p>
        Subscriptions purchased via the web are processed by Stripe.
        Subscriptions purchased via the iOS or Android applications are
        processed by Apple or Google respectively and are subject to
        the respective platform's billing terms.
      </p>
      <ul>
        <li><strong>Cancellation:</strong> you can cancel any time. Cancellation takes effect at the end of your current billing period — you keep access until then.</li>
        <li><strong>Refunds:</strong> we generally don't offer refunds for partial periods, but contact us if you believe your situation warrants one. For App Store / Play Store purchases, the platform's refund policy applies.</li>
        <li><strong>Price changes:</strong> we may change subscription prices with 30 days' notice. If you don't accept a new price, you can cancel before it takes effect.</li>
        <li><strong>Failed payments:</strong> if a subscription payment fails, we may suspend paid features until payment succeeds. Your account and content are retained.</li>
      </ul>

      <h2>7. Termination</h2>
      <p>
        You can delete your account at any time at{' '}
        <a href="/account/delete">/account/delete</a>. Two modes:
      </p>
      <ul>
        <li><strong>Archive (30 days):</strong> account is hidden; recoverable by signing in within 30 days. After 30 days the account is permanently purged.</li>
        <li><strong>Immediate:</strong> account and content are removed immediately. For citizens, we retain only a one-way hash of your email + your ID.me verification date so a future signup doesn't pay for re-verification. See the <a href="/privacy">Privacy policy</a> for details.</li>
      </ul>
      <p>
        We may suspend or terminate your account if you violate these
        Terms, if required by law, or if your continued use of the
        Service would create undue legal or security risk. We'll
        provide notice when reasonable.
      </p>

      <h2>8. Service availability</h2>
      <p>
        We work to keep CivicView available, but we don't guarantee
        uninterrupted access. Planned maintenance, hosting provider
        outages, third-party API failures (Congress.gov, ID.me, Stripe,
        etc.), and unexpected incidents may take the Service offline.
        We don't offer service-level agreements (SLAs) on the free tier;
        paid features may include limited SLAs as disclosed at signup.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT
        WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING (BUT NOT
        LIMITED TO) MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        AND NON-INFRINGEMENT.
      </p>
      <p>
        CivicView does not endorse any candidate, party, or position.
        AI-generated summaries are provided for convenience and may
        contain errors; always verify against the primary source when
        accuracy matters (legal filings, voter decisions, etc.). The
        official record — the actual bill text, the actual roll-call
        vote — is the source of truth.
      </p>
      <p>
        We don't verify the accuracy of user-submitted content beyond
        the moderation process described in our Editorial standards. A
        verified citizen's opinion is not endorsed by CivicView.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, CIVICVIEW AND ITS
        OFFICERS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY
        INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
        DAMAGES — INCLUDING LOST PROFITS, LOST DATA, OR BUSINESS
        INTERRUPTION — ARISING FROM YOUR USE OF THE SERVICE.
      </p>
      <p>
        OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM ARISING FROM THESE
        TERMS OR YOUR USE OF THE SERVICE SHALL NOT EXCEED THE GREATER
        OF (A) THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING
        THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS.
      </p>
      <p>
        Some jurisdictions don't allow these limitations. In those
        jurisdictions, the limits apply to the maximum extent permitted.
      </p>

      <h2>11. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless CivicView, its
        officers, employees, and agents from any claim, loss,
        liability, or expense (including reasonable attorney's fees)
        arising from your use of the Service, your content, or your
        violation of these Terms.
      </p>

      <h2>12. Dispute resolution and governing law</h2>
      <p>
        We hope you'll never have a dispute with us. If you do, please
        email <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>{' '}
        first — most issues resolve faster informally than through
        litigation.
      </p>
      <p>
        If informal resolution doesn't work, these Terms are governed
        by the laws of the [PLACEHOLDER — State of incorporation, e.g.
        "State of Florida"], without regard to its conflict-of-law
        principles. You and CivicView agree to resolve disputes through
        binding arbitration administered by [PLACEHOLDER — e.g. the
        American Arbitration Association] under its Consumer Arbitration
        Rules, unless the dispute qualifies for small-claims court.
      </p>
      <p>
        <strong>Class action waiver:</strong> any dispute will be
        resolved on an individual basis. You and CivicView waive any
        right to participate in a class-action lawsuit or class-wide
        arbitration.
      </p>
      <p>
        This section may be unenforceable in some jurisdictions. If
        any part of it is held unenforceable, the rest stays in effect.
      </p>

      <h2>13. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. We'll change the
        "Last updated" date at the top + bottom of this page. For
        material changes (anything that affects your rights, billing,
        or what we collect), we'll notify signed-in users via in-app
        banner at least 30 days before the change takes effect, and
        you can cancel your subscription before the new terms apply if
        you don't agree.
      </p>

      <h2>14. Other</h2>
      <ul>
        <li><strong>Entire agreement:</strong> these Terms (plus the <a href="/privacy">Privacy policy</a> and <a href="/editorial-standards">Editorial standards</a> referenced within) are the complete agreement between you and CivicView for the Service.</li>
        <li><strong>Severability:</strong> if any part of these Terms is held unenforceable, the rest remains in effect.</li>
        <li><strong>Waiver:</strong> our failure to enforce any provision doesn't waive our right to enforce it later.</li>
        <li><strong>Assignment:</strong> you can't assign these Terms without our consent. We may assign them to a successor entity (e.g., as part of a corporate transaction).</li>
        <li><strong>No agency:</strong> these Terms don't create any joint venture, partnership, or employment relationship.</li>
      </ul>

      <h2>15. Contact</h2>
      <p>
        Questions, concerns, or notices regarding these Terms should be
        sent to:
      </p>
      <p>
        Email: <a href="mailto:civicview@civicview.app">civicview@civicview.app</a><br />
        Mailing address: [PLACEHOLDER — registered business address]<br />
        Subject lines that help us route faster: "Legal notice",
        "DMCA notice", "Privacy request", "Security disclosure".
      </p>
    </LegalPageLayout>
  );
}
