# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
AI router — endpoints that call Claude.

Endpoints:
  GET  /health           — readiness check, no Anthropic call
  POST /filter-comments  — natural-language filter for comment threads

Auth model: feature endpoints scope to specific entities (post id,
poll id) and rely on the per-process daily cap in ai_service.
The health endpoint is open by design — the frontend uses it to
gate AI affordances.
"""
from __future__ import annotations

import json
import logging
import re
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import (
    CitizenAccount,
    Poll,
    PollComment,
    Post,
    PostComment,
    RepAccount,
)
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


# ── /filter-comments ─────────────────────────────────────────────────
class CommentFilterRequest(BaseModel):
    source: Literal["post", "poll"]
    source_id: int = Field(..., ge=1)
    prompt: str = Field(..., min_length=1, max_length=300)


class CommentFilterResponse(BaseModel):
    matched_ids: List[int]
    method: Literal["author", "structured", "semantic", "passthrough"]
    explanation: str


# Quick-filter keyword map. The router tries to short-circuit on these
# before paying for an AI call. Order matters — we want "very positive"
# to match the positive bucket, not the intensifier-only one.
_SENTIMENT_KEYWORDS = {
    "positive": ("positive", "supportive", "agreeing", "agree", "in favor", "favorable"),
    "negative": ("negative", "critical", "against", "oppose", "opposing", "angry", "frustrated", "mad"),
    "neutral":  ("neutral", "balanced", "factual"),
}
_TONE_KEYWORDS = {
    # tone keyword → matching ai_tones value
    "funny":       "funny",
    "humorous":    "funny",
    "joke":        "funny",
    "supportive":  "supportive",
    "encouraging": "supportive",
    "critical":    "critical",
    "pushback":    "critical",
    "informative": "informative",
    "informed":    "informative",
    "factual":     "factual",
    "skeptical":   "skeptical",
    "doubt":       "skeptical",
    "questioning": "skeptical",
    "personal":    "personal",
    "story":       "personal",
    "rhetorical":  "rhetorical",
    "angry":       "angry",
    "civil":       "civil",
    "polite":      "civil",
}
_AUTHOR_RE = re.compile(r"@(\w+)")


def _load_comments(db: Session, source: str, source_id: int):
    """Return all non-deleted comments for a post or citizen poll, plus
    a label for use in error messages. Used by the structured-filter
    branches AND as the source list for the semantic-filter call."""
    if source == "post":
        rows = (
            db.query(PostComment)
            .filter(PostComment.post_id == source_id)
            .filter(PostComment.deleted_at.is_(None))
            .all()
        )
        return rows, "post"
    rows = (
        db.query(PollComment)
        .filter(PollComment.poll_id == source_id)
        .filter(PollComment.deleted_at.is_(None))
        .all()
    )
    return rows, "poll"


def _try_author_filter(prompt: str, comments) -> Optional[List[int]]:
    """If the prompt mentions @username(s), return the IDs of comments
    whose display_name matches. Multi-name prompts ('@Fred or @Joe')
    work because we collect ALL @names and OR them."""
    handles = _AUTHOR_RE.findall(prompt)
    if not handles:
        return None
    handles_lc = {h.lower() for h in handles}
    matched = []
    for c in comments:
        name = (c.citizen_display_name or "").lower()
        # Match against the whole name OR any whitespace-separated word.
        # "@Fred" should match "Fred Smith" and "Fred"; "@FredSmith"
        # should match "FredSmith" exactly.
        words = set(re.findall(r"\w+", name))
        if any(h in words or h == name.replace(" ", "") for h in handles_lc):
            matched.append(c.id)
    return matched


def _try_structured_filter(prompt: str, comments) -> Optional[List[int]]:
    """If the prompt clearly maps to sentiment/tone keywords, filter
    against the AI columns directly. Returns None if no keyword
    matched (caller falls through to the semantic branch)."""
    pl = prompt.lower()
    # Sentiment: only count if the keyword appears as a whole word.
    matched_sentiment: Optional[str] = None
    for bucket, keywords in _SENTIMENT_KEYWORDS.items():
        if any(re.search(rf"\b{re.escape(kw)}\b", pl) for kw in keywords):
            matched_sentiment = bucket
            break
    matched_tones: List[str] = []
    for keyword, tone_value in _TONE_KEYWORDS.items():
        if re.search(rf"\b{re.escape(keyword)}\b", pl):
            if tone_value not in matched_tones:
                matched_tones.append(tone_value)
    if not matched_sentiment and not matched_tones:
        return None

    out: List[int] = []
    for c in comments:
        # Unclassified rows can't match a tag filter; skip them.
        if c.ai_classified_at is None and c.ai_sentiment is None and not c.ai_tones:
            continue
        if matched_sentiment and (c.ai_sentiment or "") != matched_sentiment:
            continue
        if matched_tones:
            comment_tones = set((c.ai_tones or "").split(",")) if c.ai_tones else set()
            if not any(t in comment_tones for t in matched_tones):
                continue
        out.append(c.id)
    return out


def _explain_structured(prompt: str) -> str:
    """Generate a short human-readable description of which structured
    filter matched. Used as the response's `explanation` so the
    frontend can surface 'Filtered to: positive · funny'."""
    pl = prompt.lower()
    bits: List[str] = []
    for bucket, keywords in _SENTIMENT_KEYWORDS.items():
        if any(re.search(rf"\b{re.escape(kw)}\b", pl) for kw in keywords):
            bits.append(bucket)
            break
    for keyword, tone_value in _TONE_KEYWORDS.items():
        if re.search(rf"\b{re.escape(keyword)}\b", pl):
            if tone_value not in bits:
                bits.append(tone_value)
    return "Filtered to: " + " · ".join(bits) if bits else "Filtered."


def _semantic_filter(prompt: str, comments) -> Optional[List[int]]:
    """Fallback: send the prompt + a compact view of every classified
    comment (id, sentiment, tones, topic, short body snippet) to
    Claude and ask which IDs match the user's intent.

    Returns None if the AI call fails or doesn't yield parsable IDs.
    Caller treats that as 'no filter applied' and surfaces the
    explanation accordingly."""
    if not comments:
        return []
    # Build a compact line per comment. Body snippet kept short so
    # 500 comments still fit comfortably in Haiku's input window.
    lines = []
    for c in comments:
        snippet = (c.body or "").replace("\n", " ").strip()
        if len(snippet) > 140:
            snippet = snippet[:137] + "..."
        lines.append(
            f"{c.id}|{c.citizen_display_name or '?'}|"
            f"{c.ai_sentiment or '?'}|"
            f"{c.ai_tones or '?'}|"
            f"{c.ai_topic or '?'}|"
            f"{snippet}"
        )
    user_msg = (
        "Comments are listed below, one per line:\n"
        "id|author|sentiment|tones|topic|snippet\n"
        + "\n".join(lines)
        + "\n\nUser asked: \"" + prompt + "\"\n"
        + "Return ONLY a JSON array of integer comment IDs that match. "
        "If nothing matches, return []."
    )
    system = (
        "You filter a comment thread by user intent. The user provides a "
        "natural-language filter description and a list of pre-classified "
        "comments. You must respond with ONLY a JSON array of integer "
        "comment IDs from the list that match the user's intent. "
        "No prose, no explanation, no code fences. Empty array is valid."
    )
    result = ai_service.chat(
        system=system,
        messages=[{"role": "user", "content": user_msg}],
        # Output cap scales with comment count — at ~5 chars per ID
        # comma-separated, 500 IDs ≈ 2.5KB ≈ 700 tokens. Cap at 1500
        # for headroom; if we ever support threads bigger than this
        # the endpoint can paginate the source list.
        max_tokens=1500,
        temperature=0.0,
    )
    if result.error or not result.text:
        logger.info("filter-comments semantic fallback failed: %s", result.error)
        return None
    # Parse the JSON array. Defensive against trailing prose.
    txt = result.text.strip()
    m = re.search(r"\[[^\]]*\]", txt)
    if not m:
        return None
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list):
        return None
    # Coerce to ints, filter to the source set so the model can't
    # hallucinate IDs that don't exist.
    source_ids = {c.id for c in comments}
    out = [int(x) for x in parsed if isinstance(x, (int, float)) and int(x) in source_ids]
    return out


@router.post("/filter-comments", response_model=CommentFilterResponse)
def filter_comments(
    req: CommentFilterRequest,
    db: Session = Depends(get_db),
) -> CommentFilterResponse:
    """Filter a post or poll's comments by a natural-language prompt.

    Routing logic (cheapest path wins):
      1. Author filter (@name)  — pure SQL, no AI call
      2. Structured filter      — pure SQL on AI classification cols
      3. Semantic filter        — Claude call against the comment set

    Returns the matched comment IDs; the frontend filters its already-
    fetched list locally instead of re-fetching. `method` tells the UI
    which branch fired so it can label the result accurately
    ('Filtered by author', 'Filtered by AI', etc.).
    """
    comments, _label = _load_comments(db, req.source, req.source_id)
    # Nothing to filter — short-circuit before any AI call.
    if not comments:
        return CommentFilterResponse(matched_ids=[], method="passthrough", explanation="No comments yet.")

    # 1. Author
    author_ids = _try_author_filter(req.prompt, comments)
    if author_ids is not None:
        handles = sorted(set(_AUTHOR_RE.findall(req.prompt)))
        return CommentFilterResponse(
            matched_ids=author_ids,
            method="author",
            explanation=f"Filtered to comments from: @{', @'.join(handles)}",
        )

    # 2. Structured
    structured_ids = _try_structured_filter(req.prompt, comments)
    if structured_ids is not None:
        return CommentFilterResponse(
            matched_ids=structured_ids,
            method="structured",
            explanation=_explain_structured(req.prompt),
        )

    # 3. Semantic
    semantic_ids = _semantic_filter(req.prompt, comments)
    if semantic_ids is None:
        # AI unavailable or failed — degrade to showing everything,
        # with a clear explanation so the user knows what happened.
        return CommentFilterResponse(
            matched_ids=[c.id for c in comments],
            method="passthrough",
            explanation="Couldn't apply filter (AI unavailable). Showing all comments.",
        )
    return CommentFilterResponse(
        matched_ids=semantic_ids,
        method="semantic",
        explanation=f'AI-filtered for: "{req.prompt}"',
    )


# ── /summarize-post ─────────────────────────────────────────────────
class PostSummaryResponse(BaseModel):
    summary: str
    word_count_original: int
    word_count_summary: int
    cached: bool = False  # reserved for future caching; always False today


_SUMMARY_SYSTEM = """\
You produce a TL;DR for a single post written by a US elected
representative or candidate on CivicView (a civic-engagement app).

