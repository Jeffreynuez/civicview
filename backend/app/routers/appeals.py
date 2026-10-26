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

2026-10-26 (admin audit M10):
  * Any author can appeal: candidate posts and comments written as a
    rep or a candidate used to fail the author check, which read one
    column per kind. services/moderation.content_author reads them all.
  * Candidates sign in to appeal like reps and citizens, and the
    caller's own lists take ?as=citizen|rep|candidate so a browser
    signed in as two identities shows each dashboard its own items.
  * One appeal per SUSPENSION, not per account for life. See
    suspension_appeal_key().
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_optional_rep, verify_password
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import (
    AdminAction,
    Appeal,
    CandidateAccount,
    CitizenAccount,
    Poll,
    PollComment,
    Post,
    PostComment,
    RepAccount,
)
from app.services.admin_auth import get_current_admin
from app.services.log_redaction import mask_email
from app.services.moderation import APPEALABLE_HIDE_REASONS, CONTENT_AUTHOR_COLUMNS, content_author


logger = logging.getLogger(__name__)
router = APIRouter()


# Window after the moderation timestamp during which an appeal can
# be filed. After this, the surface hides the Appeal button and the
# endpoint refuses with a 400.
APPEAL_WINDOW_DAYS = 30

# Account model per appellant kind. Candidates were added on
# 2026-10-26: a suspended candidate had no way to appeal.
_ACCOUNT_MODELS = {"rep": RepAccount, "citizen": CitizenAccount, "candidate": CandidateAccount}
_SUSPENSION_KINDS = {"suspension_rep": "rep", "suspension_citizen": "citizen", "suspension_candidate": "candidate"}

# Map target_kind to its model and hide column. Who wrote it comes
# from services/moderation.content_author, which reads every author
# column (citizen, rep or candidate) for the kind.
_CONTENT_TARGETS = {
    "post":         {"cls": Post,        "hide_attr": "deleted_at"},
    "post_comment": {"cls": PostComment, "hide_attr": "deleted_at"},
    "poll":         {"cls": Poll,        "hide_attr": "archived_at"},
    "poll_comment": {"cls": PollComment, "hide_attr": "deleted_at"},
}

AccountKind = Literal["citizen", "rep", "candidate"]


def _pick_identity(as_kind: Optional[str], *, citizen, rep, candidate):
    """(kind, account) whose own items a caller asked for.

    `?as=` names the identity among the sessions the request carries:
    the citizen dashboard passes citizen, a rep's or candidate's page
    dashboard passes rep or candidate. Without it: rep, then candidate,
    then citizen, as before. 401 if that session isn't there."""
    sessions = {"citizen": citizen, "rep": rep, "candidate": candidate}
    if as_kind is not None:
        acc = sessions.get(as_kind)
        if acc is None:
            raise HTTPException(status_code=401, detail=f"Not signed in as a {as_kind} account on this device.")
        return as_kind, acc
    for kind in ("rep", "candidate", "citizen"):
        if sessions[kind] is not None:
            return kind, sessions[kind]
    raise HTTPException(status_code=401, detail="Sign in.")


