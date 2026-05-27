# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.pages import (
    CandidateAccount,
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
    RepEvent,
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
    # 2FA Phase 4 — true when FORCE_2FA_ENABLED is set AND the admin
    # account hasn't enrolled in TOTP yet. Frontend uses this to
    # render the full-screen enrollment overlay before letting the
    # admin reach /admin or any other surface. Admins ARE in the
    # enforced set — losing admin credentials to credential theft
    # would be the highest-blast-radius compromise on the platform.
    needs_2fa_enrollment: bool = False


@router.get("/whoami", response_model=AdminWhoamiResponse)
def whoami(actor: dict = Depends(get_current_admin), db: Session = Depends(get_db)) -> AdminWhoamiResponse:
    """Cheap probe — frontend hits this to decide whether to show the
    /admin route at all. 200 means the current user has admin powers;
    401/403 means hide the link."""
    from app.services.totp_enforcement import requires_2fa_enrollment
    # Resolve the underlying account to read totp_enabled_at. Admin
    # status is granted to either a rep or a citizen via ADMIN_EMAILS,
    # so the actor dict's `kind` tells us which table to hit.
    account = None
    if actor.get("kind") == "rep":
        account = db.get(RepAccount, actor["id"])
    elif actor.get("kind") == "citizen":
        account = db.get(CitizenAccount, actor["id"])
    needs = requires_2fa_enrollment("admin", account) if account is not None else False
    return AdminWhoamiResponse(**actor, needs_2fa_enrollment=needs)


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
    # Deep-link affordance: where on the public site does this target
    # live? Frontend opens this in a new tab from the admin queue so
    # the admin can read full thread context before acting. NULL when
    # we couldn't resolve a hosting page (e.g. content references an
    # official_id we don't have data for — shouldn't happen, but be
    # defensive). `target_author_*` lets the suspend-author action
    # find the right account row to suspend.
    context_official_id: Optional[str] = None
    target_author_kind: Optional[Literal["citizen", "rep"]] = None
    target_author_id: Optional[int] = None
    target_author_name: Optional[str] = None


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


