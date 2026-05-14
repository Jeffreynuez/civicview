# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Admin moderation router — triage user reports.

All endpoints require an admin session (email matches one in
ADMIN_EMAILS env var). See services/admin_auth.py for the gate.

Endpoints:
  GET  /api/admin/whoami            — confirm admin auth + caller info
  GET  /api/admin/reports           — list open reports across all
                                       four content types, newest first
  POST /api/admin/reports/{kind}/{id}/dismiss   — mark a report acted
                                                  without hiding content
  POST /api/admin/reports/{kind}/{id}/hide      — hide the target +
                                                  resolve the report
  POST /api/admin/targets/{kind}/{id}/unhide    — un-hide a target
                                                  (clears deleted_at /
                                                  archived_at; leaves
                                                  report_count history)

`kind` is one of: post | post_comment | poll | poll_comment.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import (
    CitizenAccount,
    CommentReport,
    Poll,
    PollComment,
    PollCommentReport,
    PollReport,
    Post,
    PostComment,
    PostReport,
    RepAccount,
)
from app.services.admin_auth import get_current_admin


logger = logging.getLogger(__name__)
router = APIRouter()

# Limits for the report list. The admin UI paginates if we ever
# need it; for now 200 covers a healthy demo and a small launch.
_REPORT_LIST_LIMIT = 200

# Snippet length for the "preview" field on each report row.
_PREVIEW_CHARS = 200


ReportKind = Literal["post", "post_comment", "poll", "poll_comment"]


class AdminWhoamiResponse(BaseModel):
    kind: str
    id: int
    email: str


@router.get("/whoami", response_model=AdminWhoamiResponse)
def whoami(actor: dict = Depends(get_current_admin)) -> AdminWhoamiResponse:
    """Cheap probe — frontend hits this to decide whether to show the
    /admin route at all. 200 means the current user has admin powers;
    401/403 means hide the link."""
    return AdminWhoamiResponse(**actor)


class ReportRow(BaseModel):
    """Normalized report row for the queue. The frontend renders this
    in a uniform table regardless of which underlying *_reports table
    the row came from."""
    id: int                              # report id within its own table
    kind: ReportKind                     # which target type
    target_id: int                       # FK into the content table
    target_preview: str                  # first N chars of body/question
    target_hidden: bool                  # already auto-hidden / admin-hidden?
    reason: str
    detail: Optional[str] = None
    reporter_name: str
    reporter_kind: Literal["citizen", "rep"]
    created_at: datetime
    acted_at: Optional[datetime] = None


class ReportListResponse(BaseModel):
    items: List[ReportRow]


def _snippet(text: Optional[str]) -> str:
    """Trim a long body into the queue preview. Newlines collapsed so
    the queue table stays single-line per row."""
    if not text:
        return ""
    s = " ".join(text.split())
    return (s[: _PREVIEW_CHARS - 1] + "…") if len(s) > _PREVIEW_CHARS else s


def _reporter_label(
    db: Session, *, citizen_id: Optional[int], rep_id: Optional[int],
) -> tuple[str, str]:
    """Resolve a report row's reporter into (display_name, kind).
    Falls back to a placeholder if the row was orphaned by an account
    deletion (SET NULL on the FK)."""
    if citizen_id is not None:
        cz = db.get(CitizenAccount, citizen_id)
        return ((cz.display_name if cz else "(deleted citizen)"), "citizen")
    if rep_id is not None:
        rep = db.get(RepAccount, rep_id)
        return ((rep.display_name if rep else "(deleted rep)"), "rep")
    return ("(anonymous)", "citizen")  # shouldn't happen — endpoints require auth