def suspension_appeal_key(db: Session, kind: str, acc) -> int:
    """The target_id a suspension appeal is filed under, one per
    suspension (2026-10-26).

    Appeals are unique per (appellant, target), and suspension appeals
    used the account id as the target, so an account could appeal one
    suspension in its whole life: a second suspension could never be
    appealed. Now the key is minus the id of the admin History row that
    started the current suspension (the first user_suspend at or after
    suspended_at that wasn't a reason update on an existing one). A
    suspension from before the History existed has no such row and
    keeps the old key, the account id, so its appeal still counts.
    Negative keys can never collide with account ids. Changing the key
    needs no change to the table or its unique index."""
    if acc is None or acc.suspended_at is None:
        return getattr(acc, "id", 0)
    row = (
        db.query(AdminAction.id)
        .filter(
            AdminAction.action == "user_suspend",
            AdminAction.target_kind == kind,
            AdminAction.target_id == str(acc.id),
            AdminAction.at >= acc.suspended_at,
            or_(AdminAction.details_json.is_(None), ~AdminAction.details_json.contains("already_suspended")),
        )
        .order_by(AdminAction.at.asc(), AdminAction.id.asc())
        .first()
    )
    return -row.id if row is not None else acc.id


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
    else:
        reason = getattr(target, "hide_reason", None)
    if reason not in APPEALABLE_HIDE_REASONS:
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
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
) -> AppealRead:
    """Submit an appeal for a hidden piece of content the caller authored.

    Validates: caller is signed in; target exists; target is hidden by
    moderation (not by the author themselves); the window is open;
    caller is the author, as whichever identity wrote it (citizen, rep
    or candidate); no prior appeal exists for this (appellant, target)
    pair.
    """
    if me_rep is None and me_citizen is None and me_candidate is None:
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

    author = content_author(target, payload.target_kind)
    sessions = {"citizen": me_citizen, "rep": me_rep, "candidate": me_candidate}
    me = sessions.get(author[0]) if author else None
    if author is None or me is None or me.id != author[1]:
        raise HTTPException(
            status_code=403,
            detail="Only the author of this content can appeal.",
        )
    expected_appellant_kind, appellant_id = author

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
    appellant_name = me.display_name
    appellant_email = me.email
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
    from app.services.client_ip import client_ip
    return client_ip(request)


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
    candidate = db.query(CandidateAccount).filter(CandidateAccount.email == email).first()

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
    elif candidate is not None and candidate.suspended_at is not None:
        if verify_password(payload.password, candidate.password_hash):
            appellant_kind = "candidate"
            appellant_id = candidate.id
            target_kind = "suspension_candidate"
    else:
        # Burn a bcrypt cycle on the no-account / not-suspended path
        # to keep timing uniform.
        verify_password(payload.password, "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalid")

    # Generic response regardless of what went wrong. Tells the user
    # "we got it, we'll be in touch" so a real appellant gets a
    # confirmation, but doesn't tell an attacker which step failed.
    if appellant_kind is None:
        logger.info(
            "Suspension appeal: no eligible suspended account matched email=%s",
            mask_email(email),
        )
        return SuspensionAppealResponse(
            ok=True,
            message=(
                "If your account is suspended and credentials match, "
                "your appeal is in. We'll email you with the outcome."
            ),
        )

    # 30-day window from the suspension timestamp.
    acc = {"rep": rep, "citizen": citizen, "candidate": candidate}[appellant_kind]
    if acc.suspended_at and (datetime.utcnow() - acc.suspended_at) > timedelta(days=APPEAL_WINDOW_DAYS):
        return SuspensionAppealResponse(
            ok=True,
            message=(
                "The appeal window for this suspension has closed "
                f"({APPEAL_WINDOW_DAYS} days). Email civicview@civicview.app "
                "if you'd still like to discuss it."
            ),
        )

    # One appeal per suspension (2026-10-26): the target is this
    # suspension, not the account. See suspension_appeal_key().
    appeal = Appeal(
        target_kind=target_kind,
        target_id=suspension_appeal_key(db, appellant_kind, acc),
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
                "An appeal for this suspension is already on file. The "
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
    hide_reason: str  # 'admin_hidden' | 'auto_hidden' | 'threat_hidden'
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
    as_kind: Optional[AccountKind] = Query(default=None, alias="as"),
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
) -> HiddenContentResponse:
    """List every piece of moderation-hidden content one identity
    authored, with the current appeal status per row.

    `?as=citizen|rep|candidate` picks the identity (see _pick_identity).
    Every author column counts (2026-10-26): a rep's posts and the
    comments they wrote as the rep, a candidate's posts and comments,
    a citizen's comments, polls and poll comments. Before, a rep saw
    only posts, a candidate had no list at all, and a citizen who was
    also signed in as a rep saw the rep's items on their own dashboard.

    Filters:
      • A moderation hide reason (admin, auto or threat), not an
        author delete. Only admin and auto hides can be appealed.
      • Within the 30-day window — older items are excluded since
        they can no longer be appealed.

    Pre-fetches the caller's appeals once so the per-row appeal-
    status lookup is O(1) instead of a SELECT-per-row.
    """
    from app.services.citizen_polls_service import HIDDEN_ARCHIVE_REASONS
    from app.services.moderation import MODERATION_HIDE_REASONS

    appellant_kind, me = _pick_identity(as_kind, citizen=me_citizen, rep=me_rep, candidate=me_candidate)
    cutoff = datetime.utcnow() - timedelta(days=APPEAL_WINDOW_DAYS)

    appeals = (
        db.query(Appeal)
        .filter(Appeal.appellant_kind == appellant_kind, Appeal.appellant_id == me.id)
        .all()
    )
    appeals_index = {(a.target_kind, a.target_id): a for a in appeals}

    out: List[HiddenContentRow] = []
    for kind, columns in CONTENT_AUTHOR_COLUMNS.items():
        attr = next((a for a, k in columns if k == appellant_kind), None)
        if attr is None:
            continue
        cls = _CONTENT_TARGETS[kind]["cls"]
        q = db.query(cls).filter(getattr(cls, attr) == me.id)
        if kind == "poll":
            q = q.filter(
                cls.archived_at.is_not(None),
                cls.archived_reason.in_(tuple(HIDDEN_ARCHIVE_REASONS)),
                cls.archived_at >= cutoff,
            )
        else:
            q = q.filter(
                cls.deleted_at.is_not(None),
                cls.hide_reason.in_(tuple(MODERATION_HIDE_REASONS)),
                cls.deleted_at >= cutoff,
            )
        for row in q.all():
            reason = row.archived_reason if kind == "poll" else row.hide_reason
            if reason == "reported":
                reason = "auto_hidden"  # the pre-2026 spelling
            status, note = _appeal_status_for(appeals_index, kind, row.id)
            body = (row.question if kind == "poll" else row.body) or ""
            out.append(HiddenContentRow(
                target_kind=kind, target_id=row.id, preview=body[:200],
                hidden_at=_moderation_timestamp(row, kind), hide_reason=reason,
                appeal_status=status, appeal_admin_note=note,
                appealable=(status is None and _content_is_appealable(row, kind)),
            ))

    out.sort(key=lambda r: r.hidden_at, reverse=True)
    return HiddenContentResponse(items=out)


