# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Post classifier (2026-10-20): the posts sibling of poll_classifier.py.

Tags each rep or candidate post ONCE, after it is created, with the
same sentiment / tones / intensity / topic fields polls carry, so the
/posts AI filter (POST /api/ai/filter-posts) can answer the tone chips
("Positive", "Critical", ...) from stored tags and only call Claude for
free-text prompts. Runs as a FastAPI BackgroundTask; best-effort like
the poll and comment classifiers: on any failure the columns stay NULL.
"""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.pages import Post
from app.services import ai_service
from app.services.poll_classifier import _normalize, _parse_classification


logger = logging.getLogger(__name__)

MAX_INPUT_CHARS = 3000


_SYSTEM_PROMPT = """\
You classify a single post written by an elected official or a
candidate on a civic-engagement app. Return ONE JSON object with these
exact fields, nothing else:

{
  "sentiment": "positive" | "neutral" | "negative",
  "tones": [up to 5 strings from this exact list: funny, supportive,
            critical, informative, skeptical, personal, factual,
            rhetorical, angry, civil],
  "intensity": integer 1-5 (1 = mild, 5 = very strong),
  "topic": short string (2-4 words) summarizing what the post is
           about, lowercase, no punctuation
}

Rules:
- Output ONLY the JSON object. No prose, no code fences.
- Never invent tones outside the allowed list. Empty list is fine if
  none apply, but try to pick at least one.
- Judge the tone of the writing, never the politics. The same tone
  gets the same tags whatever the party or position.
- "topic" should be informative ('broadband funding', 'town hall
  schedule') not generic ('politics').
"""


def classify_post(post_id: int) -> None:
    """Background-task entry point. Classifies the post body and writes
    the ai_* columns. Logs and returns on any failure."""
    db: Session = SessionLocal()
    try:
        post = db.query(Post).filter(Post.id == post_id).first()
        if not post or post.deleted_at is not None or not (post.body or "").strip():
            return
        body = post.body[:MAX_INPUT_CHARS]
        result = ai_service.chat(
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Post to classify:\n<post>\n{body}\n</post>"}],
            max_tokens=200,
            temperature=0.1,
        )
        if result.error or not result.text:
            logger.info("Post classifier: skipping id=%d (error=%s).", post_id, result.error)
            return
        parsed = _parse_classification(result.text)
        if parsed is None:
            logger.warning(
                "Post classifier: failed to parse output for id=%d. raw=%r",
                post_id, result.text[:300],
            )
            return
        tags = _normalize(parsed)
        post.ai_sentiment = tags.get("sentiment")
        post.ai_tones = tags.get("tones") or None
        post.ai_intensity = tags.get("intensity")
        post.ai_topic = tags.get("topic")
        post.ai_classified_at = datetime.utcnow()
        db.commit()
        logger.info(
            "Classified Post %d: sentiment=%s tones=%s topic=%r",
            post_id, post.ai_sentiment, post.ai_tones, post.ai_topic,
        )
    except Exception:
        logger.exception("classify_post failed for id=%d", post_id)
        db.rollback()
    finally:
        db.close()