Rules:
- Write ONE short paragraph, 2-3 sentences, max ~50 words.
- Use plain English. Translate jargon (committee names, bill numbers,
  legislative terms) into what a constituent would understand.
- Preserve concrete numbers and names when they appear in the post.
- Do NOT inject opinion, fact-check, or context the post didn't include.
- Do NOT start with "The representative" or "This post" — start with
  the substance.
- Output ONLY the summary. No preamble, no markdown, no bullet points.
"""


@router.get("/summarize-post/{post_id}", response_model=PostSummaryResponse)
def summarize_post(
    post_id: int,
    db: Session = Depends(get_db),
) -> PostSummaryResponse:
    """One-shot non-streaming summary of a single post.

    Public: no auth needed. The body is already public via
    /api/pages/{official_id}, so anyone who can read the post can
    summarize it. We don't gate behind login because the whole
    point of summaries is to lower the bar to scanning a long
    post — a sign-in wall undoes that.

    Threshold: the frontend only renders the "Summarize" button
    when the post is longer than ~300 words. Short posts don't
    need summarization; we still allow the call though so a
    user-driven feature like "summarize this short post anyway"
    works without endpoint changes.

    Cost note: at Haiku rates a 500-word post → ~750 input tokens +
    50-100 output tokens ≈ $0.001 per call. Cheap, but a popular
    post could rack up calls — caching on (post_id, body_hash) is
    a follow-up if abuse shows up.
    """
    post = (
        db.query(Post)
        .filter(Post.id == post_id, Post.deleted_at.is_(None))
        .first()
    )
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    body = (post.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Post has no body to summarize")

    result = ai_service.chat(
        system=_SUMMARY_SYSTEM,
        messages=[{"role": "user", "content": f"Post to summarize:\n\n{body}"}],
        max_tokens=200,
        temperature=0.2,
    )
    if result.error == "not_configured":
        raise HTTPException(status_code=503, detail="AI is not configured on this deployment.")
    if result.error == "budget_exceeded":
        raise HTTPException(status_code=503, detail="Daily AI budget reached. Try again tomorrow.")
    if result.error or not result.text:
        raise HTTPException(status_code=502, detail="Summarization failed. Please try again.")

    summary = result.text.strip()
    return PostSummaryResponse(
        summary=summary,
        word_count_original=len(body.split()),
        word_count_summary=len(summary.split()),
    )


# ── /filter-polls ────────────────────────────────────────────────────
# Sibling of /filter-comments for the /polls global feed. Same hybrid
# routing: author lookup → structured filter on stored ai_* columns →
# semantic Claude call. Active polls only (archived_at IS NULL).
class PollFilterRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=300)
    # Optional kind narrowing — same shape as the /polls UI's chip
    # row. Saves a per-poll-kind pre-filter on the client.
    kind: Optional[Literal["rep", "citizen", "standalone"]] = None


class PollFilterResponse(BaseModel):
    matched_ids: List[int]
    method: Literal["author", "structured", "semantic", "passthrough"]
    explanation: str


_POLL_AUTHOR_RE = re.compile(r"@(\w+)")


def _load_active_polls(db: Session, kind: Optional[str]):
    """Active polls only. The kind filter mirrors /api/feed/polls."""
    q = db.query(Poll).filter(Poll.archived_at.is_(None))
    if kind == "rep":
        q = q.filter(Poll.author_kind == "rep")
    elif kind == "citizen":
        q = q.filter(
            Poll.author_kind == "citizen",
            Poll.target_official_id.is_not(None),
        )
    elif kind == "standalone":
        q = q.filter(
            Poll.author_kind == "citizen",
            Poll.target_official_id.is_(None),
        )
    return q.order_by(Poll.created_at.desc()).limit(500).all()


def _poll_author_label(db: Session, poll: Poll) -> str:
    """Resolve a poll's author display name. Used by the @-mention
    branch."""
    if poll.author_kind == "citizen":
        cz = (
            db.query(CitizenAccount)
            .filter(CitizenAccount.id == poll.author_citizen_id)
            .first()
        )
        return cz.display_name if cz else ""
    # Rep poll — author lives via the attached post.
    if not poll.post_id:
        return ""
    post = db.get(Post, poll.post_id)
    if post is None:
        return ""
    rep = db.get(RepAccount, post.author_id) if post.author_id else None
    return rep.display_name if rep else ""


def _try_poll_author_filter(prompt: str, polls) -> Optional[List[int]]:
    handles = _POLL_AUTHOR_RE.findall(prompt)
    if not handles:
        return None
    handles_lc = {h.lower() for h in handles}
    matched: List[int] = []
    # Need a DB session, but polls were loaded with one; we can pull
    # it from the bind. Simpler: just iterate and look up author per
    # poll. Bounded by limit=500 above so this is fine.
    from app.db import SessionLocal as _SL
    with _SL() as db2:
        for p in polls:
            name = _poll_author_label(db2, p).lower()
            words = set(re.findall(r"\w+", name))
            if any(h in words or h == name.replace(" ", "") for h in handles_lc):
                matched.append(p.id)
    return matched


def _try_poll_structured_filter(prompt: str, polls) -> Optional[List[int]]:
    """Translate prompt keywords to filters on the stored ai_* fields.
    Reuses the same vocabulary as the comment filter so prompts work
    uniformly across both surfaces."""
    pl = prompt.lower()
    matched_sentiment: Optional[str] = None
    for bucket, keywords in _SENTIMENT_KEYWORDS.items():
        if any(re.search(rf"\b{re.escape(kw)}\b", pl) for kw in keywords):
            matched_sentiment = bucket
            break
    matched_tones: List[str] = []
    for keyword, tone_value in _TONE_KEYWORDS.items():
        if re.search(rf"\b{re.escape(keyword)}\b", pl):
            if tone_value not in matched_tones:
                matched_tones.append(tone_value)
    if not matched_sentiment and not matched_tones:
        return None

    out: List[int] = []
    for p in polls:
        if p.ai_classified_at is None and p.ai_sentiment is None and not p.ai_tones:
            continue
        if matched_sentiment and (p.ai_sentiment or "") != matched_sentiment:
            continue
        if matched_tones:
            poll_tones = set((p.ai_tones or "").split(",")) if p.ai_tones else set()
            if not any(t in poll_tones for t in matched_tones):
                continue
        out.append(p.id)
    return out


def _semantic_poll_filter(prompt: str, polls) -> Optional[List[int]]:
    """Fallback: send the prompt + a compact view of each poll
    (id, sentiment, tones, topic, question snippet) to Claude and
    ask which IDs match the user's intent. Returns None on parse
    failure so the caller falls back to passthrough."""
    if not polls:
        return []
    lines = []
    for p in polls:
        snippet = (p.question or "").replace("\n", " ").strip()
        if len(snippet) > 140:
            snippet = snippet[:137] + "..."
        lines.append(
            f"{p.id}|"
            f"{p.ai_sentiment or '?'}|"
            f"{p.ai_tones or '?'}|"
            f"{p.ai_topic or '?'}|"
            f"{snippet}"
        )
    user_msg = (
        "Polls are listed below, one per line:\n"
        "id|sentiment|tones|topic|question\n"
        + "\n".join(lines)
        + "\n\nUser asked: \"" + prompt + "\"\n"
        + "Return ONLY a JSON array of integer poll IDs that match. "
        "If nothing matches, return []."
    )
    system = (
        "You filter a list of pre-classified civic polls by user "
        "intent. Respond with ONLY a JSON array of integer poll IDs "
        "from the list that match the user's intent. No prose, no "
        "explanation, no code fences. Empty array is valid."
    )
    result = ai_service.chat(
        system=system,
        messages=[{"role": "user", "content": user_msg}],
        max_tokens=1500,
        temperature=0.0,
    )
    if result.error or not result.text:
        logger.info("filter-polls semantic fallback failed: %s", result.error)
        return None
    txt = result.text.strip()
    m = re.search(r"\[[^\]]*\]", txt)
    if not m:
        return None
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list):
        return None
    source_ids = {p.id for p in polls}
    return [int(x) for x in parsed if isinstance(x, (int, float)) and int(x) in source_ids]


@router.post("/filter-polls", response_model=PollFilterResponse)
def filter_polls(
    req: PollFilterRequest,
    db: Session = Depends(get_db),
) -> PollFilterResponse:
    """Filter the /polls feed by a natural-language prompt.

    Routing (cheapest path wins):
      1. Author filter (@name) — SQL-ish on display_name. No AI call.
      2. Structured filter on ai_sentiment / ai_tones — no AI call.
      3. Semantic filter — Claude examines the pre-classified set
         and returns matching ids.
    """
    polls = _load_active_polls(db, req.kind)
    if not polls:
        return PollFilterResponse(matched_ids=[], method="passthrough", explanation="No polls in this view.")

    author_ids = _try_poll_author_filter(req.prompt, polls)
    if author_ids is not None:
        handles = sorted(set(_POLL_AUTHOR_RE.findall(req.prompt)))
        return PollFilterResponse(
            matched_ids=author_ids,
            method="author",
            explanation=f"Filtered to polls from: @{', @'.join(handles)}",
        )

    structured_ids = _try_poll_structured_filter(req.prompt, polls)
    if structured_ids is not None:
        # Reuse the comment filter's explanation builder — same vocab.
        return PollFilterResponse(
            matched_ids=structured_ids,
            method="structured",
            explanation=_explain_structured(req.prompt),
        )

    semantic_ids = _semantic_poll_filter(req.prompt, polls)
    if semantic_ids is None:
        return PollFilterResponse(
            matched_ids=[p.id for p in polls],
            method="passthrough",
            explanation="Couldn't apply filter (AI unavailable). Showing all polls.",
        )
    return PollFilterResponse(
        matched_ids=semantic_ids,
        method="semantic",
        explanation=f'AI-filtered for: "{req.prompt}"',
    )


# ── /filter-items (generic: bills, votes — any {id, text} list) ───────
# Powers the AI-search toggle on the rep-profile Bills + Votes tabs.
# Those datasets aren't in our DB (they come from Congress.gov / the
# votes API and are loaded client-side), so the client sends the loaded
# items here and we semantic-filter them. Index-based model output keeps
# the call cheap and avoids the model mangling long id strings.
class FilterItem(BaseModel):
    id: str = Field(..., max_length=128)
    text: str = Field(default="", max_length=2000)


class ItemFilterRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=300)
    items: List[FilterItem] = Field(default_factory=list)


class ItemFilterResponse(BaseModel):
    matched_ids: List[str]
    method: Literal["ai", "passthrough"]
    explanation: str


_ITEMS_MAX = 200
_ITEM_TEXT_MAX = 400


@router.post("/filter-items", response_model=ItemFilterResponse)
def filter_items(req: ItemFilterRequest) -> ItemFilterResponse:
    """Semantic filter over a caller-supplied {id, text} list.

    Fail-open: if AI is unavailable / unparseable, returns
    method='passthrough' with ALL ids so the UI shows everything rather
    than erroring. Scoped to whatever the client sent (the loaded set).
    """
    items = req.items[:_ITEMS_MAX]
    all_ids = [it.id for it in items]
    if not items:
        return ItemFilterResponse(matched_ids=[], method="passthrough", explanation="Nothing to filter.")

    catalog = "\n".join(
        f"{idx}: {(it.text or '')[:_ITEM_TEXT_MAX]}" for idx, it in enumerate(items)
    )
    system = (
        "You filter a list of U.S. legislative items (bills or roll-call "
        "votes) by how well each matches the user's search query. Return "
        "ONLY a JSON array of the integer INDICES that match, most-relevant "
        "first. No prose, no code fences. An empty array is valid. Be "
        "inclusive on topical matches (synonyms, related policy areas) but "
        "exclude clearly-unrelated items."
    )
    user = f'Search query: "{req.prompt.strip()}"\n\nItems (index: text):\n{catalog}'

    result = ai_service.chat(
        system=system,
        messages=[{"role": "user", "content": user}],
        max_tokens=400,
        temperature=0.0,
    )
    if result.error or not result.text:
        return ItemFilterResponse(
            matched_ids=all_ids, method="passthrough",
            explanation="AI unavailable — showing all results.",
        )
    m = re.search(r"\[.*\]", result.text, re.S)
    if not m:
        return ItemFilterResponse(
            matched_ids=all_ids, method="passthrough",
            explanation="Couldn't apply AI filter — showing all results.",
        )
    try:
        idxs = json.loads(m.group(0))
    except Exception:
        return ItemFilterResponse(
            matched_ids=all_ids, method="passthrough",
            explanation="Couldn't apply AI filter — showing all results.",
        )
    matched: List[str] = []
    seen = set()
    for i in idxs:
        if isinstance(i, bool):
            continue
        if isinstance(i, int) and 0 <= i < len(items) and i not in seen:
            seen.add(i)
            matched.append(items[i].id)
    return ItemFilterResponse(
        matched_ids=matched, method="ai",
        explanation=f'AI-filtered for: "{req.prompt.strip()}"',
    )
