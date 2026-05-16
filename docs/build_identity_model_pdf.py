"""Build the CivicView Identity Model PDF.

Run from repo root:
    python3 docs/build_identity_model_pdf.py
"""
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether,
    Table, TableStyle,
)


# CivicView brand colors — pulled from the frontend CSS tokens so this
# doc looks at home alongside the app.
CL_PRIMARY = HexColor("#1d3557")
CL_ACCENT = HexColor("#2a7a2a")
CL_ACCENT_SOFT = HexColor("#e6f4ea")
CL_TEXT = HexColor("#1a1a1a")
CL_TEXT_LIGHT = HexColor("#5a6068")
CL_BORDER = HexColor("#e1e5ea")
CL_BG_SOFT = HexColor("#f5f7fa")
CL_DANGER = HexColor("#b00020")
CL_WARNING = HexColor("#8a6100")


def build_styles():
    base = getSampleStyleSheet()

    styles = {
        "Title": ParagraphStyle(
            "Title", parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=24, leading=30,
            textColor=CL_PRIMARY,
            spaceAfter=6,
            alignment=TA_LEFT,
        ),
        "Subtitle": ParagraphStyle(
            "Subtitle", parent=base["Normal"],
            fontName="Helvetica",
            fontSize=12, leading=16,
            textColor=CL_TEXT_LIGHT,
            spaceAfter=18,
        ),
        "H1": ParagraphStyle(
            "H1", parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16, leading=22,
            textColor=CL_PRIMARY,
            spaceBefore=14, spaceAfter=8,
        ),
        "H2": ParagraphStyle(
            "H2", parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12, leading=16,
            textColor=CL_PRIMARY,
            spaceBefore=10, spaceAfter=4,
        ),
        "Body": ParagraphStyle(
            "Body", parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10, leading=15,
            textColor=CL_TEXT,
            spaceAfter=8,
        ),
        "BodyMuted": ParagraphStyle(
            "BodyMuted", parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9, leading=14,
            textColor=CL_TEXT_LIGHT,
            spaceAfter=8,
        ),
        "Bullet": ParagraphStyle(
            "Bullet", parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10, leading=15,
            textColor=CL_TEXT,
            leftIndent=14, bulletIndent=2,
            spaceAfter=4,
        ),
        "Pill": ParagraphStyle(
            "Pill", parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8, leading=10,
            textColor=CL_ACCENT,
            spaceAfter=4,
        ),
        "Code": ParagraphStyle(
            "Code", parent=base["Code"],
            fontName="Courier",
            fontSize=9, leading=12,
            textColor=CL_TEXT,
            leftIndent=14,
            spaceAfter=8,
        ),
        "FooterMeta": ParagraphStyle(
            "FooterMeta", parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8, leading=11,
            textColor=CL_TEXT_LIGHT,
        ),
    }
    return styles


def bullet(s, styles):
    """Render a single bullet line. Uses ParagraphStyle's bullet support so
    the indent + glyph render consistently across pages."""
    return Paragraph(s, styles["Bullet"], bulletText="•")


def build_table(rows, styles, col_widths=None, header=True):
    """Render a simple table with the brand accent header row."""
    table = Table(rows, colWidths=col_widths, repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9, 12),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, CL_BG_SOFT]),
        ("GRID", (0, 0), (-1, -1), 0.5, CL_BORDER),
    ]
    if header:
        style.extend([
            ("BACKGROUND", (0, 0), (-1, 0), CL_PRIMARY),
            ("TEXTCOLOR", (0, 0), (-1, 0), white),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9, 12),
        ])
    table.setStyle(TableStyle(style))
    return table


