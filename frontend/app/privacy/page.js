'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /privacy: what CivicView collects, who sees it, who receives it, how
 * long it is kept, and the rights every user has. Required for the
 * Google Play and Microsoft Store listings.
 *
 * 2026-10-15 rewrite. Written without an attorney (Jeffrey: "I don't have
 * an attorney because I still can't afford one"), so it was checked line
 * by line against the code at main 9448888 instead, and against the
 * privacy-policy contents California's CalOPPA (Bus. & Prof. Code
 * 22575) requires of any site with California users: the categories of
 * data and of recipients, how to review and correct data, how changes
 * are announced, the effective date, the response to Do Not Track
 * signals, and whether other parties track users across sites. Florida's
 * breach-notice rule (s. 501.171: notice within 30 days) is reflected
 * under Security. The larger state privacy laws have thresholds CivicView
 * is far below, but their rights (access, correct, delete, portability,
 * appeal) are offered to every user anyway.
 *
 * Decisions behind it (Jeffrey, 2026-10-15): accounts are for adults 18
 * and older (matching /child-safety and the store rating); the page
 * owner's dashboard keeps its "most active commenters" list and this
 * page discloses it; the policy describes the app exactly as it is, and
 * the code gaps found in the audit were fixed separately (the last one,
 * an email opt-out for notices to trackers about former pages, on
 * 2026-10-16).
 * Keep this page true: when the code changes what is collected, shown,
 * sent or kept, change this page in the same pull request.
 */

import LegalPageLayout from '@/components/LegalPageLayout';

const EMAIL = 'civicview@civicview.app';

