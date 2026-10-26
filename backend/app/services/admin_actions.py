# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Admin action history (2026-10-26, admin audit finding M5).

Every admin endpoint that changes something calls record() in the same
transaction as the change, so an action and its history row are saved
or rolled back together. The admin page's History tab reads them back
through GET /api/admin/actions.

require_reason() is the one rule for the actions that must say why:
suspend, hide (and Keep hidden), deny an appeal, unlock a lockout and
reset 2FA. A reason is at least 3 characters after trimming.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

REASON_MIN = 3
REASON_MAX = 1000
_LABEL_MAX = 200


def clean_reason(reason: Optional[str]) -> Optional[str]:
    """Trimmed reason, cut to REASON_MAX, or None when blank."""
    text = " ".join((reason or "").split())
    return text[:REASON_MAX] if text else None


def require_reason(reason: Optional[str], what: str) -> str:
    """The trimmed reason, or 422 when it is missing or too short."""
    text = clean_reason(reason)
    if text is None or len(text) < REASON_MIN:
        raise HTTPException(
            status_code=422,
            detail=f"Give a reason for the {what} (at least {REASON_MIN} characters).",
        )
    return text


def label(text: Optional[str]) -> Optional[str]:
    """A short one-line snapshot of a name or a piece of content."""
    if not text:
        return None
    one = " ".join(str(text).split())
    return one if len(one) <= _LABEL_MAX else one[: _LABEL_MAX - 3] + "..."


def record(
    db: Session,
    actor: dict,
    action: str,
    *,
    target_kind: Optional[str] = None,
    target_id: Any = None,
    target_label: Optional[str] = None,
    reason: Optional[str] = None,
    details: Optional[dict] = None,
):
    """Add one history row for `actor` (the dict get_current_admin
    returns). The caller commits, together with the action itself."""
    from app.models.pages import AdminAction

    row = AdminAction(
        actor_kind=str(actor.get("kind") or "")[:16],
        actor_id=int(actor.get("id") or 0),
        actor_email=str(actor.get("email") or "")[:255],
        action=action[:40],
        target_kind=(target_kind or None) and str(target_kind)[:32],
        target_id=None if target_id is None else str(target_id)[:64],
        target_label=label(target_label),
        reason=clean_reason(reason),
        details_json=json.dumps(details, default=str, sort_keys=True) if details else None,
    )
    db.add(row)
    return row


def as_dict(row) -> dict:
    """The API shape of one history row."""
    try:
        details = json.loads(row.details_json) if row.details_json else None
    except ValueError:
        details = None
    return {
        "id": row.id,
        "at": row.at.isoformat() if row.at else None,
        "actor_kind": row.actor_kind,
        "actor_email": row.actor_email,
        "action": row.action,
        "target_kind": row.target_kind,
        "target_id": row.target_id,
        "target_label": row.target_label,
        "reason": row.reason,
        "details": details,
    }


def scalars(summary: Any) -> Optional[dict]:
    """The plain number, flag and short-text fields of a job summary,
    for details_json. Lists and nested objects (which may name people)
    are left out."""
    if not isinstance(summary, dict):
        return None
    out = {}
    for key, value in summary.items():
        if isinstance(value, bool) or isinstance(value, (int, float)):
            out[str(key)] = value
        elif isinstance(value, str) and len(value) <= 80:
            out[str(key)] = value
    return out or None
