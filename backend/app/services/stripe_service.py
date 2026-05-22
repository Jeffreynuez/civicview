# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Stripe billing service (Task #88).

Scaffolds the citizen $5/mo subscription flow. Two backends, picked by
env vars (same swappable pattern as image_storage + email_service):

  • StripeBillingService — production. Talks to Stripe's REST API via
    the official `stripe` Python library. Requires STRIPE_API_KEY +
    STRIPE_PRICE_ID + STRIPE_WEBHOOK_SECRET + STRIPE_SUCCESS_URL +
    STRIPE_CANCEL_URL.
  • DevBillingService — dev fallback. Returns a synthetic checkout
    URL that just bounces the user back to the success URL with a
    flag so the frontend can simulate a paid state. NEVER calls
    Stripe. Useful so a developer can exercise the subscribe button +
    paid-feature gates end-to-end without provisioning a Stripe
    account.

Why this lives behind an abstraction:
  • The Stripe account isn't set up yet — the user provisions it
    after launching the business. Without the env-gated fallback the
    backend would crash on boot.
  • Tests should never hit Stripe — DevBillingService gives them a
    deterministic path.
  • If we ever swap billing providers (Paddle, Lemon Squeezy, etc.)
    the abstraction confines the change to this module.

Webhook handling: the service exposes parse_webhook_event() which
verifies the Stripe signature and returns a normalized
NormalizedWebhookEvent the router can switch on. Signature
verification is non-negotiable — without it an attacker who knows
the webhook URL could fake activation events to grant free
subscriptions.

Customer Portal: when a subscribed citizen wants to cancel / update
payment / view invoices, we send them to Stripe's hosted Customer
Portal (no custom UI required). This is the recommended path per
Stripe's docs and saves us from re-implementing payment-method
collection.

Webhook event coverage:
  checkout.session.completed     — first activation; capture
                                   customer_id + subscription_id + period_end
  customer.subscription.updated  — renewal, status changes
  customer.subscription.deleted  — cancellation (immediate or end-
                                   of-period); set is_subscribed=False
  invoice.payment_failed         — subscription moves to past_due;
                                   downstream policy decides whether
                                   to keep is_subscribed True (we
                                   currently do — Stripe will retry
                                   the payment 3x before canceling).

All callable methods return Python primitives + don't raise on the
happy path. Errors raise StripeBillingError so the router can map
them to 4xx/5xx consistently.
"""
from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional


logger = logging.getLogger(__name__)


class StripeBillingError(Exception):
    """Raised by billing operations that can't complete (network,
    invalid configuration, signature verification failure). Routers
    catch this and surface a user-safe message."""


# ─────────────────────────────────────────────────────────────────────
# Normalized event shape — the router only deals with these, not raw
# Stripe dicts. Both backends produce the same shape so swap-out is
# transparent.
# ─────────────────────────────────────────────────────────────────────
@dataclass
class NormalizedWebhookEvent:
    """A webhook event after backend-specific parsing. event_type maps
    1:1 to Stripe's event.type ('checkout.session.completed', etc.).

    Fields are best-effort — not every event type populates every
    field. Routers should check for None before reading.
    """
    event_type: str
    # Stripe Customer object ID, "cus_...". Always set on subscription-
    # bearing events.
    customer_id: Optional[str] = None
    # Stripe Subscription object ID, "sub_...". Set on subscription-
    # bearing events; absent on checkout.session.completed where the
    # subscription is created as a side effect.
    subscription_id: Optional[str] = None
    # Subscription status string ('active', 'trialing', 'past_due',
    # 'canceled', etc.). Mirrors Stripe's enum verbatim.
    status: Optional[str] = None
    # When the current paid period ends. Used to populate
    # CitizenAccount.current_period_end so the UI can show
    # "Renewing on 2026-06-21". Stored as UTC datetime.
    current_period_end: Optional[datetime] = None
    # The citizen_id we passed as Stripe metadata on Checkout. Used
    # by the router to look up which CitizenAccount this event
    # belongs to. Falls back to looking up by stripe_customer_id if
    # absent.
    citizen_id: Optional[int] = None
    # Raw event payload for logging / debugging. Don't read this in
    # router code — that defeats the abstraction.
    raw: Any = None


# ─────────────────────────────────────────────────────────────────────
# Abstract interface
# ─────────────────────────────────────────────────────────────────────
class BillingService(ABC):
    """Billing backend protocol. Both Stripe + Dev backends implement
    these four methods + each lays its own connectivity concerns."""

    @abstractmethod
    def create_checkout_session(
        self,
        *,
        citizen_id: int,
        citizen_email: str,
        success_url: Optional[str] = None,
        cancel_url: Optional[str] = None,
    ) -> str:
        """Return a URL the user should be redirected to in order to
        complete checkout. The URL is short-lived (Stripe ~24h).
        success_url + cancel_url override the configured defaults
        when set — useful for "subscribe from the X page → come back
        to X" flows."""

    @abstractmethod
    def create_portal_session(
        self,
        *,
        stripe_customer_id: str,
        return_url: Optional[str] = None,
    ) -> str:
        """Return a URL into Stripe's hosted Customer Portal where the
        user can update payment, cancel, view invoices, etc. The
        portal redirects back to return_url when the user is done."""

    @abstractmethod
    def parse_webhook_event(
        self,
        *,
        payload_bytes: bytes,
        signature_header: Optional[str],
    ) -> NormalizedWebhookEvent:
        """Verify the webhook signature (production) and return the
        parsed event. Raises StripeBillingError on signature failure.

        The router passes the request body bytes verbatim — DO NOT
        re-encode or re-parse before passing here, that breaks
        signature verification."""

    @abstractmethod
    def is_configured(self) -> bool:
        """True if this backend can actually make Stripe API calls.
        DevBillingService returns False so the UI can render a
        "billing not yet active" notice instead of a dead Subscribe
        button."""


