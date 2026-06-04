# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Read endpoints for optional poll demographic forms.

  GET /api/polls/demographics/catalog        — full standardized catalog
       (Standard + Sensitive tiers) for the poll-composer picker.
  GET /api/polls/{poll_id}/demographics       — the questions a poll attached
       (catalog-resolved). Metadata only — never individual answers.
  GET /api/polls/{poll_id}/results/breakdown   — AGGREGATE results for a
       filtered/cross-tabbed subset, with server-side MIN-CELL SUPPRESSION.

Privacy: suppression is enforced HERE, server-side. Whenever a demographic
dimension is involved (a `filter_*` is applied or `by` is set) and the
resulting subset — or a cross-tab bucket — has fewer than MIN_CELL respondents,
the counts are withheld (`suppressed: true`, empty options). Plain geography-only
results are not suppressed (they mirror the public poll card). Individual rows
are never returned.
"""
from __future__ import annotations

from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, selectinload

from datetime import datetime

from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import Poll, PollOption, Post, PollVote, PollVoteDemographic
from app.services import demographics_catalog, poll_demographics

router = APIRouter()

MIN_CELL = 10  # app-wide minimum subset/bucket size before a demographic cut shows


@router.get("/demographics/catalog")
def get_demographics_catalog() -> dict:
    """The standardized question catalog for the creator picker."""
    return {
        "version": demographics_catalog.CATALOG_VERSION,
        "questions": demographics_catalog.serialize_catalog(),
    }


@router.get("/{poll_id}/demographics")
def get_poll_demographics(poll_id: int, db: Session = Depends(get_db)) -> dict:
    """The demographic questions attached to a poll (metadata only)."""
    if db.get(Poll, poll_id) is None:
        raise HTTPException(status_code=404, detail="Poll not found")
    questions = poll_demographics.questions_payload(db, poll_id)
    return {"poll_id": poll_id, "has_form": bool(questions), "questions": questions}


@router.get("/{poll_id}/demographics/mine")
def my_poll_demographics(
    poll_id: int,
    db: Session = Depends(get_db),
    citizen=Depends(get_optional_citizen),
) -> dict:
    """The CURRENT citizen's own self-reported answers for this poll, so the
    voter form can prefill them for editing until the poll closes. Returns the
    caller's OWN answers only — never anyone else's. Empty for anonymous."""
    poll = db.get(Poll, poll_id)
    if poll is None:
        raise HTTPException(status_code=404, detail="Poll not found")
    answers: dict[str, str] = {}
    if citizen is not None:
        vote = (
            db.query(PollVote)
            .filter(PollVote.poll_id == poll_id, PollVote.citizen_id == citizen.id)
            .first()
        )
        if vote is not None:
            for r in (
                db.query(PollVoteDemographic)
                .filter(PollVoteDemographic.poll_vote_id == vote.id)
                .all()
            ):
                answers[r.question_key] = r.answer_value
    can_edit = poll.closes_at is None or datetime.utcnow() < poll.closes_at
    return {"poll_id": poll_id, "answers": answers, "can_edit": can_edit}


@router.get("/{poll_id}/results/breakdown")
def results_breakdown(
    poll_id: int,
    request: Request,
    scope: str = Query("country"),
    by: str | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    """Aggregate option results for a filtered subset of a poll's votes.

    Query params:
      • scope = country|state|district|city (reuses the poll's geography
        semantics; clamps to what the poll owner supports).
      • filter_<question_key>=<option_value> (repeatable) — restrict to voters
        who self-reported that answer. Only attached + catalog-valid pairs apply.
      • by=<question_key> — also return a per-bucket cross-tab for that question.

    Suppression: when a demographic dimension is involved and the subset (or a
    bucket) has < MIN_CELL respondents, counts are withheld.
    """
    poll = (
        db.query(Poll)
        .options(selectinload(Poll.options).selectinload(PollOption.votes))
        .filter(Poll.id == poll_id)
        .first()
    )
    if poll is None:
        raise HTTPException(status_code=404, detail="Poll not found")

    # Reuse the existing geography matcher + owner resolution so the explorer's
    # scope means exactly what the poll card's scope means.
    from app.routers.pages import (
        _load_owner, _allowed_scopes_for_owner, _vote_matches_scope,
    )
    owner = None
    if poll.post_id is not None:
        post = db.get(Post, poll.post_id)
        if post is not None:
            owner = _load_owner(db, post.official_id)
    allowed = _allowed_scopes_for_owner(owner)
    scope = (scope or "country").lower()
    if scope not in allowed:
        scope = "country"

    eff_min = max(MIN_CELL, poll.min_cell_override or 0)
    attached = set(poll_demographics.get_attached_keys(db, poll_id))

    # Parse repeatable filter_<key>=<value> params; keep only attached+valid.
    filters: dict[str, str] = {}
    for raw_key, raw_val in request.query_params.multi_items():
        if not raw_key.startswith("filter_"):
            continue
        key = raw_key[len("filter_"):]
        if key in attached and demographics_catalog.is_valid_answer(key, raw_val):
            filters[key] = raw_val
    if by is not None and by not in attached:
        by = None

    # vote_id -> {question_key: answer_value}
    demo_by_vote: dict[int, dict[str, str]] = defaultdict(dict)
    for r in (
        db.query(PollVoteDemographic)
        .filter(PollVoteDemographic.poll_id == poll_id)
        .all()
    ):
        demo_by_vote[r.poll_vote_id][r.question_key] = r.answer_value

    options = sorted(poll.options, key=lambda o: o.sort_order)

    def vote_passes(v) -> bool:
        if not _vote_matches_scope(v, scope, owner):
            return False
        if filters:
            ans = demo_by_vote.get(v.id, {})
            for fk, fv in filters.items():
                if ans.get(fk) != fv:
                    return False
        return True

    subset: list[tuple[int, object]] = []  # (option_id, vote)
    for o in options:
        for v in (o.votes or []):
            if vote_passes(v):
                subset.append((o.id, v))

    subset_total = len(subset)
    is_demographic_cut = bool(filters) or bool(by)
    suppressed = is_demographic_cut and subset_total < eff_min

    counts = Counter(oid for oid, _ in subset)
    resp: dict = {
        "poll_id": poll_id,
        "scope": scope,
        "allowed_scopes": allowed,
        "applied_filters": filters,
        "by": by,
        "subset_total": subset_total,
        "min_cell": eff_min,
        "suppressed": suppressed,
        "options": (
            [] if suppressed
            else [{"id": o.id, "text": o.text, "count": counts.get(o.id, 0)} for o in options]
        ),
    }

    if by:
        meta = demographics_catalog.DEMOGRAPHIC_CATALOG.get(by, {})
        bucket_rows: dict[str, list] = defaultdict(list)
        for oid, v in subset:
            ans = demo_by_vote.get(v.id, {}).get(by)
            if ans is not None:
                bucket_rows[ans].append((oid, v))
        buckets = []
        for opt in meta.get("options", []):
            rows = bucket_rows.get(opt["value"], [])
            n = len(rows)
            b_suppressed = n < eff_min
            b_counts = Counter(oid for oid, _ in rows)
            buckets.append({
                "value": opt["value"],
                "label": opt["label"],
                "total": n,
                "suppressed": b_suppressed,
                "options": (
                    [] if b_suppressed
                    else [{"id": o.id, "count": b_counts.get(o.id, 0)} for o in options]
                ),
            })
        resp["breakdown"] = {
            "question_key": by, "prompt": meta.get("prompt"), "buckets": buckets,
        }

    return resp
