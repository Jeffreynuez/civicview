# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Notifications — out-of-app delivery for things admins should know
about even when they aren't currently looking at the CivicView UI.

Today only one channel (email via Resend) and one event type (new
report came in). Both designed to be extended:

  • Channel: notification_send() is the single point of egress;
    swapping providers (Postmark, SendGrid, plain SMTP) is a one-
    function change, not a per-call-site change.
  • Event: notify_new_report() is the only public emitter so far.
    Future events (suspension issued, monthly digest) follow the
    same shape — build the payload, call notification_send().

Config (Render env vars):
  RESEND_API_KEY              — required to actually send. Unset =
                                no-op; the function logs and returns.
  NOTIFICATION_FROM_EMAIL     — From address. Must be on a verified
                                Resend domain. Use 'onboarding@resend.dev'
                                for unverified testing.
  ADMIN_EMAILS                — recipient list (comma-separated).
                                Reuses the admin allowlist so the
                                operator doesn't have to maintain a
                                second list.
  REPORT_NOTIFICATIONS_ENABLED — 'true' / 'false'. Default true once
                                RESEND_API_KEY is set. Lets the
                                operator silence emails without
                                rotating the API key.
  PUBLIC_APP_URL              — e.g. 'https://civicview.app'. Used
                                to build the link to /admin in the
                                email body. Falls back to a sensible
                                default if unset.

Design choices:
  • Real-time, per-report. No batching / digest yet. If a single
    abuser spams 50 reports the admin gets 50 emails — accept the
    noise for now; rate-limit when needed (likely an email-per-
    target-per-N-hours rule, deferred until we see real volume).
  • Fired from BackgroundTasks so the user reporting the content
    doesn't pay for the email round-trip in their request latency.
    Failures don't surface to the reporter — they just log.
  • One email per ADMIN_EMAILS entry (one-to-one), not one with the
    whole list in the To. Keeps each admin's inbox clean and
    Resend's per-recipient send logs sensible.
"""
from __future__ import annotations

import html as _html
import logging
import os
from typing import Optional

import httpx


logger = logging.getLogger(__name__)

_RESEND_URL = "https://api.resend.com/emails"
_DEFAULT_FROM = "CivicView <onboarding@resend.dev>"
# Match the kind labels the admin UI uses so the email reads the
# same way the queue does.
_KIND_LABELS = {
    "post": "Rep post",
    "post_comment": "Comment on post",
    "poll": "Citizen poll",
    "poll_comment": "Comment on poll",
}


def _admin_emails() -> list[str]:
    """Parse ADMIN_EMAILS into a list. Same parser shape as
    services/admin_auth.py — kept in lockstep so notifications and
    auth use the same allowlist. Empty / unset → []."""
    raw = (os.getenv("ADMIN_EMAILS") or "").strip()
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def _enabled() -> bool:
    """Notifications are gated on BOTH (a) the API key being set AND
    (b) the explicit enable flag (defaults true when key is set)."""
    if not (os.getenv("RESEND_API_KEY") or "").strip():
        return False
    flag = (os.getenv("REPORT_NOTIFICATIONS_ENABLED") or "true").strip().lower()
    return flag in {"true", "1", "yes"}


def _public_app_url() -> str:
    return (os.getenv("PUBLIC_APP_URL") or "https://civicview.app").rstrip("/")


def notification_send(
    *,
    to: str,
    subject: str,
    html_body: str,
    text_body: Optional[str] = None,
) -> bool:
    """Send a single email via Resend. Returns True on 2xx, False
    otherwise (logged). Synchronous — call from a BackgroundTask or
    accept the latency cost."""
    api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    if not api_key:
        logger.info("notification_send: RESEND_API_KEY not set — no-op.")
        return False
    from_addr = (os.getenv("NOTIFICATION_FROM_EMAIL") or _DEFAULT_FROM).strip()
    payload: dict = {
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": html_body,
    }
    if text_body:
        payload["text"] = text_body
    try:
        # Short timeout — we're already inside a background task and
        # don't want a slow provider to pile up tasks during a
        # report surge.
        resp = httpx.post(
            _RESEND_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        )
    except httpx.RequestError as e:
        logger.warning("notification_send: network error %s — skipping.", e)
        return False
    if 200 <= resp.status_code < 300:
        return True
    logger.warning(
        "notification_send: provider returned %s — body=%s",
        resp.status_code, resp.text[:300],
    )
    return False


def notify_new_report(
    *,
    kind: str,
    target_id: int,
    reason: str,
    detail: Optional[str] = None,
    reporter_name: str = "(unknown)",
    target_preview: str = "",
    context_official_id: Optional[str] = None,
) -> None:
    """Fire-and-forget notification to every admin in ADMIN_EMAILS.

    Caller responsibility: build the payload from the report row +
    target, then schedule this via BackgroundTasks so it runs after
    the report's own commit. Errors here never propagate — admin
    notifications are nice-to-have, not load-bearing.
    """
    if not _enabled():
        return
    recipients = _admin_emails()
    if not recipients:
        logger.info("notify_new_report: no ADMIN_EMAILS configured — no-op.")
        return

    kind_label = _KIND_LABELS.get(kind, kind)
    subject = f"[CivicView] New report: {kind_label} — {reason}"

    # Build a richer link than just /admin — include a hash so the
    # admin can ctrl-F to find the row. Frontend doesn't deep-link
    # on the hash yet, but it costs nothing and is forward-
    # compatible with that improvement.
    admin_url = f"{_public_app_url()}/admin#{kind}-{target_id}"
    page_url = (
        f"{_public_app_url()}/?page={context_official_id}"
        if context_official_id else None
    )

    # Escape user-supplied strings before splicing into the HTML
    # body. The reporter's display name, the target snippet, and
    # the report reason / detail all come from user input.
    safe_reporter = _html.escape(reporter_name)
    safe_reason = _html.escape(reason)
    safe_detail = _html.escape(detail or "")
    safe_preview = _html.escape(target_preview or "")

    detail_block = (
        f'<p style="margin:8px 0 0;color:#555;font-style:italic;">'
        f'Reporter note: {safe_detail}</p>'
        if safe_detail else ""
    )
    page_link_html = (
        f'<p style="margin:14px 0 0;"><a href="{page_url}" '
        f'style="color:#1e6b56;">View the page in context →</a></p>'
        if page_url else ""
    )
    html_body = f"""\
