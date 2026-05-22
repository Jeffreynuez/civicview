# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
TOTP enforcement helpers (2FA Phase 4).

The single source of truth for "does this account need to enroll in
2FA before we let them use the app?". Wired into the /me + /whoami
endpoints; the frontend reads the resulting `needs_2fa_enrollment`
boolean to decide whether to render the full-screen enrollment overlay.

Toggled by the FORCE_2FA_ENABLED env var:
  • Unset / empty / falsy → no enforcement, all accounts can use the
    app whether or not they've enrolled. This is the default while
    the platform is still onboarding real reps + candidates and we
    don't want to wall off the demo experience.
  • Truthy ('1', 'true', 'yes', case-insensitive) → enforcement is
    live. Any account in the ENFORCED_KINDS set with no
    `totp_enabled_at` will get needs_2fa_enrollment=True on its /me
    response.

Citizens are deliberately NOT in the enforced set — they remain
opt-in indefinitely. The credential-theft blast radius for a citizen
account is upvoting a poll or posting a comment that goes through
the same moderation queue every other comment does. For reps,
candidates, and admins the blast radius is posting under a verified
identity (rep / candidate) or modifying every other account's
state (admin), which is where the second factor pays off.
"""
from __future__ import annotations

import os
from typing import Any, Literal


EnforcedKind = Literal["rep", "candidate", "admin"]
ENFORCED_KINDS: set[str] = {"rep", "candidate", "admin"}

_TRUTHY = {"1", "true", "yes", "on"}


def force_2fa_enabled() -> bool:
    """Read the FORCE_2FA_ENABLED env var. Truthy values: '1', 'true',
    'yes', 'on' (case-insensitive). Anything else is False."""
    val = (os.getenv("FORCE_2FA_ENABLED") or "").strip().lower()
    return val in _TRUTHY


def requires_2fa_enrollment(account_kind: str, account: Any) -> bool:
    """Return True when this account should be forced through the 2FA
    enrollment flow on its next authenticated request.

    Args:
      account_kind: 'rep' | 'candidate' | 'admin' | 'citizen'.
      account: the SQLAlchemy account row (RepAccount, CandidateAccount,
               or CitizenAccount). Must expose `totp_enabled_at`.

    Returns False when:
      • FORCE_2FA_ENABLED is unset / falsy (master switch is off).
      • account is None (defensive — caller passed a missing row).
      • account_kind is not in ENFORCED_KINDS (citizens, anonymous, …).
      • account.totp_enabled_at is already set (the account has
        previously completed enrollment).

    Otherwise returns True.
    """
    if account is None:
        return False
    if account_kind not in ENFORCED_KINDS:
        return False
    if not force_2fa_enabled():
        return False
    # `totp_enabled_at` is a nullable timestamp; any non-None value
    # means the account finished enrollment at least once.
    return getattr(account, "totp_enabled_at", None) is None
