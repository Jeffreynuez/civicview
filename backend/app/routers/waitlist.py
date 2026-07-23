# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Citizen waitlist router.

Phase 1 stand-in for real citizen accounts. We capture email + a
`clicked_from` tag so Phase 2 can segment the launch list by intent
(comment CTA, subscribe button, claim-this-page modal, etc.).

Intentionally very thin: no verification, no confirmation email, no
dedupe across distinct `clicked_from` contexts — if the same email
signs up twice from two different CTAs we keep both rows as a signal
of repeated interest.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import CitizenWaitlist
from app.schemas.pages import WaitlistSignup, WaitlistStatus
from app.services.brevo_service import sync_waitlist_contact


logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("", response_model=WaitlistStatus)
def join_waitlist(
    payload: WaitlistSignup,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()
    clicked_from = (payload.clicked_from or "unknown").strip().lower()[:64]
    state = (payload.state or "").strip().upper()[:2] or None
    note = (payload.note or "").strip()[:2000] or None

    # Dedupe per (email, clicked_from) to avoid flooding the table if a
    # frontend bug re-submits the same context. Different CTAs still
    # create distinct rows as a signal. Claim-this-page carries a
    # `note` with the requester's details; if they re-submit we update
    # the existing row's note so the most recent context wins.
    existing = (
        db.query(CitizenWaitlist)
        .filter(
            CitizenWaitlist.email == email,
            CitizenWaitlist.clicked_from == clicked_from,
        )
        .first()
    )
    if existing:
        if note and note != existing.note:
            existing.note = note
            db.commit()
        return WaitlistStatus(ok=True, already_subscribed=True)

    db.add(CitizenWaitlist(
        email=email,
        clicked_from=clicked_from,
        state=state,
        note=note,
    ))
    db.commit()
    # Best-effort mirror into Brevo (no-op unless BREVO_* env vars are set).
    # Runs after the response so a slow/failed Brevo call never blocks signup.
    bg.add_task(sync_waitlist_contact, email, state, clicked_from)
    logger.info(
        "Waitlist signup — email=%s clicked_from=%s state=%s note_len=%d",
        email, clicked_from, state, len(note or ""),
    )
    return WaitlistStatus(ok=True, already_subscribed=False)
