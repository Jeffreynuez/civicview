# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""One-click unsubscribe for notification emails (2026-10-16).

Each email that someone can turn off carries:

  * List-Unsubscribe: <https://api.civicview.app/api/email/unsubscribe/TOKEN>
    and List-Unsubscribe-Post: List-Unsubscribe=One-Click (RFC 8058).
    The mail provider POSTs there and that one email type is turned off.
  * a visible footer link to civicview.app/unsubscribe?token=TOKEN, a
    page that says what will be turned off and has one button, so a
    link scanner opening the email turns nothing off. A GET on the API
    address goes to that page too.

The token is signed (itsdangerous, keyed by SESSION_SECRET through
app.auth.SESSION_SIGNING_SECRET) and names
one account and one email type, so it can only turn that one email off
for that one account. It does not expire: an old email's link keeps
working. It turns nothing back on; the settings do that.

Email types:
  digest              the weekly digest (CitizenAccount.digest_opt_in)
  page_changes        "Email me when a page I track changes" (citizen,
                      rep and candidate accounts, page_change_email_off_at)
  election_reminders  election reminder emails
                      (CitizenAccount.election_reminder_email_at)
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

SALT = "civicview-email-unsubscribe-v1"

EMAIL_TYPES = {
    "digest": "the weekly digest email",
    "page_changes": "emails when a page you track changes",
    "election_reminders": "election reminder emails",
}
# Which account kinds each type exists for.
_KINDS = {
    "digest": ("citizen",),
    "page_changes": ("citizen", "rep", "candidate"),
    "election_reminders": ("citizen",),
}


def _serializer():
    """Signed with the app's one signing secret (app.auth: SESSION_SECRET,
    which production refuses to boot without), under its own salt."""
    from itsdangerous import URLSafeSerializer

    from app.auth import SESSION_SIGNING_SECRET
    return URLSafeSerializer(SESSION_SIGNING_SECRET, salt=SALT)


def app_url() -> str:
    return (os.getenv("PUBLIC_APP_URL") or "https://civicview.app").rstrip("/")


def api_url() -> str:
    """Where the API is reached from the internet (the one-click POST)."""
    return (os.getenv("PUBLIC_API_URL") or "https://api.civicview.app").rstrip("/")


def make_token(account_kind: str, account_id: int, email_type: str) -> str:
    if email_type not in EMAIL_TYPES or account_kind not in _KINDS[email_type]:
        raise ValueError(f"no {email_type!r} email for {account_kind!r} accounts")
    return _serializer().dumps({"k": account_kind, "i": int(account_id), "t": email_type})


def read_token(token: str) -> Optional[dict]:
    """{"k", "i", "t"} for a valid token, else None."""
    from itsdangerous import BadSignature
    try:
        data = _serializer().loads(token or "")
    except (BadSignature, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    kind, aid, etype = data.get("k"), data.get("i"), data.get("t")
    if etype not in EMAIL_TYPES or kind not in _KINDS[etype] or not isinstance(aid, int):
        return None
    return {"k": kind, "i": aid, "t": etype}


def one_click_url(token: str) -> str:
    return f"{api_url()}/api/email/unsubscribe/{token}"


def page_url(token: str) -> str:
    return f"{app_url()}/unsubscribe?token={token}"


def links(account_kind: str, account_id: int, email_type: str) -> dict:
    """{"headers": {...}, "page_url": ...} for one email."""
    token = make_token(account_kind, account_id, email_type)
    return {
        "headers": {
            "List-Unsubscribe": f"<{one_click_url(token)}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        "page_url": page_url(token),
    }


def _account(db, kind: str, account_id: int):
    from app.models.pages import CandidateAccount, CitizenAccount, RepAccount
    model = {"citizen": CitizenAccount, "rep": RepAccount, "candidate": CandidateAccount}[kind]
    return db.get(model, account_id)


def is_off(acct, email_type: str) -> bool:
    if email_type == "digest":
        return not bool(acct.digest_opt_in)
    if email_type == "election_reminders":
        return acct.election_reminder_email_at is None
    return acct.page_change_email_off_at is not None


def describe(db, token: str) -> Optional[dict]:
    """What a token turns off, for the unsubscribe page."""
    data = read_token(token)
    if data is None:
        return None
    acct = _account(db, data["k"], data["i"])
    if acct is None:
        return None
    return {"email_type": data["t"], "label": EMAIL_TYPES[data["t"]], "already_off": is_off(acct, data["t"])}


def unsubscribe(db, token: str) -> Optional[dict]:
    """Turn off the email type the token names. Returns what was turned
    off, or None for a token that is not valid (or an account that no
    longer exists)."""
    data = read_token(token)
    if data is None:
        return None
    acct = _account(db, data["k"], data["i"])
    if acct is None:
        return None
    etype = data["t"]
    was_off = is_off(acct, etype)
    if not was_off:
        if etype == "digest":
            acct.digest_opt_in = False
        elif etype == "election_reminders":
            acct.election_reminder_email_at = None
        else:
            acct.page_change_email_off_at = datetime.utcnow()
        db.commit()
        logger.info("email unsubscribe: %s turned off for %s id=%s", etype, data["k"], data["i"])
    return {"email_type": etype, "label": EMAIL_TYPES[etype], "already_off": was_off}
