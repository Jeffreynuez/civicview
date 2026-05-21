"""Generate the Benefit Corp formation reference PDF.

Output: docs/civicview_benefit_corp_filing.pdf

Contents:
  1. Three-length business descriptions (short / medium / long)
     for various form fields the user will encounter.
  2. The 'ARTICLE — BENEFIT CORPORATION STATUS' language to paste
     into Sunbiz's Optional Provisions text area when filing the
     Florida Profit Corporation Articles of Incorporation.
"""
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, PageBreak, KeepTogether,
)


OUT_PATH = Path(__file__).resolve().parent / "civicview_benefit_corp_filing.pdf"


def build_styles():
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=22, leading=26, alignment=TA_LEFT,
            textColor=colors.HexColor("#1F3A52"), spaceAfter=4,
        ),
        "subtitle": ParagraphStyle(
            "subtitle", parent=base["Normal"], fontName="Helvetica",
            fontSize=11, leading=15, textColor=colors.HexColor("#5F5E5A"),
            spaceAfter=20,
        ),
        "h1": ParagraphStyle(
            "h1", parent=base["Heading1"], fontName="Helvetica-Bold",
            fontSize=15, leading=20, textColor=colors.HexColor("#1F3A52"),
            spaceBefore=18, spaceAfter=6,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=11.5, leading=15, textColor=colors.HexColor("#2C2C2A"),
            spaceBefore=12, spaceAfter=4,
        ),
        "label": ParagraphStyle(
            "label", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=8.5, leading=11, textColor=colors.HexColor("#5F5E5A"),
            spaceAfter=2,
        ),
        "body": ParagraphStyle(
            "body", parent=base["Normal"], fontName="Helvetica",
            fontSize=10.5, leading=14.5, textColor=colors.HexColor("#1A1A1A"),
            spaceAfter=8,
        ),
        "note": ParagraphStyle(
            "note", parent=base["Normal"], fontName="Helvetica-Oblique",
            fontSize=9.5, leading=13, textColor=colors.HexColor("#5F5E5A"),
            spaceAfter=12,
        ),
        "code": ParagraphStyle(
            "code", parent=base["Code"], fontName="Courier",
            fontSize=9, leading=12.5, textColor=colors.HexColor("#1A1A1A"),
            leftIndent=10, rightIndent=10, spaceAfter=6,
            backColor=colors.HexColor("#F6F7F9"),
            borderColor=colors.HexColor("#E0E0E0"), borderWidth=0.5,
            borderPadding=8,
        ),
        "boxed_desc": ParagraphStyle(
            "boxed_desc", parent=base["Normal"], fontName="Helvetica",
            fontSize=10.5, leading=15, textColor=colors.HexColor("#1A1A1A"),
            leftIndent=12, rightIndent=12, spaceAfter=4,
            backColor=colors.HexColor("#F8F9FB"),
            borderColor=colors.HexColor("#D4DAE2"), borderWidth=0.5,
            borderPadding=10,
        ),
        "footer": ParagraphStyle(
            "footer", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.5, leading=11, textColor=colors.HexColor("#888"),
            spaceBefore=20,
        ),
    }
    return styles


# ─────────────────────────────────────────────────────────────────────
# Content
# ─────────────────────────────────────────────────────────────────────

ULTRA_SHORT = (
    "CivicView is a civic-engagement platform that surfaces what U.S. "
    "elected officials publicly say and do, and lets verified constituents "
    "respond in their own districts."
)

MEDIUM = (
    "CivicView is a civic-engagement software platform serving U.S. residents. "
    "We aggregate publicly-available data on elected officials at the federal, "
    "state, and local level &mdash; voting records, public statements, bill "
    "sponsorships &mdash; and provide subscribers with tools to track, engage "
    "with, and respond to their elected representatives. The platform is "
    "non-partisan and does not endorse any candidate, party, or position. "
    "Revenue comes from a $5/month consumer subscription. Users include "
    "citizens, verified representatives, and declared candidates."
)

LONG = (
    "CivicView is a civic-technology company providing a non-partisan platform "
    "that strengthens the connection between U.S. residents and their elected "
    "officials. The platform surfaces publicly-available data on federal, "
    "state, and local representatives &mdash; voting records, public "
    "statements, sponsored legislation, and official actions &mdash; and "
    "provides subscribers with tools to track those officials, respond to "
    "their positions through structured polls and comments, and verify their "
    "own identity as constituents. CivicView is editorially neutral by design: "
    "we do not endorse candidates, parties, or positions, and our content "
    "moderation policies enforce that stance across the platform. Our mission "
    "is to lower the cost of informed civic engagement for ordinary citizens "
    "while preserving the integrity of public discourse."
)