def _resolve_target_context(db: Session, kind: str, target: Any) -> dict:
    """For a given report target (Post / PostComment / Poll / PollComment),
    return:
      - context_official_id : the rep page this content lives on
      - target_author_kind  : 'citizen' | 'rep' | None
      - target_author_id    : the author account id, for the suspend action
      - target_author_name  : display name of the author

    The official_id resolution walks the FK chain:
      Post           → Post.official_id
      PostComment    → PostComment.post_id → Post.official_id
      Poll (rep)     → Poll.post_id → Post.official_id
      Poll (citizen) → Poll.target_official_id
      PollComment    → poll → (rep or citizen branch above)

    Returns {} keyed dict-style; caller spreads onto ReportRow. Missing
    fields stay None which the schema allows.
    """
    out: dict = {
        "context_official_id": None,
        "target_author_kind": None,
        "target_author_id": None,
        "target_author_name": None,
    }
    if target is None:
        return out

    if kind == "post":
        out["context_official_id"] = target.official_id
        # The post author is a rep — look up via author_id.
        author = db.get(RepAccount, target.author_id) if target.author_id else None
        if author is not None:
            out["target_author_kind"] = "rep"
            out["target_author_id"] = author.id
            out["target_author_name"] = author.display_name

    elif kind == "post_comment":
        post = db.get(Post, target.post_id) if target.post_id else None
        if post is not None:
            out["context_official_id"] = post.official_id
        # Comment authors are citizens.
        author = db.get(CitizenAccount, target.citizen_id) if target.citizen_id else None
        if author is not None:
            out["target_author_kind"] = "citizen"
            out["target_author_id"] = author.id
            out["target_author_name"] = author.display_name

    elif kind == "poll":
        # Two flavors of poll: rep-authored (attached to a Post) or
        # citizen-authored (target_official_id points at the page).
        if target.author_kind == "citizen":
            out["context_official_id"] = target.target_official_id
            author = (
                db.get(CitizenAccount, target.author_citizen_id)
                if target.author_citizen_id else None
            )
            if author is not None:
                out["target_author_kind"] = "citizen"
                out["target_author_id"] = author.id
                out["target_author_name"] = author.display_name
        else:
            post = db.get(Post, target.post_id) if target.post_id else None
            if post is not None:
                out["context_official_id"] = post.official_id
                author = db.get(RepAccount, post.author_id) if post.author_id else None
                if author is not None:
                    out["target_author_kind"] = "rep"
                    out["target_author_id"] = author.id
                    out["target_author_name"] = author.display_name

    elif kind == "poll_comment":
        poll = db.get(Poll, target.poll_id) if target.poll_id else None
        if poll is not None:
            # Recurse on the parent poll to get its official_id (but
            # author is the COMMENT author, not the poll author).
            poll_ctx = _resolve_target_context(db, "poll", poll)
            out["context_official_id"] = poll_ctx["context_official_id"]
        author = db.get(CitizenAccount, target.citizen_id) if target.citizen_id else None
        if author is not None:
            out["target_author_kind"] = "citizen"
            out["target_author_id"] = author.id
            out["target_author_name"] = author.display_name

    return out


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
        ctx = _resolve_target_context(db, "post", target)
        out.append(ReportRow(
            id=r.id, kind="post", target_id=r.post_id,
            target_preview=_snippet(target.body if target else None),
            target_hidden=bool(target and target.deleted_at is not None),
            reason=r.reason, detail=r.detail,
            reporter_name=name, reporter_kind=kind,
            created_at=r.created_at, acted_at=r.acted_at,
            **ctx,
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
        ctx = _resolve_target_context(db, "post_comment", target)
        out.append(ReportRow(
            id=r.id, kind="post_comment", target_id=r.comment_id,
            target_preview=_snippet(target.body if target else None),
            target_hidden=bool(target and target.deleted_at is not None),
            reason=r.reason, detail=r.detail,
            reporter_name=name, reporter_kind=kind,
            created_at=r.created_at, acted_at=r.acted_at,
            **ctx,
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
        ctx = _resolve_target_context(db, "poll", target)
        out.append(ReportRow(
            id=r.id, kind="poll", target_id=r.poll_id,
            target_preview=_snippet(target.question if target else None),
            target_hidden=bool(target and target.archived_at is not None),
            reason=r.reason, detail=r.detail,
            reporter_name=name, reporter_kind=kind,
            created_at=r.created_at, acted_at=r.acted_at,
            **ctx,
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
        ctx = _resolve_target_context(db, "poll_comment", target)
        out.append(ReportRow(
            id=r.id, kind="poll_comment", target_id=r.poll_comment_id,
            target_preview=_snippet(target.body if target else None),
            target_hidden=bool(target and target.deleted_at is not None),
            reason=r.reason, detail=r.detail,
            reporter_name=name, reporter_kind=kind,
            created_at=r.created_at, acted_at=r.acted_at,
            **ctx,
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
    True if the target was newly hidden (False if already hidden).
    Also stamps hide_reason / archived_reason='admin_hidden' so the
    appeals surface knows this was a moderator action (not an
    author-deletion) and shows the Appeal button to the author."""
    if kind == "poll":
        if target.archived_at is not None:
            return False
        target.archived_at = datetime.utcnow()
        target.archived_reason = "admin_hidden"
        return True
    if target.deleted_at is not None:
        return False
    target.deleted_at = datetime.utcnow()
    # hide_reason exists on Post / PostComment / PollComment. Set
    # defensively in case the column is missing on some other future
    # target type (extra hasattr guards the assignment).
    if hasattr(target, "hide_reason"):
        target.hide_reason = "admin_hidden"
    return True


def _unhide_target(target: Any, kind: str) -> bool:
    """Inverse of _hide_target. Returns True if the target was just
    un-hidden, False if it wasn't hidden to begin with. Also clears
    hide_reason / archived_reason so the appeals surface stops
    treating the row as moderation-hidden."""
    if kind == "poll":
        if target.archived_at is None:
            return False
        target.archived_at = None
        target.archived_reason = None
        return True
    if target.deleted_at is None:
        return False
    target.deleted_at = None
    if hasattr(target, "hide_reason"):
        target.hide_reason = None
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
    # Resolve EVERY open report against this same target, not just
    # the one that triggered the hide. If 3 different users reported
    # the same comment, hiding it answers all 3 — the queue
    # shouldn't keep showing the remaining 2 as open.
    resolved_n = _resolve_reports_against_target(
        db, kind=kind, target_id=getattr(target, "id", -1),
    )
    db.commit()
    logger.warning(
        "Admin %s hid %s target_id=%d (via report id=%d, newly_hidden=%s, "
        "resolved %d open report(s) against the target).",
        actor["email"], kind, getattr(target, "id", -1), report_id,
        newly_hidden, resolved_n,
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


# ── User suspend / unsuspend ────────────────────────────────────────
# `kind` is 'rep' | 'citizen'. Suspending sets suspended_at + optional
# reason; the auth dependencies pick that up immediately and treat
# the account as not-signed-in on subsequent requests. The login
# endpoints also check the column so re-auth attempts get a clear
# 403 + contact-us message rather than silent failure.
#
# Operators with admin access in ADMIN_EMAILS can NEVER suspend
# themselves (defensive — would lock the operator out of /admin if
# they fat-finger the wrong user id).

UserKind = Literal["rep", "citizen", "candidate"]


class UserSuspendPayload(BaseModel):
    reason: Optional[str] = None
    # When True, also soft-hide every piece of content the user
    # currently has visible. See the suspend endpoint for the
    # exact scope (posts, post-comments, polls, poll-comments).
    # Default False — admin must opt in per-suspension.
    cascade_hide: bool = False


class UserActionResult(BaseModel):
    ok: bool = True
    suspended: bool
    # Populated when cascade_hide=True. Empty dict otherwise.
    # Useful for the UI to show "Suspended + hid N posts and M
    # comments" after the action.
    hidden_counts: dict = {}
    # Reports against this user's content that got auto-resolved by
    # the suspend action. Keyed by report kind. Sum lets the UI flash
    # "...and closed 3 open reports against them" in a confirmation
    # toast / inline message.
    resolved_reports: dict = {}


def _load_user_account_or_404(db: Session, kind: str, user_id: int):
    if kind == "rep":
        acc = db.get(RepAccount, user_id)
    elif kind == "citizen":
        acc = db.get(CitizenAccount, user_id)
    elif kind == "candidate":
        acc = db.get(CandidateAccount, user_id)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown user kind: {kind!r}")
    if acc is None:
        raise HTTPException(status_code=404, detail="User not found")
    return acc


def _resolve_reports_against_user(
    db: Session, *, user_kind: str, user_id: int,
) -> dict:
    """When the admin acts against a user (suspend), every open report
    targeting content authored by that user is implicitly resolved —
    the admin's action IS the moderation outcome. Without this the
    queue stays cluttered with reports for hidden content authored
    by suspended users, which is the bug the user just hit.

    Each branch matches the report's target FK back to the user via
    the authoring chain:
      Post / RepEvent     → author_id (rep_accounts.id)
      PostComment         → citizen_id (citizen_accounts.id)
      Poll (rep flavor)   → post.author_id (rep)
      Poll (citizen)      → author_citizen_id
      PollComment         → citizen_id

    Returns counts per type, useful for the response body so the UI
    can flash "Suspended Sweeny Tod and resolved 3 open reports."
    """
    now = datetime.utcnow()
    counts = {"post": 0, "post_comment": 0, "poll": 0, "poll_comment": 0}

    if user_kind == "rep":
        # PostReports against this rep's posts.
        for r in (
            db.query(PostReport)
            .join(Post, Post.id == PostReport.post_id)
            .filter(Post.author_id == user_id, PostReport.acted_at.is_(None))
            .all()
        ):
            r.acted_at = now
            counts["post"] += 1
        # PollReports against this rep's rep-authored polls (via the
        # attached post).
        for r in (
            db.query(PollReport)
            .join(Poll, Poll.id == PollReport.poll_id)
            .join(Post, Post.id == Poll.post_id)
            .filter(
                Poll.author_kind == "rep",
                Post.author_id == user_id,
                PollReport.acted_at.is_(None),
            )
            .all()
        ):
            r.acted_at = now
            counts["poll"] += 1
        return counts

    if user_kind == "candidate":
        # Candidate accounts can't author content yet (Phase 4 ships
        # author_candidate_id on Posts). Until then there's nothing
        # for the suspend-cascade to resolve. Return zero counts.
        return counts

    # Citizen — comments, polls, poll-comments.
    for r in (
        db.query(CommentReport)
        .join(PostComment, PostComment.id == CommentReport.comment_id)
        .filter(PostComment.citizen_id == user_id, CommentReport.acted_at.is_(None))
        .all()
    ):
        r.acted_at = now
        counts["post_comment"] += 1
    for r in (
        db.query(PollReport)
        .join(Poll, Poll.id == PollReport.poll_id)
        .filter(
            Poll.author_kind == "citizen",
            Poll.author_citizen_id == user_id,
            PollReport.acted_at.is_(None),
        )
        .all()
    ):
        r.acted_at = now
        counts["poll"] += 1
    for r in (
        db.query(PollCommentReport)
        .join(PollComment, PollComment.id == PollCommentReport.poll_comment_id)
        .filter(PollComment.citizen_id == user_id, PollCommentReport.acted_at.is_(None))
        .all()
    ):
        r.acted_at = now
        counts["poll_comment"] += 1
    return counts


def _resolve_reports_against_target(
    db: Session, *, kind: str, target_id: int,
) -> int:
    """Mark every open report for a specific piece of content as
    resolved. Called when an admin hides content — the report that
    triggered the hide is one of N reports against the same target;
    the rest are implicitly resolved by the same action.

    Returns the count of reports newly resolved (excludes those
    already acted on)."""
    now = datetime.utcnow()
    table_map = {
        "post":         (PostReport, "post_id"),
        "post_comment": (CommentReport, "comment_id"),
        "poll":         (PollReport, "poll_id"),
        "poll_comment": (PollCommentReport, "poll_comment_id"),
    }
    if kind not in table_map:
        return 0
    cls, fk = table_map[kind]
    rows = (
        db.query(cls)
        .filter(getattr(cls, fk) == target_id, cls.acted_at.is_(None))
        .all()
    )
    for r in rows:
        r.acted_at = now
    return len(rows)


@router.post(
    "/users/{kind}/{user_id}/suspend",
    response_model=UserActionResult,
)
def suspend_user(
    kind: UserKind,
    user_id: int,
    payload: UserSuspendPayload,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
) -> UserActionResult:
    """Suspend a rep or citizen account. Sets suspended_at to now and
    records a short reason. Idempotent — re-suspending an already-
    suspended account just updates the reason (no audit log of
    multiple suspensions today; if abuse history becomes relevant
    a separate `user_suspensions` table is the right shape)."""
    acc = _load_user_account_or_404(db, kind, user_id)
    # Self-suspension guard.
    if kind == actor["kind"] and actor["id"] == user_id:
        raise HTTPException(
            status_code=400,
            detail="Can't suspend your own account — that would lock you out of /admin.",
        )
    # Don't suspend other admins through this endpoint either — they
    # have to be removed from ADMIN_EMAILS first. Otherwise admin A
    # could lock out admin B and there's no in-band recovery.
    from app.services.admin_auth import is_admin_email
    if is_admin_email(getattr(acc, "email", None)):
        raise HTTPException(
            status_code=400,
            detail="Can't suspend a fellow admin. Remove them from ADMIN_EMAILS first.",
        )

    if acc.suspended_at is None:
        acc.suspended_at = datetime.utcnow()
    if payload.reason:
        acc.suspended_reason = payload.reason.strip()[:255]

    hidden_counts: dict = {}
    if payload.cascade_hide:
        # Soft-hide all of this user's currently-visible content.
        # "Visible" = not already deleted_at / archived_at. We skip
        # already-hidden rows so re-running cascade doesn't reset
        # the deleted_at timestamp on already-removed content.
        #
        # NOTE: this is intentionally one-way. Unsuspend does NOT
        # automatically restore. Admin should review surviving
        # reports + decide per-piece whether prior content was
        # legitimate. Cascade-hide is for "this person clearly
        # shouldn't have a public footprint right now"; surgical
        # restore is for "and now we've reviewed it carefully."
        now = datetime.utcnow()
        if kind == "rep":
            # Rep content: their authored Posts (which cascades to
            # the attached Poll), plus any RepEvents they posted.
            # No comments — reps don't author comments in the
            # current data model.
            posts = (
                db.query(Post)
                .filter(Post.author_id == user_id, Post.deleted_at.is_(None))
                .all()
            )
            for p in posts:
                p.deleted_at = now
                p.hide_reason = "admin_hidden"
            hidden_counts["posts"] = len(posts)
            events = (
                db.query(RepEvent)
                .filter(RepEvent.author_id == user_id, RepEvent.deleted_at.is_(None))
                .all()
            )
            for e in events:
                e.deleted_at = now
                # RepEvent doesn't have hide_reason — events aren't an
                # appealable surface today (no event-detail UI for the
                # author). If we ever ship that, mirror the column here.
            hidden_counts["events"] = len(events)
        elif kind == "candidate":
            # Candidate accounts can't author content yet (Phase 4
            # ships Posts.author_candidate_id). Until then cascade-hide
            # is a no-op for candidates. Recording empty counts keeps
            # the response shape uniform across kinds.
            hidden_counts = {"posts": 0, "events": 0}
        else:  # citizen
            # Citizen content: post comments, citizen-authored polls
            # (archived_at + reason='reported_user_suspended'), and
            # comments on poll threads.
            comments = (
                db.query(PostComment)
                .filter(PostComment.citizen_id == user_id, PostComment.deleted_at.is_(None))
                .all()
            )
            for c in comments:
                c.deleted_at = now
                c.hide_reason = "admin_hidden"
            hidden_counts["post_comments"] = len(comments)
            polls = (
                db.query(Poll)
                .filter(
                    Poll.author_kind == "citizen",
                    Poll.author_citizen_id == user_id,
                    Poll.archived_at.is_(None),
                )
                .all()
            )
            for p in polls:
                p.archived_at = now
                # Reuse 'admin_hidden' for consistency with the
                # appeals surface — the author can appeal these even
                # though the trigger was a user suspension. The
                # earlier 'reported_user_suspended' value was finer-
                # grained but not surfaced anywhere; admin_hidden is
                # the appealable bucket.
                p.archived_reason = "admin_hidden"
            hidden_counts["polls"] = len(polls)
            poll_comments = (
                db.query(PollComment)
                .filter(PollComment.citizen_id == user_id, PollComment.deleted_at.is_(None))
                .all()
            )
            for pc in poll_comments:
                pc.deleted_at = now
                pc.hide_reason = "admin_hidden"
            hidden_counts["poll_comments"] = len(poll_comments)

    # Implicit moderation outcome: suspending the user resolves every
    # open report against their authored content. Without this the
    # moderation queue stays cluttered with hidden / acted-on content.
    resolved_reports = _resolve_reports_against_user(
        db, user_kind=kind, user_id=user_id,
    )

    db.commit()
    logger.warning(
        "Admin %s suspended %s user_id=%d (reason=%r, cascade=%s, hidden=%s, resolved=%s).",
        actor["email"], kind, user_id, acc.suspended_reason,
        payload.cascade_hide, hidden_counts, resolved_reports,
    )
    return UserActionResult(
        ok=True, suspended=True,
        hidden_counts=hidden_counts,
        resolved_reports=resolved_reports,
    )


@router.post(
    "/users/{kind}/{user_id}/unsuspend",
    response_model=UserActionResult,
)
def unsuspend_user(
    kind: UserKind,
    user_id: int,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
) -> UserActionResult:
    """Lift a suspension. Clears suspended_at + suspended_reason. Does
    NOT restore any content the user had hidden — that's a separate
    explicit unhide per piece."""
    acc = _load_user_account_or_404(db, kind, user_id)
    if acc.suspended_at is None:
        return UserActionResult(ok=True, suspended=False)
    acc.suspended_at = None
    acc.suspended_reason = None
    db.commit()
    logger.warning(
        "Admin %s un-suspended %s user_id=%d.",
        actor["email"], kind, user_id,
    )
    return UserActionResult(ok=True, suspended=False)


# ── Unread-count endpoint for the navbar badge ──────────────────────
class UnreadCountResponse(BaseModel):
    count: int


@router.get("/reports/unread-count", response_model=UnreadCountResponse)
def unread_report_count(
    db: Session = Depends(get_db),
    _actor: dict = Depends(get_current_admin),
) -> UnreadCountResponse:
    """Count of open (acted_at IS NULL) reports across all four
    target types. Polled by the admin navbar badge so admins know
    there's something in the queue without visiting /admin first.

    Cheap query — four COUNTs with a WHERE on an indexed column
    (acted_at). Polling every 30s from a single admin session is
    fine; if we ever have multiple admins hammering this together,
    layer Redis or in-memory caching on top.
    """
    n = 0
    for cls in (PostReport, CommentReport, PollReport, PollCommentReport):
        n += db.query(func.count(cls.id)).filter(cls.acted_at.is_(None)).scalar() or 0
    return UnreadCountResponse(count=int(n))


# ── Suspended users index ───────────────────────────────────────────
class SuspendedUserRow(BaseModel):
    """Normalized row for the suspended-users UI. Same row shape for
    both rep and citizen accounts so the frontend renders one table."""
    kind: Literal["rep", "citizen"]
    id: int
    email: str
    display_name: str
    suspended_at: datetime
    suspended_reason: Optional[str] = None


class SuspendedUserListResponse(BaseModel):
    items: List[SuspendedUserRow]


@router.get("/users/suspended", response_model=SuspendedUserListResponse)
def list_suspended_users(
    db: Session = Depends(get_db),
    _actor: dict = Depends(get_current_admin),
) -> SuspendedUserListResponse:
    """List every rep + citizen account with suspended_at IS NOT NULL,
    newest suspension first. Cap at 200 — beyond that an admin needs
    a search / pagination UI which isn't built yet.
    """
    out: List[SuspendedUserRow] = []

    rep_rows = (
        db.query(RepAccount)
        .filter(RepAccount.suspended_at.isnot(None))
        .order_by(RepAccount.suspended_at.desc())
        .limit(200)
        .all()
    )
    for r in rep_rows:
        out.append(SuspendedUserRow(
            kind="rep", id=r.id, email=r.email,
            display_name=r.display_name,
            suspended_at=r.suspended_at,
            suspended_reason=r.suspended_reason,
        ))

    cz_rows = (
        db.query(CitizenAccount)
        .filter(CitizenAccount.suspended_at.isnot(None))
        .order_by(CitizenAccount.suspended_at.desc())
        .limit(200)
        .all()
    )
    for c in cz_rows:
        out.append(SuspendedUserRow(
            kind="citizen", id=c.id, email=c.email,
            display_name=c.display_name,
            suspended_at=c.suspended_at,
            suspended_reason=c.suspended_reason,
        ))

    cand_rows = (
        db.query(CandidateAccount)
        .filter(CandidateAccount.suspended_at.isnot(None))
        .order_by(CandidateAccount.suspended_at.desc())
        .limit(200)
        .all()
    )
    for cand in cand_rows:
        out.append(SuspendedUserRow(
            kind="candidate", id=cand.id, email=cand.email,
            display_name=cand.display_name,
            suspended_at=cand.suspended_at,
            suspended_reason=cand.suspended_reason,
        ))

    # Newest-first across all three kinds, then cap.
    out.sort(key=lambda u: u.suspended_at, reverse=True)
    return SuspendedUserListResponse(items=out[:200])


# ── Election-win promotion (Phase 5 scaffold) ─────────────────────────
# Promote a CandidateAccount to a RepAccount per the identity-model
# spec's "promote in place" decision. Schema-wise we have separate
# candidate_accounts and rep_accounts tables, so "promote in place"
# is implemented as:
#   1. Create a new RepAccount with the candidate's identity (email,
#      display_name, geography) + the official_id their new office is
#      keyed on (bioguide_id for federal, state seed id for state, etc.).
#   2. Migrate every Post / PostReaction / PostComment / CommentReaction
#      / PollVote / PollComment row from the candidate authorship to
#      the new rep authorship.
#   3. Re-key those rows' official_id from candidate_id → new
#      official_id so the page surface shows the same content under
#      the rep page URL.
#   4. Archive the candidate account (is_active=False, suspended_at
#      stamped with reason 'promoted_to_rep') so the candidate can
#      no longer log in.
#   5. Archive the OLD rep on this official_id, if any (the defeated
#      incumbent), with reason 'defeated_in_election'.
#
# Important caveats — this scaffold is intentionally narrow:
#   • The new RepAccount's password is supplied by the admin. A real
#     onboarding flow would email the new rep a setup link; that's
#     deferred to a later phase.
#   • We don't migrate uploaded images (PostImage.uploader_candidate_id
#     → uploader_id). The Post rows reference the images correctly via
#     post_id, so they still render — the ownership trail just keeps
#     pointing at the archived candidate account. Acceptable for the
#     historical record.
#   • This is an irreversible action. Admins should run it once the
#     election has been certified, not before.

class PromoteCandidateRequest(BaseModel):
    """Admin payload to promote a candidate to a rep account."""
    new_official_id: str = Field(..., min_length=1, max_length=64)
    new_role: Optional[str] = Field(default=None, max_length=64)
    new_password: str = Field(..., min_length=8, max_length=256)


class PromoteCandidateResponse(BaseModel):
    ok: bool = True
    candidate_id: int
    new_rep_account_id: int
    new_official_id: str
    defeated_rep_account_id: Optional[int] = None
    migrated: dict = Field(default_factory=dict)


@router.post(
    "/candidates/{candidate_db_id}/promote",
    response_model=PromoteCandidateResponse,
)
def promote_candidate(
    candidate_db_id: int,
    payload: PromoteCandidateRequest,
    db: Session = Depends(get_db),
    _actor: dict = Depends(get_current_admin),
) -> PromoteCandidateResponse:
    """Promote a CandidateAccount to a RepAccount. See module-level
    comment for the lifecycle + caveats."""
    from datetime import datetime
    from app.auth import hash_password
    from app.models.pages import (
        PostReaction, PostComment, CommentReaction, PollVote, PollComment,
    )

    candidate = db.get(CandidateAccount, candidate_db_id)
    if candidate is None or not candidate.is_active:
        raise HTTPException(status_code=404, detail="Candidate account not found.")
    if candidate.claim_status != "active":
        raise HTTPException(
            status_code=400,
            detail="Only active candidates can be promoted. Approve the claim first.",
        )

    new_official_id = payload.new_official_id.strip()
    if not new_official_id:
        raise HTTPException(status_code=400, detail="new_official_id is required.")

    # Email collision check — a rep account already exists for some
    # other candidate's email? Refuse, the admin needs to manually
    # resolve before promoting.
    existing_email = (
        db.query(RepAccount).filter(RepAccount.email == candidate.email).first()
    )
    if existing_email is not None and existing_email.official_id != new_official_id:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A rep account already exists with email {candidate.email!r} "
                f"under official_id {existing_email.official_id!r}. Resolve "
                "manually before promoting."
            ),
        )

    # If a rep account already holds this official_id, that's the
    # defeated incumbent — archive them with a clear reason.
    defeated_rep = (
        db.query(RepAccount)
        .filter(RepAccount.official_id == new_official_id, RepAccount.suspended_at.is_(None))
        .first()
    )
    defeated_rep_id: Optional[int] = None
    if defeated_rep is not None:
        defeated_rep.suspended_at = datetime.utcnow()
        defeated_rep.suspended_reason = "defeated_in_election"
        defeated_rep.is_active = False
        defeated_rep_id = defeated_rep.id

    # Mint the new rep account. We do NOT reuse the defeated rep's
    # row even when one existed — a fresh row keeps the audit trail
    # readable and avoids accidentally inheriting suspended state.
    new_rep = RepAccount(
        email=candidate.email,
        password_hash=hash_password(payload.new_password),
        display_name=candidate.display_name,
        official_id=new_official_id,
        role=(payload.new_role or "").strip() or None,
        owner_state=candidate.owner_state,
        owner_district=candidate.owner_district,
        owner_city=candidate.owner_city,
        is_active=True,
    )
    db.add(new_rep)
    db.flush()  # populate new_rep.id

    # Migration sweep — re-attribute every authored row and re-key
    # official_id from candidate_id → new_official_id. We touch each
    # engagement table independently so a malformed row in one
    # doesn't block the others. Rows are tagged on author_candidate_id
    # so the WHERE-clause is selective.
    migrated = {}
    migrated["posts"] = (
        db.query(Post)
        .filter(Post.author_candidate_id == candidate.id)
        .update(
            {Post.author_id: new_rep.id, Post.author_candidate_id: None},
            synchronize_session=False,
        )
    )
    # Re-key the page's official_id on all of THIS candidate's posts
    # (which now belong to the new rep account).
    db.query(Post).filter(
        Post.author_id == new_rep.id,
        Post.official_id == candidate.candidate_id,
    ).update({Post.official_id: new_official_id}, synchronize_session=False)
    migrated["post_reactions"] = (
        db.query(PostReaction)
        .filter(PostReaction.author_candidate_id == candidate.id)
        .update(
            {PostReaction.author_rep_id: new_rep.id, PostReaction.author_candidate_id: None},
            synchronize_session=False,
        )
    )
    migrated["post_comments"] = (
        db.query(PostComment)
        .filter(PostComment.author_candidate_id == candidate.id)
        .update(
            {PostComment.author_rep_id: new_rep.id, PostComment.author_candidate_id: None},
            synchronize_session=False,
        )
    )
    migrated["comment_reactions"] = (
        db.query(CommentReaction)
        .filter(CommentReaction.author_candidate_id == candidate.id)
        .update(
            {CommentReaction.author_rep_id: new_rep.id, CommentReaction.author_candidate_id: None},
            synchronize_session=False,
        )
    )
    migrated["poll_votes"] = (
        db.query(PollVote)
        .filter(PollVote.author_candidate_id == candidate.id)
        .update(
            {PollVote.author_rep_id: new_rep.id, PollVote.author_candidate_id: None},
            synchronize_session=False,
        )
    )
    migrated["poll_comments"] = (
        db.query(PollComment)
        .filter(PollComment.author_candidate_id == candidate.id)
        .update(
            {PollComment.author_rep_id: new_rep.id, PollComment.author_candidate_id: None},
            synchronize_session=False,
        )
    )

    # Archive the candidate account so they can no longer log in
    # through the candidate-auth path. The archived row stays in the
    # admin queue for historical reference.
    candidate.is_active = False
    candidate.suspended_at = datetime.utcnow()
    candidate.suspended_reason = "promoted_to_rep"

    db.commit()
    db.refresh(new_rep)

    logger.info(
        "Promoted candidate %s (db id %d) → rep %s (new db id %d). "
        "Migrated: %r. Defeated incumbent rep id: %s.",
        candidate.candidate_id, candidate.id,
        new_rep.official_id, new_rep.id,
        migrated, defeated_rep_id,
    )
    return PromoteCandidateResponse(
        ok=True,
        candidate_id=candidate.id,
        new_rep_account_id=new_rep.id,
        new_official_id=new_rep.official_id,
        defeated_rep_account_id=defeated_rep_id,
        migrated=migrated,
    )


# ── Lockout management (Task #56 revision) ───────────────────────────
from pydantic import BaseModel as _UnlockBaseModel
from typing import Literal as _UnlockLiteral


class _AdminUnlockRequest(_UnlockBaseModel):
    """Body for admin unlock. identity_kind picks which model to load."""
    identity_kind: _UnlockLiteral["rep", "candidate", "citizen"]
    account_id: int


# ── Consolidated dashboard load (Task #63) ──────────────────────────
@router.get("/dashboard")
def admin_dashboard(
    db: Session = Depends(get_db),
    _actor: dict = Depends(get_current_admin),
):
    """Single-call dashboard load — returns the four datasets the
    /admin page renders on initial mount, in one request.

    Replaces the prior pattern where the page fired four separate
    GETs in parallel — which was triggering Cloudflare's WAF burst
    rate-limit (Task #62). Per-tab refresh after a user action still
    hits the individual endpoints (/reports, /appeals,
    /users/suspended, /lockouts) so action-driven reloads stay
    narrow and fast.

    Internally calls each list function — no duplicated query
    logic. Each list function already has its own get_current_admin
    dependency; passing the resolved actor through avoids re-running
    the admin check four times.

    Response shape (each subfield is the same shape the per-endpoint
    response would have returned):
        {
          "reports":   {"items": [...]},
          "appeals":   {"items": [...]},
          "suspended": {"items": [...]},
          "lockouts":  {"items": [...]}
        }

    Note: list_appeals lives in app/routers/appeals.py — imported
    inside the function so the module-load order doesn\'t matter and
    we avoid any future circular-import surface if appeals.py ever
    needs to import from admin.py.
    """
    from app.routers.appeals import list_appeals as _list_appeals
    return {
        "reports":   list_reports(include_acted=False, db=db, _actor=_actor),
        "appeals":   _list_appeals(include_acted=False, db=db, _actor=_actor),
        "suspended": list_suspended_users(db=db, _actor=_actor),
        "lockouts":  list_lockouts(db=db, _actor=_actor),
    }


@router.get("/lockouts")
def list_lockouts(
    db: Session = Depends(get_db),
    _actor: dict = Depends(get_current_admin),
):
    """Admin-only: list every account currently inside its lockout
    window. Used by the /admin?tab=lockouts UI to show who's locked
    out and offer per-row unlock.

    Returns rows across all three identity tracks (rep, candidate,
    citizen) so the admin sees one consolidated list. Sorted by
    locked_until ascending so the soonest-to-expire shows first.
    """
    from app.models.pages import (
        RepAccount as _Rep,
        CandidateAccount as _Cand,
        CitizenAccount as _Cit,
    )
    now = datetime.utcnow()
    items = []
    for kind, Model in (("rep", _Rep), ("candidate", _Cand), ("citizen", _Cit)):
        rows = (
            db.query(Model)
            .filter(Model.locked_until.isnot(None))
            .filter(Model.locked_until > now)
            .order_by(Model.locked_until.asc())
            .all()
        )
        for row in rows:
            items.append({
                "identity_kind": kind,
                "account_id": row.id,
                "email": row.email,
                "display_name": getattr(row, "display_name", None) or row.email,
                "locked_until": row.locked_until.isoformat() + "Z",
                "consecutive_lockout_count": int(getattr(row, "consecutive_lockout_count", 0) or 0),
            })
    items.sort(key=lambda x: x["locked_until"])
    return {"items": items}


@router.post("/lockout/unlock")
def admin_unlock_account(
    payload: _AdminUnlockRequest,
    db: Session = Depends(get_db),
    _actor: dict = Depends(get_current_admin),
):
    """Admin-only: clear lockout state on a specific account.

    Resets failed_login_count + consecutive_lockout_count to 0 and
    sets locked_until to NULL via login_attempts.reset_counters().
    Use case: a legit user got locked out and called for support
    before the lockout window expired; admin can unlock immediately.

    Audit: doesn't write a separate admin-action row today; the
    LoginAttempt history retains the lockout events for reference.
    Layered admin audit (who unlocked whom + when) is a Phase 2
    follow-up if the team grows beyond one admin.
    """
    from app.services import login_attempts as _la
    from app.models.pages import (
        RepAccount as _Rep,
        CandidateAccount as _Cand,
        CitizenAccount as _Cit,
    )
    model_for_kind = {
        "rep": _Rep,
        "candidate": _Cand,
        "citizen": _Cit,
    }[payload.identity_kind]
    account = db.get(model_for_kind, payload.account_id)
    if account is None:
        raise HTTPException(
            status_code=404,
            detail=f"{payload.identity_kind} account {payload.account_id} not found",
        )
    _la.reset_counters(account)
    db.commit()
    return {
        "ok": True,
        "identity_kind": payload.identity_kind,
        "account_id": payload.account_id,
    }
