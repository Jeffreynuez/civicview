# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Identity verification router (Task #89).

Endpoints:
  GET  /api/identity-verification/status    — public probe
  POST /api/identity-verification/start     — citizen auth required
  GET  /api/identity-verification/callback  — ID.me redirects here

Only citizens verify in the current product. The /start endpoint
sits behind the citizen auth dep so an unauthenticated caller
can't mint state tokens. The /callback endpoint trusts the signed
state token (rather than the cookie) to identify the citizen —
ID.me's redirect may arrive on a different cookie context than the
one that initiated the flow.

The router stays thin: state-token + DB writes here, all OAuth
and PII handling in services/idme_service.py.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth_citizen import get_current_citizen
from app.db import get_db
from app.models.pages import CitizenAccount
from app.services.idme_service import (
    DEFAULT_POST_AUTH_REDIRECT,
    IdMeError,
    cost_skip_match,
    cost_skip_match_by_attributes,
    encrypt_legal_name,
    get_verification_service,
    hash_address,
    mint_state_token,
    verify_state_token,
    write_archive_entry,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────
# Response models
# ─────────────────────────────────────────────────────────────────────
class VerificationStatusResponse(BaseModel):
    """Public probe so the UI can decide whether to render a real
    'Verify with ID.me' button or a 'verification not yet activated'
    notice. No auth required."""
    is_configured: bool


class StartVerificationResponse(BaseModel):
    """URL the frontend redirects the user to in order to begin
    ID.me verification. configured=False signals the dev backend
    handed back a placeholder — the frontend should render a
    'verification not yet activated' message instead of navigating
    away."""
    url: str
    configured: bool


# ─────────────────────────────────────────────────────────────────────
# Public status probe
# ─────────────────────────────────────────────────────────────────────
@router.get("/status", response_model=VerificationStatusResponse)
def verification_status():
    """Cheap configuration probe. No auth — anyone can ask whether
    ID.me is wired up."""
    return VerificationStatusResponse(
        is_configured=get_verification_service().is_configured(),
    )


# ─────────────────────────────────────────────────────────────────────
# Citizen-only: start a verification flow
# ─────────────────────────────────────────────────────────────────────
@router.post("/start", response_model=StartVerificationResponse)
def start_verification(
    db: Session = Depends(get_db),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """Mint a state token + return the ID.me authorize URL for the
    signed-in citizen.

    Cost-skip pre-check: before sending the user to ID.me, look up
    their email in the verified-identity archive. If they've been
    verified before (i.e., previously deleted account at this
    email), flip the verified flag immediately and skip the $1.50
    charge. We don't update legal_name / address on this path
    because we don't have the original verified attributes — those
    are at ID.me. The flag is enough; the BillingSection +
    engagement gates only check `verified`.
    """
    if citizen.verified:
        # Already verified — no need to send them through again.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You're already verified.",
        )

    # ── Primary cost-skip ──
    # Email-hash hit means a previously-deleted account at this
    # exact email was ID.me-verified. Mark verified immediately +
    # skip ID.me entirely.
    archive_hit = cost_skip_match(db, email=citizen.email)
    if archive_hit is not None:
        citizen.verified = True
        citizen.verified_at = datetime.utcnow()
        citizen.verified_method = "id.me-archive"
        db.commit()
        logger.info(
            "ID.me cost-skip: citizen id=%s verified via archive (email match)",
            citizen.id,
        )
        # Return a URL the frontend can navigate to that just bounces
        # back to /account?verified=1 — no ID.me round-trip needed.
        return StartVerificationResponse(
            url=f"{DEFAULT_POST_AUTH_REDIRECT}&via=archive",
            configured=True,
        )

    svc = get_verification_service()
    state = mint_state_token(citizen.id)
    return StartVerificationResponse(
        url=svc.build_authorize_url(state_token=state),
        configured=svc.is_configured(),
    )


# ─────────────────────────────────────────────────────────────────────
# OAuth callback — ID.me → us
# ─────────────────────────────────────────────────────────────────────
@router.get("/callback")
def verification_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """Receive the OAuth redirect from ID.me, exchange the code for
    verified attributes, update the citizen row + archive, then
    bounce the browser back to the frontend.

    Identity is taken from the signed state token, NOT the cookie —
    the redirect from ID.me may arrive with a different cookie
    context than the one that initiated the flow (cross-site cookie
    rules, Safari ITP, etc.).

    On success the browser lands at IDME_POST_AUTH_REDIRECT with
    ?verified=1. On any failure it lands there with ?verified=0
    plus an &reason= so the frontend can render an explanatory
    message.
    """
    import os
    bounce_base = os.getenv("IDME_POST_AUTH_REDIRECT") or DEFAULT_POST_AUTH_REDIRECT

    # ── Hard fails first: missing params / ID.me-side error ──
    if error:
        logger.info(
            "ID.me callback returned error=%s description=%s",
            error, error_description,
        )
        return RedirectResponse(
            f"{bounce_base.replace('verified=1', 'verified=0')}&reason=idme_error",
            status_code=303,
        )
    if not code or not state:
        return RedirectResponse(
            f"{bounce_base.replace('verified=1', 'verified=0')}&reason=missing_params",
            status_code=303,
        )

    # ── Validate state token (CSRF protection) ──
    citizen_id = verify_state_token(state)
    if citizen_id is None:
        return RedirectResponse(
            f"{bounce_base.replace('verified=1', 'verified=0')}&reason=bad_state",
            status_code=303,
        )
    citizen = db.get(CitizenAccount, citizen_id)
    if citizen is None:
        return RedirectResponse(
            f"{bounce_base.replace('verified=1', 'verified=0')}&reason=account_missing",
            status_code=303,
        )
    if citizen.verified:
        # Idempotent — repeated callbacks for an already-verified
        # citizen don't re-charge or re-overwrite. Just bounce home.
        return RedirectResponse(
            f"{bounce_base}&via=already_verified",
            status_code=303,
        )

    # ── Exchange code for verified attributes ──
    svc = get_verification_service()
    try:
        attrs = svc.exchange_code_for_attributes(code=code)
    except IdMeError:
        logger.exception("ID.me code exchange failed for citizen id=%s", citizen_id)
        return RedirectResponse(
            f"{bounce_base.replace('verified=1', 'verified=0')}&reason=exchange_failed",
            status_code=303,
        )

    if attrs.ial_level < 2:
        # ID.me reported the user but at an insufficient assurance
        # level (some scopes return basic attributes without full
        # IAL2 verification). Refuse — we need IAL2 for the
        # "verified constituent" claim to mean anything.
        return RedirectResponse(
            f"{bounce_base.replace('verified=1', 'verified=0')}&reason=insufficient_ial",
            status_code=303,
        )

    # ── Secondary cost-skip ──
    # Even though they passed ID.me here (so the charge already
    # happened on ID.me's side for *this* verification), we still
    # write a fresh archive entry so a FUTURE re-signup gets the
    # cost-skip. The secondary path is more of a "find existing
    # row to update" than a charge-avoidance — see write_archive_entry
    # for the dedupe logic.
    now = datetime.utcnow()

    # ── Apply to the citizen row ──
    citizen.verified = True
    citizen.verified_at = now
    citizen.verified_method = "id.me"
    try:
        citizen.verified_legal_name_encrypted = encrypt_legal_name(attrs.legal_name)
    except Exception:
        # Encryption depends on SESSION_SECRET; if it's misconfigured
        # we still grant verification (the flag is what gates
        # features) but log so an operator can fix.
        logger.exception(
            "ID.me callback: legal_name encryption failed for citizen id=%s",
            citizen_id,
        )
    citizen.verified_address_hash = hash_address(attrs)
    # Update geography to the verified ground truth so the
    # state + district scope filters reflect reality, not the
    # citizen's original self-attestation.
    if attrs.address_state:
        citizen.state = attrs.address_state
    if attrs.address_city:
        citizen.city = attrs.address_city
    # NOTE: we don't auto-update congressional_district here —
    # that requires a Census-geocoder round-trip from the
    # verified address. Wire that into the cutover work; for now
    # the citizen's previously-set district stays put.
    db.commit()

    # ── Write / update the archive ──
    try:
        write_archive_entry(db, email=citizen.email, attrs=attrs, verified_at=now)
    except Exception:
        # Archive write is best-effort — verification already
        # succeeded on the citizen row. Log loudly so we can
        # backfill the archive if needed.
        logger.exception(
            "ID.me callback: archive write failed for citizen id=%s",
            citizen_id,
        )

    logger.info(
        "ID.me verification completed for citizen id=%s state=%s city=%s",
        citizen_id, citizen.state, citizen.city,
    )
    return RedirectResponse(f"{bounce_base}&via=id.me", status_code=303)