@router.get("/reports", response_model=ReportListResponse)
def list_reports(
    include_acted: bool = False,
    db: Session = Depends(get_db),
    _actor: dict = Depends(get_current_admin),
) -> ReportListResponse:
    """Pull every open report across all four target types.

    Default: only reports with acted_at IS NULL (the queue).
    `include_acted=true` returns all reports including resolved
    ones — useful for an audit / "what did I just do" view.

    Sorted newest first; capped at _REPORT_LIST_LIMIT total rows
    across all types combined.
    """
    out: List[ReportRow] = []

    # ── Post reports ─────────────────────────────────────────────
    q = db.query(PostReport)
    if not include_acted:
        q = q.filter(PostReport.acted_at.is_(None))
    for r in q.order_by(PostReport.created_at.desc()).limit(_REPORT_LIST_LIMIT).all():
        target = db.get(Post, r.post_id)
        name, kind = _reporter_label(
            db, citizen_id=r.reporter_citizen_id, rep_id=r.reporter_rep_id,
        )
        out.append(ReportRow(
            id=r.id, kind="post", target_id=r.post_id,
            target_preview=_snippet(target.body if target else None),
            target_hidden=bool(target and target.deleted_at is not None),
            reason=r.reason, detail=r.detail,
            reporter_name=name, reporter_kind=kind,
            created_at=r.created_at, acted_at=r.acted_at,
        ))

    # ── PostComment reports ──────────────────────────────────────
    q = db.query(CommentReport)
    if not include_acted:
        q = q.filter(CommentReport.acted_at.is_(None))
    for r in q.order_by(CommentReport.created_at.desc()).limit(_REPORT_LIST_LIMIT).all():
        target = db.get(PostComment, r.comment_id)
        name, kind = _reporter_label(
            db, citizen_id=r.reporter_citizen_id, rep_id=r.reporter_rep_id,
        )
        out.append(ReportRow(
            id=r.id, kind="post_comment", target_id=r.comment_id,
            target_preview=_snippet(target.body if target else None),
            target_hidden=bool(target and target.deleted_at is not None),
            reason=r.reason, detail=r.detail,
            reporter_name=name, reporter_kind=kind,
            created_at=r.created_at, acted_at=r.acted_at,
        ))

    # ── Poll reports ─────────────────────────────────────────────
    q = db.query(PollReport)
    if not include_acted:
        q = q.filter(PollReport.acted_at.is_(None))
    for r in q.order_by(PollReport.created_at.desc()).limit(_REPORT_LIST_LIMIT).all():
        target = db.get(Poll, r.poll_id)
        name, kind = _reporter_label(
            db, citizen_id=r.reporter_citizen_id, rep_id=r.reporter_rep_id,
        )
        out.append(ReportRow(
            id=r.id, kind="poll", target_id=r.poll_id,
            target_preview=_snippet(target.question if target else None),
            target_hidden=bool(target and target.archived_at is not None),
            reason=r.reason, detail=r.detail,
            reporter_name=name, reporter_kind=kind,
            created_at=r.created_at, acted_at=r.acted_at,
        ))

    # ── PollComment reports ──────────────────────────────────────
    q = db.query(PollCommentReport)
    if not include_acted:
        q = q.filter(PollCommentReport.acted_at.is_(None))
    for r in q.order_by(PollCommentReport.created_at.desc()).limit(_REPORT_LIST_LIMIT).all():
        target = db.get(PollComment, r.poll_comment_id)
        name, kind = _reporter_label(
            db, citizen_id=r.reporter_citizen_id, rep_id=r.reporter_rep_id,
        )
        out.append(ReportRow(
            id=r.id, kind="poll_comment", target_id=r.poll_comment_id,
            target_preview=_snippet(target.body if target else None),
            target_hidden=bool(target and target.deleted_at is not None),
            reason=r.reason, detail=r.detail,
            reporter_name=name, reporter_kind=kind,
            created_at=r.created_at, acted_at=r.acted_at,
        ))

    # Newest first across all types, then cap.
    out.sort(key=lambda r: r.created_at, reverse=True)
    return ReportListResponse(items=out[:_REPORT_LIST_LIMIT])


# Tables-by-kind so the action endpoints can route without a chain
# of if/elif. Each entry is (report-table-class, target-table-class).
_REPORT_TABLES = {
    "post":         (PostReport, Post),
    "post_comment": (CommentReport, PostComment),
    "poll":         (PollReport, Poll),
    "poll_comment": (PollCommentReport, PollComment),
}


