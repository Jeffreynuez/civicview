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
  admin would have to act manually). Only reports from trusted
  identities (reps, verified non-demo citizens) count toward the
  threshold; every report still reaches the admin queue.

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

from sqlalchemy import func
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


_REPORT_TABLES = {
    # kind: (report model name, foreign-key column on that model)
    "post": ("PostReport", "post_id"),
    "post_comment": ("CommentReport", "comment_id"),
    "poll": ("PollReport", "poll_id"),
    "poll_comment": ("PollCommentReport", "poll_comment_id"),
}


def is_trusted_reporter_citizen(citizen: Any) -> bool:
    """A citizen whose report may count toward auto-hide: verified by a
    real method. Demo accounts are verified_method='demo' and do not
    count, whatever their verified flag says."""
    from app.services.verified_identity import is_verified_person
    return is_verified_person(citizen)


def _trusted_report_count(db: Session, target: Any, kind: str) -> int:
    """Reports on `target` filed by trusted identities: reps (manually
    provisioned accounts) and verified, non-demo citizens."""
    from app.models import pages as models

    model_name, fk = _REPORT_TABLES[kind]
    model = getattr(models, model_name)
    db.flush()  # the caller just added this reporter's row
    rows = db.query(model).filter(getattr(model, fk) == target.id).all()
    trusted = 0
    for row in rows:
        if getattr(row, "reporter_rep_id", None):
            trusted += 1
        elif getattr(row, "reporter_citizen_id", None):
            citizen = db.get(models.CitizenAccount, row.reporter_citizen_id)
            if is_trusted_reporter_citizen(citizen):
                trusted += 1
    return trusted


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
    # One atomic UPDATE (report_count = report_count + 1) instead of
    # read, add one, write back: two reports landing together used to
    # both read N and both write N + 1, losing one (audit B9). The
    # refresh reads the new value back into this session.
    model = type(target)
    db.query(model).filter(model.id == target.id).update(
        {model.report_count: func.coalesce(model.report_count, 0) + 1},
        synchronize_session=False,
    )
    db.refresh(target, attribute_names=["report_count"])
    threshold = _threshold()
    if threshold <= 0:
        return False
    # Only TRUSTED reports count toward auto-hide. report_count keeps
    # every report so the admin queue sees them all, but a demo account
    # costs nothing to create, and five of them could hide any post in
    # the app (reproduced 2026-09-24). Until identity verification is
    # live, demo reports go to the admin queue and never hide anything
    # on their own. See _trusted_report_count.
    if _trusted_report_count(db, target, kind) < threshold:
        return False

    # Don't re-hide content that's already hidden. The check is per
    # content type because each uses a different hide column. Also
    # stamp hide_reason / archived_reason='auto_hidden' so the
    # author's appeals surface correctly distinguishes auto-hide from
    # an admin Hide click — both are appealable, but the audit log
    # carries the difference.
    if kind == "poll":
        from app.services.citizen_polls_service import poll_is_publicly_visible
        if not poll_is_publicly_visible(target):
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
