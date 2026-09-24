# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Threat / incitement moderation SERVICE (Task #41, Phase 0 — shadow mode).

assess() runs one piece of content through the rubric (moderation_policy)
via ai_service.chat(), parses the verdict, derives a decision, and writes
a ContentModerationVerdict audit row.

PHASE 0 = SHADOW MODE (moderation_policy.SHADOW_MODE): verdicts are
recorded but NO content state changes — nothing is hidden. _apply_decision
is where Phase 1+ will wire the actual hide_reason action; it's a no-op
while SHADOW_MODE is True.

Fail-open by construction: if the AI is unconfigured / rate-limited / over
the daily spend cap, or returns unparseable output, we record a 'skipped'
verdict and move on. AI availability NEVER blocks civic participation, and
this is always invoked from a BackgroundTask so it's off the request path.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.pages import ContentModerationVerdict
from app.services import ai_service
from app.services import moderation_policy as policy

logger = logging.getLogger(__name__)

_VALID_CONTENT_TYPES = {"post", "poll", "post_comment", "poll_comment"}


def _parse_verdict(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """Parse the model's JSON verdict defensively. Returns None if the
    output isn't a usable verdict (caller treats that as 'skipped')."""
    if not raw:
        return None
    t = raw.strip()
    # Strip markdown code fences if the model wrapped the JSON.
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t).strip()
    # Grab the first {...} object.
    m = re.search(r"\{.*\}", t, re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return None
    category = obj.get("category")
    if category not in policy.CATEGORIES:
        return None
    try:
        severity = float(obj.get("severity", 0.0))
    except (TypeError, ValueError):
        severity = 0.0
    severity = max(0.0, min(1.0, severity))
    rationale = obj.get("rationale")
    span = obj.get("offending_span")
    return {
        "category": category,
        "severity": severity,
        "rationale": (str(rationale)[:500] if rationale else None),
        "offending_span": (str(span)[:500] if span else None),
    }


def _record(
    db: Session, *, content_type: str, content_id: int,
    author_kind: Optional[str], author_id: Optional[int],
    category: str, severity: float, decision: str,
    rationale: Optional[str], offending_span: Optional[str],
    model: Optional[str],
) -> Dict[str, Any]:
    v = ContentModerationVerdict(
        content_type=content_type,
        content_id=content_id,
        author_kind=author_kind,
        author_id=author_id,
        category=category,
        severity=severity,
        decision=decision,
        rationale=rationale,
        offending_span=offending_span,
        model=model,
        policy_version=policy.POLICY_VERSION,
    )
    db.add(v)
    db.commit()
    return {
        "id": v.id, "category": category, "severity": severity,
        "decision": decision, "policy_version": policy.POLICY_VERSION,
    }


def _apply_decision(db: Session, *, content_type: str, content_id: int, decision: str) -> None:
    """Apply a moderation decision to the content row.

    PHASE 0: no-op (shadow mode). Phase 1+ will, when
    moderation_policy.SHADOW_MODE is False, set hide_reason='threat_hidden'
    on auto_hide and surface flag/auto_hide verdicts in the admin queue.
    Intentionally left unimplemented until the eval set + attorney review
    sign off on acting on verdicts (PRD §11).
    """
    return None


def assess(
    db: Session, *,
    content_type: str,
    content_id: int,
    text: str,
    author_kind: Optional[str] = None,
    author_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Assess one piece of content. Records a verdict; never raises.

    In shadow mode (default), records only — no content state changes.
    Returns a small dict describing the recorded verdict.
    """
    if content_type not in _VALID_CONTENT_TYPES:
        logger.warning("moderation: unknown content_type %r", content_type)
        content_type = content_type or "post"

    body = (text or "").strip()
    if not body:
        return _record(
            db, content_type=content_type, content_id=content_id,
            author_kind=author_kind, author_id=author_id,
            category="none", severity=0.0, decision="skipped",
            rationale="empty content", offending_span=None, model=None,
        )

    res = ai_service.chat(
        system=policy.SYSTEM_PROMPT,
        messages=[{"role": "user", "content": policy.user_prompt(body)}],
        max_tokens=300,
        temperature=0.0,
        # Moderation draws on the reserved share of the daily AI cap, so
        # heavy use of the public AI features cannot switch it off.
        reserved=True,
    )
    if res.error or not res.text:
        # Fail-open: log a 'skipped' verdict (could be batch re-checked later).
        return _record(
            db, content_type=content_type, content_id=content_id,
            author_kind=author_kind, author_id=author_id,
            category="none", severity=0.0, decision="skipped",
            rationale=f"ai_unavailable:{res.error or 'no_text'}",
            offending_span=None, model=None,
        )

    parsed = _parse_verdict(res.text)
    if parsed is None:
        return _record(
            db, content_type=content_type, content_id=content_id,
            author_kind=author_kind, author_id=author_id,
            category="none", severity=0.0, decision="skipped",
            rationale="unparseable_verdict", offending_span=None, model=None,
        )

    decision = policy.decide(parsed["category"], parsed["severity"])
    if not policy.SHADOW_MODE:
        _apply_decision(db, content_type=content_type, content_id=content_id, decision=decision)

    return _record(
        db, content_type=content_type, content_id=content_id,
        author_kind=author_kind, author_id=author_id,
        category=parsed["category"], severity=parsed["severity"],
        decision=decision, rationale=parsed["rationale"],
        offending_span=parsed["offending_span"], model=ai_service.DEFAULT_MODEL,
    )


def assess_in_background(
    content_type: str,
    content_id: int,
    text: str,
    author_kind: Optional[str] = None,
    author_id: Optional[int] = None,
) -> None:
    """BackgroundTasks entry point — owns its own DB session (the request
    session is closed by the time this runs) and swallows all errors so a
    moderation failure can never affect the user's request."""
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        assess(
            db, content_type=content_type, content_id=content_id, text=text,
            author_kind=author_kind, author_id=author_id,
        )
    except Exception:
        logger.exception("moderation assess (bg) failed: %s %s", content_type, content_id)
    finally:
        db.close()
