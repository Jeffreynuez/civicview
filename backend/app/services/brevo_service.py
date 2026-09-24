# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Brevo contact sync for the citizen waitlist.

Best-effort mirror of citizen-waitlist signups into a Brevo list so
marketing/announcement emails (the launch welcome, and the future
subscription-launch notice) can be sent from Brevo. Purely additive:
if Brevo is unconfigured or its API errors, the waitlist signup still
succeeds — we log and move on.

Config (env vars — set on Render, never commit):
  BREVO_API_KEY           Brevo v3 REST API key (NOT the MCP key)
  BREVO_WAITLIST_LIST_ID  numeric id of the Brevo list to add contacts to
  BREVO_DOI_TEMPLATE_ID   optional: id of a Brevo double opt-in template.
                          When set, a signup gets a confirmation email and
                          joins the list only after clicking it (audit S9).
  BREVO_DOI_REDIRECT_URL  optional: where the confirm link lands. Defaults
                          to https://civicview.app/.

Contact attributes written: STATE (2-letter) and SOURCE (the
`clicked_from` tag). updateEnabled=True so re-syncing an existing email
updates the contact instead of erroring.
"""
from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

_BREVO_CONTACTS_URL = "https://api.brevo.com/v3/contacts"
_BREVO_DOI_URL = "https://api.brevo.com/v3/contacts/doubleOptinConfirmation"


def _doi_template_id() -> int | None:
    raw = (os.getenv("BREVO_DOI_TEMPLATE_ID") or "").strip()
    try:
        return int(raw) if raw else None
    except ValueError:
        return None


def _api_key() -> str:
    return (os.getenv("BREVO_API_KEY") or "").strip()


def _list_id() -> int | None:
    raw = (os.getenv("BREVO_WAITLIST_LIST_ID") or "").strip()
    try:
        return int(raw) if raw else None
    except ValueError:
        return None


def is_configured() -> bool:
    """True when both the API key and target list id are present."""
    return bool(_api_key()) and _list_id() is not None


def sync_waitlist_contact(
    email: str,
    state: str | None = None,
    clicked_from: str | None = None,
) -> bool:
    """Create or update a contact in the Brevo waitlist list.

    Best-effort and self-contained (safe to run from a FastAPI
    BackgroundTask): returns True on success, False if skipped
    (unconfigured) or failed. Never raises.
    """
    api_key = _api_key()
    list_id = _list_id()
    if not api_key or list_id is None:
        # Unconfigured (local/dev, or env not set yet) — skip silently.
        return False

    attributes: dict[str, str] = {}
    if state:
        attributes["STATE"] = state
    if clicked_from:
        attributes["SOURCE"] = clicked_from

    doi_template = _doi_template_id()
    if doi_template is not None:
        # Double opt-in: Brevo sends the confirmation email and adds the
        # contact to the list only after the recipient clicks. Nothing
        # CivicView-branded reaches an address its owner did not ask for
        # beyond that one confirmation.
        url = _BREVO_DOI_URL
        payload: dict = {
            "email": email,
            "includeListIds": [list_id],
            "templateId": doi_template,
            "redirectionUrl": (os.getenv("BREVO_DOI_REDIRECT_URL") or "https://civicview.app/").strip(),
        }
    else:
        url = _BREVO_CONTACTS_URL
        payload = {
            "email": email,
            "listIds": [list_id],
            "updateEnabled": True,
        }
    if attributes:
        payload["attributes"] = attributes

    try:
        resp = httpx.post(
            url,
            json=payload,
            headers={
                "api-key": api_key,
                "accept": "application/json",
                "content-type": "application/json",
            },
            timeout=10.0,
        )
        # 201 = created, 204 = updated (existing contact via updateEnabled).
        if resp.status_code in (200, 201, 204):
            return True
        logger.warning(
            "Brevo waitlist sync non-2xx for email=%s: %s %s",
            email, resp.status_code, resp.text[:300],
        )
        return False
    except Exception:
        logger.exception("Brevo waitlist sync failed for email=%s", email)
        return False