# ─────────────────────────────────────────────────────────────────────
# Stripe — production backend
# ─────────────────────────────────────────────────────────────────────
class StripeBillingService(BillingService):
    """Hosted-checkout flow via the official Stripe library.

    Required env vars:
      STRIPE_API_KEY        — secret API key from
                              dashboard.stripe.com → Developers →
                              API keys → 'Secret key'. Starts with
                              `sk_test_...` in test mode or
                              `sk_live_...` in production.
      STRIPE_PRICE_ID       — the Price object ID for the $5/mo
                              citizen subscription, looks like
                              `price_...`. Create in Stripe dashboard
                              → Products → CivicView Citizen.
      STRIPE_WEBHOOK_SECRET — endpoint signing secret, `whsec_...`.
                              From Developers → Webhooks → your
                              endpoint → Signing secret.

    Optional env vars:
      STRIPE_SUCCESS_URL    — Where the user lands after successful
                              checkout. Defaults to
                              https://civicview.app/account?subscribed=1
      STRIPE_CANCEL_URL     — Where the user lands if they cancel
                              checkout. Defaults to
                              https://civicview.app/account?subscribed=0

    Lazy-imports stripe so dev environments without it installed
    fall back cleanly to DevBillingService.
    """

    def __init__(self):
        try:
            import stripe  # noqa: F401 — imported for the side effect
        except ImportError as e:
            raise RuntimeError(
                "Stripe billing requested but the `stripe` package isn't "
                "installed. Run `pip install -r requirements.txt` to pick "
                "up stripe>=7."
            ) from e

        import stripe as stripe_mod
        self._stripe = stripe_mod
        self._stripe.api_key = _require_env("STRIPE_API_KEY")
        self._price_id = _require_env("STRIPE_PRICE_ID")
        self._webhook_secret = _require_env("STRIPE_WEBHOOK_SECRET")
        self._success_url = os.getenv(
            "STRIPE_SUCCESS_URL",
            "https://civicview.app/account?subscribed=1",
        )
        self._cancel_url = os.getenv(
            "STRIPE_CANCEL_URL",
            "https://civicview.app/account?subscribed=0",
        )

    def is_configured(self) -> bool:
        return True

    def create_checkout_session(
        self,
        *,
        citizen_id: int,
        citizen_email: str,
        success_url: Optional[str] = None,
        cancel_url: Optional[str] = None,
    ) -> str:
        try:
            session = self._stripe.checkout.Session.create(
                mode="subscription",
                # Citizen tier — single $5/mo price. quantity=1 is the
                # only sensible value (no per-seat licensing here).
                line_items=[{"price": self._price_id, "quantity": 1}],
                # customer_email pre-fills the email field on the
                # Stripe-hosted page. Stripe will create a new
                # Customer object on completion if one doesn't
                # already exist for this email.
                customer_email=citizen_email,
                success_url=success_url or self._success_url,
                cancel_url=cancel_url or self._cancel_url,
                # Stash the citizen id so the webhook handler can map
                # the resulting subscription back to our row without
                # depending on email matching (which can race if the
                # user updates their email mid-checkout).
                metadata={"citizen_id": str(citizen_id)},
                # Mirror metadata onto the underlying subscription
                # too so non-checkout events (updates, deletes) can
                # still resolve the citizen via either lookup path.
                subscription_data={
                    "metadata": {"citizen_id": str(citizen_id)},
                },
                # Allows the user to enter a coupon code at checkout.
                # No tax handling here — tax is collected separately
                # via Stripe Tax once we enable it.
                allow_promotion_codes=True,
            )
            return session.url  # type: ignore[no-any-return]
        except Exception as e:
            logger.exception("Stripe Checkout session creation failed")
            raise StripeBillingError("Could not start the checkout flow.") from e

    def create_portal_session(
        self,
        *,
        stripe_customer_id: str,
        return_url: Optional[str] = None,
    ) -> str:
        try:
            session = self._stripe.billing_portal.Session.create(
                customer=stripe_customer_id,
                return_url=return_url
                or os.getenv(
                    "STRIPE_PORTAL_RETURN_URL",
                    "https://civicview.app/account",
                ),
            )
            return session.url  # type: ignore[no-any-return]
        except Exception as e:
            logger.exception("Stripe Customer Portal session creation failed")
            raise StripeBillingError(
                "Could not open the billing portal.",
            ) from e

    def parse_webhook_event(
        self,
        *,
        payload_bytes: bytes,
        signature_header: Optional[str],
    ) -> NormalizedWebhookEvent:
        if not signature_header:
            raise StripeBillingError("Missing Stripe-Signature header.")
        try:
            event = self._stripe.Webhook.construct_event(
                payload_bytes, signature_header, self._webhook_secret,
            )
        except Exception as e:
            # construct_event raises stripe.error.SignatureVerificationError
            # on bad signature. Don't leak the underlying message — the
            # webhook caller is Stripe (or an attacker pretending to be
            # Stripe); they don't need our debugging.
            logger.warning("Stripe webhook signature verification failed: %s", e)
            raise StripeBillingError("Invalid webhook signature.") from e
        return _normalize_event(event.to_dict())


