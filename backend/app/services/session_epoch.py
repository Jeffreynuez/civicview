# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Per-account session epoch: the switch that revokes every session.

Session tokens are signed and stateless, so on their own they stay
valid for their full 14 days no matter what happens to the account.
Each account now carries `session_epoch`, every token records the
epoch it was issued under (payload key "se"), and the session
resolvers in app/auth*.py refuse a token whose epoch no longer
matches. Bumping the number signs the account out everywhere at once.

Bumped by: a completed password reset, an admin 2FA reset, and the
"Sign out of all devices" action. Tokens issued before this change
carry no "se" and read as 0, which matches every account's starting
epoch, so nobody is signed out by the deploy itself. (audit S7)
"""
from __future__ import annotations


def epoch_of(account) -> int:
    try:
        return int(getattr(account, "session_epoch", 0) or 0)
    except (TypeError, ValueError):
        return 0


def bump(account) -> int:
    """Invalidate every token issued for this account so far. The
    caller commits."""
    account.session_epoch = epoch_of(account) + 1
    return account.session_epoch


def token_epoch(payload: dict) -> int:
    se = payload.get("se", 0) if isinstance(payload, dict) else 0
    return se if isinstance(se, int) and not isinstance(se, bool) else 0
