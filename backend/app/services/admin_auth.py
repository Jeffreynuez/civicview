# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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

    Defense-in-depth: citizens must be verified=True to wield admin
    powers. Reps don't have a verified flag — they're vetted at
    onboarding, so a matching email is sufficient.

    Why we check BOTH sessions independently rather than "rep first,
    else citizen": the client-side mutually-exclusive-session
    teardown can fail silently (network blip during loginCitizenApi
    when it tries to clear the rep cookie, etc.). When that happens,
    the user thinks they're signed in only as a citizen but a stale
    rep cookie is still riding along. Falling back to "rep wins" in
    that case denies admin to a verified citizen-admin just because
    they have a leftover rep cookie — confusing failure mode. So we
    accept whichever side actually matches ADMIN_EMAILS.

    If BOTH emails are admin (unusual but legitimate — operator who
    set up both a rep and a citizen account with admin-listed emails)
    we prefer the verified citizen for the audit log identity.
    """
    candidates = []  # list of (kind, id, email, verified-or-None)
    if me_rep is not None:
        candidates.append(("rep", me_rep.id, me_rep.email, None))
    if me_citizen is not None:
        candidates.append(("citizen", me_citizen.id, me_citizen.email, me_citizen.verified))

    if not candidates:
        # Not signed in at all — 401, distinct from 403 below.
        raise HTTPException(status_code=401, detail="Sign in to access admin.")

    # Find a candidate whose email is in ADMIN_EMAILS AND (for citizens)
    # is verified. Prefer citizens over reps on tie because verified
    # citizens are the documented operator-admin path and audit logs
    # read more cleanly that way.
    matched: list[tuple] = []
    rejected_unverified = False
    for cand in candidates:
        kind, _id, email, verified = cand
        if not is_admin_email(email):
            continue
        if kind == "citizen" and not verified:
            rejected_unverified = True
            continue
        matched.append(cand)

    if matched:
        # Prefer citizen if any matched (sort puts 'citizen' before 'rep').
        matched.sort(key=lambda c: 0 if c[0] == "citizen" else 1)
        kind, actor_id, actor_email, _ = matched[0]
        return {"kind": kind, "id": actor_id, "email": actor_email}

    # No match. Differentiate the failure mode so the operator can
    # debug — "your email isn't on the list" vs. "your email IS on
    # the list but the account isn't verified."
    if rejected_unverified:
        raise HTTPException(
            status_code=403,
            detail=(
                "Admin email matched but the citizen account isn't verified. "
                "Sign in as a verified account (or seed one via "
                "DEMO_CITIZEN_ACCOUNTS_JSON with \"verified\": true)."
            ),
        )
    raise HTTPException(status_code=403, detail="Admin access required.")
