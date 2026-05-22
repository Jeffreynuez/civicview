# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
AI service — Anthropic Claude client wrapper.

Centralizes everything every AI feature needs:
  • A lazily-initialized Anthropic client (so a missing API key at
    boot just degrades AI surfaces, doesn't kill the whole API)
  • A daily token-spend cap (defensive — limits the blast radius
    of a runaway loop or prompt-injection abuse)
  • A unified `chat()` helper that handles retries, logs token
    counts, updates the daily-spend counter, and returns either
    the assistant message or a structured error

Design principles:
  - **Fail open for non-AI users.** Visitors who never touch an AI
    feature should never see degraded behavior just because the AI
    is down or unconfigured. Every endpoint that uses AI calls into
    this module and gets either a result or a typed error; the
    caller decides how to surface that to the user.
  - **No surprises on the bill.** The daily cap and per-request
    `max_tokens` are both enforced here, so a buggy caller can't
    accidentally rack up a $100 day's worth of usage.
  - **Model choice is per-call, not per-process.** Most features
    use Haiku (fast, cheap); occasionally a feature wants Sonnet
    or Opus for harder reasoning. The model name is a kwarg so
    callers stay explicit.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Default model for everything unless the caller overrides. Haiku 4.5
# is the sweet spot for the kinds of short, structured calls CivicView
# makes (comment classification, post summaries, simple Q&A).
DEFAULT_MODEL = "claude-haiku-4-5-20251001"

# Approximate per-million-token costs in USD for Haiku 4.5. Used by the
# daily-spend cap. Update these when Anthropic changes pricing — the
# numbers don't have to be exact, they're a budget guardrail not a
# billing source. The actual billing comes from your Anthropic account.
# Sonnet/Opus are pricier; if a feature uses them, the same per-million
# rates apply at higher numbers — we track in tokens and don't
# differentiate by model in the daily cap.
_HAIKU_INPUT_PER_M = 1.00     # USD per 1M input tokens (Haiku 4.5)
_HAIKU_OUTPUT_PER_M = 5.00    # USD per 1M output tokens (Haiku 4.5)

# Daily token-spend cap. Defaults are generous-but-not-runaway:
#   60M input tokens / day  ≈ $60 worst-case at Haiku rates
#   15M output tokens / day ≈ $75 worst-case at Haiku output rates
# Override per-environment via env vars. Set both to 0 to disable.
_DAILY_INPUT_CAP = int(os.getenv("AI_DAILY_INPUT_TOKEN_CAP", "60000000"))
_DAILY_OUTPUT_CAP = int(os.getenv("AI_DAILY_OUTPUT_TOKEN_CAP", "15000000"))


@dataclass
class AIResult:
    """Structured return from `chat()`.

    Exactly one of `text` or `error` is set:
      • Success → `text` populated, `error` is None
      • Failure → `error` populated with one of:
          'not_configured' — ANTHROPIC_API_KEY isn't set
          'rate_limited'   — Anthropic returned 429; caller may retry
          'budget_exceeded' — our internal daily cap was hit
          'transient'      — 5xx from Anthropic; caller may retry
          'invalid'        — 4xx other than 429; bad prompt or model
          'unknown'        — anything else (logged with full trace)

    `usage` always carries the input/output token counts when the call
    actually hit Anthropic, so the caller can log/cost-account even on
    soft failures. NULL when the call never made it out the door
    (not_configured, budget_exceeded).
    """
    text: Optional[str]
    error: Optional[str]
    usage: Optional[Dict[str, int]] = None
    raw: Optional[Any] = None  # Original Message object — only for advanced callers


# ── Daily-spend tracking ──────────────────────────────────────────────
# In-memory counter, reset at UTC midnight. Per-process semantics on
# Render's free tier (only one worker). If we ever multi-worker we'd
# move this to Redis; for now the simpler approach is fine and the cap
# is approximate by design.
_spend_lock = threading.Lock()
_spend_date: Optional[_dt.date] = None
_spend_input_tokens = 0
_spend_output_tokens = 0


def _maybe_reset_spend() -> None:
    """Reset the spend counters at UTC midnight rollover."""
    global _spend_date, _spend_input_tokens, _spend_output_tokens
    today = _dt.datetime.utcnow().date()
    if _spend_date != today:
        _spend_date = today
        _spend_input_tokens = 0
        _spend_output_tokens = 0


def _record_usage(input_tokens: int, output_tokens: int) -> None:
    """Tick the daily counters by the tokens this request consumed.
    Called inside the lock from chat()."""
    global _spend_input_tokens, _spend_output_tokens
    _maybe_reset_spend()
    _spend_input_tokens += max(int(input_tokens), 0)
    _spend_output_tokens += max(int(output_tokens), 0)


def get_daily_spend() -> Dict[str, Any]:
    """Read-only snapshot of today's usage. Exposed for the /api/ai/health
    endpoint so we can surface budget headroom to ops without exposing
    the raw env vars."""
    with _spend_lock:
        _maybe_reset_spend()
        cost_estimate = (
            (_spend_input_tokens / 1_000_000) * _HAIKU_INPUT_PER_M
            + (_spend_output_tokens / 1_000_000) * _HAIKU_OUTPUT_PER_M
        )
        return {
            "date": _spend_date.isoformat() if _spend_date else None,
            "input_tokens": _spend_input_tokens,
            "output_tokens": _spend_output_tokens,
            "input_cap": _DAILY_INPUT_CAP,
            "output_cap": _DAILY_OUTPUT_CAP,
            "estimated_cost_usd": round(cost_estimate, 4),
        }


def _would_exceed_cap(estimated_input: int, estimated_output: int) -> bool:
    """Pre-flight check before making the API call. Uses pessimistic
    estimates (max_tokens for output, message-token-count for input)
    so we err on the side of refusing rather than overspending.

    A cap of 0 disables that dimension — useful in dev where you don't
    want to be surprised by a cap when testing."""
    with _spend_lock:
        _maybe_reset_spend()
        if _DAILY_INPUT_CAP > 0 and _spend_input_tokens + estimated_input > _DAILY_INPUT_CAP:
            return True
        if _DAILY_OUTPUT_CAP > 0 and _spend_output_tokens + estimated_output > _DAILY_OUTPUT_CAP:
            return True
        return False


# ── Client init ──────────────────────────────────────────────────────
# Lazy singleton — instantiate on first use, NOT at import time. That
# way the backend can still boot if ANTHROPIC_API_KEY isn't set; AI
# endpoints just return `not_configured` until the key shows up.
_client_lock = threading.Lock()
_client: Optional[Any] = None
_client_init_attempted = False


def _get_client() -> Optional[Any]:
    """Return the Anthropic client singleton, or None if the key isn't
    set / the SDK can't be initialized. Logs the failure once so we
    don't spam the deploy logs on every call."""
    global _client, _client_init_attempted
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        if _client_init_attempted:
            return None
        _client_init_attempted = True
        api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
        if not api_key:
            logger.info(
                "ANTHROPIC_API_KEY is not set — AI features will return "
                "'not_configured'. Set the env var to enable them.",
            )
            return None
        try:
            from anthropic import Anthropic  # local import keeps boot light
            _client = Anthropic(api_key=api_key)
            logger.info("Anthropic client initialized (model default=%s).", DEFAULT_MODEL)
            return _client
        except Exception:
            logger.exception(
                "Failed to initialize Anthropic client — AI features disabled.",
            )
            return None


def is_configured() -> bool:
    """Public helper: cheap, doesn't make a network call. Used by
    routes to short-circuit when the key is missing."""
    return _get_client() is not None


# ── chat() — the one helper every AI feature uses ────────────────────
def chat(
    *,
    system: str,
    messages: List[Dict[str, Any]],
    max_tokens: int = 512,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.3,
) -> AIResult:
    """Single-shot non-streaming chat call.

    Args:
      system: System prompt — the "you are X" preamble. Required.
      messages: Anthropic-format message list. Typically a single
        user message: [{"role": "user", "content": "..."}]
      max_tokens: Output budget. Keep this tight — it's the upper
        bound on this call's output cost. 512 is enough for most
        summaries / classifications; bump to 1024+ for long-form.
      model: Override DEFAULT_MODEL when you want Sonnet / Opus.
      temperature: 0.0 (deterministic) to 1.0 (creative). Default
        0.3 is a good middle ground for civic content — consistent
        outputs without being mechanical.

    Returns: AIResult — never raises. Callers branch on `error`.
    """
    client = _get_client()
    if client is None:
        return AIResult(text=None, error="not_configured", usage=None)

    # Pessimistic input estimate for the pre-flight cap check: assume
    # ~4 chars per token, count system + all message contents. Cheap
    # heuristic, intentionally over-estimates so we err on the side
    # of refusing before we spend.
    char_count = len(system)
    for m in messages:
        c = m.get("content")
        if isinstance(c, str):
            char_count += len(c)
        elif isinstance(c, list):
            for block in c:
                if isinstance(block, dict):
                    char_count += len(block.get("text", "") or "")
    estimated_input_tokens = max(char_count // 4, 1)
    if _would_exceed_cap(estimated_input_tokens, max_tokens):
        logger.warning(
            "AI daily spend cap would be exceeded — refusing call. "
            "snapshot=%s",
            get_daily_spend(),
        )
        return AIResult(text=None, error="budget_exceeded", usage=None)

    try:
        msg = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=messages,
        )
    except Exception as e:
        # Anthropic SDK raises specific exception subclasses; we use
        # duck-typing on the status code to avoid coupling tightly to
        # the SDK's class hierarchy (which has shifted across versions).
        status = getattr(e, "status_code", None) or getattr(e, "status", None)
        if status == 429:
            logger.warning("Anthropic rate-limited the call.")
            return AIResult(text=None, error="rate_limited", usage=None)
        if status and 500 <= int(status) < 600:
            logger.warning("Anthropic transient error %s — caller may retry.", status)
            return AIResult(text=None, error="transient", usage=None)
        if status and 400 <= int(status) < 500:
            logger.warning("Anthropic 4xx %s — invalid request.", status)
            return AIResult(text=None, error="invalid", usage=None)
        logger.exception("Unexpected Anthropic call failure.")
        return AIResult(text=None, error="unknown", usage=None)

    # Pull the text out. Anthropic returns content as a list of blocks;
    # we concatenate all `text`-typed blocks into a single string. The
    # SDK guarantees at least one text block on a non-streaming call.
    text_parts: List[str] = []
    for block in (msg.content or []):
        if getattr(block, "type", None) == "text":
            text_parts.append(getattr(block, "text", "") or "")
    text = "".join(text_parts).strip()

    usage = {
        "input_tokens": int(getattr(msg.usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(msg.usage, "output_tokens", 0) or 0),
    }
    with _spend_lock:
        _record_usage(usage["input_tokens"], usage["output_tokens"])

    return AIResult(text=text, error=None, usage=usage, raw=msg)