def _load_report_or_404(db: Session, kind: str, report_id: int):
    """Look up the report row by (kind, id). 400 for unknown kind,
    404 if the id doesn't exist."""
    if kind not in _REPORT_TABLES:
        raise HTTPException(status_code=400, detail=f"Unknown report kind: {kind!r}")
    report_cls, _target_cls = _REPORT_TABLES[kind]
    report = db.get(report_cls, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


def _load_target_or_404(db: Session, kind: str, target_id: int):
    """Look up the target row for an unhide action."""
    if kind not in _REPORT_TABLES:
        raise HTTPException(status_code=400, detail=f"Unknown target kind: {kind!r}")
    _report_cls, target_cls = _REPORT_TABLES[kind]
    target = db.get(target_cls, target_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Target not found")
    return target


class ActionResult(BaseModel):
    ok: bool = True
    target_hidden: bool


def _target_for_report(db: Session, kind: str, report) -> Any:
    """Resolve the target content row from a report row. The FK column
    name varies by kind — handle each explicitly."""
    if kind == "post":
        return db.get(Post, report.post_id)
    if kind == "post_comment":
        return db.get(PostComment, report.comment_id)
    if kind == "poll":
        return db.get(Poll, report.poll_id)
    if kind == "poll_comment":
        return db.get(PollComment, report.poll_comment_id)
    raise HTTPException(status_code=400, detail=f"Unknown report kind: {kind!r}")


def _hide_target(target: Any, kind: str) -> bool:
    """Apply the right hide attribute for the target type. Returns
    True if the target was newly hidden (False if already hidden)."""
    if kind == "poll":
        if target.archived_at is not None:
            return False
        target.archived_at = datetime.utcnow()
        target.archived_reason = "reported"
        return True
    if target.deleted_at is not None:
        return False
    target.deleted_at = datetime.utcnow()
    return True


def _unhide_target(target: Any, kind: str) -> bool:
    """Inverse of _hide_target. Returns True if the target was just
    un-hidden, False if it wasn't hidden to begin with."""
    if kind == "poll":
        if target.archived_at is None:
            return False
        target.archived_at = None
        target.archived_reason = None
        return True
    if target.deleted_at is None:
        return False
    target.deleted_at = None
    return True


@router.post(
    "/reports/{kind}/{report_id}/dismiss",
    response_model=ActionResult,
)
def dismiss_report(
    kind: ReportKind,
    report_id: int,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
) -> ActionResult:
    """Resolve a report without taking action on the content (e.g. the
    report was spurious / spam). Sets acted_at on the row so it falls
    out of the default queue. Target stays visible.
    """
    report = _load_report_or_404(db, kind, report_id)
    if report.acted_at is None:
        report.acted_at = datetime.utcnow()
        db.commit()
    target = _target_for_report(db, kind, report)
    hidden = (
        bool(target and getattr(target, "archived_at", None) is not None)
        if kind == "poll"
        else bool(target and getattr(target, "deleted_at", None) is not None)
    )
    logger.info(
        "Admin %s dismissed %s report id=%d.",
        actor["email"], kind, report_id,
    )
    return ActionResult(ok=True, target_hidden=hidden)


@router.post(
    "/reports/{kind}/{report_id}/hide",
    response_model=ActionResult,
)
def hide_target(
    kind: ReportKind,
    report_id: int,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
) -> ActionResult:
    """Hide the report's target AND resolve the report. Idempotent —
    if the target was already hidden (by auto-hide or a previous
    admin action), just resolves the report.
    """
    report = _load_report_or_404(db, kind, report_id)
    target = _target_for_report(db, kind, report)
    if target is None:
        # Target was already hard-deleted somehow; just resolve the report.
        if report.acted_at is None:
            report.acted_at = datetime.utcnow()
            db.commit()
        return ActionResult(ok=True, target_hidden=True)
    newly_hidden = _hide_target(target, kind)
    if report.acted_at is None:
        report.acted_at = datetime.utcnow()
    db.commit()
    logger.warning(
        "Admin %s hid %s target_id=%d (via report id=%d, newly_hidden=%s).",
        actor["email"], kind, getattr(target, "id", -1), report_id, newly_hidden,
    )
    return ActionResult(ok=True, target_hidden=True)


@router.post(
    "/targets/{kind}/{target_id}/unhide",
    response_model=ActionResult,
)
def unhide_target(
    kind: ReportKind,
    target_id: int,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
) -> ActionResult:
    """Restore content that was auto-hidden or admin-hidden. Does NOT
    resolve outstanding reports — admin should review them separately
    (the content is visible again, but the queue still shows the
    reports so the admin can decide whether they were spurious).
    """
    target = _load_target_or_404(db, kind, target_id)
    newly_unhidden = _unhide_target(target, kind)
    db.commit()
    logger.warning(
        "Admin %s un-hid %s target_id=%d (newly_unhidden=%s).",
        actor["email"], kind, target_id, newly_unhidden,
    )
    return ActionResult(ok=True, target_hidden=False)
