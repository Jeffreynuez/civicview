# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Transactional email service (Task #87).

Single source of truth for "how do we send an email to a user?".
Two implementations, picked by env vars (same swappable pattern as
the image_storage service):

  • PostmarkEmailService — production. Uses Postmark's REST API via
    the postmarker library. Requires POSTMARK_API_TOKEN +
    POSTMARK_FROM_EMAIL.
  • DevEmailService — dev fallback. Logs the email subject + body to
    stdout (Render logs) so a developer can see what would have
    been sent without needing a Postmark account.

Why this pattern over just calling Postmark directly: when a
developer clones the repo, runs the backend locally, and triggers a
password reset, they shouldn't need to provision Postmark first.
The dev path lets every email-related feature work end-to-end without
external credentials.

Templates live as Python strings in this module rather than in
Postmark's template system. Trade-off: less polished HTML, but
easier to ship + keeps copy under version control. Migrate to
Postmark templates later if we need richer HTML / per-template
metrics.
"""
from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import Optional


logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# Abstract interface
# ─────────────────────────────────────────────────────────────────────
class EmailService(ABC):
    """Email backend protocol. Implementations handle the SMTP /
    HTTP-API concern; templates + recipient resolution live in the
    caller."""

    @abstractmethod
    def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: Optional[str] = None,
        reply_to: Optional[str] = None,
    ) -> bool:
        """Send a single email. Returns True on success, False on
        failure. NEVER raises — email failures should degrade gracefully
        (the action that triggered the email succeeded; the email is
        a courtesy notification). Caller decides whether to log /
        retry / surface to the user."""


# ─────────────────────────────────────────────────────────────────────
# Postmark — production backend
# ─────────────────────────────────────────────────────────────────────
class PostmarkEmailService(EmailService):
    """Sends via Postmark's REST API.

    Configuration env vars:
      POSTMARK_API_TOKEN  — server API token from postmarkapp.com →
                            Servers → <your server> → API Tokens.
      POSTMARK_FROM_EMAIL — verified sender address. Must match a
                            Sender Signature OR a verified domain in
                            Postmark. We use civicview@civicview.app
                            (verified via DKIM on the domain).
      POSTMARK_MESSAGE_STREAM — OPTIONAL. Defaults to 'outbound'
                                (transactional). Use 'broadcast' for
                                marketing-style sends (not done today).

    Lazy-imports postmarker so dev environments without it installed
    fall back cleanly to DevEmailService.
    """

    def __init__(self):
        try:
            from postmarker.core import PostmarkClient
        except ImportError as e:
            raise RuntimeError(
                "Postmark email requested but postmarker isn't installed. "
                "Run `pip install -r requirements.txt` to pick up postmarker>=1.0."
            ) from e

        self._token = _require_env("POSTMARK_API_TOKEN")
        self._from_email = _require_env("POSTMARK_FROM_EMAIL")
        self._stream = os.getenv("POSTMARK_MESSAGE_STREAM", "outbound").strip() or "outbound"
        self._client = PostmarkClient(server_token=self._token)

    def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: Optional[str] = None,
        reply_to: Optional[str] = None,
    ) -> bool:
        try:
            self._client.emails.send(
                From=self._from_email,
                To=to,
                Subject=subject,
                TextBody=text_body,
                HtmlBody=html_body,
                ReplyTo=reply_to or self._from_email,
                MessageStream=self._stream,
            )
            return True
        except Exception:
            # postmarker raises for 4xx / 5xx / network failures.
            # Don't let an email failure break the caller's action —
            # log it and return False.
            logger.exception("Postmark send failed (to=%s subject=%r)", to, subject)
            return False


# ─────────────────────────────────────────────────────────────────────
# Dev — stdout fallback
# ─────────────────────────────────────────────────────────────────────
class DevEmailService(EmailService):
    """Logs to stdout instead of sending. Use in dev environments
    that don't have Postmark credentials.

    Useful pattern: a developer running the backend locally triggers
    a password reset → sees the reset link printed to the terminal →
    clicks it directly. No Postmark account needed for end-to-end
    feature work."""

    def send(
        self,
        *,
        to: str,
        subject: str,
        text_body: str,
        html_body: Optional[str] = None,
        reply_to: Optional[str] = None,
    ) -> bool:
        # Use a distinct prefix so these stand out in mixed logs.
        logger.info(
            "\n"
            "═════════════════════ EMAIL (dev) ═════════════════════\n"
            "To:         %s\n"
            "Subject:    %s\n"
            "Reply-To:   %s\n"
            "─── text body ─────────────────────────────────────────\n"
            "%s\n"
            "═══════════════════════════════════════════════════════",
            to, subject, reply_to or "(default)", text_body,
        )
        return True


def _require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(
            f"Postmark email requested but {name} is not set. "
            f"Set POSTMARK_API_TOKEN + POSTMARK_FROM_EMAIL together — "
            f"partial config breaks at runtime."
        )
    return val


# ─────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────
_EMAIL_SINGLETON: Optional[EmailService] = None


def get_email_service() -> EmailService:
    """Return the active email backend. Picks PostmarkEmailService when
    the full env var set is present; falls back to DevEmailService
    otherwise. Cached singleton — reuses the same Postmark client
    across requests."""
    global _EMAIL_SINGLETON
    if _EMAIL_SINGLETON is not None:
        return _EMAIL_SINGLETON

    if _postmark_env_present():
        try:
            _EMAIL_SINGLETON = PostmarkEmailService()
            logger.info(
                "Email service: Postmark backend active (from=%s, stream=%s)",
                os.getenv("POSTMARK_FROM_EMAIL"),
                os.getenv("POSTMARK_MESSAGE_STREAM", "outbound"),
            )
            return _EMAIL_SINGLETON
        except Exception:
            logger.exception(
                "Postmark env vars are set but PostmarkEmailService failed to "
                "initialize — falling back to DevEmailService. Check postmarker "
                "install + verify POSTMARK_* credentials in Postmark dashboard."
            )

    _EMAIL_SINGLETON = DevEmailService()
    logger.info("Email service: Dev backend active (emails will log to stdout)")
    return _EMAIL_SINGLETON


def reset_email_service_for_tests() -> None:
    """Test-only hook to clear the cached singleton so env-var changes
    take effect between test cases. Not used in production code."""
    global _EMAIL_SINGLETON
    _EMAIL_SINGLETON = None


def _postmark_env_present() -> bool:
    """True iff every required Postmark env var is set + non-empty."""
    required = ("POSTMARK_API_TOKEN", "POSTMARK_FROM_EMAIL")
    return all((os.getenv(name) or "").strip() for name in required)


# ─────────────────────────────────────────────────────────────────────
# Email templates (Task #87 — initial set)
# ─────────────────────────────────────────────────────────────────────
# Templates kept here as functions returning (subject, text_body) so
# the caller passes context as kwargs and templates stay easy to
# review in code review. HTML versions can be added later — text-only
# already renders correctly in every email client and Postmark
# auto-builds a basic HTML wrapper if html_body is None.

def render_password_reset_email(
    *, display_name: str, identity_kind: str, reset_url: str, expires_in_hours: int = 1,
) -> tuple[str, str]:
    """Compose the password reset email. identity_kind in
    {'citizen', 'rep', 'candidate'} so the copy can name which
    account is being reset (relevant for multi-identity users)."""
    kind_label = {
        "citizen": "citizen",
        "rep": "representative",
        "candidate": "candidate",
    }.get(identity_kind, "account")

    subject = "Reset your CivicView password"
    body = f"""Hi {display_name or 'there'},

