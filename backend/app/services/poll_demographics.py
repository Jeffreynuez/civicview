# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Service for optional poll demographic forms (Task: poll demographic forms).

Two write paths + read helpers, shared by the rep-poll and citizen-poll
routers so the logic lives in exactly one place:

  • attach_questions()  — at poll create, persist which catalog questions the
    creator attached (validated + de-duped via the catalog).
  • record_for_vote()   — at vote time, replace this vote's self-reported
    answers (validated against the poll's attached questions + the catalog).
    Caller gates this to verified-citizen votes only, mirroring how PollVote
    geography scopes attach (anonymous/demo-token votes carry none).

  • get_attached_keys() / questions_payload() — reads for serialization.

Privacy: individual answers are never returned by these helpers; only the
attached-question metadata (questions_payload) is public. Aggregation +
min-cell suppression live in the breakdown endpoint (separate module).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.pages import (
    CitizenDemographicProfile, PollDemographicQuestion, PollVoteDemographic,
)
from app.services import demographics_catalog as catalog

MAX_QUESTIONS_PER_POLL = 12  # catalog is small; guards against abuse/bloat

# Per-poll suppression-threshold presets a creator may choose. 10 is the app
# floor (stored as NULL); only stricter values are persisted.
ALLOWED_THRESHOLDS = {25, 50, 100}


def clamp_threshold(value) -> int | None:
    """Return a valid stricter-than-floor threshold, or None (= app floor 10).
    Anything not in the allowed preset set collapses to None."""
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None
    return v if v in ALLOWED_THRESHOLDS else None


def attach_questions(db: Session, poll_id: int, keys) -> list[str]:
    """Persist the creator-selected catalog questions for a poll, in order.
    Invalid/unknown/duplicate keys are dropped. Returns the keys stored.
    Assumes a fresh poll (no existing attached questions)."""
    norm = catalog.normalize_keys(list(keys or []))[:MAX_QUESTIONS_PER_POLL]
    for i, key in enumerate(norm):
        db.add(PollDemographicQuestion(poll_id=poll_id, question_key=key, sort_order=i))
    return norm


def get_attached_keys(db: Session, poll_id: int) -> list[str]:
    rows = (
        db.query(PollDemographicQuestion)
        .filter(PollDemographicQuestion.poll_id == poll_id)
        .order_by(PollDemographicQuestion.sort_order)
        .all()
    )
    return [r.question_key for r in rows]


def has_form(db: Session, poll_id: int) -> bool:
    return (
        db.query(PollDemographicQuestion.id)
        .filter(PollDemographicQuestion.poll_id == poll_id)
        .first()
        is not None
    )


def record_for_vote(db: Session, poll_id: int, vote, demographics: dict | None) -> None:
    """Replace the self-reported demographic answers tied to `vote`.

    Validates each answer against the poll's attached questions AND the catalog
    options; silently drops anything invalid (a stale client or a question the
    creator didn't attach). Clearing/omitting an answer is allowed — that's the
    "Prefer not to say" path (no row stored). `vote` must already have an id
    (caller flushes). Caller must only invoke this for verified-citizen votes.
    """
    attached = set(get_attached_keys(db, poll_id))
    # Always clear prior answers for this vote so a re-vote / option switch
    # doesn't leave stale demographics behind.
    db.query(PollVoteDemographic).filter(
        PollVoteDemographic.poll_vote_id == vote.id
    ).delete(synchronize_session=False)
    if not attached or not demographics:
        return
    for key, value in demographics.items():
        if key not in attached:
            continue
        value = "" if value is None else str(value)
        if not catalog.is_valid_answer(key, value):
            continue  # includes "prefer not to say" / blank -> no row
        db.add(PollVoteDemographic(
            poll_id=poll_id, poll_vote_id=vote.id,
            question_key=key, answer_value=value,
        ))


STANDARD_KEYS = {k for k in catalog.DEMOGRAPHIC_CATALOG if k not in catalog.SENSITIVE_KEYS}


def get_profile(db: Session, citizen_id: int) -> dict:
    """The citizen's saved reusable profile {question_key: value} (standard only)."""
    rows = (
        db.query(CitizenDemographicProfile)
        .filter(CitizenDemographicProfile.citizen_id == citizen_id)
        .all()
    )
    return {r.question_key: r.answer_value for r in rows if r.question_key in STANDARD_KEYS}


def set_profile(db: Session, citizen_id: int, answers: dict | None) -> None:
    """Replace the citizen's reusable profile. Only STANDARD catalog questions
    with valid option values persist — sensitive categories are never stored in
    the profile (they remain answer-per-poll)."""
    db.query(CitizenDemographicProfile).filter(
        CitizenDemographicProfile.citizen_id == citizen_id
    ).delete(synchronize_session=False)
    for key, value in (answers or {}).items():
        if key not in STANDARD_KEYS:
            continue
        value = "" if value is None else str(value)
        if catalog.is_valid_answer(key, value):
            db.add(CitizenDemographicProfile(
                citizen_id=citizen_id, question_key=key, answer_value=value,
            ))


def clear_profile(db: Session, citizen_id: int) -> None:
    db.query(CitizenDemographicProfile).filter(
        CitizenDemographicProfile.citizen_id == citizen_id
    ).delete(synchronize_session=False)


def questions_payload(db: Session, poll_id: int) -> list[dict]:
    """Catalog-resolved attached questions for a poll, in display order:
    [{key, prompt, tier, options:[{value,label}]}]. Public (no answers)."""
    out: list[dict] = []
    for key in get_attached_keys(db, poll_id):
        meta = catalog.DEMOGRAPHIC_CATALOG.get(key)
        if not meta:
            continue
        out.append({
            "key": key, "prompt": meta["prompt"], "tier": meta["tier"],
            "options": meta["options"],
        })
    return out
