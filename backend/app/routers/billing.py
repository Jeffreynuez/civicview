# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Billing router (Task #88).

Endpoints:
  POST /api/billing/checkout-session  → start a hosted Checkout
  POST /api/billing/portal-session    → open the Stripe Customer Portal
  POST /api/billing/webhook           → Stripe → us (subscription events)
  GET  /api/billing/status            → quick "is billing configured?" probe

Only citizens can subscribe (Task #88 scope), so the
checkout-session + portal-session endpoints sit behind the citizen
auth dep. The webhook endpoint is unauthenticated by design — Stripe
authenticates itself with the signature header that our service
verifies. Without verification, an attacker who guesses the webhook
URL could fake activation events.

The router stays thin: it converts HTTP requests into service calls,
maps service exceptions to status codes, and shapes responses. All
billing logic + DB writes live in services/stripe_service.py.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.auth_citizen import get_current_citizen
from app.db import get_db
from app.models.pages import CitizenAccount
from app.services.stripe_service import (
    StripeBillingError,
    apply_webhook_event,
    get_billing_service,
)


logger = logging.getLogger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────
# Response models
# ─────────────────────────────────────────────────────────────────────
class CheckoutSessionResponse(BaseModel):
    """URL the frontend redirects the user to. window.location.assign
    (or document.location.href = url) is the standard pattern —
    Stripe Checkout doesn't play well with iframes."""
    url: str
    # True iff the billing backend is real Stripe. False means the
    # dev backend returned a placeholder URL — the frontend should
    # show "billing isn't activated yet" instead of redirecting.
    configured: bool


class PortalSessionResponse(BaseModel):
    """URL into Stripe's hosted Customer Portal."""
    url: str
    configured: bool


class BillingStatusResponse(BaseModel):
    """Cheap probe so the UI can decide whether to render a real
    Subscribe button or a 'billing not yet activated' notice.

    is_configured: True when the Stripe env vars are set.
    price_id_present: True when STRIPE_PRICE_ID is set (separate from
      is_configured so the UI can distinguish 'no Stripe at all' vs.
      'Stripe set up but no price chosen yet').

    Note this endpoint is intentionally public — there's nothing
    sensitive about knowing whether the backend has been wired up.
    """
    model_config = ConfigDict(from_attributes=True)
    is_configured: bool
    price_id_present: bool


class CheckoutSessionRequest(BaseModel):
    """Optional overrides for where the user lands after checkout
    completes / cancels. Useful so a 'subscribe from /polls' flow
    can bring the user back to /polls instead of /account."""
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class PortalSessionRequest(BaseModel):
    """Optional override for where the user lands after they exit
    the Stripe Customer Portal."""
    return_url: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────
# Public status probe
# ─────────────────────────────────────────────────────────────────────
@router.get("/status", response_model=BillingStatusResponse)
def billing_status():
    """Cheap configuration probe. No auth — anyone can ask whether
    billing is wired up. Used by the frontend to show/hide the
    Subscribe button + render an honest "coming soon" copy state
    when Stripe creds aren't set yet."""
    import os
    return BillingStatusResponse(
        is_configured=get_billing_service().is_configured(),
        price_id_present=bool((os.getenv("STRIPE_PRICE_ID") or "").strip()),
    )


# ─────────────────────────────────────────────────────────────────────
# Citizen-only: start a checkout session
# ─────────────────────────────────────────────────────────────────────
@router.post("/checkout-session", response_model=CheckoutSessionResponse)
def create_checkout_session(
    payload: CheckoutSessionRequest = CheckoutSessionRequest(),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """Start a Stripe hosted Checkout session for the signed-in
    citizen. Returns the URL — the frontend redirects to it.

    If billing isn't configured yet (dev backend), we still return
    a URL (`about:blank?stripe-dev=1...`) but mark configured=False
    so the frontend can render a "billing isn't activated" message
    instead of navigating away.
    """
    if citizen.is_subscribed:
        # Already subscribed — they should go to the billing portal,
        # not start a second subscription. Return a 409 with a
        # pointer the frontend can act on.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You're already subscribed. Use the billing portal to manage your subscription.",
        )
    svc = get_billing_service()
    try:
        url = svc.create_checkout_session(
            citizen_id=citizen.id,
            citizen_email=citizen.email,
            success_url=payload.success_url,
            cancel_url=payload.cancel_url,
        )
    except StripeBillingError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        )
    return CheckoutSessionResponse(url=url, configured=svc.is_configured())


# ─────────────────────────────────────────────────────────────────────
# Citizen-only: open the Stripe Customer Portal
# ─────────────────────────────────────────────────────────────────────
@router.post("/portal-session", response_model=PortalSessionResponse)
def create_portal_session(
    payload: PortalSessionRequest = PortalSessionRequest(),
    citizen: CitizenAccount = Depends(get_current_citizen),
):
    """Open the Stripe Customer Portal so the citizen can update
    payment method, cancel, view invoices, etc. — without us
    having to build a custom UI for any of it.

    Requires a previously-set stripe_customer_id, which only exists
    after a successful checkout. Returns 409 with a "subscribe
    first" message if the citizen hasn't been through checkout.
    """
    svc = get_billing_service()
    if not citizen.stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "No billing information on file. Subscribe first to set up "
                "a payment method."
            ),
        )
    try:
        url = svc.create_portal_session(
            stripe_customer_id=citizen.stripe_customer_id,
            return_url=payload.return_url,
        )
    except StripeBillingError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(e),
        )
    return PortalSessionResponse(url=url, configured=svc.is_configured())


# ─────────────────────────────────────────────────────────────────────
# Webhook — Stripe → us
# ─────────────────────────────────────────────────────────────────────
@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
):
    """Receive + process Stripe webhook events.

    Authentication is via the Stripe-Signature header, verified
    inside the billing service against STRIPE_WEBHOOK_SECRET. NO
    other auth — Stripe doesn't have a way to send our cookies.

    We accept the raw request body bytes verbatim and pass them to
    the service for verification. Re-encoding the JSON breaks the
    signature.

    Returns 200 even on most non-fatal failures so Stripe doesn't
    enter the exponential retry loop for events we logged + chose
    not to act on. Returns 400 only on signature failure — that
    DOES merit a retry because it's almost certainly a config
    problem on our end (rotated secret, etc.) rather than the event
    being un-actionable.
    """
    payload_bytes = await request.body()
    svc = get_billing_service()
    try:
        event = svc.parse_webhook_event(
            payload_bytes=payload_bytes,
            signature_header=stripe_signature,
        )
    except StripeBillingError as e:
        # Bad signature OR dev backend rejecting webhooks. Either way,
        # return 400 so Stripe retries (in prod the retry will succeed
        # once the secret mismatch is fixed).
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    try:
        apply_webhook_event(db, event)
    except Exception:
        # Log + swallow — Stripe will retry the event if we return
        # non-2xx, and we want the next attempt to come through
        # cleanly rather than enter an infinite loop on the same
        # row.
        logger.exception(
            "Webhook event %s failed to apply to DB — returning 200 anyway "
            "so Stripe doesn't retry. Investigate the error above.",
            event.event_type,
        )
    return {"received": True, "event_type": event.event_type}
