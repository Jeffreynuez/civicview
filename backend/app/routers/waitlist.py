# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Citizen waitlist router.

Phase 1 stand-in for real citizen accounts. We capture email + a
`clicked_from` tag so Phase 2 can segment the launch list by intent
(comment CTA, subscribe button, claim-this-page modal, etc.).

Intentionally thin, with three guards added after the 2026-09-24
audit (S9), because an anonymous form that makes CivicView send email
to any address it is given puts the civicview.app sending reputation
at risk:
  • 5 signups per caller per hour (app/middleware/rate_limit.py).
  • Brevo is told about an address once, the first time it appears
    here, not once per CTA. With BREVO_DOI_TEMPLATE_ID set, Brevo
    sends a double opt-in confirmation instead of adding the contact
    outright.
  • An existing row is never edited. A repeat submission with a
    different note (claim-this-page requests carry one) is stored as
    a new row, so nobody who knows an email address can overwrite the
    claim details someone else sent.

If the same email signs up from two different CTAs we still keep both
rows as a signal of repeated interest.
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

    # Dedupe per (email, clicked_from, note) so a frontend bug that
    # re-submits the same context does not flood the table. Different
    # CTAs, or the same CTA with new claim details, get a new row.
    # Existing rows are never modified (see the module docstring).
    same_context = (
        db.query(CitizenWaitlist)
        .filter(
            CitizenWaitlist.email == email,
            CitizenWaitlist.clicked_from == clicked_from,
        )
        .all()
    )
    if same_context and (not note or any(r.note == note for r in same_context)):
        return WaitlistStatus(ok=True, already_subscribed=True)

    first_time_for_email = (
        db.query(CitizenWaitlist.id).filter(CitizenWaitlist.email == email).first()
        is None
    )

    db.add(CitizenWaitlist(
        email=email,
        clicked_from=clicked_from,
        state=state,
        note=note,
    ))
    db.commit()
    # Best-effort mirror into Brevo (no-op unless BREVO_* env vars are set).
    # Runs after the response so a slow/failed Brevo call never blocks signup.
    # Only the first time this address shows up, so Brevo mail cannot be
    # triggered again and again for one inbox through different CTAs.
    if first_time_for_email:
        bg.add_task(sync_waitlist_contact, email, state, clicked_from)
    logger.info(
        "Waitlist signup — email=%s clicked_from=%s state=%s note_len=%d",
        email, clicked_from, state, len(note or ""),
    )
    return WaitlistStatus(ok=True, already_subscribed=bool(same_context))
