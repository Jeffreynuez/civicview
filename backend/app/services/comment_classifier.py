# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Comment classifier — categorizes a single comment using Claude Haiku.

Why this exists:
  The comment-filter UX ("show me funny ones," "show me skeptical ones")
  needs comments to carry structured tags. Doing this at write time
  rather than at filter time has three advantages:
    1. Filtering is then ~free at read time (DB query on indexed cols).
    2. Aggregates ("70% of comments on this post are positive") work.
    3. One classification per comment vs. one per filter request.

Failure model:
  • The classifier is best-effort. If Claude is down / over-budget /
    returns a malformed response, we leave the AI columns NULL on
    that row. The filter endpoint excludes NULLs from tag filters
    but still returns them in the unfiltered list — users always
    see every comment, just not always filterable.
  • Run from a FastAPI BackgroundTask after the comment is committed
    so the request that posted the comment doesn't pay the AI
    latency. Worst case: a comment appears immediately and gets
    tagged ~1s later.

Output shape (parsed JSON from the model):
  {
    "sentiment": "positive" | "neutral" | "negative",
    "tones": ["funny", "supportive", "critical", "informative",
              "skeptical", "personal", "factual", "rhetorical"],
    "intensity": 1-5,
    "topic": "2-4 word gist"
  }

The model is INSTRUCTED to return JSON only — we still defensively
strip code fences and extract the first JSON object if the model
adds preamble. If parsing fails, we log + skip.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.pages import PollComment, PostComment
from app.services import ai_service


logger = logging.getLogger(__name__)

# Constrain the tone vocabulary so the filter endpoint can reason
# about a fixed set. The model picks 0–5 tags from this list — never
# invents new ones (enforced in the prompt; sanitized on parse).
ALLOWED_TONES = (
    "funny",        # joke, witty observation, sarcasm-as-humor
    "supportive",   # agreeing with the post, encouraging the rep
    "critical",     # pushing back, expressing disagreement
    "informative",  # adds facts, sources, context
    "skeptical",    # questioning the data / framing without hostility
    "personal",     # shares a personal experience
    "factual",      # neutral statement of fact
    "rhetorical",   # asks a pointed question without expecting answer
    "angry",        # heated, frustrated
    "civil",        # measured, polite
)

# Hard cap on body length we send to the model. Comments are capped at
# 1000 chars by the DB schema, so this matches. Truncates extra-long
# inputs defensively (shouldn't happen in practice).
MAX_BODY_CHARS = 1000


_SYSTEM_PROMPT = """\
You classify a single user comment for a civic-engagement app.
Return a single JSON object with these exact fields, nothing else:

{
  "sentiment": "positive" | "neutral" | "negative",
  "tones": [up to 5 strings from this exact list: funny, supportive,
            critical, informative, skeptical, personal, factual,
            rhetorical, angry, civil],
  "intensity": integer 1-5 (1 = mild, 5 = very strong),
  "topic": short string (2-4 words) summarizing what the comment is
            about, lowercase, no punctuation
}

Rules:
- Output ONLY the JSON object. No prose, no code fences, no explanation.
- Never invent tones outside the allowed list. Empty list is fine if
  none apply, but try to pick at least one.
- "sentiment" is about the comment's overall attitude toward the post/
  rep/topic — not toward life in general.
- "intensity" reflects how STRONGLY the sentiment is expressed,
  regardless of polarity. A polite disagreement is intensity 2;
  shouting in caps is intensity 5.
- "topic" should be informative ("broadband funding," "rep's vote
  on H.R. 123," "town hall scheduling") not generic ("politics").
"""


def _build_user_message(body: str) -> str:
    """Tiny wrapper so the model knows where the comment starts/ends."""
    return f"Comment to classify:\n<comment>\n{body[:MAX_BODY_CHARS]}\n</comment>"