function Mail({ subject }) {
  const href = subject ? `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${EMAIL}`;
  return <a href={href}>{EMAIL}</a>;
}

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy policy" eyebrow="Your data on CivicView" lastUpdated="October 18, 2026">
      <p>
        This policy explains what CivicView collects, why, who can see it,
        who else receives it, how long we keep it, and what you can do
        about it. We wrote it in plain English, and we describe what the
        app actually does today, including the parts we plan to improve.
      </p>

      <blockquote>
        <strong>The short version.</strong> We collect what we need to show
        you who represents you, let you take part, and keep accounts safe.
        We don&apos;t sell your data, show ads, or use advertising or
        analytics trackers. Your individual poll votes and likes are never
        shown with your name. Comments and polls you write are public, with
        your display name and the place they were written from. CivicView
        is for adults 18 and older. You can see, correct and delete your
        data at any time.
      </blockquote>

      <h2>Who we are and what this covers</h2>
      <p>
        CivicView is run by CivicView, Inc., a Florida benefit corporation
        (&ldquo;CivicView,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). This
        policy covers civicview.app, the CivicView Android app on Google
        Play and the Windows app on the Microsoft Store, which all use the
        same service. It applies to everyone who uses CivicView: visitors,
        citizens, elected officials and their staff, and candidates. You
        can reach us at <Mail subject="Privacy request" /> or at CIVICVIEW,
        INC., PO Box 621182, Orlando, FL 32862-1182.
      </p>

      <h2>What we collect</h2>

      <h3>If you browse without an account</h3>
      <p>
        You can read CivicView without signing up. We still receive the
        technical information every website receives (see{' '}
        <a href="#technical">Technical information</a>), any address you
        type into the lookup, and anything you choose to send us.
      </p>

      <h3>Citizen accounts</h3>
      <ul>
        <li><strong>Email address and password.</strong> For signing in and for messages about your account. We store your password only as a one-way hash. Demo accounts get a generated address that receives no mail.</li>
        <li><strong>Contact email (optional, demo accounts only).</strong> If you add one, we use it only for your account: the sign-in email you can ask for when you create the account (your generated sign-in address and a link to choose a new password, never your password), password reset emails, and one notice before demo accounts are retired.</li>
        <li><strong>Display name.</strong> The name you choose. It appears on the comments and polls you write. No two accounts can share a name, and citizens can&apos;t use the names of members of Congress, other federal officials, governors and statewide officials, or officials and candidates with a CivicView account.</li>
        <li><strong>Age confirmation.</strong> When you create an account, you confirm that you&apos;re 18 or older, and we keep the time you confirmed it.</li>
        <li><strong>State and congressional district (required) and city (optional).</strong> We use them to show you your officials, ballot and elections, and to count engagement by area. You can change them in Account &amp; settings. If you use &ldquo;find my district from an address,&rdquo; the address is handled like the address lookup below and isn&apos;t saved to your account. For a verified account, these come from your verification.</li>
        <li><strong>Your settings.</strong> Your start page, notification settings (for each kind of alert, whether it reaches the bell, your phone or your email; quiet hours; how often you&apos;re alerted; whether notifications show details; and your time zone offset, which also sets the times shown in your pushes and emails), whether you want the weekly digest email (off unless you turn it on), the officials, bills and elections you track, save or feature, and the officials you mute.</li>
        <li><strong>Bills you track.</strong> Once a day we check each federal bill someone tracks on Congress.gov, the official source, and record its latest action so we can tell you when it changes. We send Congress.gov only the bill&apos;s number, never anything about you. We record which bill updates we sent you so you never get one twice.</li>
        <li><strong>Polls you voted in.</strong> When a poll closes, we use the record of who voted in it to tell those people the results are in. Your vote itself is never shown to anyone.</li>
        <li><strong>What you do on CivicView.</strong> The polls you vote in and your choice, the posts, comments, polls and bills you like or dislike, the comments you write and the polls you create. Each vote, like and comment is recorded with the state, district, city (and county, where known) of your account at that moment and whether your account was verified, so it can be counted for the right area.</li>
        <li><strong>Edits and deletions.</strong> When you edit or delete a comment, we keep its original text, hidden from everyone, so moderation decisions can be checked. It&apos;s removed when you delete your account.</li>
        <li><strong>Optional poll questions.</strong> See <a href="#poll-questions">Optional poll questions</a> below.</li>
        <li><strong>Notifications.</strong> The in-app notices we send you, such as a reply to your comment (which includes the replier&apos;s display name and a short preview).</li>
        <li><strong>Election reminders.</strong> Before voting deadlines and Election Day, we send a reminder with the date and a link to the state&apos;s official election site, the same for everyone in that state, to citizen accounts in each state where we have its dates from official sources, and to anyone tracking an election in one of those states. We use your account&apos;s state, the elections you track and your time zone offset to choose and time them, and we record which reminders we sent you so you never get the same one twice. If you tap &ldquo;I already voted&rdquo; on a reminder, we record that for that election only, so we stop reminding you; it isn&apos;t shown or shared with anyone, and you can undo it. If you turn on reminder emails, we also send them to your sign-in email. You can turn reminders off from any reminder or in notification settings.</li>
        <li><strong>Reports and appeals.</strong> When you report content, we record that you reported it, your reason and any note. The person you report is not told who reported them. When you appeal a moderation decision, we keep your appeal and our decision.</li>
      </ul>

      <h3 id="poll-questions">Optional poll questions</h3>
      <p>
        Some polls ask optional questions the poll&apos;s creator chose:
        age range, sex, whether you&apos;re a parent or guardian,
        education, employment, whether you own or rent, and military
        service, and on some polls the sensitive questions political
        party, race or ethnicity, household income and religion. Answering
        is always optional, and answers are kept only for verified
        accounts. They&apos;re stored with your vote so you can change them
        until the poll closes, and are published only as totals for groups of
        at least 10 people, never tied to you. You can save the
        non-sensitive answers as a reusable profile; sensitive answers are
        never saved to it, and you can clear it from your dashboard.
      </p>

      <h3>Identity verification (ID.me)</h3>
      <p>
        Verification is not live yet. When it opens, it happens on
        ID.me&apos;s own site, and ID.me sees what it needs to verify you
        (such as your name, address, date of birth and ID documents). We
        receive the result and keep:
      </p>
      <ul>
        <li>whether you&apos;re verified, how and when;</li>
        <li>your legal name as ID.me confirms it, stored encrypted. It is used to check a name hand-off for a former official (see below), and a CivicView administrator can see it only when reviewing one of those;</li>
        <li>the city and state of the address ID.me confirms, which replace the ones you entered, and that address&apos;s congressional district, which we look up once by sending the address to the U.S. Census Geocoder;</li>
        <li>a one-way hash of your street address, never the address itself; and</li>
        <li>a separate record of one-way hashes of your email, verified name and verified street address, with the date you verified. It lets us recognize someone who has already verified so we don&apos;t pay ID.me to verify the same person twice, and it stays after you delete your account. The hashes are salted with our application secret, so they can&apos;t be turned back into your email, name or address.</li>
      </ul>
      <p>
        ID.me&apos;s reply can include your date of birth. We don&apos;t
        read it or save it to your account. We never receive the
        documents ID.me looked at. ID.me&apos;s{' '}
        <a href="https://www.id.me/about/privacy" target="_blank" rel="noopener noreferrer">privacy policy</a>{' '}
        covers what ID.me does with your information.
      </p>

      <h3>Representative and candidate accounts</h3>
      <ul>
        <li><strong>Account details.</strong> Sign-in email, password (as a one-way hash), display name, your role, the official or candidate page your account runs, and the state, district or city that page covers (from our records, not from you).</li>
        <li><strong>What you publish.</strong> Posts, polls, events and images, and the comments, likes and votes you make as the official or candidate. All of it is public, and it stays on the page as a public record (see <a href="#deleting">Deleting your account</a>). Edited or deleted posts keep their original text, hidden, for moderation review.</li>
        <li><strong>Images.</strong> We remove hidden details such as location from the images you upload before storing them. Images taken out of a post may stay in storage.</li>
        <li><strong>Claim requests.</strong> If you ask to claim a page, we keep your email, state and the details you send us (such as your name and your connection to the official), and add your email and state to our Brevo mailing list like a waitlist sign-up.</li>
      </ul>

      <h3>Former officials and candidates</h3>
      <p>
        When someone leaves office or a campaign ends, their page stays,
        labeled as a former official&apos;s or former candidate&apos;s
        page, and is archived six months later (three months for a
        campaign). We record the date, its official source and which
        administrator set it. The person can link a citizen account by
        being signed in to both in the same browser. We keep that link,
        and each choice they make about what to carry over (their name,
        a copy of their tracked items, saved posts and notification
        settings, and an optional &ldquo;Served as&rdquo; line), with the
        time it was turned on or off. Their name is released to their
        citizen account only if ID.me verifies a matching legal name, or
        an administrator approves the match with a source.
      </p>

      <h3>Waitlist sign-ups</h3>
      <p>
        If you join the waitlist, we keep your email, your state if you
        give it, which button you used and any note. We also add your
        email, state and that button to our mailing list at Brevo, which
        may send you an email asking you to confirm, and which we use to
        announce CivicView&apos;s launch and major news. Every such email
        has an unsubscribe link.
      </p>

      <h3>Messages you send us</h3>
      <p>
        Emails you send us, and anything you write in our feedback form
        (a Google Form, so it also goes to Google under{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google&apos;s privacy policy</a>).
      </p>

      <h3>Security information</h3>
      <ul>
        <li><strong>Two-step sign-in (2FA).</strong> If you turn it on, your 2FA secret is stored encrypted and your recovery codes as one-way hashes.</li>
        <li><strong>Sign-in records.</strong> Each sign-in attempt is recorded with the email tried, whether it worked, your IP address and your browser&apos;s user agent, to stop password guessing. We also count failed attempts to lock an account under attack. If your account is locked, we email you, and that email includes the IP address the attempts came from.</li>
        <li><strong>Last sign-in time</strong> for every account.</li>
      </ul>

      <h3 id="technical">Technical information</h3>
      <ul>
        <li><strong>IP address.</strong> Our servers see it on every request and use it to limit abuse. Apart from sign-in records and lockout emails, we don&apos;t store it, and we don&apos;t build profiles from it.</li>
        <li><strong>Server logs.</strong> Our application logs record some events, such as a sign-up or an email we sent. They name an account by its number, and show an email address only as its first letter and domain (like j***@example.org). Typed addresses and the random voter ID are masked. Our hosting providers keep these logs, and their own request logs (IP address, browser and the page requested), for a limited time.</li>
        <li><strong>Addresses you look up.</strong> When you type an address to find your officials, our server sends it to the U.S. Census Geocoder (or, if that fails, OpenStreetMap&apos;s Nominatim) and, when it&apos;s turned on, to Google Civic Information. We don&apos;t save it on our servers. Lookup results can be cached briefly by our network provider and your browser, and the app remembers the last address you matched on your device.</li>
        <li><strong>&ldquo;Use my location.&rdquo;</strong> Only if you tap it and allow it. Your device&apos;s coordinates go straight from your browser to Nominatim, which returns the nearest address, and that address is then looked up as above. We never receive or store the coordinates.</li>
        <li><strong>Push notifications (Android, only if you turn them on).</strong> A device token from Google Firebase Cloud Messaging, your push settings (including your time zone offset and whether notifications show details), the app&apos;s version number, whether notifications for CivicView are turned off in Android settings (so we stop sending to that phone until they&apos;re back on) and, if you aren&apos;t signed in, the list of officials you track on that device. While you&apos;re signed in on the device, the token is linked to your citizen account; signing out unlinks it and clears that list. If you choose a daily or weekly summary, or an update arrives during your quiet hours, we keep that update (who or what it&apos;s about and the push text) until the summary goes out, then delete it. Turning push off deletes the token and everything stored with it. By default each notification, on a locked phone or not, shows only a general line such as &ldquo;New update from an official you track,&rdquo; not who posted or what, and only that line passes through Google; you can choose Show details.</li>
        <li><strong>Web push notifications (in a browser, CivicView on an iPhone or iPad Home Screen, or the Windows app, only if you turn them on).</strong> Your browser gives us a push subscription: its endpoint (the web address of your browser&apos;s push service for this browser) and two keys that every notification is encrypted with. We store it with your push settings (including your time zone offset and whether notifications show details), whether the device is a computer, an Android phone, or an iPhone or iPad, when we last sent to it and, if you aren&apos;t signed in, the list of officials you track in that browser. While you&apos;re signed in there, the subscription is linked to your citizen account; signing out unlinks it and clears that list. Each notification goes through your browser&apos;s push service: Google for Chrome and for Edge on Android, Microsoft for Edge on Windows, Mozilla for Firefox, and Apple for Safari and for Home Screen apps on iPhone and iPad. It is encrypted for your browser, so the push service can&apos;t read it; it sees the endpoint, the notification&apos;s size and timing, and a coded label that names no one. Updates held for a daily or weekly summary or during quiet hours are kept and deleted as for the app. Turning push off deletes the subscription and everything stored with it; so does blocking CivicView&apos;s notifications in your browser (the next time you open CivicView there) and a push service telling us the subscription no longer exists. By default each notification shows only a general line such as &ldquo;New update from an official you track,&rdquo; not who posted or what; you can choose Show details, which applies to your phone and your browsers alike. In an installed app, the icon can show how many notifications you haven&apos;t read.</li>
      </ul>

      <h3>Payments</h3>
      <p>
        Paid subscriptions aren&apos;t available yet. When they launch,
        Stripe will handle payment on its own pages. We&apos;ll keep your
        Stripe customer and subscription IDs, your subscription status
        and renewal date, never your card number. When your account is
        deleted, we cancel any subscription on it right away, so you
        aren&apos;t charged again.
      </p>

      <h2 id="cookies">Cookies and storage on your device</h2>
      <p>
        CivicView sets three cookies, only to keep you signed in:{' '}
        <code>cl_citizen</code>, <code>cl_session</code> (officials) and{' '}
        <code>cl_candidate</code>. They can&apos;t be read by page scripts
        and expire after 14 days. We use no advertising or analytics
        cookies.
      </p>
      <p>
        The app also stores a few things in your browser&apos;s local
        storage:
      </p>
      <ul>
        <li>a copy of your sign-in and security tokens, which keeps you signed in, including in the Android and Windows apps;</li>
        <li>a random voter ID (<code>civicview_voter_token</code>) that shows you how you voted on older polls from this browser. It isn&apos;t linked to your name;</li>
        <li>your push choice and token (or, in a browser, the push subscription&apos;s endpoint), and your notification settings;</li>
        <li>your ballot-measure leanings, which stay on your device and are never sent to us;</li>
        <li>the last district and address you looked up, your map view, tutorial and display choices, and which site notice you dismissed.</li>
      </ul>
      <p>
        You can clear all of this in your browser&apos;s settings.
        Pages run by others, such as our Google feedback form and,
        later, Stripe&apos;s payment pages, may set their own cookies.
      </p>

      <h2>How we use your information</h2>
      <ul>
        <li><strong>To run CivicView:</strong> show you your officials, ballot and elections, display what you publish, and keep your settings.</li>
        <li><strong>To count engagement:</strong> totals of votes, likes and comments by area for officials, candidates and everyone.</li>
        <li><strong>To notify you:</strong> the in-app, push and email messages you turned on, election reminders (on unless you turn them off), and notices about your account or the pages you track.</li>
        <li><strong>To keep CivicView safe:</strong> screening new content, handling reports and appeals, rate limits, lockouts and 2FA.</li>
        <li><strong>For AI features:</strong> plain-English summaries, topic and tone tags on comments and polls, and AI search (see Anthropic below).</li>
        <li><strong>To verify citizens,</strong> once ID.me verification opens.</li>
        <li><strong>To understand use in total,</strong> for example how many polls were created, from our own database. We don&apos;t use outside analytics services.</li>
        <li><strong>To meet legal duties</strong> and protect our users and the service.</li>
      </ul>
      <p>
        We don&apos;t sell personal information, we don&apos;t share it
        for targeted advertising, and we don&apos;t build advertising
        profiles.
      </p>

      <h2>Who can see what</h2>

      <h3>Everyone, without signing in</h3>
      <ul>
        <li><strong>Your comments:</strong> your display name, the text, the district or state and the city the comment was written from, an &ldquo;Unverified&rdquo; label if your account wasn&apos;t verified, and your account number (which opens your public card).</li>
        <li><strong>Polls you create:</strong> your display name, your current state, city and district, and whether you&apos;re verified.</li>
        <li><strong>Your public card:</strong> your display name and, only if you chose it, a &ldquo;Served as&rdquo; line. It shows nothing else.</li>
        <li><strong>Totals</strong> of votes and likes. Your own vote or like is shown only to you.</li>
        <li><strong>Everything on an official&apos;s or candidate&apos;s page.</strong></li>
      </ul>
      <p>
        Never public: your email, your individual votes and likes, your
        answers to optional poll questions, what you track or save, and
        your verification details.
      </p>

      <h3>Officials and candidates who run a page</h3>
      <p>
        They see totals for their page: votes, likes and comments by
        area, poll results by group (only for groups of at least 10), how
        many different citizens engaged, and their top posts. Their
        dashboard also lists their five most active commenters, with each
        person&apos;s display name, city, district, state and number of
        comments; those comments are already public. They never see your
        email, your individual votes or likes, or your answers to optional
        poll questions.
      </p>

      <h3>CivicView administrators</h3>
      <p>
        Only people on an explicit admin list can use admin tools. They
        can see account emails, reports and who filed them, suspended and
        locked accounts, and, only when reviewing a former official&apos;s
        name hand-off, a verified legal name. They use database access to
        handle reports, appeals, security incidents and support, and for
        totals. We don&apos;t browse personal data without a reason.
        Moderation decisions, appeals and changes to former officials&apos;
        pages are recorded with who made them.
      </p>

      <h2>Companies that help us run CivicView</h2>
      <p>
        These providers receive personal information only to do their job
        for us:
      </p>
      <ul>
        <li><strong>Render:</strong> hosts our server and database.</li>
        <li><strong>Vercel:</strong> hosts the website and receives every visitor&apos;s IP address and request details.</li>
        <li><strong>Cloudflare:</strong> sits in front of our server to block attacks and speed it up. It handles the traffic to our server, including its contents, and briefly caches public responses. Cloudflare R2 stores images uploaded by officials and candidates.</li>
        <li><strong>Anthropic (Claude AI):</strong> receives the text of comments, polls (question and options) and the posts and polls of officials and candidates, to screen them for safety and tag their topic and tone; posts when someone asks for a summary; what you type into an AI search box, with the items being searched (for comment search, that includes commenters&apos; display names and short excerpts); and public bills, votes and executive orders to summarize. It doesn&apos;t receive your email, address, verification or votes. Under its commercial terms, Anthropic doesn&apos;t use this content to train its models.</li>
        <li><strong>Postmark:</strong> sends our account emails (password resets and changes, sign-in help, lockout alerts with the IP address), the weekly digest, election reminder emails you turn on and notices about former officials&apos; and candidates&apos; pages.</li>
        <li><strong>Resend:</strong> emails our administrators about new reports (the content, the reason and the reporter&apos;s display name) and appeals (the appellant&apos;s name, email and reasons), and emails you our decision on your appeal.</li>
        <li><strong>Brevo:</strong> our waitlist mailing list (email, state and the button used).</li>
        <li><strong>ID.me:</strong> identity verification, once it opens.</li>
        <li><strong>U.S. Census Geocoder, OpenStreetMap Nominatim and Google Civic Information:</strong> addresses you look up, to find their districts.</li>
        <li><strong>Google Firebase Cloud Messaging:</strong> delivers push notifications, so the notification text passes through Google.</li>
        <li><strong>Your browser&apos;s push service</strong> (Google, Microsoft, Mozilla or Apple, depending on the browser): delivers web push notifications. Each one is encrypted for your browser, so the push service can&apos;t read it.</li>
        <li><strong>Google Forms:</strong> our feedback form.</li>
        <li><strong>Stripe:</strong> payments, once subscriptions launch.</li>
      </ul>
      <p>
        Your browser also loads some content straight from other sites:
        map tiles from CARTO, boundary files from GitHub and the U.S.
        Census, and officials&apos; photos from public sources such as
        Wikimedia Commons, GitHub, government websites, Amazon S3 and
        Google Cloud Storage. Like any website, they see your IP address
        and browser details when they send it. The public-data services we
        use (Congress.gov, Open States, the FEC and others) receive no
        personal information.
      </p>
      <p>
        We may also disclose information when the law requires it (for
        example a valid subpoena or court order), to protect someone&apos;s
        safety, to report child sexual abuse material to the National
        Center for Missing &amp; Exploited Children, or to a company that
        takes over CivicView, which would have to honor this policy.
      </p>

      <h3>Tracking, Do Not Track and Global Privacy Control</h3>
      <p>
        CivicView has no advertising or analytics trackers, and we
        don&apos;t let other companies collect information about your
        activity across websites through CivicView, beyond the request
        details any site you load content from receives (listed above).
        Because we don&apos;t track you across sites, CivicView works the
        same whether or not your browser sends a Do Not Track signal. If
        your browser sends a Global Privacy Control signal, we treat it as
        a request to opt out of the sale or sharing of your information,
        which we don&apos;t do for anyone.
      </p>

      <h2>Emails we send</h2>
      <ul>
        <li><strong>Account and security emails</strong> (password resets and changes, sign-in help, lockout alerts). These protect your account, so they can&apos;t be turned off.</li>
        <li><strong>The weekly digest</strong> of the officials you follow: only if you turn it on. Turn it off in your notification settings (Weekly email digest) or with the one-click unsubscribe link in each one.</li>
        <li><strong>Election reminder emails:</strong> only if you turn them on, the same reminders as in the app. Each one links to the setting that turns them off and has a one-click unsubscribe link.</li>
        <li><strong>Bill update emails:</strong> only if you choose email for Bill updates, at most one a day, listing the federal bills you track that changed. Each one has a one-click unsubscribe link.</li>
        <li><strong>One notice when a page you track changes</strong>, for example when an official leaves office, a campaign ends or a candidate takes office. By email unless you choose a setting without email for &ldquo;Changes to pages you track&rdquo; in your notification settings or use the one-click unsubscribe link in the email; the notice in the app still comes. To stop both, stop tracking the page.</li>
        <li><strong>Notices to former officials and candidates</strong> about their page.</li>
        <li><strong>Your appeal decision.</strong></li>
        <li><strong>Waitlist emails</strong> from Brevo, each with an unsubscribe link.</li>
      </ul>
      <p>
        We never send advertising for other companies. Bell, push and
        email alerts are controlled in your notification settings (the
        bell&apos;s Settings, or Account &amp; settings), and election
        reminders also from any reminder.
      </p>

      <h2>How long we keep information</h2>
      <ul>
        <li><strong>Your account and what you do on CivicView:</strong> until you delete your account. Clearing a notification hides it; it&apos;s removed when you delete your account.</li>
        <li><strong>Sign-in records:</strong> about 90 days. Our daily cleanup removes older ones.</li>
        <li><strong>Password reset links:</strong> expire after one hour (the demo sign-in link after 24 hours), and expired ones are removed daily.</li>
        <li><strong>Accounts scheduled for deletion:</strong> 30 days, then deleted (citizens) or closed (officials and candidates).</li>
        <li><strong>Content hidden by moderation, reports and appeals:</strong> kept so decisions can be appealed and checked.</li>
        <li><strong>Our moderation system&apos;s assessments</strong> of content (which can quote up to a few sentences of it): kept as a safety record, even after the account is deleted.</li>
        <li><strong>Push tokens:</strong> until you turn push off, the token stops working, or you delete your citizen account. Updates held for a summary push: until the summary goes out.</li>
        <li><strong>Web push subscriptions:</strong> until you turn push off, block CivicView&apos;s notifications in that browser, the push service says the subscription no longer exists, or you delete your citizen account.</li>
        <li><strong>Bill status records:</strong> the latest action we saw on each tracked federal bill, and the updates we found, are public information about the bill and are kept while anyone tracks it. The record of which updates we sent you is deleted with your account.</li>
        <li><strong>Waitlist entries:</strong> until you ask us to remove them, and on Brevo until you unsubscribe or ask us.</li>
        <li><strong>Verification records:</strong> the one-way hashes and date described above, kept to avoid paying to verify the same person twice.</li>
        <li><strong>Pages of officials and candidates, and records of their changes:</strong> kept as a public record. Former pages are archived, not deleted.</li>
        <li><strong>Logs:</strong> for the limited time our hosting providers keep them.</li>
        <li><strong>Backups:</strong> deleted data can remain in our database provider&apos;s backups for a short time, until they&apos;re replaced.</li>
      </ul>

      <h2 id="deleting">Deleting your account</h2>
      <p>
        Go to <a href="/account/delete">Delete account</a>. You can
        schedule deletion for 30 days from now (sign back in before then
        to cancel) or delete right away.
      </p>
      <ul>
        <li><strong>Citizen accounts</strong> are deleted, with your comments, the polls you created, your likes, your answers to optional poll questions, your tracked and saved items, notifications, election reminder records, records of the notices we sent you about pages you track, push registrations, sign-in records and password reset links. What stays: your votes on other people&apos;s polls remain in their totals with no link to you; reports you filed remain without your name; your appeals and our moderation assessments remain as a safety record; your verification hashes and date remain (see above); and reply notices other people received keep your display name and a short preview.</li>
        <li><strong>Official and candidate accounts</strong> are closed, never emptied. You can no longer sign in, and your sign-in email, password, 2FA secret and recovery codes, tracked and saved items, notifications, records of the notices we sent you and sign-in records are removed. What you published (posts, polls, events, comments, likes and votes) stays on the page as a public record, whether or not you&apos;re in office, so deleting an account can never erase what was published on it.</li>
      </ul>

      <h2>Your rights and choices</h2>
      <p>
        Wherever you live in the U.S., you can:
      </p>
      <ul>
        <li><strong>Get a copy</strong> of the personal information we have about you, in a common machine-readable format.</li>
        <li><strong>Correct it.</strong> Most of it is editable in Account &amp; settings; email us for the rest.</li>
        <li><strong>Delete it,</strong> with the delete page or by email (with the exceptions in <a href="#deleting">Deleting your account</a>).</li>
        <li><strong>Opt out</strong> of the sale or sharing of your information, targeted advertising and profiling. We don&apos;t do any of these.</li>
        <li><strong>Change your mind</strong> about optional things: your poll answers (until the poll closes), your saved poll profile, push, the digest and the &ldquo;Served as&rdquo; line.</li>
      </ul>
      <p>
        To make a request, email <Mail subject="Privacy request" /> from
        the email address on your account (or tell us how to confirm
        it&apos;s you), or write to the address above. Someone you
        authorize can make a request for you, with your signed permission.
        We&apos;ll answer within 45 days, and if we need more time
        we&apos;ll tell you why, within another 45 days at most. If we turn
        down a request, you can reply to ask us to reconsider, and
        we&apos;ll answer that within 45 days too; if you still disagree,
        you can contact your state&apos;s attorney general. Using these
        rights never changes how CivicView treats you.
      </p>

      <h2>Sensitive information</h2>
      <p>
        Some of what you share can reveal sensitive things: your political
        views (through your votes and comments) and, if you choose to
        answer, your party, race or ethnicity, household income and
        religion. We collect those answers only when you choose to give
        them, use them only for anonymous totals of at least 10 people,
        and never sell them or use them for advertising. We never collect
        your precise location, and we keep your verified legal name
        encrypted.
      </p>

      <h2>Children</h2>
      <p>
        CivicView is for adults 18 and older and isn&apos;t directed to
        children. We don&apos;t knowingly collect information from anyone
        under 18. If you believe someone under 18 has an account, email{' '}
        <Mail subject="Child account" /> and we&apos;ll delete it.
      </p>

      <h2>Security</h2>
      <p>
        We protect your information with HTTPS everywhere, one-way hashed
        passwords and recovery codes, encrypted 2FA secrets and legal
        names, protection against cross-site request forgery, rate limits
        and lockouts, a web application firewall in front of our server,
        automated code and dependency scanning, and an explicit list of
        administrators. We plan an independent security review as
        CivicView grows. No system is perfectly secure. If a breach puts
        your personal information at risk, we&apos;ll notify you and the
        authorities as the law requires (in Florida, within 30 days). To
        report a vulnerability, email <Mail subject="Security disclosure" />{' '}
        before disclosing it publicly.
      </p>

      <h2>If you&apos;re outside the United States</h2>
      <p>
        CivicView is built for people in the United States, and your
        information is stored and processed in the U.S. If you use it from
        the European Union or the United Kingdom, you have the rights above
        under the GDPR, and you can also object to our processing or
        complain to your data protection authority. We rely on these legal
        bases: providing the service you asked for, our legitimate
        interest in keeping CivicView safe and working, your consent for
        optional things (poll answers, push, verification), and our legal
        obligations.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        When we change this policy, we update the &ldquo;Last
        updated&rdquo; date at the bottom of this page. For a material
        change, such as collecting something new, using it in a new way or
        sharing it with someone new, we&apos;ll post a notice on CivicView
        and email account holders at least 30 days before it takes effect.
        We won&apos;t use information you&apos;ve already given us in a
        materially different way without your consent.
      </p>

      <h2>Contact us</h2>
      <p>
        Email <Mail subject="Privacy request" /> with any privacy question
        or request, or write to CIVICVIEW, INC., PO Box 621182, Orlando,
        FL 32862-1182. We usually reply within 24 to 48 hours during the
        work week.
      </p>
    </LegalPageLayout>
  );
}
