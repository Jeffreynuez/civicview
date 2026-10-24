# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Plain-English explanations of ballot measures (2026-10-24).

People said the official wording of some ballot measures is hard to follow.
The Elections tab's ballot measure cards get the same kind of AI explainer
bills already have: the first "Explain in plain English" tap writes one from
the measure's official text with Claude Sonnet, it is saved, and everyone
after sees the saved text.

Only the official text in the curated elections data goes to the model
(the ballot title and summary, the threshold, who placed it on the ballot
and the financial impact statement when there is one). Nothing a caller
sends is used. The saved row remembers a hash of that text, so if the data
file's wording changes the old explanation stops showing and the next tap
writes a new one.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.pages import BallotMeasureExplanation
from app.services import ai_service

logger = logging.getLogger(__name__)


def source_text(measure: dict) -> str:
    """The official text the explanation is written from, as one block.
    Every line comes from the measure's record in the elections data."""
    parts: list[str] = []
    where = measure.get("state_name") or measure.get("state") or ""
    if measure.get("level") != "state" and measure.get("county"):
        where = f"{measure['county']} County, {where}".strip(", ")
    if where:
        parts.append(f"Where it is on the ballot: {where}")
    name = " ".join(x for x in (measure.get("number"), measure.get("title")) if x)
    if name:
        parts.append(f"Measure: {name}")
    if measure.get("type"):
        parts.append(f"Type: {measure['type']}")
    if measure.get("official_ballot_title"):
        parts.append(f"Official ballot title: {measure['official_ballot_title']}")
    if measure.get("summary"):
        label = measure.get("summary_label") or "Official ballot summary"
        parts.append(f"{label}:\n{measure['summary']}")
    if measure.get("threshold"):
        parts.append(f"Votes needed to pass: {measure['threshold']} of the votes cast on it")
    if measure.get("origin"):
        parts.append(f"How it got on the ballot: {measure['origin']}")
    fis = measure.get("financial_impact_statement")
    if fis:
        parts.append(f"Official financial impact statement:\n{fis}")
    return "\n\n".join(parts)


# Sonnet, not the Haiku default the bill summaries use. In testing on the
# three Florida measures (2026-10-24), Haiku added conditions the ballot
# text doesn't have (an invented "declared state of emergency" exception),
# turned "agricultural products" into "growing", and dropped "non-school
# taxes"; Sonnet kept to the text in every run. Each measure is written
# once per wording and saved, so this costs about a cent per measure.
MODEL = "claude-sonnet-4-5-20250929"

# Part of the saved hash with MODEL: raising it makes every saved
# explanation stale, so the next tap on each measure writes it again.
PROMPT_VERSION = "2026-10-24.3"


def source_hash(text: str) -> str:
    return hashlib.sha256(f"{PROMPT_VERSION}|{MODEL}\n{text}".encode("utf-8")).hexdigest()


_NUMBER_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?%?")


def _numbers(text: str) -> set[str]:
    """Every number in the text, as written but without thousands commas
    or a trailing period ("$750", "25%", "2027", "150000")."""
    out = set()
    for raw in _NUMBER_RE.findall(text or ""):
        n = raw.replace(",", "").rstrip(".")
        out.add(n)
        out.add(n.lstrip("$").rstrip("%"))
    return out


def unsupported_numbers(explanation: str, official: str) -> set[str]:
    """Numbers in the explanation that the official text doesn't have.
    An explanation with any is not saved: a wrong figure on a ballot
    measure is the one mistake this feature must not make."""
    have = _numbers(official)
    return {n for n in _numbers(explanation) if n not in have and n.lstrip("$").rstrip("%") not in have}


# Explanations Jeffrey read before they went live (2026-10-24: the three
# Florida 2026 amendments). Each is used only while the measure's official
# text, the prompt version and the model still match its source_hash, so
# a reviewed one can never sit under wording it wasn't written from.
_REVIEWED_PATH = Path(__file__).resolve().parent.parent / "data" / "ballot_measure_explanations.json"


@lru_cache(maxsize=1)
def _reviewed() -> dict:
    try:
        with _REVIEWED_PATH.open("r", encoding="utf-8") as fh:
            return {e["measure_id"]: e for e in json.load(fh).get("explanations", [])}
    except (OSError, ValueError, KeyError) as e:
        logger.warning("Reviewed ballot measure explanations not loaded: %s", e)
        return {}


def cached(db: Session, measure: dict):
    """The explanation for this measure's current official text: the saved
    row, else a reviewed one shipped with the data, else None."""
    h = source_hash(source_text(measure))
    row = (
        db.query(BallotMeasureExplanation)
        .filter(BallotMeasureExplanation.measure_id == measure["id"])
        .first()
    )
    if row is not None and row.source_hash == h:
        return row
    e = _reviewed().get(measure["id"])
    if e and e.get("source_hash") == h and e.get("plain_english"):
        return SimpleNamespace(
            plain_english=e["plain_english"],
            plain_english_model=e.get("model"),
            generated_at=datetime.fromisoformat(e["generated_at"]) if e.get("generated_at") else None,
        )
    return None