# ─────────────────────────────────────────────────────────────────────
# Dev — synthetic backend
# ─────────────────────────────────────────────────────────────────────
class DevBillingService(BillingService):
    """Fake billing backend for environments without a Stripe account.

    create_checkout_session returns a non-Stripe URL that the
    frontend can handle as "pretend you paid" — the dev frontend
    can route this through a localhost endpoint that flips
    is_subscribed=True directly. We intentionally don't have the
    backend do that auto-flip here — that would be too much magic +
    would make it easy to ship the dev backend to prod unnoticed.

    parse_webhook_event returns a no-op event because there's no
    real Stripe sending us webhooks. If a test wants to exercise the
    webhook codepath it should construct a NormalizedWebhookEvent
    directly and call the router-internal apply function.
    """

    def is_configured(self) -> bool:
        return False

    def create_checkout_session(
        self,
        *,
        citizen_id: int,
        citizen_email: str,
        success_url: Optional[str] = None,
        cancel_url: Optional[str] = None,
    ) -> str:
        # Return a recognizable URL the frontend can render as
        # "billing isn't configured" rather than navigating away.
        # Using a query string instead of a path so the URL still
        # parses cleanly in the browser if a developer copy-pastes.
        return (
            f"about:blank?stripe-dev=1&citizen_id={citizen_id}"
            f"&reason=stripe_not_configured"
        )

    def create_portal_session(
        self,
        *,
        stripe_customer_id: str,
        return_url: Optional[str] = None,
    ) -> str:
        return "about:blank?stripe-dev-portal=1&reason=stripe_not_configured"

    def parse_webhook_event(
        self,
        *,
        payload_bytes: bytes,
        signature_header: Optional[str],
    ) -> NormalizedWebhookEvent:
        # Fail closed — without a webhook secret we can't verify
        # signatures, so we refuse to process anything. This blocks
        # an accidental "dev backend in prod" scenario from granting
        # subscriptions on forged webhooks.
        raise StripeBillingError(
            "Webhooks aren't accepted in dev mode (no STRIPE_WEBHOOK_SECRET).",
        )


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(
            f"Stripe billing requested but {name} is not set. "
            f"Set STRIPE_API_KEY + STRIPE_PRICE_ID + STRIPE_WEBHOOK_SECRET "
            f"together — partial config breaks at runtime."
        )
    return val