@router.get("/me/appeals", response_model=MyAppealsResponse)
def list_my_appeals(
    as_kind: Optional[AccountKind] = Query(default=None, alias="as"),
    db: Session = Depends(get_db),
    me_rep: Optional[RepAccount] = Depends(get_optional_rep),
    me_citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    me_candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
) -> MyAppealsResponse:
    """Return every appeal one identity has filed, newest first.
    `?as=` picks the identity, as for /me/hidden-content."""
    kind, me = _pick_identity(as_kind, citizen=me_citizen, rep=me_rep, candidate=me_candidate)
    rows = (
        db.query(Appeal)
        .filter(Appeal.appellant_kind == kind, Appeal.appellant_id == me.id)
        .order_by(Appeal.created_at.desc())
        .all()
    )
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
    # Who decided it (2026-10-26). Stored since appeals shipped, never
    # sent to the page until now.
    admin_email: Optional[str] = None


class AdminAppealListResponse(BaseModel):
    items: List[AdminAppealRow]
    # Whole-queue numbers for the tiles, whatever include_acted says
    # (2026-10-26): pending, granted_week, denied_week.
    counts: dict = {}


def _appellant_label(db: Session, kind: str, account_id: int) -> tuple[str, str]:
    """Resolve an appellant to (display_name, email) for the queue.
    Handles SET-NULL-ish cases (deleted account) by returning sentinel
    strings rather than failing the row."""
    model = _ACCOUNT_MODELS.get(kind, CitizenAccount)
    acc = db.get(model, account_id)
    if acc is None:
        return (f"(deleted {kind})", "")
    return (acc.display_name, acc.email or "")


