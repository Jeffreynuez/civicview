# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Appeals router — user recourse against moderation actions.

Endpoints:

  Authed (citizen / rep):
    POST /api/appeals
        Submit an appeal for a hidden post / comment / poll / poll-comment
        the caller authored. Enforces the 30-day window, the unique
        (appellant, target) constraint, and the "you must be the author"
        check.

    GET /api/me/appeals
        Caller's own appeals — pending and resolved — for the dashboard's
        "Hidden by moderation" surface. Always includes the moderation-
        hidden content the caller authored (with current appeal status if
        any), so the surface can render the Appeal button OR the
        "Pending / Granted / Denied" pill in one round-trip.

  Unauthenticated (suspended-user appeal):
    POST /api/appeals/suspension
        Suspended user submits an appeal of their suspension. Re-verifies
        email + password (since they have no session) but does NOT issue
        a session — they stay locked out until the appeal is granted.
        Per-IP rate limit so a hostile actor can't flood the endpoint.

  Admin only (gated by services/admin_auth):
    GET  /api/admin/appeals?include_acted=true
        Queue. Pending first, then resolved if requested.
    POST /api/admin/appeals/{id}/grant
        Restores the underlying content / lifts the suspension, marks
        decision='granted', records the admin's note (optional).
    POST /api/admin/appeals/{id}/deny
        Marks decision='denied' + admin note. Target stays hidden /
        suspended.

