# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Is this process the production deployment?

Render sets RENDER=true on every service it runs, so production is
detected without a new variable to remember. CIVICVIEW_ENV=production
forces the answer anywhere else, and CIVICVIEW_ENV=development forces
it off (a local run that happens to have RENDER set).
"""
from __future__ import annotations

import os


def is_production() -> bool:
    explicit = (os.getenv("CIVICVIEW_ENV") or "").strip().lower()
    if explicit in ("production", "prod"):
        return True
    if explicit in ("development", "dev", "test"):
        return False
    return (os.getenv("RENDER") or "").strip().lower() in ("true", "1", "yes")


class ProductionConfigError(RuntimeError):
    """Production is missing configuration it cannot run without."""


# Settings whose absence does not stop the app but silently switches a
# feature to a development fallback or turns it off. In production each
# missing one is logged at every boot, saying what it costs, so the gap
# shows up in the Render logs instead of being found by a user (audit
# O3). Core settings log at ERROR, optional features at WARNING. Stripe
# and ID.me are left out on purpose: they stay unset until launch.
RECOMMENDED_SETTINGS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("ALLOWED_ORIGINS",),
     "the API accepts browser requests only from localhost, so civicview.app cannot call it"),
    (("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"),
     "post images are saved to the server's temporary disk and lost on the next deploy"),
    (("POSTMARK_API_TOKEN", "POSTMARK_FROM_EMAIL"),
     "password reset and account emails are not sent"),
    (("ANTHROPIC_API_KEY",),
     "AI summaries and AI moderation screening are off"),
    (("ADMIN_EMAILS",),
     "nobody can open the admin page or the report queue"),
    (("CONGRESS_API_KEY",),
     "Congress.gov features lose live data"),
    (("OPENSTATES_API_KEY",),
     "state legislature features lose live data"),
)
OPTIONAL_SETTINGS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("OPEN_FEC_API_KEY",),
     "federal campaign finance lookups fail"),
    (("COURTLISTENER_TOKEN",),
     "state court opinion lookups fail"),
    (("GOOGLE_CIVIC_API_KEY",),
     "Google Civic lookups fail"),
    (("FIREBASE_SERVICE_ACCOUNT_JSON",),
     "push notifications are logged instead of sent"),
    (("BREVO_API_KEY", "BREVO_WAITLIST_LIST_ID"),
     "waitlist signups are not copied to Brevo and get no welcome email"),
    (("RESEND_API_KEY",),
     "admins are not emailed when content is reported"),
)


def check_production_config(log=None) -> list[str]:
    """Startup check of production settings (audit O3).

    Does nothing outside production. In production it raises
    ProductionConfigError when DATABASE_URL does not point at a real
    database, because the fallback is a SQLite file on the server's
    temporary disk: the app would start, accept signups, and lose them
    all on the next deploy. SESSION_SECRET is enforced where it is read
    (app/auth.py). Every missing RECOMMENDED_SETTINGS entry is logged
    as an ERROR and every missing OPTIONAL_SETTINGS entry as a WARNING;
    COOKIE_SECURE must be "true". Returns the names of every setting
    reported.
    """
    if not is_production():
        return []
    import logging

    log = log or logging.getLogger("app.config")
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url or url.startswith("sqlite"):
        raise ProductionConfigError(
            "DATABASE_URL is not set to a Postgres database. In production the "
            "app would otherwise create a SQLite file on the server's temporary "
            "disk and lose every account and post on the next deploy."
        )
    missing_all: list[str] = []
    for level, table in ((logging.ERROR, RECOMMENDED_SETTINGS), (logging.WARNING, OPTIONAL_SETTINGS)):
        for names, consequence in table:
            missing = [n for n in names if not (os.getenv(n) or "").strip()]
            if missing:
                missing_all.extend(missing)
                log.log(
                    level, "Production setting missing: %s. Until it is set, %s.",
                    ", ".join(missing), consequence,
                )
    if (os.getenv("COOKIE_SECURE") or "").strip().lower() != "true":
        missing_all.append("COOKIE_SECURE")
        log.error(
            'Production setting COOKIE_SECURE is not "true", so sign-in cookies '
            "are set without the Secure flag."
        )
    return missing_all
