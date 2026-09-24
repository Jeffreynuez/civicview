'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /privacy: what CivicView collects, who can see it, how long we
 * keep it, and your rights. Required for the Google Play and Microsoft
 * Store listings. Re-checked against the code on 2026-09-24 (audit P5),
 * which added the missing recipients (Postmark, Resend, Brevo, Google
 * Civic, the Census geocoder, Nominatim, Google Forms, CARTO, unpkg,
 * GitHub, Stripe) and data (contact email, poll demographic answers,
 * address fields, waitlist notes, AI search text), and corrected the
 * IP retention and deletion statements. Earlier notes:
 *  - Three-identity sessions (citizen / rep / candidate) via httpOnly
 *    cookies + bearer-token mirror.
 *  - ID.me verification on citizens; verification hash preserved
 *    across account deletion (Task #81).
 *  - 2FA secrets encrypted at rest via Fernet keyed off SESSION_SECRET.
 *  - Post images live in Cloudflare R2 (when prod); local disk in dev.
 *  - Soft delete has a 30-day grace; hard delete removes everything
 *    tied to the account except the verification hash, appeals and
 *    moderation verdicts (audit B3).
 */

import LegalPageLayout from '@/components/LegalPageLayout';

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy policy" eyebrow="Your data on CivicView" lastUpdated="September 24, 2026">
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
        <li><strong>Email address</strong>: for login and account recovery. Required. Demo accounts are given a generated address that receives no mail.</li>
        <li><strong>Contact email (optional, demo accounts)</strong>: if you add one, we use it only to tell you before demo accounts are retired.</li>
        <li><strong>Display name</strong>: shown next to your comments + poll votes. You choose what to use.</li>
        <li><strong>City, state, and (optional) congressional district</strong>: so we can show you the right ballot, match your engagement to the right rep's dashboard, and surface local conversations. Required.</li>
        <li><strong>Address verification status (when ID.me verification is available; it is not live yet)</strong>: the result ("verified" / "not verified") and the verification date, plus the street address and ZIP code ID.me confirms, which we use to place you in the right districts. We never receive the documents ID.me used.</li>
        <li><strong>Engagement history</strong>: the polls you've voted in, posts you've reacted to, comments you've made. Tied to your account.</li>
        <li><strong>Optional poll questions</strong>: some polls include questions the poll&apos;s creator chose, such as age range or party, and on some polls race, religion or income. Answering is optional. Answers are stored with your vote so you can change them until the poll closes, are counted only from verified accounts, and are published only as totals for groups of at least 10 people, never tied to you. You can also save the non-sensitive answers as a reusable profile; sensitive categories are never saved to it, and you can clear it from your dashboard.</li>
      </ul>

      <h3>Representatives and candidates</h3>
      <ul>
        <li><strong>Email + display name</strong>: for login + page attribution.</li>
        <li><strong>Official identifier</strong>: your bioguide_id (for reps) or candidate_id (for declared candidates). Used to bind your account to your public page.</li>
        <li><strong>Posts, polls, and events you publish.</strong> These are public — that's the point of the page.</li>
      </ul>

      <h3>Waitlist and claim requests</h3>
      <ul>
        <li>If you join the waitlist or ask to claim a page, we store your email, your state if you give it, which button you used, and any note you write (for a claim request, the details you send us).</li>
      </ul>

      <h3>Security data (all identity types)</h3>
      <ul>
        <li><strong>Password hash</strong>: bcrypt with a per-account salt. We never see your actual password.</li>
        <li><strong>2FA secret (when enabled)</strong>: encrypted at rest using Fernet symmetric encryption keyed off our application secret. Unusable without access to both the database AND the application secret.</li>
        <li><strong>Recovery codes (when 2FA enabled)</strong>: bcrypt-hashed, single-use, never shown to anyone but you at generation time.</li>
        <li><strong>Last login timestamp</strong>: used to surface "active recently" indicators + spot abandoned accounts.</li>
        <li><strong>Sign-in records</strong>: each sign-in attempt is recorded with the email tried, the result, your IP address and your browser&apos;s user agent, to detect password guessing and lock accounts under attack. Records older than 90 days are deleted each time our server restarts, and all of yours are deleted when your account is permanently deleted.</li>
      </ul>

      <h3>Technical data</h3>
      <ul>
        <li><strong>IP address</strong>: visible to our backend on every request and used for rate limiting and abuse detection. Apart from the sign-in records above, we don&apos;t store it. Our hosting and network providers keep their own request logs for a limited time. We don&apos;t build IP-based profiles.</li>
        <li><strong>Addresses you look up</strong>: when you type an address to find your representatives, our server sends it to the U.S. Census Geocoder (or, if that fails, OpenStreetMap&apos;s Nominatim) and to Google Civic Information to find its districts. We don&apos;t store it, and it is masked in our logs.</li>
        <li><strong>&ldquo;Use my location&rdquo;</strong>: only if you tap it and your browser allows it. Your device&apos;s coordinates go directly from your browser to OpenStreetMap&apos;s Nominatim service, which returns the nearest address. We don&apos;t store the coordinates.</li>
        <li><strong>Browser type + device info</strong>: present in standard HTTP headers; we don't log it beyond what our hosting provider's request logs retain.</li>
        <li><strong>Cookies</strong>: httpOnly session cookies (<code>cl_session</code> for reps, <code>cl_citizen</code> for citizens, <code>cl_candidate</code> for candidates). No tracking cookies. No third-party advertising cookies. No analytics cookies.</li>
        <li><strong>Push notification token (Android app, only if you enable push)</strong>: a device identifier issued by Google Firebase Cloud Messaging so we can deliver the alerts you asked for. If you enable push without signing in, we also store the list of officials you track on that device alongside the token. That list is what lets us send you their updates, and it's used for nothing else. Your notification settings (like quiet hours and how often to be alerted, including your timezone offset) are stored so we respect them when sending. Turning push off deletes the token and everything stored with it.</li>
      </ul>

      <h2>How we use your data</h2>
      <ul>
        <li><strong>To match you with your representatives</strong>: your city / state / district is the lookup key for which rep pages, ballots, and elections we show you.</li>
        <li><strong>To attribute your engagement</strong>: your display name and verification status appear next to comments + poll responses so reps can tell verified constituents from anonymous visitors.</li>
        <li><strong>To roll up engagement for reps</strong>: your rep sees that <em>X people in their district</em> voted in their poll, but never the individual list. Aggregates only.</li>
        <li><strong>To send notifications you've opted into</strong>: tracked items, new posts on pages you follow, replies to your comments.</li>
        <li><strong>To enforce account security</strong>: 2FA, rate limits on login attempts, automatic moderation thresholds.</li>
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
        <li><strong>ID.me</strong>: for citizen identity verification. They see what they need to verify you (name, address, ID document); we receive only the verification result. Their{' '}
          <a href="https://www.id.me/about/privacy" target="_blank" rel="noopener noreferrer">privacy policy</a>{' '}applies to their handling of that data.</li>
        <li><strong>Anthropic</strong>: for AI features. We use Anthropic&apos;s Claude models to (a) generate plain-English summaries of public bills, votes, and executive orders (only public government text is sent), (b) classify and moderate user-generated content: when you create a poll or post a comment, its text is sent to Anthropic to tag it (sentiment, tone, topic) and to screen it for safety and policy violations, and (c) run AI search: the words you type into an AI search box are sent along with the list of items being searched. We do not send your email, address, ID verification, or engagement history. When AI search filters a comment thread, the public display names shown on those comments are included. Anthropic processes this content on our behalf and does not use it to train its models.</li>
        <li><strong>Postmark</strong>: sends account email such as password reset links. Sees your email address and the message.</li>
        <li><strong>Resend</strong>: sends CivicView&apos;s admins an email when content is reported. That email contains the reported content, the reason given, and the reporter&apos;s display name.</li>
        <li><strong>Brevo</strong>: holds the waitlist mailing list. Receives your email, state, and which button you used.</li>
        <li><strong>Google Civic Information and the U.S. Census Geocoder</strong>: receive addresses you type into the address lookup, to find your districts.</li>
        <li><strong>OpenStreetMap Nominatim</strong>: receives your device&apos;s coordinates if you use &ldquo;Use my location,&rdquo; and a typed address when the Census Geocoder can&apos;t place it.</li>
        <li><strong>Google Firebase Cloud Messaging</strong>: delivers push notifications on Android if you turn them on (see the push token above).</li>
        <li><strong>Google Forms</strong>: the feedback form is a Google Form. What you type there goes to Google and to us, under{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google&apos;s privacy policy</a>.</li>
        <li><strong>Map and file hosts</strong>: map tiles come from CARTO, the map&apos;s stylesheet from unpkg, and state boundary files from GitHub and the U.S. Census. Like any website, they see your IP address when your browser loads them.</li>
        <li><strong>Stripe</strong>: will process payments when paid subscriptions launch. We will never see your full card number.</li>
        <li><strong>Render</strong>: our hosting provider. They have access to the underlying server + database. We chose Render because of their privacy posture; we don't make them our data processor for any analytics use.</li>
        <li><strong>Cloudflare</strong>: DNS + WAF + CDN. Sees the IP address of every visitor (that's how DNS works). Doesn't see the contents of HTTPS-encrypted application traffic.</li>
        <li><strong>Cloudflare R2</strong>: object storage for post images. Images uploaded by reps + candidates are stored in R2 buckets in our account.</li>
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
        <li><strong>Permanently deleted accounts:</strong> the account, your content (posts, polls you started, comments, reactions, and your answers to optional poll questions) and everything tied to your account (tracked and saved items, notifications, push device registrations, sign-in records, password reset links) are removed. Your votes on other people&apos;s polls stay in their totals with no link to you. We keep three things. For verified citizens, a one-way hash of your email and the date your ID.me verification ran, so a future signup doesn&apos;t pay for re-verification ($1.50); the hash is salted with our application secret, so it can&apos;t be turned back into your email even if it leaked. Any appeals you filed. And our moderation system&apos;s assessments of content you posted, as a safety record.</li>
        <li><strong>Sign-in records:</strong> about 90 days (older records are deleted whenever our server restarts).</li>
        <li><strong>Content hidden by moderation:</strong> stays in our database, hidden from everyone but its author, so it can be appealed and decisions can be reviewed. Reports are kept with that history.</li>
        <li><strong>Admin actions:</strong> suspensions and decisions on reports are recorded in our server logs. We don&apos;t yet keep a separate admin audit table.</li>
        <li><strong>Waitlist entries:</strong> kept until you ask us to remove them.</li>
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