The 30-day window is enforced server-side on POST (frontend hides
the button past 30 days, but a stale URL or curl shouldn't bypass).
The 'one appeal per (appellant, target) ever' rule is enforced by
the unique index — caught at INSERT time and converted to 409.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_optional_rep, hash_password, verify_password
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import (
    Appeal,
    CitizenAccount,
    Poll,
    PollComment,
    Post,
    PostComment,
    RepAccount,
)
from app.services.admin_auth import get_current_admin


logger = logging.getLogger(__name__)
router = APIRouter()


# Window after the moderation timestamp during which an appeal can
# be filed. After this, the surface hides the Appeal button and the
# endpoint refuses with a 400.
APPEAL_WINDOW_DAYS = 30

# Map target_kind to (model class, FK author column attr name) so
# the endpoints can resolve "is this the author" / "is this hidden"
# without four if/elif blocks.
_CONTENT_TARGETS = {
    "post":         {"cls": Post,        "author_attr": "author_id",     "appellant_kind": "rep",     "hide_attr": "deleted_at"},
    "post_comment": {"cls": PostComment, "author_attr": "citizen_id",    "appellant_kind": "citizen", "hide_attr": "deleted_at"},
    "poll":         {"cls": Poll,        "author_attr": "author_citizen_id", "appellant_kind": "citizen", "hide_attr": "archived_at"},
    "poll_comment": {"cls": PollComment, "author_attr": "citizen_id",    "appellant_kind": "citizen", "hide_attr": "deleted_at"},
}


# ── Submit (authed) ────────────────────────────────────────────────────
class AppealSubmitRequest(BaseModel):
    target_kind: Literal["post", "post_comment", "poll", "poll_comment"]
    target_id: int = Field(..., ge=1)
    rationale: str = Field(..., min_length=50, max_length=1000)


class AppealRead(BaseModel):
    id: int
    target_kind: str
    target_id: int
    appellant_kind: str
    appellant_id: int
    rationale: str
    created_at: datetime
    acted_at: Optional[datetime] = None
    decision: Optional[str] = None
    admin_note: Optional[str] = None


def _moderation_timestamp(target, kind: str) -> Optional[datetime]:
    """The timestamp the appeal-window clock runs from. For posts /
    comments it's deleted_at; for polls it's archived_at."""
    if kind == "poll":
        return target.archived_at
    return target.deleted_at


def _content_is_appealable(target, kind: str) -> bool:
    """Eligible if (a) the target is currently hidden by moderation
    (admin_hidden / auto_hidden — NOT author-deleted), AND (b) we're
    inside the 30-day window from the moderation timestamp."""
    if target is None:
        return False
    moderation_at = _moderation_timestamp(target, kind)
    if moderation_at is None:
        return False  # not hidden at all
    # Distinguish moderation hide from author delete.
    if kind == "poll":
        reason = getattr(target, "archived_reason", None)
        if reason not in {"admin_hidden", "auto_hidden"}:
            return False
    else:
        reason = getattr(target, "hide_reason", None)
        if reason not in {"admin_hidden", "auto_hidden"}:
            return False
    if datetime.utcnow() - moderation_at > timedelta(days=APPEAL_WINDOW_DAYS):
        return False
    return True


@router.post("/appeals", response_model=AppealRead, status_code=201)
def submit_appeal(
    payload: AppealSubmitRequest,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> AppealRead:
    """Submit an appeal for a hidden piece of content the caller authored.

    Validates: caller is signed in; target exists; target is hidden by
    moderation (not by the author themselves); the window is open;
    caller is the author; no prior appeal exists for this (appellant,
    target) pair.
    """
    if me_rep is None and me_citizen is None:
        raise HTTPException(status_code=401, detail="Sign in to file an appeal.")

    cfg = _CONTENT_TARGETS[payload.target_kind]
    target = db.get(cfg["cls"], payload.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Target not found.")

    if not _content_is_appealable(target, payload.target_kind):
        # Could be: not hidden, hidden but author-deleted, or past the
        # 30-day window. The server doesn't differentiate in the
        # message because the frontend shouldn't have offered the
        # button in the first place.
        raise HTTPException(
            status_code=400,
            detail="This content isn't eligible for appeal.",
        )

    expected_appellant_kind = cfg["appellant_kind"]
    expected_appellant_id = getattr(target, cfg["author_attr"])
    if expected_appellant_kind == "rep":
        if me_rep is None or me_rep.id != expected_appellant_id:
            raise HTTPException(
                status_code=403,
                detail="Only the author of this content can appeal.",
            )
        appellant_id = me_rep.id
    else:
        if me_citizen is None or me_citizen.id != expected_appellant_id:
            raise HTTPException(
                status_code=403,
                detail="Only the author of this content can appeal.",
            )
        appellant_id = me_citizen.id

    appeal = Appeal(
        target_kind=payload.target_kind,
        target_id=payload.target_id,
        appellant_kind=expected_appellant_kind,
        appellant_id=appellant_id,
        rationale=payload.rationale.strip(),
    )
    db.add(appeal)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                "You've already filed an appeal on this item. "
                "The earlier decision is final."
            ),
        )
    db.refresh(appeal)
    logger.info(
        "Appeal filed: id=%d target=%s/%d by %s/%d",
        appeal.id, appeal.target_kind, appeal.target_id,
        appeal.appellant_kind, appeal.appellant_id,
    )

    # Email admins. Fire-and-forget; SMTP latency stays out of the
    # appellant's request path. Resolves the appellant's display
    # name + email here while we have them in scope.
    if expected_appellant_kind == "rep":
        appellant_name = me_rep.display_name
        appellant_email = me_rep.email
    else:
        appellant_name = me_citizen.display_name
        appellant_email = me_citizen.email
    from app.services.notifications import notify_new_appeal
    bg_tasks.add_task(
        notify_new_appeal,
        target_kind=appeal.target_kind,
        target_id=appeal.target_id,
        appellant_name=appellant_name,
        appellant_email=appellant_email,
        rationale=appeal.rationale,
    )
    return AppealRead.model_validate(appeal, from_attributes=True)


# ── Submit (suspended-user, unauthenticated) ──────────────────────────
# Per-IP rate limit so a hostile actor can't pound the endpoint with
# bad credentials. In-memory; per-worker semantics — fine for a
# single-process Render free tier.
_SUSPENSION_APPEAL_WINDOW_SECS = 24 * 60 * 60
_SUSPENSION_APPEAL_LIMIT_PER_IP = 5
_suspension_appeal_log: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        first = fwd.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _check_suspension_appeal_rate(ip: str) -> None:
    now = time.time()
    cutoff = now - _SUSPENSION_APPEAL_WINDOW_SECS
    hits = [t for t in _suspension_appeal_log.get(ip, []) if t > cutoff]
    if len(hits) >= _SUSPENSION_APPEAL_LIMIT_PER_IP:
        raise HTTPException(
            status_code=429,
            detail=(
                "Too many appeal attempts from this connection today. "
                "Try again tomorrow or email civicview@civicview.app."
            ),
        )
    hits.append(now)
    _suspension_appeal_log[ip] = hits


class SuspensionAppealRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=1, max_length=256)
    rationale: str = Field(..., min_length=50, max_length=1000)