# Extract the first {...} JSON object from a string. Defensive against
# code fences (```json ... ```) or preamble the model might add despite
# the instructions. We try strict json.loads first, then a regex
# extract as fallback.
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_classification(text: str) -> Optional[Dict[str, Any]]:
    """Parse the model's response into a structured dict. Returns None
    on any parse failure (caller logs and skips the row)."""
    if not text:
        return None
    cleaned = text.strip()
    # Strip code fences if present.
    if cleaned.startswith("```"):
        # Drop the opening fence + optional language tag.
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        # Drop the closing fence.
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)
        cleaned = cleaned.strip()
    # Try strict parse first.
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # Fallback: pull out the first {...} block.
    m = _JSON_BLOCK_RE.search(cleaned)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _normalize(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce the parsed JSON into our column shape with strict types.
    Drops any unrecognized values; clamps numeric ranges."""
    out: Dict[str, Any] = {
        "sentiment": None,
        "tones": "",  # stored as comma-separated string
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
        # Strip punctuation, collapse spaces, cap length.
        t = re.sub(r"[^\w\s-]", "", topic).strip().lower()
        t = re.sub(r"\s+", " ", t)
        out["topic"] = t[:80] if t else None
    return out


def classify_text(body: str) -> Optional[Dict[str, Any]]:
    """Classify a comment body and return a normalized dict, or None on
    any failure. Synchronous — call from a background task, not from a
    request handler that wants to return quickly."""
    body = (body or "").strip()
    if not body:
        return None
    result = ai_service.chat(
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_user_message(body)}],
        max_tokens=200,         # plenty for the JSON object; usually <150
        temperature=0.1,        # near-deterministic — classification, not creative
    )
    if result.error or not result.text:
        logger.info(
            "Comment classifier: skipping (error=%s). Body length=%d.",
            result.error, len(body),
        )
        return None
    parsed = _parse_classification(result.text)
    if parsed is None:
        logger.warning(
            "Comment classifier: failed to parse model output. raw=%r",
            result.text[:500],
        )
        return None
    return _normalize(parsed)


# ── Background-task entry points (called from comment-create routes) ─
def _apply_classification(comment: Any, tags: Dict[str, Any]) -> None:
    """Mutate a comment ORM object with the classified fields. Caller
    handles the commit."""
    comment.ai_sentiment = tags.get("sentiment")
    comment.ai_tones = tags.get("tones") or None
    comment.ai_intensity = tags.get("intensity")
    comment.ai_topic = tags.get("topic")
    comment.ai_classified_at = datetime.utcnow()


def classify_post_comment(comment_id: int) -> None:
    """Background-task entry point for PostComment. Opens its own DB
    session (FastAPI's get_db dependency is request-scoped and isn't
    valid in a background task)."""
    db: Session = SessionLocal()
    try:
        comment = db.query(PostComment).filter(PostComment.id == comment_id).first()
        if not comment or comment.deleted_at is not None:
            return
        tags = classify_text(comment.body)
        if tags is None:
            return
        _apply_classification(comment, tags)
        db.commit()
        logger.info(
            "Classified PostComment %d: sentiment=%s tones=%s topic=%r",
            comment_id, comment.ai_sentiment, comment.ai_tones, comment.ai_topic,
        )
    except Exception:
        logger.exception("classify_post_comment failed for id=%d", comment_id)
        db.rollback()
    finally:
        db.close()


def classify_poll_comment(comment_id: int) -> None:
    """Background-task entry point for PollComment. Mirror of the
    PostComment version."""
    db: Session = SessionLocal()
    try:
        comment = db.query(PollComment).filter(PollComment.id == comment_id).first()
        if not comment or comment.deleted_at is not None:
            return
        tags = classify_text(comment.body)
        if tags is None:
            return
        _apply_classification(comment, tags)
        db.commit()
        logger.info(
            "Classified PollComment %d: sentiment=%s tones=%s topic=%r",
            comment_id, comment.ai_sentiment, comment.ai_tones, comment.ai_topic,
        )
    except Exception:
        logger.exception("classify_poll_comment failed for id=%d", comment_id)
        db.rollback()
    finally:
        db.close()
