'use client';

// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * /child-safety — CivicView's published standards against child sexual
 * abuse and exploitation (CSAE/CSAM). Required by Google Play's Child
 * Safety Standards policy for apps in the Social category, and linked
 * from the Play Console "Child safety standards" declaration. Must stay
 * publicly reachable and non-editable by end users.
 */

import LegalPageLayout from '@/components/LegalPageLayout';

export default function ChildSafetyPage() {
  return (
    <LegalPageLayout title="Child safety standards" eyebrow="Our standards against CSAE" lastUpdated="June 16, 2026">
      <p>
        CivicView is a non-partisan civic-engagement platform intended for
        adults (18 and older). It is not directed to children, and we do not
        knowingly allow anyone under 18 to create an account. We have a
        zero-tolerance stance toward child sexual abuse and exploitation
        (CSAE), including child sexual abuse material (CSAM). This page sets
        out the standards we hold ourselves and our users to, how we prevent
        and detect violations, how anyone can report a concern, and how we
        work with the relevant authorities.
      </p>

      <h2>Zero tolerance for CSAE</h2>
      <p>
        The following are strictly prohibited on CivicView, will be removed
        when identified, and will be reported to the appropriate authorities:
      </p>
      <ul>
        <li>Child sexual abuse material (CSAM) in any form — images, video, text, or links.</li>
        <li>Grooming, solicitation, or sexualization of a minor.</li>
        <li>Sexual extortion of a minor, or trafficking and exploitation of children.</li>
        <li>Promoting, normalizing, or facilitating the sexual abuse or exploitation of children.</li>
        <li>Any other content or conduct that endangers a child.</li>
      </ul>
      <p>
        Accounts involved in this conduct are suspended, and the associated
        content is removed and preserved as required for reporting to
        authorities.
      </p>

      <h2>How we prevent and detect violations</h2>
      <ul>
        <li><strong>Adults-only product:</strong> CivicView is designed for verified adult citizens, their elected representatives, and election candidates. It is rated for a mature audience and is not intended for minors.</li>
        <li><strong>Reporting on every surface:</strong> every post, comment, and poll carries a Report control so any user can flag harmful content immediately.</li>
        <li><strong>Human moderation:</strong> reports enter a queue an administrator reviews. Content that crosses a report threshold is auto-hidden from public view pending review, so harmful material can be contained quickly.</li>
        <li><strong>Automated signals:</strong> we use content classifiers to flag potentially abusive material for prioritized human review, and we are expanding automated threat detection over time.</li>
        <li><strong>Preservation:</strong> when we identify apparent CSAM, we preserve the relevant records as required so they can be provided to authorities.</li>
      </ul>

      <h2>How to report a child-safety concern</h2>
      <p>
        If you encounter content or behavior that may sexually exploit or
        endanger a child:
      </p>
      <ul>
        <li><strong>In the app:</strong> use the Report control on the post, comment, or poll. Reports are reviewed by our moderation team.</li>
        <li><strong>By email:</strong> contact our designated child-safety point of contact at <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>. Please include the content URL and any relevant detail. We treat these reports as urgent.</li>
      </ul>
      <p>
        If a child is in immediate danger, contact your local emergency
        services first.
      </p>

      <h2>Working with authorities</h2>
      <p>
        CivicView complies with all applicable child-safety laws. When we
        become aware of apparent child sexual abuse material, we report it to
        the National Center for Missing &amp; Exploited Children (NCMEC) through
        the CyberTipline, and we cooperate with law enforcement and other
        regional and national authorities as required by law. Members of the
        public in the United States can also report directly to NCMEC at{' '}
        <a href="https://report.cybertip.org" target="_blank" rel="noopener noreferrer">report.cybertip.org</a>.
      </p>

      <h2>Point of contact</h2>
      <p>
        Our designated point of contact for child-safety and CSAE matters is{' '}
        <a href="mailto:civicview@civicview.app">civicview@civicview.app</a>. This
        contact is able to speak to our CSAE/CSAM prevention practices and
        compliance.
      </p>

      <h2>Our commitment</h2>
      <p>
        Protecting children is non-negotiable. We will continue to invest in
        prevention, detection, reporting, and response so that CivicView
        remains a safe space for civic participation and gives no quarter to
        those who would exploit or endanger children.
      </p>
    </LegalPageLayout>
  );
}
