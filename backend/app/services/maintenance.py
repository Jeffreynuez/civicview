# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Data-retention jobs, run at boot and then once a day (audit O7).

Until 2026-09-25 these ran only when the API booted, so how promptly
a soft-deleted account was really erased depended on how often a
deploy happened to restart the server. The privacy policy promises a
30-day grace period, then deletion; a quiet week without deploys
stretched that. main.py now calls run_retention_jobs() at boot and
every RETENTION_INTERVAL_SECONDS after that.

Every job is idempotent (it deletes what is past its date), so two
processes running it at once during a deploy is harmless. Each job has
its own try/except so one failing cannot stop the others.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Once a day. The jobs are cheap deletes over small tables.
RETENTION_INTERVAL_SECONDS = 24 * 60 * 60


def _jobs():
    """(label, callable) for every retention job, imported lazily so this
    module can load before the models."""
    from app.services.account_deletion import purge_expired_accounts, purge_orphaned_account_rows
    from app.services.login_attempts import purge_old_login_attempts
    from app.services.password_reset import purge_expired_password_reset_tokens

    return [
        # Task #81: soft-deleted accounts past their 30-day grace window.
        ("expired account purge", purge_expired_accounts),
        # Task #87: expired password-reset tokens.
        ("password-reset token purge", purge_expired_password_reset_tokens),
        # Audit B3: rows keyed by (kind, id) whose account is gone.
        ("orphaned account row sweep", purge_orphaned_account_rows),
        # Audit P5: login attempts (IP and user agent) kept 90 days.
        ("login attempt retention purge", purge_old_login_attempts),
    ]


def run_retention_jobs() -> dict:
    """Run every job; returns {label: 'ok' | 'failed'}. Never raises."""
    results: dict = {}
    try:
        jobs = _jobs()
    except Exception:
        logger.exception("Retention jobs could not be loaded.")
        return results
    for label, job in jobs:
        try:
            job()
            results[label] = "ok"
        except Exception:
            logger.exception("%s failed; it runs again at the next interval.", label)
            results[label] = "failed"
    return results