<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
            color:#222;max-width:560px;line-height:1.5;">
  <h2 style="margin:0 0 6px;font-size:18px;">New report in the moderation queue</h2>
  <p style="margin:0 0 14px;color:#555;font-size:14px;">
    Reported by <strong>{safe_reporter}</strong> &mdash; reason: <strong>{safe_reason}</strong>
  </p>
  <div style="background:#f4f4f6;border:1px solid #e1e1e6;border-radius:8px;
              padding:12px 14px;font-size:14px;">
    <div style="font-weight:700;margin-bottom:4px;">{kind_label}</div>
    <div>{safe_preview or '<em>(empty content)</em>'}</div>
    {detail_block}
  </div>
  <p style="margin:18px 0 6px;">
    <a href="{admin_url}" style="background:#1e6b56;color:white;text-decoration:none;
       padding:10px 16px;border-radius:6px;font-weight:600;display:inline-block;">
       Open the queue
    </a>
  </p>
  {page_link_html}
  <hr style="margin:24px 0;border:0;border-top:1px solid #e1e1e6;" />
  <p style="font-size:12px;color:#888;margin:0;">
    Sent because your email is on the ADMIN_EMAILS allowlist.
    To stop receiving these, set REPORT_NOTIFICATIONS_ENABLED=false
    on Render or remove your address from ADMIN_EMAILS.
  </p>
</div>
"""
    text_body = (
        f"New report — {kind_label}\n"
        f"Reporter: {reporter_name}\n"
        f"Reason: {reason}\n"
        + (f"Detail: {detail}\n" if detail else "")
        + f"\nContent: {target_preview}\n"
        + f"\nOpen the queue: {admin_url}\n"
        + (f"View page: {page_url}\n" if page_url else "")
    )

    for addr in recipients:
        ok = notification_send(
            to=addr,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )
        if ok:
            logger.info(
                "notify_new_report: sent to %s (kind=%s target_id=%d).",
                addr, kind, target_id,
            )
