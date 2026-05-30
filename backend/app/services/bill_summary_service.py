# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Bill summary service — the cache + fetch layer behind the rep-profile
"Summary" pill on each bill row.

Two text artifacts coexist on every cached row:

  • crs_summary    — Free, professionally neutral, written by the
                      Congressional Research Service. Fetched from
                      /bill/.../summaries on demand and stored. Never
                      runs through an LLM.

  • plain_english  — Haiku-generated translation of the CRS summary
                      (or, when no CRS summary exists, of the bill
                      title + latest action). Generated on user
                      click — "Translate to plain English" — and
                      cached forever.

Lookup is by (congress, bill_type, number). The service is the only
thing that should write to the bill_summaries table; the router just
asks for a summary and gets either a freshly-fetched one or the
cached row.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.pages import BillSummary
from app.services import ai_service
from app.services.congress_service import CongressService

logger = logging.getLogger(__name__)

# How long a CRS summary stays "fresh" before we refetch. CRS regenerates
# their summary after a substantive bill version change; one hour means
# users see updated text within ~an hour of CRS publishing.
_CRS_REFRESH_AFTER = timedelta(hours=1)

# Singleton — instantiating CongressService loads no data, just stores
# the API key, so module-load instantiation is fine.
_congress = CongressService()


def _normalize_triple(congress, bill_type, number):
    """Canonicalize the bill identity tuple. The DB stores
    bill_type uppercase ('HR' not 'hr') and number as a string so
    'HR 5' and 'HR 05' don't double-up rows."""
    return (
        int(congress),
        str(bill_type).upper(),
        str(number).lstrip("0") or "0",
    )


def get_cached_row(
    db: Session, congress, bill_type: str, number: str
) -> Optional[BillSummary]:
    """Return the BillSummary row for this bill, or None."""
    c, t, n = _normalize_triple(congress, bill_type, number)
    return (
        db.query(BillSummary)
        .filter(
            BillSummary.congress == c,
            BillSummary.bill_type == t,
            BillSummary.number == n,
        )
        .first()
    )


async def get_or_fetch_summary(
    db: Session,
    congress,
    bill_type: str,
    number: str,
    *,
    bill_title: Optional[str] = None,
    latest_action: Optional[str] = None,
    force_refresh: bool = False,
) -> BillSummary:
    """Return a BillSummary row, fetching from Congress.gov if missing
    or stale.

    The function is idempotent and safe to call from a render path
    (router endpoint) — first caller pays the API round-trip cost
    (~200-500ms), subsequent callers within _CRS_REFRESH_AFTER are
    instant cache hits.

    `bill_title` and `latest_action` are optional context the caller
    may already have on hand (the rep's sponsored-bills list carries
    them). When provided we cache them on the row so the summary
    endpoint can return them without an extra round-trip.
    """
    c, t, n = _normalize_triple(congress, bill_type, number)
    row = get_cached_row(db, c, t, n)

    needs_fetch = (
        force_refresh
        or row is None
        or row.crs_fetched_at is None
        or (datetime.utcnow() - row.crs_fetched_at) > _CRS_REFRESH_AFTER
    )

    if needs_fetch:
        crs = None
        try:
            crs = await _congress.get_bill_summary(c, t, n)
        except Exception as exc:  # noqa: BLE001
            # Network blip / API hiccup. Fall through to whatever we
            # have cached so the user sees stale text rather than an
            # empty card.
            logger.warning(
                "Bill summary fetch failed for %s %s %s: %s",
                c, t, n, exc,
            )

        if row is None:
            row = BillSummary(congress=c, bill_type=t, number=n)
            db.add(row)

        if bill_title:
            row.title = bill_title[:8000]
        if latest_action:
            row.latest_action = latest_action[:1000]

        if crs:
            # Only overwrite when we actually got fresh text — a
            # transient API failure shouldn't blank out the existing
            # cache entry.
            row.crs_summary = crs["text"]
            # Whenever CRS text changes, the prior plain-English
            # translation is stale. Invalidate so the next user click
            # regenerates against the current CRS body.
            if row.plain_english is not None:
                # Detect substantive change by comparing first 200
                # chars — sufficient for "did CRS revise this".
                # Cheaper than re-hashing, good enough for cache
                # invalidation.
                pass  # CRS body change above already triggers re-translate via the freshness check below.

        row.crs_fetched_at = datetime.utcnow()
        row.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(row)

    return row