def build_story(styles):
    story = []

    # ───── Title block ─────────────────────────────────────────────
    story.append(Paragraph("CivicView Identity Model", styles["Title"]))
    story.append(Paragraph(
        "Three-tier authentication, lifecycle transitions, and the role of ID.me + FEC/SOS verification in the post-Phase-3 platform.",
        styles["Subtitle"],
    ))
    story.append(Paragraph(
        "Owner: Jeffrey Nuez &nbsp;&nbsp;|&nbsp;&nbsp; Status: Phase 3 (Candidate auth) shipped; Phase 4+ pending against this spec",
        styles["FooterMeta"],
    ))
    story.append(Spacer(1, 0.25 * inch))

    # ───── Executive summary ────────────────────────────────────────
    story.append(Paragraph("Summary", styles["H1"]))
    story.append(Paragraph(
        "CivicView supports three independent account types, each with its own session cookie and signed-token salt: "
        "<b>Citizens</b>, <b>Candidates</b>, and <b>Representatives</b>. The three identities can coexist in the same "
        "browser at the transport layer; the frontend enforces one active role at a time. Engagement capability is "
        "tiered by verification + subscription state, not by account type alone. Candidates who win elections are "
        "promoted in place to representatives, preserving their history and follower base.",
        styles["Body"],
    ))
    story.append(Paragraph(
        "This document is the source of truth for how identity, verification, and lifecycle work in the platform. "
        "Implementation phases reference back to it; deviations require updating this spec first.",
        styles["BodyMuted"],
    ))

    # ───── Engagement tiers ────────────────────────────────────────
    story.append(Paragraph("Engagement Tiers", styles["H1"]))
    story.append(Paragraph(
        "Reading and navigation are free for everyone. Higher-friction engagement is gated to higher-trust "
        "verification states. The ladder maps abuse-surface risk to the cost the user has paid to participate.",
        styles["Body"],
    ))

    tier_rows = [
        ["Tier", "Who", "What they can do", "Gate"],
        [
            "0 — Anonymous",
            "Anyone on the internet",
            "Read posts, polls, comments. Browse reps, candidates, bills, votes, executive orders. View profiles.",
            "None",
        ],
        [
            "1 — Verified Citizen",
            "Real person, ID.me-confirmed identity + address",
            "Everything in Tier 0, plus: like / dislike posts and comments, vote on polls (rep + candidate + citizen-authored).",
            "ID.me identity verification (free)",
        ],
        [
            "2 — Subscribed Citizen",
            "Tier-1 citizen with an active CivicView subscription",
            "Everything in Tier 1, plus: post comments and replies, create standalone citizen-authored polls on unclaimed pages.",
            "Tier-1 + active paid subscription",
        ],
    ]
    story.append(build_table(
        tier_rows, styles,
        col_widths=[1.3 * inch, 1.6 * inch, 2.5 * inch, 1.4 * inch],
    ))
    story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph(
        "<b>Rationale:</b> like / dislike / vote are quantitative signals with low abuse surface, so they unlock at "
        "Tier 1 with no subscription friction. Comments and polls are text-based and high-abuse-surface, so the "
        "Tier-2 subscription gate doubles as a moderation signal and a revenue source.",
        styles["Body"],
    ))

    # ───── Account types ───────────────────────────────────────────
    story.append(Paragraph("Account Types", styles["H1"]))
    story.append(Paragraph(
        "Three independent account tables, one cookie per account type. The same human can hold accounts in multiple "
        "tables (e.g. a sitting rep who is also a citizen who comments on other reps' pages). The frontend enforces "
        "one active role per browser session by tearing down the other two on each login.",
        styles["Body"],
    ))

    story.append(Paragraph("Citizen accounts (citizen_accounts)", styles["H2"]))
    story.append(bullet(
        "Created via the public signup flow or the demo-citizen self-serve endpoint.", styles))
    story.append(bullet(
        "Verified via ID.me (post-Phase 3 — currently demo accounts are unverified=False).", styles))
    story.append(bullet(
        "Carry geography (state, congressional district, city) used for scope-filtering engagement.", styles))
    story.append(bullet(
        "Cookie: <font name='Courier'>cl_citizen</font>. Bearer header: <font name='Courier'>X-Citizen-Token</font>.", styles))

    story.append(Paragraph("Candidate accounts (candidate_accounts)", styles["H2"]))
    story.append(bullet(
        "Created when a person legally on a ballot claims their candidate page through the verification flow.", styles))
    story.append(bullet(
        "Keyed on <font name='Courier'>candidate_id</font> (e.g. fl-cand-byron-donalds), matched 1:1 to a row in "
        "the curated candidate registry.", styles))
    story.append(bullet(
        "Lifecycle: <font name='Courier'>pending</font> at create time, flipped to <font name='Courier'>active</font> "
        "by admin (Phase 1-3) or automatically by ID.me + FEC/SOS data match (Phase 5+).", styles))
    story.append(bullet(
        "Cookie: <font name='Courier'>cl_candidate</font>. Bearer header: <font name='Courier'>X-Candidate-Token</font>.", styles))

    story.append(Paragraph("Representative accounts (rep_accounts)", styles["H2"]))
    story.append(bullet(
        "Created for sitting reps (House, Senate, executive officials, state-level, local) when they claim their "
        "official page. Currently provisioned by admin onboarding; future state uses the .gov-email verification "
        "path or a Congressional digital affairs partnership.", styles))
    story.append(bullet(
        "Keyed on <font name='Courier'>official_id</font> (bioguide_id for federal, state-seeded ids for state/local).", styles))
    story.append(bullet(
        "Cookie: <font name='Courier'>cl_session</font>. Bearer header: <font name='Courier'>Authorization: Bearer ...</font>", styles))

    story.append(PageBreak())

    # ───── Capabilities by account type ─────────────────────────────
    story.append(Paragraph("Capabilities by Account Type", styles["H1"]))

    cap_rows = [
        ["Action", "Tier-1 Citizen", "Tier-2 Citizen", "Candidate", "Representative"],
        ["Read posts / polls / comments", "Yes", "Yes", "Yes", "Yes"],
        ["Like / dislike posts", "Yes", "Yes", "On own page only", "On own page only"],
        ["Vote on polls", "Yes", "Yes", "On own page only", "On own page only"],
        ["Comment on posts", "—", "Yes", "On own page only", "On own page only"],
        ["Reply to top-level comments", "—", "If original commenter", "If post creator (own page)", "If post creator (own page)"],
        ["Create standalone polls", "—", "On unclaimed rep pages", "On own page only", "Not applicable (use posts)"],
        ["Post on a page", "—", "—", "Own candidate page", "Own rep page"],
        ["Manage page dashboard", "—", "—", "Yes (own page)", "Yes (own page)"],
        ["Delete own posts / polls / comments", "Own comments only", "Own comments + polls", "Own content on own page", "Own content on own page"],
    ]
    story.append(build_table(
        cap_rows, styles,
        col_widths=[2.0 * inch, 1.0 * inch, 1.1 * inch, 1.2 * inch, 1.4 * inch],
    ))
    story.append(Spacer(1, 0.05 * inch))
    story.append(Paragraph(
        "Reps and candidates engaging with their <i>own</i> content (Phase 2 self-engagement) record an "
        "<font name='Courier'>author_rep_id</font> / <font name='Courier'>author_candidate_id</font> on the "
        "reaction / comment row. The UI surfaces an &ldquo;Author&rdquo; badge on those rows so other viewers "
        "see the page owner&rsquo;s voice distinctly. Self-engagement does not extend across pages &mdash; a rep "
        "visiting a peer&rsquo;s page falls through to the standard citizen path.",
        styles["Body"],
    ))

    # ───── Verification model ───────────────────────────────────────
    story.append(Paragraph("Verification Model", styles["H1"]))
    story.append(Paragraph(
        "<b>Identity</b> (who you are) and <b>role authority</b> (what you&rsquo;re entitled to claim) are two "
        "separate questions. ID.me answers the first; FEC, Secretary of State filings, and admin review answer the second.",
        styles["Body"],
    ))

    story.append(Paragraph("Citizens", styles["H2"]))
    story.append(Paragraph(
        "ID.me confirms the person is real and lives at the address they claim. The verified geography flows into "
        "their CitizenAccount row (state / congressional_district / city) and drives engagement scope filtering. "
        "Today the platform runs demo citizens with <font name='Courier'>verified=False</font>; ID.me integration "
        "(Phase 5+) flips the flag and unlocks Tier-1 capabilities.",
        styles["Body"],
    ))

    story.append(Paragraph("Candidates", styles["H2"]))
    story.append(Paragraph(
        "Two factors required: <b>ID.me</b> (identity) + a <b>candidacy data match</b> (entitlement). Auto-approval "
        "path:",
        styles["Body"],
    ))
    story.append(bullet("ID.me name + DOB + address match a current FEC filing (federal candidates) &rarr; auto-approve.", styles))
    story.append(bullet("ID.me match against a state Secretary of State ballot filing (state + local) &rarr; auto-approve.", styles))
    story.append(bullet("Party nomination paperwork on file (primary winners awaiting general election) &rarr; auto-approve.", styles))
    story.append(bullet("Anything else (write-ins, declared-but-not-filed, edge cases) &rarr; admin review queue.", styles))
    story.append(Paragraph(
        "All Phase 1-3 claims today go through manual admin review &mdash; the auto-approve path is Phase 5+ work.",
        styles["BodyMuted"],
    ))

    story.append(Paragraph("Representatives", styles["H2"]))
    story.append(Paragraph(
        "Two factors required: <b>ID.me</b> (identity) + proof the person represents the claimed office. Acceptable proofs:",
        styles["Body"],
    ))
    story.append(bullet("Verification email sent to the rep&rsquo;s official .gov address.", styles))
    story.append(bullet("Long-term: partnership with the House / Senate Digital Affairs office for batch verification.", styles))
    story.append(bullet("Today: manual admin onboarding (the current path).", styles))

    story.append(PageBreak())

    # ───── Lifecycle transitions ────────────────────────────────────
    story.append(Paragraph("Lifecycle Transitions", styles["H1"]))
    story.append(Paragraph(
        "The same human moves through political life: citizen, then candidate, then representative, then (sometimes) "
        "back to citizen after defeat or retirement. The platform models these transitions explicitly so history, "
        "followers, and accountability records carry forward correctly.",
        styles["Body"],
    ))

    story.append(Paragraph("Citizen &rarr; Candidate", styles["H2"]))
    story.append(bullet(
        "An ID.me-verified citizen who is legally on a ballot may claim their candidate page.", styles))
    story.append(bullet(
        "The claim creates a CandidateAccount with <font name='Courier'>claim_status='pending'</font>. The "
        "citizen&rsquo;s existing CitizenAccount remains active and separate &mdash; the same person now holds two "
        "independent accounts.", styles))
    story.append(bullet(
        "Verification (auto via FEC/SOS match, or manual admin review) flips the candidate account to "
        "<font name='Courier'>active</font>. The candidate can then sign in via the candidate login.", styles))

    story.append(Paragraph("Candidate &rarr; Representative (election win)", styles["H2"]))
    story.append(Paragraph(
        "<b>Decision: Promote in place.</b> The candidate account itself transitions to a representative account "
        "rather than being deleted and recreated. Concretely:",
        styles["Body"],
    ))
    story.append(bullet(
        "The CandidateAccount&rsquo;s historical content (posts, polls, comments) carries forward to the new rep "
        "page &mdash; the same author identity is preserved through a foreign-key remap or a role flag.", styles))
    story.append(bullet(
        "Followers from the campaign page automatically follow the rep page.", styles))
    story.append(bullet(
        "The candidate&rsquo;s sign-in continues to work; on next login they land on the rep dashboard.", styles))
    story.append(bullet(
        "Implementation detail (Phase 6+): either flip a <font name='Courier'>role</font> column on a unified "
        "account record, OR keep the candidate account locked-historical and create a linked rep account with "
        "<font name='Courier'>former_candidate_id</font> FK. The user experience is identical; the choice is "
        "between schema simplicity and audit-trail explicitness.", styles))

    story.append(Paragraph("Defeated rep / defeated candidate", styles["H2"]))
    story.append(Paragraph(
        "<b>Decision: Archive to read-only public; owner keeps read access.</b> The page stays publicly viewable forever &mdash; "
        "civic memory matters for accountability around past statements and votes. The former rep or candidate:",
        styles["Body"],
    ))
    story.append(bullet("Cannot post, poll, comment, or moderate from the archived page.", styles))
    story.append(bullet(
        "Can still log in to view their own dashboard analytics (their term&rsquo;s engagement history).", styles))
    story.append(bullet(
        "Retains any separate citizen account they hold &mdash; defeat doesn&rsquo;t affect citizen-tier capabilities.", styles))
    story.append(bullet(
        "May reactivate as a candidate in a future cycle (admin-approved unarchive, reusing the same account).", styles))

    story.append(Paragraph("Incumbents running for re-election", styles["H2"]))
    story.append(Paragraph(
        "Incumbents do <b>not</b> get a parallel candidate page during their re-election campaign. Their existing "
        "rep page is their campaign presence. Challengers get candidate pages until the election resolves; if a "
        "challenger wins, the incumbent&rsquo;s rep page archives and the challenger&rsquo;s candidate page promotes "
        "to the rep page.",
        styles["Body"],
    ))

    story.append(Paragraph("Resignation, death, or mid-term vacancy", styles["H2"]))
    story.append(Paragraph(
        "The rep page archives immediately. A special election process determines the replacement, which moves "
        "through the standard candidate &rarr; rep flow.",
        styles["Body"],
    ))

    story.append(PageBreak())

    # ───── Cross-identity rules ─────────────────────────────────────
    story.append(Paragraph("Cross-Identity Rules", styles["H1"]))

    story.append(Paragraph("Same human, multiple accounts", styles["H2"]))
    story.append(Paragraph(
        "Reps and candidates are humans who also happen to be citizens. A sitting rep can plausibly hold "
        "<b>all three</b> account types at once: their rep account for the office they currently hold, a "
        "candidate account for a different office they&rsquo;re running for, and a citizen account for "
        "engaging on other reps&rsquo; pages. The platform supports this triple-identity case explicitly.",
        styles["Body"],
    ))
    story.append(bullet(
        "<b>Rep account</b> &mdash; for managing the page of their current office, posting, dashboard analytics.", styles))
    story.append(bullet(
        "<b>Candidate account</b> &mdash; required <i>only</i> when running for a <i>different</i> office than "
        "the one they currently hold (e.g. a House rep running for Senate or Governor, a state legislator running "
        "for U.S. House). Incumbents running for <i>re-election</i> to the same office use their existing rep page "
        "as their campaign presence &mdash; no parallel candidate account is created in that case (see Lifecycle "
        "Transitions for the full rule).", styles))
    story.append(bullet(
        "<b>Citizen account</b> &mdash; for engaging on <i>other</i> reps&rsquo; pages as a constituent, voting "
        "in their own district&rsquo;s polls, commenting on bills or executive orders that affect them personally. "
        "Requires ID.me verification like any other citizen.", styles))
    story.append(Paragraph(
        "The three account tables each have independent email uniqueness, so the same email address may be used "
        "across all three. This is intentional &mdash; same person, separate identities serving separate purposes. "
        "When the rep wins the new office they&rsquo;re running for, the candidate account promotes to a new rep "
        "account (per the Candidate &rarr; Representative flow), and their <i>previous</i> rep page archives to "
        "read-only public &mdash; they now hold the new rep account plus their citizen account, with the former "
        "rep page preserved as historical record.",
        styles["Body"],
    ))

    story.append(Paragraph("Session mutual exclusivity", styles["H2"]))
    story.append(Paragraph(
        "The backend permits all three session cookies simultaneously, but the frontend enforces &ldquo;one active "
        "role per browser&rdquo; by tearing down the other two on each login. This avoids visual ambiguity (a single "
        "identity pill in the navbar, one dashboard surface) at the cost of forcing a sign-out + sign-in switch "
        "between roles. Users who need parallel sessions can use a second browser or incognito tab.",
        styles["Body"],
    ))
    story.append(Paragraph(
        "Implementation: <font name='Courier'>_tearDownTwoOtherRoles</font> in <font name='Courier'>lib/pagesApi.js</font> "
        "fires both other-role logout endpoints in parallel before minting the new session.",
        styles["BodyMuted"],
    ))

    story.append(Paragraph("Engagement attribution", styles["H2"]))
    story.append(Paragraph(
        "Each engagement row (reaction, comment, vote) records exactly one of: "
        "<font name='Courier'>citizen_id</font>, <font name='Courier'>author_rep_id</font>, "
        "<font name='Courier'>author_candidate_id</font> &mdash; never two at once. The XOR is enforced at the "
        "route layer (<font name='Courier'>_resolve_engager</font> helper) rather than via a database CHECK, since "
        "SQLite can&rsquo;t cleanly enforce cross-column constraints.",
        styles["Body"],
    ))

    # ───── Open questions / Phase plan ──────────────────────────────
    story.append(Paragraph("Open Questions &amp; Phase Plan", styles["H1"]))
    story.append(Paragraph(
        "Items deferred from the current spec for explicit decision in later phases:",
        styles["Body"],
    ))
    story.append(bullet(
        "<b>Promotion mechanism &mdash; in-place flip vs lock+relink.</b> Both preserve user experience. Decision "
        "deferred until we ship the first candidate-wins-election flow (Phase 6+). Audit-trail vs schema-simplicity tradeoff.", styles))
    story.append(bullet(
        "<b>Subscription pricing + payment integration.</b> The Tier 0/1/2 ladder is locked, but the price point and "
        "billing provider (Stripe, Paddle, etc.) are open. Phase 5 polish.", styles))
    story.append(bullet(
        "<b>Account linking for the same human across roles.</b> Should an ID.me-verified person who has both a "
        "citizen account and a rep account get them linked behind the scenes? Useful for abuse-prevention "
        "audits; orthogonal to UX. Decision punted to post-launch.", styles))
    story.append(bullet(
        "<b>Reactivation of dormant accounts.</b> A defeated candidate or rep running again 2-4 years later &mdash; "
        "do they reactivate their old account or create a new one? Likely &ldquo;reactivate, preserving the archived "
        "page as historical.&rdquo; Phase 7+ once we have actual repeat candidates.", styles))
    story.append(bullet(
        "<b>Specific .gov-email verification flow for reps.</b> The high-level model is settled, the concrete email "
        "verification template + bounce handling is a Phase 5 implementation item.", styles))

    # ───── Implementation status ────────────────────────────────────
    story.append(Paragraph("Implementation Status", styles["H1"]))
    status_rows = [
        ["Phase", "Scope", "Status"],
        ["Self-engagement Phase 1", "Citizen Author badge on own polls", "Shipped"],
        ["Self-engagement Phase 2", "Reps engage as page owners (likes, votes, comments)", "Shipped"],
        ["Self-engagement Phase 3", "Reply threading + two-party rule", "Shipped"],
        ["Candidate Phase 1", "Read-only candidate connectivity", "Shipped"],
        ["Candidate Phase 2", "CandidateAccount model + admin surfaces", "Shipped"],
        ["Candidate Phase 3", "Candidate auth + login modal", "Shipped"],
        ["Candidate Phase 4", "Candidate page composer + dashboard", "In progress"],
        ["Candidate Phase 5", "Notifications + polish + help-build update", "Pending"],
        ["Phase 6+", "ID.me integration + FEC/SOS auto-approval + subscription billing", "Future"],
        ["Phase 7+", "Election-win promotion flow + defeated-account archival", "Future"],
    ]
    story.append(build_table(
        status_rows, styles,
        col_widths=[1.6 * inch, 3.6 * inch, 1.3 * inch],
    ))

    story.append(Spacer(1, 0.2 * inch))
    story.append(Paragraph(
        "&mdash; End of spec &mdash;",
        styles["FooterMeta"],
    ))

    return story


def main():
    out = Path(__file__).resolve().parent / "identity-model.pdf"
    styles = build_styles()
    doc = SimpleDocTemplate(
        str(out),
        pagesize=LETTER,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.75 * inch, bottomMargin=0.75 * inch,
        title="CivicView Identity Model",
        author="Jeffrey Nuez",
    )
    doc.build(build_story(styles))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
