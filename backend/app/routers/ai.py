# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
AI router — endpoints that call Claude.

Only one endpoint right now (`/health`), used to confirm the
ANTHROPIC_API_KEY is configured and the daily-spend cap has
headroom. Feature endpoints (comment classification, post
summaries, etc.) land in this router as they ship.

Auth model: feature endpoints will scope to specific entities
(post id, comment id, page id) and apply per-citizen rate limits
in addition to the per-process daily cap in ai_service. The health
endpoint is open by design — Render's health check hits it and
the frontend may surface "AI features available?" to gate UI.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from app.services import ai_service


logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
def health() -> dict:
    """Lightweight readiness check for AI features.

    Does NOT make an Anthropic API call — that would be slow on
    cold starts and burn tokens. Instead reports:
      - configured: whether the env var is set + SDK loaded OK
      - budget: today's spend so far + the configured caps

    Frontend uses `configured` to decide whether to render the AI
    affordances ("Summarize," "✨ Filter comments", etc.) or hide
    them. Ops can hit `/api/ai/health` to confirm a fresh deploy
    picked up an updated ANTHROPIC_API_KEY env var.
    """
    return {
        "configured": ai_service.is_configured(),
        "model_default": ai_service.DEFAULT_MODEL,
        "budget": ai_service.get_daily_spend(),
    }