We received a request to reset the password for your CivicView {kind_label} account.

Click the link below to choose a new password. The link expires in {expires_in_hours} hour{'s' if expires_in_hours != 1 else ''} and can only be used once.

{reset_url}

If you didn't request a password reset, you can safely ignore this email — your password won't change unless you click the link above.

For your security, please:
  • Don't share this link with anyone.
  • Choose a password you haven't used elsewhere.
  • Enable two-factor authentication after signing in (Dashboard → Account security).

Questions or concerns? Reply to this email or write to civicview@civicview.app.

— The CivicView team
"""
    return subject, body


def render_password_reset_confirmation_email(
    *, display_name: str, identity_kind: str,
) -> tuple[str, str]:
    """Sent after a successful password change. Belt-and-suspenders
    — alerts the user if they DIDN'T initiate the change so they can
    take action (e.g., compromised email account)."""
    kind_label = {
        "citizen": "citizen",
        "rep": "representative",
        "candidate": "candidate",
    }.get(identity_kind, "account")

    subject = "Your CivicView password was changed"
    body = f"""Hi {display_name or 'there'},

The password for your CivicView {kind_label} account was just changed.

If this was you, no further action is needed.

If you DIDN'T change your password, your account may be compromised. Please:
  1. Sign in and change your password immediately if you can.
  2. Enable two-factor authentication (Dashboard → Account security).
  3. Email civicview@civicview.app so we can help secure the account.