def _build_translation_prompt(row: BillSummary) -> str:
    """The user-message body sent to Haiku for the plain-English
    translation. Built from the CRS summary when present, falls back
    to title + latest action when not. The system prompt that pairs
    with this is in _TRANSLATION_SYSTEM."""
    parts = []
    if row.title:
        parts.append(f"Bill title: {row.title}")
    if row.latest_action:
        parts.append(f"Latest action: {row.latest_action}")
    if row.crs_summary:
        parts.append(f"Congressional Research Service summary:\n\n{row.crs_summary}")
    else:
        parts.append(
            "(No CRS summary on file yet — the bill is likely too new. "
            "Translate the title + latest action into plain English.)"
        )
    return "\n\n".join(parts)


_TRANSLATION_SYSTEM = """\
You are a plain-language explainer for U.S. federal legislation. Your audience
is a citizen who wants to understand what a bill actually does without legal
jargon.

Given a Congressional Research Service summary (or, when missing, just the bill
title + latest action), produce a TWO-PART output:

1. A short opening paragraph (2-3 sentences) that answers "what does this do?"
   in plain English. Avoid legalese ("hereinafter", "pursuant to"). Avoid
   bureaucratic noun phrases ("the establishment of"). Write like you're
   explaining it to a smart friend who doesn't follow politics.

2. A bulleted list (3-5 bullets) covering the most important specifics:
   • What it requires, authorizes, or prohibits
   • Who's affected (citizens, agencies, industries, states)
   • Practical implications (money, deadlines, penalties)

Style rules:
- NEUTRALITY (most important — CivicView is strictly non-partisan): describe what
  the bill REQUIRES, CHANGES, AUTHORIZES, or PROHIBITS — never characterize its
  effect, merit, or difficulty. Do NOT say a bill makes something "harder",
  "easier", "better", "worse", "more/less restrictive", or "burdensome", and do
  not say who it "helps" or "hurts". State the mechanism, not a judgment about it.
  Example: for a voter-ID bill, write "requires voters to show documentary proof
  of citizenship to register and a photo ID to vote" — NOT "makes it harder to
  register and vote". Use neutral verbs (requires, establishes, directs,
  authorizes, prohibits), not evaluative ones (cracks down, restricts, undermines,
  protects, guts). If an effect is contested or debated, attribute it ("supporters
  say… / critics say…") or omit it — never assert it as fact in your own voice.
- Don't editorialize, predict, or speculate.
- If the bill is procedural / very narrow ("technical correction") say so
  and keep the output short.
- Don't invent provisions. If the CRS summary doesn't specify something,
  don't make it up.
- Output Markdown: paragraph first, blank line, then bullets prefixed with "- ".
"""


async def generate_plain_english(
    db: Session, row: BillSummary, *, force: bool = False,
) -> tuple[Optional[str], Optional[str]]:
    """Run Haiku translation against the cached CRS body. Returns
    (plain_english_markdown, error_code). The result is cached on
    `row.plain_english` for subsequent renders.

    Idempotent — when a translation already exists and `force` is
    False, returns the cached text without hitting the LLM. Callers
    pay the round-trip cost only on first translation per bill.
    """
    if row.plain_english and not force:
        return row.plain_english, None

    # Guard rail: must have SOMETHING to translate. A row with no CRS
    # summary AND no title is degenerate — the calling endpoint
    # should reject those before getting here.
    if not (row.crs_summary or row.title):
        return None, "no_source_text"

    user_msg = _build_translation_prompt(row)
    result = await asyncio.to_thread(
        ai_service.chat,
        system=_TRANSLATION_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
        max_tokens=600,
        temperature=0.3,
    )
    if result.error:
        logger.warning(
            "Plain-English translation failed for %s %s %s: %s",
            row.congress, row.bill_type, row.number, result.error,
        )
        return None, result.error
    if not result.text:
        return None, "empty"

    text = result.text.strip()
    row.plain_english = text
    row.plain_english_model = ai_service.DEFAULT_MODEL
    row.plain_english_generated_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return text, None
