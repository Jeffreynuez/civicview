# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Admin auth — email-allowlist gate for the moderation queue.

Design: a single ADMIN_EMAILS env var (comma-separated) holds the
set of admin email addresses. Any user — rep OR citizen — whose
signed-in account's email matches one of those is treated as an
admin. The check is case-insensitive on the local-part split is
not normalized (foo+admin@x.com is distinct from foo@x.com).

Why not a DB column?  Because there's exactly one admin in the
near term (the operator). A column adds a migration + a UI to
toggle it; an env var adds one line of config. If the admin
count grows past "a few," migrate to a role column on
RepAccount / CitizenAccount.

Why allow citizens to be admins?  Because the operator may sign
in with their personal account (likely a citizen self-serve)
and shouldn't need a separate rep credential to triage reports.

Failure mode: if ADMIN_EMAILS is unset OR empty, NOBODY is an
admin — every /api/admin/* endpoint returns 403. This is the
safe default for a fresh deploy where the operator forgot to
set the env var.
"""
from __future__ import annotations

import logging
import os
from typing import Optional, Set

from fastapi import Depends, HTTPException

from app.auth import get_optional_rep
from app.auth_citizen import get_optional_citizen
from app.models.pages import CitizenAccount, RepAccount


logger = logging.getLogger(__name__)


def _admin_emails() -> Set[str]:
    """Parse ADMIN_EMAILS env var into a case-folded set.
    Empty / unset → empty set → nobody is admin."""
    raw = (os.getenv("ADMIN_EMAILS") or "").strip()
    if not raw:
        return set()
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def is_admin_email(email: Optional[str]) -> bool:
    """Check a single email against the configured admin set.
    Case-insensitive — local-part normalization is NOT applied."""
    if not email:
        return False
    return email.strip().lower() in _admin_emails()


def get_current_admin(
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> dict:
    """FastAPI dependency for /api/admin/* endpoints. Returns a small
    dict describing the authenticated admin (kind + id + email) on
    success; raises 403 otherwise — 401 would be misleading because
    the user IS authenticated, just not authorized.

    The mutually-exclusive-sessions contract means at most one of
    me_rep / me_citizen is populated per request. We check whichever
    is present.
    """
    actor_email: Optional[str] = None
    kind: Optional[str] = None
    actor_id: Optional[int] = None
    if me_rep is not None:
        actor_email = me_rep.email
        kind = "rep"
        actor_id = me_rep.id
    elif me_citizen is not None:
        actor_email = me_citizen.email
        kind = "citizen"
        actor_id = me_citizen.id

    if actor_email is None:
        # Not signed in at all — 401, distinct from 403 below.
        raise HTTPException(status_code=401, detail="Sign in to access admin.")

    if not is_admin_email(actor_email):
        raise HTTPException(
            status_code=403,
            detail="Admin access required.",
        )

    return {
        "kind": kind,
        "id": actor_id,
        "email": actor_email,
    }
