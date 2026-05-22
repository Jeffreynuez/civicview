'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /editorial-standards — the no-endorsement stance, how moderation
 * works, what gets auto-hidden vs admin-reviewed, the citizen-poll
 * vs rep-authored content distinction, and the appeals process.
 * Helps reps + journalists understand the platform.
 */

import LegalPageLayout from '@/components/LegalPageLayout';

export default function EditorialStandardsPage() {
  return (
    <LegalPageLayout title="Editorial standards" eyebrow="How we moderate" lastUpdated="May 20, 2026">
      <p>
        CivicView is a civic-engagement platform, not a publisher. We surface
        what officials publicly say and do; we don't editorialize on top of
        it. This page lays out the operational rules that follow from that
        stance — what we will and won't moderate, how appeals work, and the
        line between citizen-led conversation and rep-authored content.
      </p>

      <h2>The no-endorsement rule</h2>
      <p>
        CivicView does not endorse any candidate, party, or position. This
        applies to:
      </p>
      <ul>
        <li><strong>Product decisions:</strong> we don't algorithmically boost any side. Posts and polls render in chronological order. We don't downrank a rep's content because we disagree with it.</li>
        <li><strong>Editorial copy:</strong> AI summaries on bills + votes are neutral rephrasings of the original text. If we'd struggle to write the summary without taking a side, we don't ship the summary.</li>
        <li><strong>Curated content:</strong> top-issues, stances, and biographical info on candidate pages quote the candidate's own published positions — we don't add interpretive framing.</li>
        <li><strong>Staff conduct:</strong> CivicView employees may participate in civic life as private citizens; they don't post on behalf of the platform.</li>
      </ul>

      <h2>What gets moderated</h2>
      <p>
        The moderation queue handles two kinds of reports — citizen reports
        on content they encounter, and auto-flags from our content
        classifiers. Reports go into a queue an admin reviews; we don't
        auto-remove content based on report count alone.
      </p>
      <p>
        Content that <strong>will</strong> be removed when reported and
        confirmed by an admin:
      </p>
      <ul>
        <li>Direct threats of violence or harm against a specific person.</li>
        <li>Doxxing — posting someone's home address, phone number, or other personal contact info without consent.</li>
        <li>Impersonation of an elected official, candidate, or their staff.</li>
        <li>Spam, automated abuse, or coordinated inauthentic behavior.</li>
        <li>Sexually explicit content. CivicView is a civic-engagement platform; this content has no place here.</li>
        <li>Content that violates federal election or campaign-finance law (e.g. unreported coordinated advocacy).</li>
        <li>Copyright or trademark infringement (we honor DMCA takedown notices — see the contact section below).</li>
      </ul>
      <p>
        Content that will <strong>not</strong> be removed even if reported:
      </p>
      <ul>
        <li>Heated criticism of a public official's policy positions, voting record, or public conduct. Disagreement is the point of the platform.</li>
        <li>Statements you find ideologically objectionable but that don't fall in the categories above. We don't moderate by viewpoint.</li>
        <li>Citizens correcting or fact-checking a rep's claim, even if the rep finds it embarrassing.</li>
        <li>Content the rep doesn't like appearing on their own page (the page's discussion is part of the public record of constituent response).</li>
      </ul>

      <h2>Auto-hide threshold</h2>
      <p>
        A post or comment that receives a threshold number of reports
        (currently 3, subject to change as we learn) is automatically
        hidden from public view pending admin review. This protects users
        from sustained abuse without giving any one reporter a veto over
        speech. The author can still see their own hidden content; the
        post or comment is restored on admin clearance, or removed if the
        report stands.
      </p>
      <p>
        The threshold is set to be hard to game — coordinated reports from
        a single source don't move the needle.
      </p>

      <h2>Citizen-led vs rep-authored content</h2>
      <p>
        Every page on CivicView is either <strong>claimed</strong> (the
        rep or candidate has signed in and can post directly) or{' '}
        <strong>unclaimed</strong> (we surface their public record but no
        one from their office is posting). Both states are clearly labeled
        on the page header.
      </p>
      <p>
        On unclaimed pages, citizens can start polls and conversations —
        these are tagged "Citizen-led conversation" so visitors know the
        rep hasn't responded. If the rep later claims their page, those
        citizen polls archive into a "Pre-claim discussion" section that
        stays visible but is clearly separated from posts the rep
        authored themselves.
      </p>
      <p>
        This separation matters because attribution matters. A reader
        should never have to guess whether a quote on a politician's page
        came from the politician or from another reader.
      </p>

      <h2>How to report content</h2>
      <p>
        Every post, comment, and poll has a Report option. Reporting is
        anonymous to the reported content's author — they can't see who
        reported them — but visible to admins so we can spot patterns.
      </p>
      <p>
        For content that needs urgent attention (credible threats,
        doxxing, immediate harm), email{' '}
        <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>{' '}
        directly. We monitor that inbox during business hours.
      </p>

      <h2>Appeals</h2>
      <p>
        If your content was removed and you disagree, you can appeal:
      </p>
      <ul>
        <li><strong>From the suspension or removal notice:</strong> we're rolling out an inline appeal form in the dashboard. Until that ships, email civicview@civicview.app with the content URL and your reasoning.</li>
        <li><strong>Response time:</strong> typically 24-72 hours. Complex cases (election-law questions, IP disputes) may take longer.</li>
        <li><strong>What we'll do:</strong> a second admin re-reviews the decision. If we got it wrong, we restore the content and add an internal note so we calibrate future calls better.</li>
        <li><strong>What we won't do:</strong> reverse a removal because it's politically inconvenient for the reporter or the author. The original moderation standards apply equally on appeal.</li>
      </ul>

      <h2>DMCA + intellectual property</h2>
      <p>
        Copyright takedown notices should be sent to{' '}
        <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>{' '}
        with the subject line "DMCA notice" and include: the copyrighted
        work, the allegedly infringing URL on CivicView, your contact
        info, a good-faith statement, and your physical or electronic
        signature. We acknowledge within 48 hours and remove confirmed
        infringing content promptly.
      </p>

      <h2>Transparency</h2>
      <p>
        We'll publish aggregate moderation statistics (reports received,
        content actioned vs cleared, breakdown by category) once the
        platform has enough volume for the numbers to be meaningful
        without identifying specific cases. Until then, the moderation
        queue is small enough that publishing data could effectively
        identify individuals.
      </p>
    </LegalPageLayout>
  );
}