_SYSTEM = """\
You explain ballot measures to voters in plain English. CivicView is strictly
non-partisan: your job is to make the official wording easy to understand,
never to help anyone decide how to vote.

You get the measure's official text: its title, the official ballot summary,
how many votes it needs, how it got on the ballot, and sometimes an official
financial impact statement. Write this, in this order:

1. One short paragraph (2 or 3 sentences) saying what the measure would do,
   in everyday words.

2. Two to five bullets with the specifics: what changes, the numbers and
   limits, who decides or acts, timing and exceptions. Start each bullet
   with "- ". When the text gives the votes needed to pass, the last bullet
   is exactly: "- It needs <that share> of the votes cast on it to pass."

3. Exactly these two lines, last:
   **A Yes vote means:** what happens if the measure passes, in one sentence.
   **A No vote means:** what happens if it does not pass, in one sentence. If
   the official text names the current rule (for example "from 10% to 25%"),
   say that rule stays. If it doesn't, say the current rules stay as they
   are, without guessing what they are.

Rules:
- NEUTRALITY comes first. Describe what the measure REQUIRES, CHANGES,
  ALLOWS or PROHIBITS. Never say it is good or bad, helps or hurts anyone,
  makes things easier or harder, or is a reform, a power grab, a protection
  or a loophole. Never tell the reader how to vote or what to consider.
- ACCURACY: use only the official text you are given. Do not add
  background, history, purposes, arguments for or against, who supports or
  opposes it, examples, or predictions of its effects (on taxes, prices,
  services or anything else). If the official financial impact statement is
  given, you may say what it states, attributed to it ("The official
  financial impact statement says..."). If something isn't in the text,
  leave it out.
- Keep every limit and condition. If the text says something applies only
  to some taxes, some property, some people or some years, say so every time
  you mention it. Never narrow or widen a term: "agricultural products" is
  not "crops", and a cap on assessment increases is not a cap on tax
  increases. Keep numbers, dates and names exactly as the text gives them.
- Call funds, programs and offices by the names the text uses ("the budget
  stabilization fund"), never by a description of your own ("a savings
  fund", "an emergency fund", "a rainy day fund"), and don't say what
  something is for or how it works beyond what the text says. You may
  explain a legal term in everyday words (for example, "ad valorem taxes"
  are property taxes).
- Keep the text's own words for what is covered and what is done. If it
  says "used in the production of agricultural products", don't change it
  to "used for growing" or "farming". Simpler words are for the sentences
  around those terms, not for the terms themselves.
- Plain words, short sentences, about an 8th grade reading level. No
  legalese. Commas and periods instead of dashes.
- Markdown only as described: the paragraph, a blank line, the bullets, a
  blank line, the two vote lines. No headings, no other bold.
"""


async def generate(db: Session, measure: dict) -> tuple[Optional[BallotMeasureExplanation], Optional[str]]:
    """The saved explanation for the measure's current official text,
    writing it first when there isn't one. Returns (row, error_code);
    error_code is ai_service's ('not_configured', 'budget_exceeded', ...),
    'no_source_text', 'empty' or 'unsupported_numbers' (two tries both
    had a figure the official text doesn't)."""
    row = cached(db, measure)
    if row is not None:
        return row, None
    if not measure.get("summary") and not measure.get("official_ballot_title"):
        return None, "no_source_text"

    text = source_text(measure)
    explanation = None
    for attempt in range(2):
        result = await asyncio.to_thread(
            ai_service.chat,
            system=_SYSTEM,
            messages=[{"role": "user", "content": text}],
            max_tokens=700,
            model=MODEL,
            temperature=0.1 if attempt == 0 else 0.0,
        )
        if result.error:
            logger.warning("Ballot measure explanation failed for %s: %s", measure.get("id"), result.error)
            return None, result.error
        candidate = (result.text or "").strip()
        if not candidate:
            return None, "empty"
        extra = unsupported_numbers(candidate, text)
        if not extra:
            explanation = candidate
            break
        logger.warning("Ballot measure explanation for %s had numbers not in the official text: %s",
                       measure.get("id"), sorted(extra))
    if explanation is None:
        return None, "unsupported_numbers"

    existing = (
        db.query(BallotMeasureExplanation)
        .filter(BallotMeasureExplanation.measure_id == measure["id"])
        .first()
    )
    row = existing or BallotMeasureExplanation(measure_id=measure["id"])
    row.source_hash = source_hash(text)
    row.plain_english = explanation
    row.plain_english_model = MODEL
    row.generated_at = datetime.utcnow()
    if existing is None:
        db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Two first taps at once: the other one saved first. Use its row.
        db.rollback()
        row = cached(db, measure)
        return (row, None) if row is not None else (None, "empty")
    db.refresh(row)
    return row, None