class SuspensionAppealResponse(BaseModel):
    ok: bool = True
    message: str


@router.post("/appeals/suspension", response_model=SuspensionAppealResponse)
def submit_suspension_appeal(
    payload: SuspensionAppealRequest,
    request: Request,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SuspensionAppealResponse:
    """Public endpoint — no session required. The caller proves identity
    by re-submitting their credentials, but no session is granted (they
    stay locked out until an admin grants the appeal).

    Looks up the account in BOTH rep_accounts and citizen_accounts,
    verifies the password against whichever matches. Returns a generic
    'thanks, we'll get back to you' message regardless of validation
    failure mode so the endpoint doesn't double as a credential / email
    enumeration oracle.
    """
    _check_suspension_appeal_rate(_client_ip(request))

    email = payload.email.strip().lower()
    rationale = payload.rationale.strip()

    # Try rep first, then citizen. Run a dummy bcrypt check on the
    # path that doesn't find a row to keep the timing flat against
    # an enumeration attack.
    rep = db.query(RepAccount).filter(RepAccount.email == email).first()
    citizen = db.query(CitizenAccount).filter(CitizenAccount.email == email).first()

    appellant_kind: Optional[str] = None
    appellant_id: Optional[int] = None
    target_kind: Optional[str] = None

    if rep is not None and rep.suspended_at is not None:
        if verify_password(payload.password, rep.password_hash):
            appellant_kind = "rep"
            appellant_id = rep.id
            target_kind = "suspension_rep"
    elif citizen is not None and citizen.suspended_at is not None:
        if verify_password(payload.password, citizen.password_hash):
            appellant_kind = "citizen"
            appellant_id = citizen.id
            target_kind = "suspension_citizen"
    else:
        # Burn a bcrypt cycle on the no-account / not-suspended path
        # to keep timing uniform.
        verify_password(payload.password, "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalid")

    # Generic response regardless of what went wrong. Tells the user
    # "we got it, we'll be in touch" so a real appellant gets a
    # confirmation, but doesn't tell an attacker which step failed.
    if appellant_kind is None:
        logger.info(
            "Suspension appeal: no eligible suspended account matched email=%r",
            email,
        )
        return SuspensionAppealResponse(
            ok=True,
            message=(
                "If your account is suspended and credentials match, "
                "your appeal is in. We'll email you with the outcome."
            ),
        )

    # 30-day window from the suspension timestamp.
    acc = rep if appellant_kind == "rep" else citizen
    if acc.suspended_at and (datetime.utcnow() - acc.suspended_at) > timedelta(days=APPEAL_WINDOW_DAYS):
        return SuspensionAppealResponse(
            ok=True,
            message=(
                "The appeal window for this suspension has closed "
                f"({APPEAL_WINDOW_DAYS} days). Email civicview@civicview.app "
                "if you'd still like to discuss it."
            ),
        )

    # target_id for a suspension appeal is the appellant's own
    # account id — there's no separate suspension row to FK against.
    appeal = Appeal(
        target_kind=target_kind,
        target_id=appellant_id,
        appellant_kind=appellant_kind,
        appellant_id=appellant_id,
        rationale=rationale,
    )
    db.add(appeal)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return SuspensionAppealResponse(
            ok=True,
            message=(
                "An appeal for this account is already on file. The "
                "earlier decision is final."
            ),
        )
    logger.info(
        "Suspension appeal filed: id=%d by %s/%d",
        appeal.id, appellant_kind, appellant_id,
    )

    # Email admins. acc is the resolved RepAccount or CitizenAccount.
    from app.services.notifications import notify_new_appeal
    bg_tasks.add_task(
        notify_new_appeal,
        target_kind=appeal.target_kind,
        target_id=appeal.target_id,
        appellant_name=acc.display_name,
        appellant_email=acc.email,
        rationale=appeal.rationale,
    )
    return SuspensionAppealResponse(
        ok=True,
        message="Your appeal is in. We'll email you with the outcome.",
    )


# ── Caller's own appeals ──────────────────────────────────────────────
class MyAppealsResponse(BaseModel):
    items: List[AppealRead]


# ── Caller's hidden content (drives the dashboard surface) ───────────
class HiddenContentRow(BaseModel):
    """One piece of moderation-hidden content the caller authored.
    Sized for the dashboard surface — preview + when it was hidden +
    current appeal status (so the UI knows whether to show the
    Appeal button, 'Pending', 'Granted ✓', or 'Denied'). The
    backend bakes appeal_status in so the frontend doesn't have to
    cross-reference /me/appeals row-by-row.
    """
    target_kind: Literal["post", "post_comment", "poll", "poll_comment"]
    target_id: int
    preview: str
    hidden_at: datetime
    hide_reason: str  # 'admin_hidden' | 'auto_hidden'
    # Appeal lifecycle for this specific row. NULL if no appeal
    # exists yet AND we're inside the 30-day window. NULL with
    # appealable=False means the window has closed.
    appeal_status: Optional[Literal["pending", "granted", "denied"]] = None
    appeal_admin_note: Optional[str] = None
    appealable: bool   # is the Appeal button surfaceable right now?


class HiddenContentResponse(BaseModel):
    items: List[HiddenContentRow]


def _appeal_status_for(
    appeals_index: dict, kind: str, target_id: int,
) -> tuple[Optional[str], Optional[str]]:
    """Look up an existing appeal for (kind, target_id) in the
    pre-built index. Returns (status, admin_note) or (None, None)."""
    appeal = appeals_index.get((kind, target_id))
    if appeal is None:
        return (None, None)
    if appeal.acted_at is None:
        return ("pending", None)
    return (appeal.decision, appeal.admin_note)


@router.get("/me/hidden-content", response_model=HiddenContentResponse)
def list_my_hidden_content(
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> HiddenContentResponse:
    """List every piece of moderation-hidden content the caller
    authored, with the current appeal status per row.

    Filters:
      • hide_reason / archived_reason IS NOT NULL — author-deletes
        don't surface here.
      • Within the 30-day window — older items are excluded since
        they can no longer be appealed (frontend shouldn't show
        them as actionable). If we ever want a "history" view of
        old hides, that's a separate endpoint.

    Pre-fetches the caller's appeals once so the per-row appeal-
    status lookup is O(1) instead of a SELECT-per-row.
    """
    if me_rep is None and me_citizen is None:
        raise HTTPException(status_code=401, detail="Sign in.")

    cutoff = datetime.utcnow() - timedelta(days=APPEAL_WINDOW_DAYS)
    appellant_kind = "rep" if me_rep is not None else "citizen"
    appellant_id = me_rep.id if me_rep is not None else me_citizen.id

    # Build the (target_kind, target_id) -> Appeal index once.
    appeals = (
        db.query(Appeal)
        .filter(
            Appeal.appellant_kind == appellant_kind,
            Appeal.appellant_id == appellant_id,
        )
        .all()
    )
    appeals_index = {(a.target_kind, a.target_id): a for a in appeals}

    out: List[HiddenContentRow] = []

    if me_rep is not None:
        # Rep's own hidden posts.
        posts = (
            db.query(Post)
            .filter(
                Post.author_id == me_rep.id,
                Post.deleted_at.is_not(None),
                Post.hide_reason.is_not(None),
                Post.deleted_at >= cutoff,
            )
            .order_by(Post.deleted_at.desc())
            .all()
        )
        for p in posts:
            status, note = _appeal_status_for(appeals_index, "post", p.id)
            preview = (p.body or "")[:200]
            out.append(HiddenContentRow(
                target_kind="post", target_id=p.id, preview=preview,
                hidden_at=p.deleted_at, hide_reason=p.hide_reason,
                appeal_status=status, appeal_admin_note=note,
                appealable=(status is None),
            ))
    else:
        # Citizen's hidden post-comments + polls + poll-comments.
        comments = (
            db.query(PostComment)
            .filter(
                PostComment.citizen_id == me_citizen.id,
                PostComment.deleted_at.is_not(None),
                PostComment.hide_reason.is_not(None),
                PostComment.deleted_at >= cutoff,
            )
            .order_by(PostComment.deleted_at.desc())
            .all()
        )
        for c in comments:
            status, note = _appeal_status_for(appeals_index, "post_comment", c.id)
            out.append(HiddenContentRow(
                target_kind="post_comment", target_id=c.id, preview=(c.body or "")[:200],
                hidden_at=c.deleted_at, hide_reason=c.hide_reason,
                appeal_status=status, appeal_admin_note=note,
                appealable=(status is None),
            ))
        polls = (
            db.query(Poll)
            .filter(
                Poll.author_kind == "citizen",
                Poll.author_citizen_id == me_citizen.id,
                Poll.archived_at.is_not(None),
                Poll.archived_reason.in_(("admin_hidden", "auto_hidden")),
                Poll.archived_at >= cutoff,
            )
            .order_by(Poll.archived_at.desc())
            .all()
        )
        for p in polls:
            status, note = _appeal_status_for(appeals_index, "poll", p.id)
            out.append(HiddenContentRow(
                target_kind="poll", target_id=p.id, preview=(p.question or "")[:200],
                hidden_at=p.archived_at, hide_reason=p.archived_reason,
                appeal_status=status, appeal_admin_note=note,
                appealable=(status is None),
            ))
        poll_comments = (
            db.query(PollComment)
            .filter(
                PollComment.citizen_id == me_citizen.id,
                PollComment.deleted_at.is_not(None),
                PollComment.hide_reason.is_not(None),
                PollComment.deleted_at >= cutoff,
            )
            .order_by(PollComment.deleted_at.desc())
            .all()
        )
        for pc in poll_comments:
            status, note = _appeal_status_for(appeals_index, "poll_comment", pc.id)
            out.append(HiddenContentRow(
                target_kind="poll_comment", target_id=pc.id, preview=(pc.body or "")[:200],
                hidden_at=pc.deleted_at, hide_reason=pc.hide_reason,
                appeal_status=status, appeal_admin_note=note,
                appealable=(status is None),
            ))

    out.sort(key=lambda r: r.hidden_at, reverse=True)
    return HiddenContentResponse(items=out)


@router.get("/me/appeals", response_model=MyAppealsResponse)
def list_my_appeals(
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
) -> MyAppealsResponse:
    """Return every appeal this caller has filed, newest first.
    Powers the dashboard's 'Hidden by moderation' badge state — the
    UI checks each row against this list to know whether to show
    the Appeal button or 'Pending / Granted ✓ / Denied' instead."""
    if me_rep is not None:
        rows = (
            db.query(Appeal)
            .filter(
                Appeal.appellant_kind == "rep",
                Appeal.appellant_id == me_rep.id,
            )
            .order_by(Appeal.created_at.desc())
            .all()
        )
    elif me_citizen is not None:
        rows = (
            db.query(Appeal)
            .filter(
                Appeal.appellant_kind == "citizen",
                Appeal.appellant_id == me_citizen.id,
            )
            .order_by(Appeal.created_at.desc())
            .all()
        )
    else:
        raise HTTPException(status_code=401, detail="Sign in.")
    return MyAppealsResponse(
        items=[AppealRead.model_validate(r, from_attributes=True) for r in rows],
    )


# ── Admin queue + actions ─────────────────────────────────────────────
class AdminAppealRow(BaseModel):
    """Same shape as AppealRead with extra context for the queue —
    target preview, appellant display name, and the original
    moderation timestamp so admin can see how stale the appeal is."""
    id: int
    target_kind: str
    target_id: int
    target_preview: str
    target_hidden_at: Optional[datetime] = None
    appellant_kind: str
    appellant_id: int
    appellant_name: str
    appellant_email: str
    rationale: str
    created_at: datetime
    acted_at: Optional[datetime] = None
    decision: Optional[str] = None
    admin_note: Optional[str] = None


class AdminAppealListResponse(BaseModel):
    items: List[AdminAppealRow]


def _appellant_label(db: Session, kind: str, account_id: int) -> tuple[str, str]:
    """Resolve an appellant to (display_name, email) for the queue.
    Handles SET-NULL-ish cases (deleted account) by returning sentinel
    strings rather than failing the row."""
    if kind == "rep":
        rep = db.get(RepAccount, account_id)
        return (rep.display_name if rep else "(deleted rep)", rep.email if rep else "")
    cz = db.get(CitizenAccount, account_id)
    return (cz.display_name if cz else "(deleted citizen)", cz.email if cz else "")


def _target_preview_for_appeal(db: Session, appeal: Appeal) -> tuple[str, Optional[datetime]]:
    """Return (preview, moderation_timestamp) for an appeal row. The
    preview is the first ~200 chars of the body / question, or a
    descriptive fallback for suspension appeals."""
    PREVIEW = 200
    if appeal.target_kind in ("suspension_rep", "suspension_citizen"):
        # The "target" is the account itself; no body to preview.
        # Show the account's email + suspended-at instead.
        if appeal.target_kind == "suspension_rep":
            acc = db.get(RepAccount, appeal.target_id)
        else:
            acc = db.get(CitizenAccount, appeal.target_id)
        if acc is None:
            return ("(account deleted)", None)
        reason = (acc.suspended_reason or "(no reason recorded)")
        return (f"Suspended: {reason}", acc.suspended_at)

    cfg = _CONTENT_TARGETS.get(appeal.target_kind)
    if not cfg:
        return ("(unknown target type)", None)
    target = db.get(cfg["cls"], appeal.target_id)
    if target is None:
        return ("(content deleted)", None)
    body = getattr(target, "body", None) or getattr(target, "question", None) or ""
    snippet = " ".join(body.split())
    if len(snippet) > PREVIEW:
        snippet = snippet[: PREVIEW - 1] + "…"
    moderation_at = _moderation_timestamp(target, appeal.target_kind)
    return (snippet, moderation_at)


@router.get("/admin/appeals", response_model=AdminAppealListResponse)
def list_appeals(
    include_acted: bool = False,
    db: Session = Depends(get_db),
    _actor: dict = Depends(get_current_admin),
) -> AdminAppealListResponse:
    """Admin queue. Pending first by default; pass include_acted=true
    to see resolved appeals too (audit view)."""
    q = db.query(Appeal)
    if not include_acted:
        q = q.filter(Appeal.acted_at.is_(None))
    rows = q.order_by(Appeal.created_at.desc()).limit(200).all()
    out: List[AdminAppealRow] = []
    for r in rows:
        name, email = _appellant_label(db, r.appellant_kind, r.appellant_id)
        preview, hidden_at = _target_preview_for_appeal(db, r)
        out.append(AdminAppealRow(
            id=r.id,
            target_kind=r.target_kind,
            target_id=r.target_id,
            target_preview=preview,
            target_hidden_at=hidden_at,
            appellant_kind=r.appellant_kind,
            appellant_id=r.appellant_id,
            appellant_name=name,
            appellant_email=email,
            rationale=r.rationale,
            created_at=r.created_at,
            acted_at=r.acted_at,
            decision=r.decision,
            admin_note=r.admin_note,
        ))
    return AdminAppealListResponse(items=out)


class AdminAppealDecisionPayload(BaseModel):
    admin_note: Optional[str] = Field(default=None, max_length=1000)


class AdminAppealDecisionResult(BaseModel):
    ok: bool = True
    decision: str
    target_restored: bool


def _restore_appeal_target(db: Session, appeal: Appeal) -> bool:
    """When an appeal is GRANTED, restore the underlying content or
    lift the suspension. Returns True if something was actually
    changed (i.e. the row was hidden / suspended at the time)."""
    if appeal.target_kind == "suspension_rep":
        rep = db.get(RepAccount, appeal.target_id)
        if rep is None or rep.suspended_at is None:
            return False
        rep.suspended_at = None
        rep.suspended_reason = None
        return True
    if appeal.target_kind == "suspension_citizen":
        cz = db.get(CitizenAccount, appeal.target_id)
        if cz is None or cz.suspended_at is None:
            return False
        cz.suspended_at = None
        cz.suspended_reason = None
        return True

    cfg = _CONTENT_TARGETS.get(appeal.target_kind)
    if not cfg:
        return False
    target = db.get(cfg["cls"], appeal.target_id)
    if target is None:
        return False
    if appeal.target_kind == "poll":
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


def _decide_appeal(
    db: Session,
    appeal_id: int,
    decision: str,
    admin_note: Optional[str],
    actor: dict,
    bg_tasks: BackgroundTasks,
) -> AdminAppealDecisionResult:
    """Shared core for grant + deny. Sets acted_at, decision, admin_email,
    admin_note. Grant additionally tries to restore the target."""
    appeal = db.get(Appeal, appeal_id)
    if appeal is None:
        raise HTTPException(status_code=404, detail="Appeal not found.")
    if appeal.acted_at is not None:
        raise HTTPException(
            status_code=400,
            detail=f"Appeal already {appeal.decision} on {appeal.acted_at.isoformat()}.",
        )

    restored = False
    if decision == "granted":
        restored = _restore_appeal_target(db, appeal)

    appeal.acted_at = datetime.utcnow()
    appeal.decision = decision
    appeal.admin_email = actor["email"]
    if admin_note:
        appeal.admin_note = admin_note.strip()[:1000]
    db.commit()
    logger.warning(
        "Admin %s %s appeal id=%d (target_restored=%s).",
        actor["email"], decision, appeal_id, restored,
    )

    # Email the appellant. Resolve their account email — the appeal
    # row carries the FK loosely (no joined relationship), so we
    # look up by appellant_kind + appellant_id.
    if appeal.appellant_kind == "rep":
        appellant = db.get(RepAccount, appeal.appellant_id)
    else:
        appellant = db.get(CitizenAccount, appeal.appellant_id)
    if appellant is not None and appellant.email:
        from app.services.notifications import notify_appeal_decision
        bg_tasks.add_task(
            notify_appeal_decision,
            appellant_email=appellant.email,
            appellant_name=appellant.display_name,
            target_kind=appeal.target_kind,
            decision=decision,
            admin_note=appeal.admin_note,
        )

    return AdminAppealDecisionResult(
        ok=True, decision=decision, target_restored=restored,
    )


@router.post(
    "/admin/appeals/{appeal_id}/grant",
    response_model=AdminAppealDecisionResult,
)
def grant_appeal(
    appeal_id: int,
    payload: AdminAppealDecisionPayload,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
) -> AdminAppealDecisionResult:
    return _decide_appeal(db, appeal_id, "granted", payload.admin_note, actor, bg_tasks)


@router.post(
    "/admin/appeals/{appeal_id}/deny",
    response_model=AdminAppealDecisionResult,
)
def deny_appeal(
    appeal_id: int,
    payload: AdminAppealDecisionPayload,
    bg_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    actor: dict = Depends(get_current_admin),
) -> AdminAppealDecisionResult:
    return _decide_appeal(db, appeal_id, "denied", payload.admin_note, actor, bg_tasks)