def _normalize_event(event: dict) -> NormalizedWebhookEvent:
    """Pull the fields we care about out of a raw Stripe event dict.

    Stripe events nest the relevant object under `data.object`. The
    exact shape of that object varies by event_type — checkout
    sessions, subscriptions, and invoices all have different
    surfaces. This function flattens to the union we care about so
    routers don't have to learn Stripe's schema."""
    event_type = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}

    # Pull citizen_id from metadata wherever it lives. Checkout
    # session events nest the subscription's metadata one level
    # deeper than direct subscription events; we check both paths.
    metadata = obj.get("metadata") or {}
    citizen_id_str = metadata.get("citizen_id")
    if not citizen_id_str:
        sub_obj = obj.get("subscription_details") or {}
        sub_metadata = sub_obj.get("metadata") or {}
        citizen_id_str = sub_metadata.get("citizen_id")
    citizen_id: Optional[int] = None
    if citizen_id_str:
        try:
            citizen_id = int(citizen_id_str)
        except (TypeError, ValueError):
            citizen_id = None

    # Customer + subscription IDs live at different positions
    # depending on event type. Be permissive.
    customer_id = obj.get("customer")
    subscription_id = obj.get("subscription") or (
        obj.get("id") if event_type.startswith("customer.subscription.") else None
    )

    # Subscription status only lives on subscription events.
    status = obj.get("status") if event_type.startswith("customer.subscription.") else None

    # current_period_end is a Unix timestamp (int) on subscription
    # objects. Convert to UTC datetime for the DB column.
    cpe_raw = obj.get("current_period_end")
    cpe: Optional[datetime] = None
    if isinstance(cpe_raw, (int, float)):
        try:
            cpe = datetime.utcfromtimestamp(cpe_raw)
        except (ValueError, OSError, OverflowError):
            cpe = None

    return NormalizedWebhookEvent(
        event_type=event_type,
        customer_id=customer_id,
        subscription_id=subscription_id,
        status=status,
        current_period_end=cpe,
        citizen_id=citizen_id,
        raw=event,
    )


# ─────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────
_BILLING_SINGLETON: Optional[BillingService] = None


def get_billing_service() -> BillingService:
    """Return the active billing backend. Picks StripeBillingService
    when the full env var set is present; falls back to
    DevBillingService otherwise. Cached singleton — reuses the same
    stripe module + price id across requests."""
    global _BILLING_SINGLETON
    if _BILLING_SINGLETON is not None:
        return _BILLING_SINGLETON

    if _stripe_env_present():
        try:
            _BILLING_SINGLETON = StripeBillingService()
            logger.info(
                "Billing service: Stripe backend active (price=%s)",
                os.getenv("STRIPE_PRICE_ID"),
            )
            return _BILLING_SINGLETON
        except Exception:
            logger.exception(
                "Stripe env vars are set but StripeBillingService failed to "
                "initialize — falling back to DevBillingService. Check the "
                "stripe install + verify STRIPE_* credentials in the Stripe "
                "dashboard."
            )

    _BILLING_SINGLETON = DevBillingService()
    logger.info(
        "Billing service: Dev backend active (Subscribe button + webhooks "
        "are inert until STRIPE_* env vars are set).",
    )
    return _BILLING_SINGLETON


def reset_billing_service_for_tests() -> None:
    """Test-only hook to clear the cached singleton so env-var changes
    take effect between test cases. Not used in production code."""
    global _BILLING_SINGLETON
    _BILLING_SINGLETON = None