def _target_preview_for_appeal(db: Session, appeal: Appeal) -> tuple[str, Optional[datetime]]:
    """Return (preview, moderation_timestamp) for an appeal row. The
    preview is the first ~200 chars of the body / question, or a
    descriptive fallback for suspension appeals."""
    PREVIEW = 200
    if appeal.target_kind in _SUSPENSION_KINDS:
        # No body to preview: show the suspension's reason and time.
        # The account is the appellant. A negative target_id names the
        # admin History row that started the suspension appealed
        # (2026-10-26), which keeps its own reason after the account's
        # is cleared or replaced by a later suspension.
        if appeal.target_id < 0:
            started = db.get(AdminAction, -appeal.target_id)
            if started is not None:
                return (f"Suspended: {started.reason or '(no reason recorded)'}", started.at)
        acc = db.get(_ACCOUNT_MODELS[_SUSPENSION_KINDS[appeal.target_kind]], appeal.appellant_id)
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
            admin_email=r.admin_email,
        ))
    from datetime import timedelta
    week_ago = datetime.utcnow() - timedelta(days=7)
    counts = {
        "pending": db.query(Appeal).filter(Appeal.acted_at.is_(None)).count(),
        "granted_week": db.query(Appeal).filter(Appeal.decision == "granted", Appeal.acted_at >= week_ago).count(),
        "denied_week": db.query(Appeal).filter(Appeal.decision == "denied", Appeal.acted_at >= week_ago).count(),
    }
    return AdminAppealListResponse(items=out, counts=counts)


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
    if appeal.target_kind in _SUSPENSION_KINDS:
        kind = _SUSPENSION_KINDS[appeal.target_kind]
        acc = db.get(_ACCOUNT_MODELS[kind], appeal.appellant_id)
        if acc is None or acc.suspended_at is None:
            return False
        # Only the suspension this appeal is about. If that one was
        # lifted and the account suspended again since, granting the
        # old appeal must not lift the new suspension.
        if suspension_appeal_key(db, kind, acc) != appeal.target_id:
            return False
        acc.suspended_at = None
        acc.suspended_reason = None
        return True

    cfg = _CONTENT_TARGETS.get(appeal.target_kind)
    if not cfg:
        return False
    target = db.get(cfg["cls"], appeal.target_id)
    if target is None:
        return False
    if appeal.target_kind == "poll":
        from app.services.citizen_polls_service import poll_is_publicly_visible, restore_poll_after_takedown
        if poll_is_publicly_visible(target):
            return False
        # A pre-claim poll goes back to closed-and-public, not open.
        restore_poll_after_takedown(db, target)
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
    admin_note. Grant additionally tries to restore the target. A denial
    needs a note (the appellant reads it); both are saved to the admin
    History."""
    from app.services import admin_actions

    if decision == "denied":
        admin_note = admin_actions.require_reason(admin_note, "denial")
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
        if appeal.target_kind in _CONTENT_TARGETS:
            # Granting is a decision about this content: close its open
            # reports so they stop counting toward auto-hide and the
            # next single report doesn't hide it again.
            from app.services.moderation import resolve_open_reports
            resolve_open_reports(db, kind=appeal.target_kind, target_id=appeal.target_id)

    appeal.acted_at = datetime.utcnow()
    appeal.decision = decision
    appeal.admin_email = actor["email"]
    if admin_note:
        appeal.admin_note = admin_note.strip()[:1000]
    appellant_name, _email = _appellant_label(db, appeal.appellant_kind, appeal.appellant_id)
    admin_actions.record(
        db, actor, "appeal_grant" if decision == "granted" else "appeal_deny",
        target_kind=appeal.target_kind,
        # A suspension appeal is about the account (its target_id is a
        # suspension key, see suspension_appeal_key).
        target_id=appeal.appellant_id if appeal.target_kind in _SUSPENSION_KINDS else appeal.target_id,
        target_label=appellant_name, reason=appeal.admin_note,
        details={"appeal_id": appeal.id, "restored": restored},
    )
    db.commit()
    logger.warning(
        "Admin %s %s appeal id=%d (target_restored=%s).",
        mask_email(actor["email"]), decision, appeal_id, restored,
    )

    # Email the appellant. Resolve their account email — the appeal
    # row carries the FK loosely (no joined relationship), so we
    # look up by appellant_kind + appellant_id.
    appellant = db.get(_ACCOUNT_MODELS.get(appeal.appellant_kind, CitizenAccount), appeal.appellant_id)
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
