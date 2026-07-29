# CivicView — engagement entitlements (the "dormant switch").
# Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Engagement permission gates — written NOW, enforced LATER.

THE POINT OF THIS MODULE
Before it existed, CivicView's permission model lived only in prose:
CLAUDE.md, the README tier table, the identity-model PDF, and a dozen
UI strings all described gates that NO CODE ENFORCED. Comment creation
and poll creation both checked exactly one thing — "is there a signed-in
citizen session" — and `is_subscribed` was populated but never read as a
permission. The gates weren't disabled; they were unimplemented, and an
unimplemented gate is one nobody remembers to build.

So the enforcement is written and wired onto the real endpoints today,
and it NO-OPS until `IDME_ENABLED` is true. That makes the launch step
an env var instead of a platform migration, and it puts the model in the
route signature where the next reader will actually see it.

THE MODEL (source of truth: CLAUDE.md + docs/identity-model.pdf,
changed 2026-07-28 when commenting moved down a tier)

    Anonymous    browse, search, track
    Verified     like / dislike, vote on polls, COMMENT
    Subscribed   create polls

WHAT THESE FUNCTIONS DELIBERATELY DO NOT GATE
  • Reporting content — a safety valve must never require a paid or
    verified account. Abuse reporting stays open to every signed-in user.
  • Removing your own reaction / editing / deleting your own content —
    if you could create it, you can always withdraw or manage it. This
    also matters for the demo sunset: a demo user must be able to clean
    up their own history right up to the deletion date.
  • Reps and candidates engaging on their OWN page. They're verified by
    the page-claim process, not by ID.me, and they never subscribe.
    Passing citizen=None (which _resolve_engager returns for the
    rep/candidate paths) is always allowed.

See docs/demo-sunset-and-migration-prd.md §3.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status

# Machine-readable codes so the frontend can route to the RIGHT call to
# action — "verify your identity" and "subscribe" are different screens,
# and a generic 403 would send users to the wrong one.
CODE_VERIFICATION_REQUIRED = "verification_required"
CODE_SUBSCRIPTION_REQUIRED = "subscription_required"

_TRUTHY = ("1", "true", "yes", "on")


def idme_enabled() -> bool:
    """Master switch. While false, every gate below is a no-op and demo
    accounts behave exactly as they do today. Flip to true only when
    ID.me verification is live AND real accounts can actually verify —
    turning this on early locks demo users out of their own history."""
    return os.getenv("IDME_ENABLED", "").strip().lower() in _TRUTHY


def demo_sunset_at() -> Optional[datetime]:
    """Deadline after which un-migrated demo accounts are soft-deleted
    (PRD §D3). Drives countdown copy and the sunset job. Returns None
    when unset or unparseable — callers must treat None as "no sunset
    scheduled" and show nothing, never as "sunset now"."""
    raw = os.getenv("DEMO_SUNSET_AT", "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _is_verified(citizen) -> bool:
    """Demo grants count as verified ONLY while the switch is off, and
    that path never reaches here — once IDME_ENABLED is true, a
    `verified_method='demo'` account is NOT verified. That is the whole
    point of the sunset: demo accounts must convert, not coast."""
    return bool(getattr(citizen, "verified", False))


def require_verified(citizen, *, action: str = "do this") -> None:
    """Gate a VERIFIED-tier action (comment, like / dislike, poll vote).

    No-ops when the switch is off, and when `citizen` is None — None
    means _resolve_engager picked the rep or candidate path, and page
    owners are verified by claim.
    """
    if not idme_enabled():
        return
    if citizen is None:
        return
    if _is_verified(citizen):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": CODE_VERIFICATION_REQUIRED,
            "message": (
                f"Verify your identity to {action}. Verification is free and "
                "confirms you're a real constituent — it's what makes your "
                "voice count differently from an anonymous one."
            ),
        },
    )


def require_subscribed(citizen, *, action: str = "do this") -> None:
    """Gate the SUBSCRIBED-tier action (creating polls — the only one).

    Subscription implies verification, so this checks verification first
    and returns the verification error when that's what's actually
    missing. Sending an unverified user to a payment screen they can't
    complete is the kind of dead end that makes people leave.
    """
    if not idme_enabled():
        return
    if citizen is None:
        return
    if not _is_verified(citizen):
        require_verified(citizen, action=action)
    if bool(getattr(citizen, "is_subscribed", False)):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": CODE_SUBSCRIPTION_REQUIRED,
            "message": (
                f"A CivicView subscription is required to {action}. Commenting, "
                "liking, and voting stay free with a verified account."
            ),
        },
    )