ARTICLE_TEXT = """ARTICLE &mdash; BENEFIT CORPORATION STATUS<br/><br/>The corporation is a benefit corporation under sections 607.5005 through 607.5008 of the Florida Statutes. The corporation has elected benefit corporation status to pursue, in addition to the purpose of engaging in any lawful business activity, the general public benefit of creating a material positive impact on society and the environment, taken as a whole, through its business operations.<br/><br/>The specific public benefit purposes of the corporation are:<br/><br/>(a) To strengthen the connection between U.S. residents and their elected representatives by providing free, non-partisan access to publicly-available information about those officials' actions, votes, and stated positions; and<br/><br/>(b) To promote informed civic engagement and democratic participation by providing tools that enable verified constituents to respond to, track, and engage with the elected officials who represent them, on an editorially neutral platform that does not endorse any candidate, party, or political position.<br/><br/>In addition to the duties set forth in section 607.0830, Florida Statutes, the directors of the corporation shall, in discharging their duties, consider the effects of any action or inaction on:<br/><br/>&nbsp;&nbsp;(i) the shareholders of the corporation;<br/>&nbsp;&nbsp;(ii) the employees and workforce of the corporation;<br/>&nbsp;&nbsp;(iii) the interests of customers and other persons benefiting from the public-benefit purposes stated above;<br/>&nbsp;&nbsp;(iv) community and societal factors, including those of each community in which the corporation has offices or operations;<br/>&nbsp;&nbsp;(v) the local and global environment;<br/>&nbsp;&nbsp;(vi) the short-term and long-term interests of the corporation, including benefits that may accrue from its long-term plans and the possibility that those interests may be best served by the continued independence of the corporation; and<br/>&nbsp;&nbsp;(vii) the ability of the corporation to accomplish its public-benefit purposes."""


def build():
    doc = SimpleDocTemplate(
        str(OUT_PATH),
        pagesize=LETTER,
        leftMargin=0.85 * inch, rightMargin=0.85 * inch,
        topMargin=0.7 * inch, bottomMargin=0.7 * inch,
        title="CivicView - Benefit Corp Formation Reference",
        author="CivicView",
    )
    s = build_styles()
    story = []

    # ── Header ────────────────────────────────────────────────────
    story.append(Paragraph("CivicView", s["title"]))
    story.append(Paragraph(
        "Benefit Corporation formation reference &mdash; business descriptions "
        "and Sunbiz Articles of Incorporation language.",
        s["subtitle"],
    ))

    # ── Section 1: Business descriptions ──────────────────────────
    story.append(Paragraph("1. Business descriptions", s["h1"]))
    story.append(Paragraph(
        "Three lengths for different signup forms. Pick the one that fits "
        "the field length you're filling out.",
        s["note"],
    ))

    # Short
    story.append(KeepTogether([
        Paragraph("ULTRA-SHORT", s["label"]),
        Paragraph(
            "For Sunbiz's optional &quot;Specific Purpose&quot; field, "
            "GoFundMe one-liner, business bank application.",
            s["note"],
        ),
        Paragraph(ULTRA_SHORT, s["boxed_desc"]),
    ]))
    story.append(Spacer(1, 8))

    # Medium
    story.append(KeepTogether([
        Paragraph("MEDIUM", s["label"]),
        Paragraph(
            "For &quot;Business Activity&quot; or &quot;Description&quot; "
            "fields on most signup forms &mdash; Stripe, Mercury, Postmark, "
            "etc.",
            s["note"],
        ),
        Paragraph(MEDIUM, s["boxed_desc"]),
    ]))
    story.append(Spacer(1, 8))

    # Long
    story.append(KeepTogether([
        Paragraph("LONGER", s["label"]),
        Paragraph(
            "For the Florida Benefit Corp public-benefit-purpose section, "
            "investor pitches, grant applications.",
            s["note"],
        ),
        Paragraph(LONG, s["boxed_desc"]),
    ]))

    story.append(PageBreak())

    # ── Section 2: Article — Benefit Corporation Status ───────────
    story.append(Paragraph(
        "2. Article &mdash; Benefit Corporation Status",
        s["h1"],
    ))
    story.append(Paragraph(
        "Paste the text below into Sunbiz's <b>Optional Provisions</b> or "
        "<b>Article Other Provisions</b> text area when filing the Florida "
        "Profit Corporation Articles of Incorporation. This language "
        "establishes Benefit Corporation status under Florida Statutes "
        "sections 607.5005-607.5008.",
        s["body"],
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph(ARTICLE_TEXT, s["code"]))

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "<b>Why this language matters:</b> Florida doesn't have a separate "
        "&quot;Benefit Corporation&quot; filing form. You file as a regular "
        "Profit Corporation, then add this article to the AOI. The language "
        "above satisfies the three statutory requirements: (1) explicit "
        "election of Benefit Corp status, (2) at least one specific public "
        "benefit purpose, (3) director consideration duties.",
        s["body"],
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Post-formation obligations:</b> Once incorporated, you'll need "
        "to (a) prepare an Annual Benefit Report describing how CivicView "
        "pursued its public-benefit purposes &mdash; made publicly available "
        "on your website, not filed with the state; and (b) document director "
        "consideration of the seven factors above in board meeting minutes "
        "once you have a board.",
        s["body"],
    ))

    # ── Footer ────────────────────────────────────────────────────
    story.append(Paragraph(
        f"Generated {date.today().isoformat()} &middot; "
        f"Companion to docs/LEGAL-REVIEW-ROADMAP.md.",
        s["footer"],
    ))

    doc.build(story)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    build()
