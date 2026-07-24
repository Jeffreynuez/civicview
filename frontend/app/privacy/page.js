'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /privacy — what CivicView collects, who can see it, how long we
 * keep it, and your rights. Required for iOS App Store submission +
 * Google Play submission. Accurate to the codebase as of May 2026:
 *  - Three-identity sessions (citizen / rep / candidate) via httpOnly
 *    cookies + bearer-token mirror.
 *  - ID.me verification on citizens; verification hash preserved
 *    across account deletion (Task #81).
 *  - 2FA secrets encrypted at rest via Fernet keyed off SESSION_SECRET.
 *  - Post images live in Cloudflare R2 (when prod); local disk in dev.
 *  - Soft delete has a 30-day grace; hard delete removes everything
 *    except the verification hash.
 */

import LegalPageLayout from '@/components/LegalPageLayout';

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy policy" eyebrow="Your data on CivicView" lastUpdated="May 20, 2026">
      <p>
        This policy describes what CivicView collects, why we collect it,
        who can see it, and how long we keep it. We've tried to write it in
        plain English. The goal is to be honest about what's happening with
        your data — not to bury the practices in legal-speak.
      </p>

      <blockquote>
        <strong>Quick summary:</strong> We collect the minimum we need to
        match you with your reps, let you engage, and verify you're a
        real constituent. We don't sell your data. We don't show you ads.
        We don't share your individual engagement with reps or candidates —
        they only ever see aggregate counts by geography. You can delete
        your account at any time.
      </blockquote>

      <h2>What we collect</h2>

      <h3>Citizens</h3>
      <ul>
        <li><strong>Email address</strong> — for login and account recovery. Required.</li>
        <li><strong>Display name</strong> — shown next to your comments + poll votes. You choose what to use.</li>
        <li><strong>City, state, and (optional) congressional district</strong> — so we can show you the right ballot, match your engagement to the right rep's dashboard, and surface local conversations. Required.</li>
        <li><strong>Address verification status</strong> — provided by ID.me when you complete identity proofing. We store only the result ("verified" / "not verified") plus the verification date — not the underlying documents ID.me used.</li>
        <li><strong>Engagement history</strong> — the polls you've voted in, posts you've reacted to, comments you've made. Tied to your account.</li>
      </ul>

      <h3>Representatives and candidates</h3>
      <ul>
        <li><strong>Email + display name</strong> — for login + page attribution.</li>
        <li><strong>Official identifier</strong> — your bioguide_id (for reps) or candidate_id (for declared candidates). Used to bind your account to your public page.</li>
        <li><strong>Posts, polls, and events you publish.</strong> These are public — that's the point of the page.</li>
      </ul>

      <h3>Security data (all identity types)</h3>
      <ul>
        <li><strong>Password hash</strong> — bcrypt with a per-account salt. We never see your actual password.</li>
        <li><strong>2FA secret (when enabled)</strong> — encrypted at rest using Fernet symmetric encryption keyed off our application secret. Unusable without access to both the database AND the application secret.</li>
        <li><strong>Recovery codes (when 2FA enabled)</strong> — bcrypt-hashed, single-use, never shown to anyone but you at generation time.</li>
        <li><strong>Last login timestamp</strong> — used to surface "active recently" indicators + spot abandoned accounts.</li>
      </ul>

      <h3>Technical data</h3>
      <ul>
        <li><strong>IP address</strong> — visible to our backend on every request. Used for rate-limiting and abuse detection; not stored long-term. We don't build IP-based profiles.</li>
        <li><strong>Browser type + device info</strong> — present in standard HTTP headers; we don't log it beyond what our hosting provider's request logs retain.</li>
        <li><strong>Cookies</strong> — httpOnly session cookies (<code>cl_session</code> for reps, <code>cl_citizen</code> for citizens, <code>cl_candidate</code> for candidates). No tracking cookies. No third-party advertising cookies. No analytics cookies.</li>
        <li><strong>Push notification token (Android app, only if you enable push)</strong> — a device identifier issued by Google Firebase Cloud Messaging so we can deliver the alerts you asked for. If you enable push without signing in, we also store the list of officials you track on that device alongside the token — that list is what lets us send you their updates, and it's used for nothing else. Your notification settings (like quiet hours and how often to be alerted, including your timezone offset) are stored so we respect them when sending. Turning push off deletes the token and everything stored with it.</li>
      </ul>

      <h2>How we use your data</h2>
      <ul>
        <li><strong>To match you with your representatives</strong> — your city / state / district is the lookup key for which rep pages, ballots, and elections we show you.</li>
        <li><strong>To attribute your engagement</strong> — your display name and verification status appear next to comments + poll responses so reps can tell verified constituents from anonymous visitors.</li>
        <li><strong>To roll up engagement for reps</strong> — your rep sees that <em>X people in their district</em> voted in their poll, but never the individual list. Aggregates only.</li>
        <li><strong>To send notifications you've opted into</strong> — tracked items, new posts on pages you follow, replies to your comments.</li>
        <li><strong>To enforce account security</strong> — 2FA, rate limits on login attempts, automatic moderation thresholds.</li>
      </ul>

      <h2>Who can see your data</h2>

      <h3>Public</h3>
      <p>
        Anyone visiting CivicView can see: your display name on comments
        + poll responses you've left, the content of those comments, your
        verification status badge (if shown), and the page-owner's
        attributed posts. Anonymous visitors can see this without signing
        in.
      </p>

      <h3>The page owner (rep or candidate)</h3>
      <p>
        Reps and candidates see <strong>aggregate</strong> engagement on
        their page — the number of citizens in their district who voted
        each way on a poll, the total comment count, top reactions. They
        do <strong>not</strong> see a list of individual citizens who
        engaged. The owner's dashboard surface explicitly hides
        per-citizen identities.
      </p>

      <h3>Other citizens</h3>
      <p>
        Other signed-in citizens can see your display name on comments +
        polls + reactions you've made (same as the public view). They
        cannot see your email, district, or any account-level info.
      </p>

      <h3>CivicView staff (admins)</h3>
      <p>
        Admins have database access to investigate moderation reports,
        respond to security incidents, and run aggregate analytics. Admin
        access is gated to an explicit allow-list (the{' '}
        <code>ADMIN_EMAILS</code> environment variable on the backend),
        not "anyone who signs in." Admins can see your email + content
        when investigating a specific report. We don't browse user data
        speculatively.
      </p>

      <h3>Third parties we share data with</h3>
      <ul>
        <li><strong>ID.me</strong> — for citizen identity verification. They see what they need to verify you (name, address, ID document); we receive only the verification result. Their{' '}
          <a href="https://www.id.me/about/privacy" target="_blank" rel="noopener noreferrer">privacy policy</a>{' '}applies to their handling of that data.</li>
        <li><strong>Anthropic</strong> — for AI features. We use Anthropic&apos;s Claude models to (a) generate plain-English summaries of public bills, votes, and executive orders (only public government text is sent), and (b) classify and moderate user-generated content: when you create a poll or post a comment, its text is sent to Anthropic to tag it (sentiment, tone, topic) and to screen it for safety and policy violations. We do not send your name, email, address, ID verification, or engagement history. Anthropic processes this content on our behalf and does not use it to train its models.</li>
        <li><strong>Render</strong> — our hosting provider. They have access to the underlying server + database. We chose Render because of their privacy posture; we don't make them our data processor for any analytics use.</li>
        <li><strong>Cloudflare</strong> — DNS + WAF + CDN. Sees the IP address of every visitor (that's how DNS works). Doesn't see the contents of HTTPS-encrypted application traffic.</li>
        <li><strong>Cloudflare R2</strong> — object storage for post images. Images uploaded by reps + candidates are stored in R2 buckets in our account.</li>
      </ul>
      <p>
        We don't share data with advertisers, analytics platforms (Google
        Analytics, Mixpanel, etc.), or data brokers. We don't have an ad
        network. We don't sell user data.
      </p>

      <h2>How long we keep your data</h2>
      <ul>
        <li><strong>Active accounts:</strong> kept indefinitely until you delete.</li>
        <li><strong>Soft-deleted accounts:</strong> kept for 30 days, then permanently purged. During the grace period you can sign back in and recover.</li>
        <li><strong>Permanently deleted accounts:</strong> the account row + all your content (posts, polls, comments, reactions) is removed. For citizens, we retain only a one-way hash of your email + the date your ID.me verification ran. This lets us recognize you on a future signup so you don't pay for re-verification ($1.50). The hash is salted with our application secret, so the table isn't reversible to your actual email even if it leaked.</li>
        <li><strong>Reported content:</strong> kept for 90 days after the report resolves so we can audit moderation decisions, then anonymized.</li>
        <li><strong>Audit logs:</strong> admin actions (suspensions, content removals) are logged with timestamps and the responsible admin's account. Kept indefinitely as a moderation audit trail.</li>
      </ul>

      <h2>Your rights</h2>
      <ul>
        <li><strong>Access your data:</strong> email{' '}
          <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>{' '}
          and we'll send you a copy of everything we have associated with your account within 30 days.</li>
        <li><strong>Correct your data:</strong> most fields are editable in your dashboard. For fields we control (your verification status, your bioguide_id binding, etc.), email us.</li>
        <li><strong>Delete your account:</strong> go to <a href="/account/delete">/account/delete</a>. Two options — 30-day archive (recoverable) or immediate hard delete.</li>
        <li><strong>Port your data:</strong> the access-data export above is in a portable JSON format you can re-import elsewhere.</li>
        <li><strong>Opt out of any communication:</strong> notifications can be turned off in your dashboard. Email us for any communication channels not exposed in the UI.</li>
      </ul>

      <h3>GDPR (EU) + UK GDPR</h3>
      <p>
        If you're in the EU or UK: you have the rights listed above as
        statutory entitlements. Our legal basis for processing is
        <strong> legitimate interest</strong> (providing the civic-engagement
        service you signed up for) and, where applicable,
        <strong> consent</strong> (for optional features like ID.me
        verification). To exercise your rights, email{' '}
        <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>.
        If you're unsatisfied with our response, you can complain to your
        national data protection authority.
      </p>

      <h3>CCPA (California)</h3>
      <p>
        California residents have the right to know what personal info we
        collect, to delete it, and to opt out of sale. CivicView does not
        sell personal information, so opt-out is automatic. For knowledge
        + deletion requests, use the email above or the deletion flow.
      </p>

      <h2>Children</h2>
      <p>
        CivicView is not directed at children under 13. We don't knowingly
        collect data from users under 13 (or under 16 in the EU/UK). If
        you believe we've inadvertently collected data from a child,
        email{' '}
        <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>{' '}
        and we'll remove it.
      </p>

      <h2>Security</h2>
      <p>
        We follow the practices outlined in our internal{' '}
        <code>SECURITY.md</code>: HTTPS end-to-end, parameterized queries
        (no SQL injection surface), bcrypt password hashing, encrypted 2FA
        secrets, Cloudflare WAF in front of the API, regular dependency
        scanning via Dependabot + CodeQL, planned annual penetration
        testing. No system is perfectly secure; if you discover a
        vulnerability, please report it to{' '}
        <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>{' '}
        with the subject line "Security disclosure" before public
        disclosure.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We'll update the "Last updated" date at the bottom of this page
        whenever we change something material. For substantive changes
        (new data uses, new third-party sharing), we'll also notify
        signed-in users via in-app banner before the change takes effect.
      </p>

      <h2>Contact us</h2>
      <p>
        Email{' '}
        <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>{' '}
        for any privacy question. We aim to respond within 48 hours.
      </p>
    </LegalPageLayout>
  );
}
