# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Moderation helpers — auto-hide a piece of content when its
report_count crosses a configurable threshold.

Why this exists:
  Reports accumulate in the *_reports tables, but until an admin
  triages them nothing visible happens. That's fine when the
  reports are spam or false; it's NOT fine when something
  genuinely abusive is on screen for the hours it takes a human
  to look. Auto-hide gives the community a self-defense lever:
  if N independent reporters all flag a piece of content, we
  soft-hide it pending admin review.

Threshold semantics:
  REPORT_AUTO_HIDE_THRESHOLD env var. Defaults to 5. Set to 0
  to disable auto-hide entirely (reports still accumulate; an
  admin would have to act manually).

Hide mechanics:
  Post / PostComment / PollComment → set deleted_at (existing
    soft-delete machinery). The content disappears from public
    reads on the next request; the report rows + the cached
    report_count column survive for admin review.
  Poll → set archived_at + archived_reason='reported' (Poll's
    richer archive lifecycle; deleted_at is not the right knob
    here).

The helper is intentionally NOT a no-op once a row crosses the
threshold — if the row was un-hidden by an admin and reports
keep coming, it'll auto-hide again. Admins who un-hide should
either resolve the underlying reports or accept that pattern.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session


logger = logging.getLogger(__name__)

# Number of distinct reports required before auto-hide fires.
# Override via env var. 0 disables auto-hide entirely.
def _threshold() -> int:
    raw = (os.getenv("REPORT_AUTO_HIDE_THRESHOLD") or "5").strip()
    try:
        return max(int(raw), 0)
    except ValueError:
        return 5


def record_report(db: Session, target: Any, *, kind: str) -> bool:
    """Bump a content row's report_count by 1, then auto-hide if the
    threshold is reached.

    Args:
      db:     SQLAlchemy session — caller commits.
      target: Post, PostComment, PollComment, or Poll ORM object.
      kind:   'post' | 'post_comment' | 'poll_comment' | 'poll' — drives
              the log message + which "hide" attribute we set.

    Returns:
      True if this report triggered an auto-hide, False otherwise.
      The caller usually doesn't care, but a route may want to
      surface "this content was just auto-hidden" in the response
      to the reporter as a small signal.
    """
    target.report_count = (target.report_count or 0) + 1
    threshold = _threshold()
    if threshold <= 0 or target.report_count < threshold:
        return False

    # Don't re-hide content that's already hidden. The check is per
    # content type because each uses a different hide column. Also
    # stamp hide_reason / archived_reason='auto_hidden' so the
    # author's appeals surface correctly distinguishes auto-hide from
    # an admin Hide click — both are appealable, but the audit log
    # carries the difference.
    if kind == "poll":
        if getattr(target, "archived_at", None) is not None:
            return False
        target.archived_at = datetime.utcnow()
        target.archived_reason = "auto_hidden"
    else:
        if getattr(target, "deleted_at", None) is not None:
            return False
        target.deleted_at = datetime.utcnow()
        if hasattr(target, "hide_reason"):
            target.hide_reason = "auto_hidden"

    logger.warning(
        "Auto-hidden %s id=%s after %d reports (threshold=%d).",
        kind, getattr(target, "id", "?"), target.report_count, threshold,
    )
    return True
