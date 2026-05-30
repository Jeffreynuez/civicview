# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Executive-order summary service — Haiku-powered plain-English
translation of an EO's Federal Register abstract.

Why no abstract cache: the Federal Register API exposes the
`abstract` field on every EO record. The frontend already receives
it as part of /api/federal-officials/executive-orders. Storing it
again would duplicate fresh upstream data for no benefit. Only the
Haiku translation gets persisted here — that's the only thing we
need to pay LLM cost for.

Lookup is by Federal Register `document_number` (e.g. "2025-12345").
Document numbers are immutable post-publication, so the cached
translation is valid forever.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.pages import EoSummary
from app.services import ai_service

logger = logging.getLogger(__name__)


def get_cached_row(db: Session, document_number: str) -> Optional[EoSummary]:
    """Return the cached row for this EO, or None."""
    if not document_number:
        return None
    return (
        db.query(EoSummary)
        .filter(EoSummary.document_number == document_number)
        .first()
    )


_TRANSLATION_SYSTEM = """\
You are a plain-language explainer for U.S. presidential actions. Your audience
is a citizen who wants to understand what an executive order actually does
without legal jargon.

Given an executive order's title + the Federal Register abstract (and, when
the abstract is missing, just the title), produce a TWO-PART output:

1. A short opening paragraph (2-3 sentences) that answers "what does this
   order do?" in plain English. Avoid legalese ("hereby", "pursuant to
   the authority vested in me"). Avoid bureaucratic noun phrases
   ("the establishment of"). Write like you're explaining it to a smart
   friend who doesn't follow politics.

2. A bulleted list (3-5 bullets) covering the most important specifics:
   • What it orders federal agencies to do
   • Who's affected (citizens, agencies, industries, foreign governments)
   • Practical implications (deadlines, dollar figures, reporting requirements)

Style rules:
- NEUTRALITY (most important — CivicView is strictly non-partisan): describe what
  the order DIRECTS, CHANGES, AUTHORIZES, or REVOKES — never characterize its
  effect, merit, or difficulty. Do NOT say it makes something "harder", "easier",
  "better", "worse", "more/less restrictive", or "burdensome", and do not say who
  it "helps" or "hurts". State the mechanism, not a judgment about it. Use neutral
  verbs (directs, establishes, authorizes, revokes, requires), not evaluative ones
  (cracks down, guts, undermines, protects). If an effect is contested, attribute
  it ("supporters say… / critics say…") or omit it — never assert it as fact.
- Don't editorialize, predict, or speculate about motives.
- If the abstract doesn't specify something, write "Not specified in the
  abstract" rather than inventing details.
- If the order is procedural / very narrow ("technical correction") say so
  and keep the output short.
- Output Markdown: paragraph first, blank line, then bullets prefixed with "- ".
"""


def _build_translation_prompt(title: Optional[str], abstract: Optional[str]) -> str:
    """Compose the user message body. We always include the title;
    the abstract goes in when present (which it usually is — Federal
    Register populates it for almost every published EO)."""
    parts = []
    if title:
        parts.append(f"Executive order title: {title}")
    if abstract:
        parts.append(f"Federal Register abstract:\n\n{abstract}")
    else:
        parts.append(
            "(No abstract on file — Federal Register hasn't published one yet "
            "for this order. Translate from the title alone, and be explicit "
            "about which specifics aren't in the available record.)"
        )
    return "\n\n".join(parts)


async def generate_plain_english(
    db: Session,
    *,
    document_number: str,
    title: Optional[str] = None,
    eo_number: Optional[str] = None,
    abstract: Optional[str] = None,
    force: bool = False,
) -> tuple[Optional[str], Optional[str]]:
    """Run Haiku translation against the EO's abstract (or title alone).
    Returns (plain_english_markdown, error_code).

    Idempotent — when a translation already exists for this
    document_number and `force` is False, returns the cached text
    without hitting the LLM. First caller pays the ~$0.001 Haiku
    cost; everyone after gets it free.
    """
    if not document_number:
        return None, "missing_document_number"
    if not (title or abstract):
        return None, "no_source_text"

    row = get_cached_row(db, document_number)
    if row and row.plain_english and not force:
        return row.plain_english, None

    user_msg = _build_translation_prompt(title, abstract)
    result = await asyncio.to_thread(
        ai_service.chat,
        system=_TRANSLATION_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
        max_tokens=600,
        temperature=0.3,
    )
    if result.error:
        logger.warning(
            "EO plain-English translation failed for %s: %s",
            document_number, result.error,
        )
        return None, result.error
    if not result.text:
        return None, "empty"

    text = result.text.strip()
    now = datetime.utcnow()
    if row is None:
        row = EoSummary(document_number=document_number)
        db.add(row)
    if title:
        row.title = title[:8000]
    if eo_number:
        row.eo_number = str(eo_number)[:16]
    row.plain_english = text
    row.plain_english_model = ai_service.DEFAULT_MODEL
    row.plain_english_generated_at = now
    row.updated_at = now
    db.commit()
    db.refresh(row)
    return text, None