— The CivicView team
"""
    return subject, body


def render_lockout_alert_email(
    *, identity_kind: str, ip_address: Optional[str], lockout_minutes: int,
) -> tuple[str, str]:
    """Security alert email (Task #29). Fires when an account hits
    its failed-login threshold and gets locked. Goal is two-fold:
      • Tell a legit user "your sign-in failed because we just locked
        the account — try again in N minutes, or reset your password."
        We deliberately surface this via email rather than in the API
        response (the API returns the same generic 401 as a wrong
        password to prevent enumeration).
      • Tell a user whose account is being brute-forced "someone tried
        to sign in N times and we shut it down" so they can change
        their password if they're worried.
    """
    kind_label = {
        "citizen": "citizen",
        "rep": "representative",
        "candidate": "candidate",
    }.get(identity_kind, "account")

    # Pretty-print the lockout duration so the email isn't ugly when
    # the window is exactly 60 or 1440 minutes.
    if lockout_minutes >= 1440:
        window_phrase = f"{lockout_minutes // 1440} day{'s' if lockout_minutes // 1440 != 1 else ''}"
    elif lockout_minutes >= 60:
        hours = lockout_minutes // 60
        window_phrase = f"{hours} hour{'s' if hours != 1 else ''}"
    else:
        window_phrase = f"{lockout_minutes} minutes"

    ip_line = (
        f"  • Originating IP address: {ip_address}\n"
        if ip_address else ""
    )

    subject = "Sign-in attempts locked your CivicView account"
    body = f"""Hi,

We just locked your CivicView {kind_label} account after several failed sign-in attempts.

  • The account will unlock automatically in {window_phrase}.
{ip_line}
If THAT WAS YOU:
  Just wait the lockout window out, or reset your password right now to sign in immediately:
  https://civicview.app/forgot-password

If THAT WASN'T YOU:
  Someone may be trying to access your account. We recommend:
    1. Reset your password to a value you haven't used anywhere else.
    2. Turn on two-factor authentication (Dashboard → Account security).
    3. Email civicview@civicview.app and we'll help secure the account.

— The CivicView team
"""
    return subject, body


def send_lockout_alert_email(
    *,
    to_email: str,
    identity_kind: str,
    ip_address: Optional[str],
    lockout_minutes: int,
) -> bool:
    """Convenience wrapper used by services/login_attempts.py so the
    caller doesn't have to know how the template + transport plug
    together. Returns the transport's success bool. NEVER raises —
    a failed lockout email must not unwind a transactional lockout."""
    try:
        subject, body = render_lockout_alert_email(
            identity_kind=identity_kind,
            ip_address=ip_address,
            lockout_minutes=lockout_minutes,
        )
        return get_email_service().send(
            to=to_email, subject=subject, text_body=body,
        )
    except Exception:
        logger.exception(
            "send_lockout_alert_email failed unexpectedly (to=%s, identity_kind=%s)",
            to_email, identity_kind,
        )
        return False
