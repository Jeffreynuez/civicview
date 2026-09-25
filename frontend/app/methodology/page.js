'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /methodology — explains where CivicView's data comes from, how AI
 * summaries are generated, what gets aggregated vs displayed, and
 * the editorial line between "what we surface" and "what we add to."
 * Builds trust with civic users + reduces support email volume.
 */

import LegalPageLayout from '@/components/LegalPageLayout';

export default function MethodologyPage() {
  return (
    <LegalPageLayout title="Methodology" eyebrow="How CivicView works" lastUpdated="September 25, 2026">
      <p>
        CivicView surfaces what your elected officials say and do, then lets
        verified constituents respond — in their own districts. This page
        explains where the data comes from, how we transform it, and the
        choices we make along the way.
      </p>

      <h2>Where federal data comes from</h2>
      <p>
        Congressional roster, biographical info, committee assignments, and
        photos pull from the official{' '}
        <a href="https://www.congress.gov/" target="_blank" rel="noopener noreferrer">Congress.gov</a>{' '}
        API and the volunteer-maintained{' '}
        <a href="https://github.com/unitedstates/images" target="_blank" rel="noopener noreferrer">unitedstates.io</a>{' '}
        image mirror. For newly-sworn members who haven't been added to either
        source yet (mid-cycle appointees, etc.), we fall back to a Wikipedia
        thumbnail and surface the member with the same placeholder treatment
        used for unclaimed pages. The author and license of every Wikimedia
        Commons photo are listed on our <a href="/photo-credits">Photo credits</a>{' '}
        page and shown under the photo on each profile.
      </p>
      <p>
        Bills, votes, and presidential actions come from Congress.gov + the
        Federal Register. We cache the underlying records so a temporary
        outage at the source doesn't blank out the app.
      </p>

      <h2>State and local data</h2>
      <p>
        State legislators in all 50 states come from Open States&apos; bulk
        data, which links each record to the legislature&apos;s own website.
        Governors and statewide officers come from each state&apos;s official
        website. Florida has the deepest coverage: its judiciary, local
        officials for 28 cities, and candidates checked against the Florida
        Division of Elections. Other states are added as we verify them.
      </p>
      <p>
        Candidate lists come from the FEC for federal candidates and, in
        Florida, from the Division of Elections. Some candidates&apos;
        background details and endorsements cite their campaign website, a
        news report, Ballotpedia or Wikipedia, and each one links to the
        source it came from. We do <strong>not</strong> scrape social media,
        and we do not write positions for candidates or officials: anything
        attributed to a person links to where it came from.
      </p>

      <h2>How AI summaries work</h2>
      <p>
        The "Translate to plain English" and "What was this vote?" features
        use Anthropic&apos;s Claude Haiku to rephrase official bill summaries and
        vote questions for general readers. For these features we send the
        model only the public text of the bill or vote question. The focus
        areas shown for state legislators are also written by Claude, from
        the titles of their sponsored bills, and are labeled that way.
        Separately, comments and polls are sent to Claude to tag their tone
        and topic and to screen for threats, as described in our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <p>
        AI-generated explanations are always shown <strong>alongside</strong>{' '}
        the original Congressional Research Service summary or official vote
        text, not as a replacement. If our translation conflicts with the
        primary source, the primary source is what matters.
      </p>

      <h2>How posts get attributed</h2>
      <p>
        Every rep and candidate page on CivicView starts as "unclaimed" —
        meaning we surface what officials say and do publicly, but the
        page hasn't been claimed by the official or their staff yet.
        Verified reps and candidates can claim their page by emailing{' '}
        <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>{' '}
        while the automated verification flow is still in development.
      </p>
      <p>
        Once claimed, posts on that page are attributed to the rep or
        candidate. Until claimed, citizens can still start polls and
        conversations on the page — these are clearly labeled as
        "Citizen-led" so a visiting reader knows the rep hasn't responded.
        If the official later claims the page, those polls close to new
        votes and stay public on the page with their results.
      </p>

      <h2>How engagement is counted</h2>
      <p>
        Polls, reactions, and comment counts are aggregated by geography
        for the page owner (rep or candidate): they see how many citizens
        in their district, state, or city engaged — but never individual
        citizen identities. The same display shows other visitors
        country-wide totals.
      </p>
      <p>
        Citizens see their own engagement history in their dashboard. No
        rep or candidate sees a list of "who voted on my poll" — only the
        aggregate by district.
      </p>

      <h2>Update cadence</h2>
      <ul>
        <li><strong>Member rosters:</strong> resynced from Congress.gov on every backend restart, typically daily.</li>
        <li><strong>Bills:</strong> the public records are pulled lazily — when a citizen opens a bill we haven't cached yet, we fetch it then.</li>
        <li><strong>Votes:</strong> updated weekly during Congressional sessions, less frequently during recess.</li>
        <li><strong>Candidate data:</strong> updated manually as primaries and general elections approach.</li>
      </ul>

      <h2>What we don't do</h2>
      <p>
        CivicView does <strong>not</strong> endorse candidates, parties, or
        positions. We don't run ads. We don't sell user data. We don't add
        editorial commentary on top of official records — our job is to
        make those records easier to find, read, and respond to. See our{' '}
        <a href="/editorial-standards">Editorial standards</a> for the
        operational details on how this plays out in moderation.
      </p>
    </LegalPageLayout>
  );
}
