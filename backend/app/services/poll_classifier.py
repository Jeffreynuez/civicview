# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Poll classifier — sibling of comment_classifier.py for the Poll
model. Same hybrid pattern: classify each poll ONCE at write time
via Claude Haiku and store the structured tags on the row, so
filter requests on /polls can route to cheap SQL for the common
intents (sentiment, tone, topic) and only hit Claude for free-form
queries that don't map to existing tags.

Run from a FastAPI BackgroundTask after the poll is committed so
the user posting the poll doesn't pay the AI latency. Failures
are best-effort — a missing tag set just means the poll won't
match tag-based filters but it'll still appear in the unfiltered
feed.

What we classify on:
  Poll.question + the option labels concatenated. A poll's
  classification meaningfully reflects what it's ASKING, not the
  vote distribution (which arrives later and shifts over time).
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.pages import Poll, PollOption
from app.services import ai_service


logger = logging.getLogger(__name__)

# Same tone vocabulary as comment_classifier so filter prompts work
# uniformly across both comment threads and the polls feed.
ALLOWED_TONES = (
    "funny",
    "supportive",
    "critical",
    "informative",
    "skeptical",
    "personal",
    "factual",
    "rhetorical",
    "angry",
    "civil",
)

MAX_INPUT_CHARS = 2000


_SYSTEM_PROMPT = """\
You classify a single user-submitted poll for a civic-engagement
app. Return ONE JSON object with these exact fields, nothing else:

{
  "sentiment": "positive" | "neutral" | "negative",
  "tones": [up to 5 strings from this exact list: funny, supportive,
            critical, informative, skeptical, personal, factual,
            rhetorical, angry, civil],
  "intensity": integer 1-5 (1 = mild, 5 = very strong),
  "topic": short string (2-4 words) summarizing what the poll is
           about, lowercase, no punctuation
}

Rules:
- Output ONLY the JSON object. No prose, no code fences.
- Never invent tones outside the allowed list. Empty list is fine if
  none apply, but try to pick at least one.
- "sentiment" reflects the framing of the question/options, not the
  underlying topic. A factual poll about a divisive topic is
  'neutral'; a leading question framed accusatively is 'negative';
  an enthusiastic "do you support X?" is 'positive'.
- "intensity" reflects how strongly the framing leans. A neutral
  factual poll is 1-2; an accusatory or pleading framing is 5.
- "topic" should be informative ('broadband funding', 'rep's vote
  on H.R. 123', 'town hall scheduling') not generic ('politics').
"""


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _build_user_message(poll: Poll, options: List[PollOption]) -> str:
    """Concatenate poll question + option labels. Truncated to
    MAX_INPUT_CHARS so a malicious 500-option poll can't bloat the
    Claude call."""
    parts = [f"Question: {poll.question}"]
    for i, opt in enumerate(options or []):
        parts.append(f"Option {i + 1}: {opt.text}")
    body = "\n".join(parts)
    return f"Poll to classify:\n<poll>\n{body[:MAX_INPUT_CHARS]}\n</poll>"


def _parse_classification(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```\s*$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    m = _JSON_BLOCK_RE.search(cleaned)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _normalize(parsed: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "sentiment": None,
        "tones": "",
        "intensity": None,
        "topic": None,
    }
    sentiment = parsed.get("sentiment")
    if isinstance(sentiment, str) and sentiment.lower() in {"positive", "neutral", "negative"}:
        out["sentiment"] = sentiment.lower()
    raw_tones = parsed.get("tones") or []
    if isinstance(raw_tones, list):
        kept: List[str] = []
        for t in raw_tones:
            if not isinstance(t, str):
                continue
            tl = t.strip().lower()
            if tl in ALLOWED_TONES and tl not in kept:
                kept.append(tl)
            if len(kept) >= 5:
                break
        out["tones"] = ",".join(kept) if kept else ""
    intensity = parsed.get("intensity")
    if isinstance(intensity, (int, float)):
        out["intensity"] = max(1, min(5, int(intensity)))
    topic = parsed.get("topic")
    if isinstance(topic, str) and topic.strip():
        t = re.sub(r"[^\w\s-]", "", topic).strip().lower()
        t = re.sub(r"\s+", " ", t)
        out["topic"] = t[:80] if t else None
    return out


def classify_poll(poll_id: int) -> None:
    """Background-task entry point. Looks up the poll + its options,
    classifies via Claude, writes the ai_* columns + ai_classified_at.
    Best-effort; logs and bails on any failure."""
    db: Session = SessionLocal()
    try:
        poll = db.query(Poll).filter(Poll.id == poll_id).first()
        if not poll or poll.archived_at is not None:
            return
        options = (
            db.query(PollOption)
            .filter(PollOption.poll_id == poll_id)
            .order_by(PollOption.sort_order)
            .all()
        )
        result = ai_service.chat(
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": _build_user_message(poll, options)}],
            max_tokens=200,
            temperature=0.1,
        )
        if result.error or not result.text:
            logger.info(
                "Poll classifier: skipping id=%d (error=%s).",
                poll_id, result.error,
            )
            return
        parsed = _parse_classification(result.text)
        if parsed is None:
            logger.warning(
                "Poll classifier: failed to parse output for id=%d. raw=%r",
                poll_id, result.text[:300],
            )
            return
        tags = _normalize(parsed)
        poll.ai_sentiment = tags.get("sentiment")
        poll.ai_tones = tags.get("tones") or None
        poll.ai_intensity = tags.get("intensity")
        poll.ai_topic = tags.get("topic")
        poll.ai_classified_at = datetime.utcnow()
        db.commit()
        logger.info(
            "Classified Poll %d: sentiment=%s tones=%s topic=%r",
            poll_id, poll.ai_sentiment, poll.ai_tones, poll.ai_topic,
        )
    except Exception:
        logger.exception("classify_poll failed for id=%d", poll_id)
        db.rollback()
    finally:
        db.close()