def _stripe_env_present() -> bool:
    """True iff every required Stripe env var is set + non-empty."""
    required = ("STRIPE_API_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET")
    return all((os.getenv(name) or "").strip() for name in required)


# ─────────────────────────────────────────────────────────────────────
# Webhook → DB applier (used by the router after parse_webhook_event)
# ─────────────────────────────────────────────────────────────────────
# Lives here rather than in the router so the swap-and-apply logic
# stays next to the normalization logic. The router becomes a thin
# HTTP shim.

def apply_webhook_event(db, event: NormalizedWebhookEvent) -> None:
    """Mutate the matching CitizenAccount row based on the event.

    Lookup strategy: citizen_id (from metadata) first, then
    stripe_customer_id, then stripe_subscription_id. The metadata
    path is the most reliable — we control what we put there at
    Checkout time. The other paths exist for events that didn't
    originate from our Checkout flow (e.g., manual subscription
    creation via the Stripe Dashboard, or a renewal event arriving
    after the citizen's metadata expired).

    Idempotent — re-applying the same event is a no-op. Stripe
    retries webhooks aggressively on transient failures + can
    deliver the same event multiple times during normal operation,
    so non-idempotent handlers leak duplicate side effects.
    """
    from app.models.pages import CitizenAccount  # local import to avoid cycles

    # ── Find the row ──
    citizen = None
    if event.citizen_id is not None:
        citizen = db.get(CitizenAccount, event.citizen_id)
    if citizen is None and event.customer_id:
        citizen = (
            db.query(CitizenAccount)
            .filter(CitizenAccount.stripe_customer_id == event.customer_id)
            .first()
        )
    if citizen is None and event.subscription_id:
        citizen = (
            db.query(CitizenAccount)
            .filter(CitizenAccount.stripe_subscription_id == event.subscription_id)
            .first()
        )
    if citizen is None:
        logger.warning(
            "Stripe webhook %s: no matching citizen for customer=%s sub=%s metadata_id=%s",
            event.event_type, event.customer_id, event.subscription_id, event.citizen_id,
        )
        return

    # ── Capture Stripe IDs the first time we see them ──
    if event.customer_id and not citizen.stripe_customer_id:
        citizen.stripe_customer_id = event.customer_id
    if event.subscription_id and not citizen.stripe_subscription_id:
        citizen.stripe_subscription_id = event.subscription_id

    # ── Apply the per-event-type transition ──
    et = event.event_type
    if et == "checkout.session.completed":
        # First activation. Status comes through on a subscription
        # event right after, but we optimistically grant access here
        # so the user sees the paid state on the success-page redirect
        # without waiting for the subscription.updated round-trip.
        citizen.is_subscribed = True
        # Don't overwrite an existing status — the subscription event
        # is the authoritative source for that field.
        if not citizen.subscription_status:
            citizen.subscription_status = "active"
    elif et.startswith("customer.subscription."):
        # active, trialing, past_due, canceled, incomplete,
        # incomplete_expired, unpaid, paused
        if event.status:
            citizen.subscription_status = event.status
            citizen.is_subscribed = event.status in {"active", "trialing"}
        if event.current_period_end is not None:
            citizen.current_period_end = event.current_period_end
        # Subscription deletion: keep stripe_customer_id around (so a
        # future reactivation reuses the same Customer) but drop the
        # subscription_id since it no longer exists in Stripe.
        if et == "customer.subscription.deleted":
            citizen.stripe_subscription_id = None
            citizen.is_subscribed = False
            citizen.subscription_status = "canceled"
    elif et == "invoice.payment_failed":
        # Stripe will retry the invoice automatically (Smart Retries).
        # Move the user to past_due so the UI can show a "update your
        # payment method" banner; keep is_subscribed True until the
        # subscription.updated event reflects canceled / unpaid.
        citizen.subscription_status = "past_due"
    else:
        # Unhandled event types are silently ignored — Stripe sends
        # many we don't care about (charge.succeeded, etc.). Logging
        # at DEBUG so a noisy webhook doesn't flood logs.
        logger.debug("Stripe webhook: ignoring event type %s", et)
        return

    db.commit()
    logger.info(
        "Stripe webhook %s applied to citizen id=%s status=%s is_subscribed=%s",
        et, citizen.id, citizen.subscription_status, citizen.is_subscribed,
    )
