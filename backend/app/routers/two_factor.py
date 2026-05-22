# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Two-factor authentication (TOTP) router — Task #62 Phase 1.

Endpoints under /api/2fa/* let an authenticated user enroll in TOTP,
verify enrollment, regenerate recovery codes, and disable 2FA. The
endpoints work uniformly across all three account types (citizen / rep
/ candidate) — the caller's identity is resolved from whichever
session cookie is present.

What this phase does:
  • Adds the enrollment + verification + disable + regenerate flow
    against the new TOTP columns on the account models.
  • Does NOT yet enforce 2FA at login (that's Phase 3). After running
    these endpoints, an account with totp_enabled_at set still logs
    in via plain password — the login flow doesn't check 2FA yet.
    This is intentional so we can land the schema + endpoints without
    breaking existing logins during the rollout.

What this phase does NOT do:
  • Force 2FA at first login for any account type (Phase 4).
  • Add a "2FA required" challenge step to existing auth flows
    (Phase 3).
  • Send any notification emails (could be Phase 5 if desired).

Security notes:
  • The TOTP secret is generated server-side and returned to the
    client ONCE during enroll/start. The client must immediately
    show it to the user (QR code + base32 fallback). If the user
    closes the page before calling enroll/verify, the secret is
    discarded — we never persist a TOTP secret until the user
    successfully verifies their first 6-digit code.
  • The first verify call doubles as proof-of-knowledge of the
    secret + activation. We only set totp_secret_encrypted +
    totp_enabled_at on a successful verify.
  • The disable endpoint requires a current TOTP code (or a recovery
    code) to prevent a stolen session cookie from being used to
    silently disable 2FA — a defense-in-depth check that's standard
    for the disable flow.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.auth import get_optional_rep
from app.auth_candidate import get_optional_candidate
from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import CandidateAccount, CitizenAccount, RepAccount
from app.services import recovery_codes_service, totp_service
from app.services.admin_auth import get_current_admin

logger = logging.getLogger(__name__)
router = APIRouter()


AccountKind = Literal["citizen", "rep", "candidate"]
AccountRow = CitizenAccount | RepAccount | CandidateAccount


# ─────────────────────────────────────────────────────────────────────
# Identity resolution — figure out which of the three sessions the
# caller is using. Mirrors the _resolve_engager pattern in
# routers/pages.py but simpler since 2FA enrollment doesn't allow
# cross-identity actions: a user can only enroll the account they're
# actively signed in to.
# ─────────────────────────────────────────────────────────────────────
def resolve_caller(
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    rep: Optional[RepAccount] = Depends(get_optional_rep),
    candidate: Optional[CandidateAccount] = Depends(get_optional_candidate),
) -> Tuple[AccountKind, AccountRow]:
    """Pick the active account for 2FA operations.

    Priority order matches what an authenticated user would intuitively
    expect: if they have multiple sessions, the most-privileged one
    drives the 2FA flow. Rep > candidate > citizen — same as the
    multi-identity engagement picker default in pages.py.

    Raises 401 if none of the three sessions is active."""
    if rep is not None:
        return "rep", rep
    if candidate is not None:
        return "candidate", candidate
    if citizen is not None:
        return "citizen", citizen
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not signed in. 2FA endpoints require an active session.",
    )


def _account_label(kind: AccountKind, account: AccountRow) -> str:
    """Build the human-readable label shown inside the authenticator
    app. The app displays this alongside the 6-digit code so the user
    can tell their three CivicView identities apart. Format chosen for
    width — authenticator apps usually show ~30 chars before truncating."""
    role_tag = {"citizen": "Citizen", "rep": "Rep", "candidate": "Candidate"}[kind]
    email = getattr(account, "email", "") or "?"
    return f"{email} ({role_tag})"


# ─────────────────────────────────────────────────────────────────────
# Request / response schemas
# ─────────────────────────────────────────────────────────────────────
class EnrollStartResponse(BaseModel):
    """Returned from POST /enroll/start. The client MUST immediately
    show the secret (QR code or text) to the user — once they navigate
    away, this is gone forever; subsequent calls produce a different
    secret. The pending_token is the bearer the client passes back to
    /enroll/verify to prove they're enrolling the secret we just
    handed out (not some other secret)."""
    model_config = ConfigDict(from_attributes=False)
    secret: str = Field(..., description="Base32 TOTP secret — show to user once.")
    provisioning_uri: str = Field(..., description="otpauth:// URI for QR code generation client-side.")
    pending_token: str = Field(..., description="Pass back to /enroll/verify with the first 6-digit code.")
    issuer: str = Field("CivicView", description="Authenticator-app issuer name.")
    label: str = Field(..., description="Authenticator-app entry label.")


class EnrollVerifyRequest(BaseModel):
    model_config = ConfigDict(from_attributes=False)
    pending_token: str
    code: str = Field(..., description="6-digit code from authenticator app.")


class EnrollVerifyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=False)
    enabled: bool
    recovery_codes: List[str] = Field(
        ...,
        description="10 single-use recovery codes — show to user ONCE; not recoverable later.",
    )


class VerifyRequest(BaseModel):
    """Verify a TOTP or recovery code on a 2FA-enrolled account. Used
    for the 'reauthenticate before sensitive action' flow (e.g. before
    disable, before regenerating recovery codes). Phase 3 will reuse
    this shape for the login challenge step."""
    model_config = ConfigDict(from_attributes=False)
    code: str = Field(..., description="6-digit TOTP code OR a recovery code.")


class StatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=False)
    enabled: bool
    enabled_at: Optional[datetime] = None
    recovery_codes_remaining: int = 0


class RecoveryCodesResponse(BaseModel):
    model_config = ConfigDict(from_attributes=False)
    recovery_codes: List[str]


# ─────────────────────────────────────────────────────────────────────
# Pending-enrollment token store. A POST /enroll/start hands back a
# bearer token tied to a freshly-generated TOTP secret. The token is
# valid for ~10 minutes and lives in memory only — restarting the
# backend invalidates all pending enrollments, which is fine because
# the user would just restart the enroll flow anyway.
#
# Using a dict + lock here rather than the DB because (a) these are
# ephemeral, (b) volume is low (one entry per enrollment-in-flight),
# (c) avoiding a DB write keeps the "show secret only if user
# completes verify" guarantee airtight.
# ─────────────────────────────────────────────────────────────────────
import secrets as _secrets
import threading
import time as _time

_PENDING_TTL = 10 * 60  # seconds — 10 minutes to scan QR + enter code
_pending_lock = threading.Lock()
_pending: dict[str, dict] = {}  # token → {secret, account_kind, account_id, created_at}

# Login-challenge token store. The three auth routers' login endpoints
# call _challenge_put when password verification succeeds AND the
# account has totp_enabled_at set; that hands back a short-lived
# bearer token the client passes to /api/2fa/login-challenge with
# the user's 6-digit code. The token is single-use (popped on
# consumption) and TTL is shorter than enrollment because the user
# is expected to enter their code within ~30 seconds of submitting
# their password — anything longer suggests they walked away and
# we should make them re-prove the password to mint a new challenge.
_LOGIN_CHALLENGE_TTL = 5 * 60  # seconds — 5 minutes for password→code
_login_challenge_lock = threading.Lock()
_login_challenges: dict[str, dict] = {}  # token → {account_kind, account_id, created_at}


def _pending_put(account_kind: AccountKind, account_id: int, secret: str) -> str:
    """Stash a pending enrollment, return the bearer token."""
    token = _secrets.token_urlsafe(32)
    with _pending_lock:
        _pending[token] = {
            "secret": secret,
            "account_kind": account_kind,
            "account_id": account_id,
            "created_at": _time.time(),
        }
        # Opportunistic cleanup of expired entries on every put.
        cutoff = _time.time() - _PENDING_TTL
        stale = [t for t, e in _pending.items() if e["created_at"] < cutoff]
        for t in stale:
            _pending.pop(t, None)
    return token


def _pending_pop(token: str, account_kind: AccountKind, account_id: int) -> Optional[str]:
    """Look up + remove a pending enrollment. Verifies that the token
    was issued to THIS account (not a different one) — defense against
    a token-confusion attack where one user enrolls and another user
    tries to verify with their token. Returns the base32 secret on
    success, None on expired / missing / wrong-account."""
    with _pending_lock:
        entry = _pending.pop(token, None)
    if entry is None:
        return None
    if entry["created_at"] < _time.time() - _PENDING_TTL:
        return None
    if entry["account_kind"] != account_kind or entry["account_id"] != account_id:
        # Re-stash under the same token? No — surfacing the token to a
        # wrong-account caller is itself suspect. Drop it.
        return None
    return entry["secret"]


# ─────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────
@router.get("/api/2fa/status", response_model=StatusResponse)
def get_status(
    caller: Tuple[AccountKind, AccountRow] = Depends(resolve_caller),
    db: Session = Depends(get_db),
) -> StatusResponse:
    """Is 2FA enabled for the currently-signed-in account? Used by the
    frontend account-settings panel to pick the right UI state."""
    kind, account = caller
    enabled = account.totp_enabled_at is not None
    remaining = recovery_codes_service.remaining_count(db, kind, account.id) if enabled else 0
    return StatusResponse(
        enabled=enabled,
        enabled_at=account.totp_enabled_at,
        recovery_codes_remaining=remaining,
    )


@router.post("/api/2fa/enroll/start", response_model=EnrollStartResponse)
def enroll_start(
    caller: Tuple[AccountKind, AccountRow] = Depends(resolve_caller),
) -> EnrollStartResponse:
    """Begin 2FA enrollment. Generates a fresh TOTP secret + a
    short-lived bearer token. The client MUST display the secret (QR
    or text) to the user immediately. The user scans / types it into
    their authenticator app, reads the first 6-digit code, and calls
    /enroll/verify with that code + the pending_token.

    Calling /enroll/start a second time before /enroll/verify
    discards the previous secret and issues a new one. This is
    intentional — it gives the user a 'restart' affordance if they
    closed the QR page accidentally."""
    kind, account = caller
    if account.totp_enabled_at is not None:
        # Already enrolled — they need to disable first before
        # re-enrolling. Surfacing this as a 409 lets the client show
        # a "you're already enrolled — disable first" message rather
        # than letting them silently overwrite their existing secret.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="2FA is already enabled on this account. Disable first to re-enroll.",
        )
    secret = totp_service.generate_secret()
    pending_token = _pending_put(kind, account.id, secret)
    label = _account_label(kind, account)
    return EnrollStartResponse(
        secret=secret,
        provisioning_uri=totp_service.provisioning_uri(secret, label),
        pending_token=pending_token,
        label=label,
    )


@router.post("/api/2fa/enroll/verify", response_model=EnrollVerifyResponse)
def enroll_verify(
    body: EnrollVerifyRequest,
    caller: Tuple[AccountKind, AccountRow] = Depends(resolve_caller),
    db: Session = Depends(get_db),
) -> EnrollVerifyResponse:
    """Finish 2FA enrollment. Verifies the 6-digit code against the
    pending secret; on success persists the encrypted secret + sets
    totp_enabled_at + generates the recovery codes.

    On failure, the pending_token is consumed (single-use) so the user
    has to restart enrollment. This stops brute-force guessing of the
    initial code."""
    kind, account = caller
    if account.totp_enabled_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="2FA is already enabled. Disable first to re-enroll.",
        )

    secret = _pending_pop(body.pending_token, kind, account.id)
    if secret is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enrollment token expired or invalid. Start enrollment again.",
        )

    if not totp_service.verify_code(secret, body.code):
        # Token already consumed by _pending_pop above; user must
        # restart. Don't tell the attacker whether the token or the
        # code was wrong.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Code didn't verify. Start enrollment again with a fresh code.",
        )

    # Encrypt + persist. Both fields move atomically — if encryption
    # raises, we don't set enabled_at, so the account stays in the
    # "no 2FA" state.
    account.totp_secret_encrypted = totp_service.encrypt_secret(secret)
    account.totp_enabled_at = datetime.now(timezone.utc)
    db.commit()

    codes = recovery_codes_service.generate_codes_for_account(db, kind, account.id)
    logger.info("2FA enabled for %s account #%d (%s).", kind, account.id, getattr(account, "email", "?"))
    return EnrollVerifyResponse(enabled=True, recovery_codes=codes)


@router.post("/api/2fa/verify")
def verify(
    body: VerifyRequest,
    caller: Tuple[AccountKind, AccountRow] = Depends(resolve_caller),
    db: Session = Depends(get_db),
) -> dict:
    """Verify a TOTP or recovery code against the enrolled account.
    Used as the proof-of-knowledge step before sensitive operations
    (disable 2FA, regenerate recovery codes). Returns 200 on match,
    400 on mismatch. The endpoint itself doesn't change account
    state — it's a yes/no check."""
    kind, account = caller
    if account.totp_enabled_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled on this account.",
        )
    if _verify_totp_or_recovery(db, kind, account, body.code):
        return {"verified": True}
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Code didn't match.",
    )


@router.post("/api/2fa/regenerate-recovery-codes", response_model=RecoveryCodesResponse)
def regenerate_recovery_codes(
    body: VerifyRequest,
    caller: Tuple[AccountKind, AccountRow] = Depends(resolve_caller),
    db: Session = Depends(get_db),
) -> RecoveryCodesResponse:
    """Issue a fresh batch of 10 recovery codes; invalidates the
    previous batch entirely (including any unused codes). Requires
    proof of a current TOTP / recovery code in the request body to
    prevent a stolen session from quietly rotating + exfiltrating
    backup codes."""
    kind, account = caller
    if account.totp_enabled_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled on this account.",
        )
    if not _verify_totp_or_recovery(db, kind, account, body.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current code didn't verify. Regeneration cancelled.",
        )
    codes = recovery_codes_service.generate_codes_for_account(db, kind, account.id)
    logger.info(
        "Recovery codes regenerated for %s account #%d (%s).",
        kind, account.id, getattr(account, "email", "?"),
    )
    return RecoveryCodesResponse(recovery_codes=codes)


@router.post("/api/2fa/disable")
def disable(
    body: VerifyRequest,
    caller: Tuple[AccountKind, AccountRow] = Depends(resolve_caller),
    db: Session = Depends(get_db),
) -> dict:
    """Turn 2FA off on the current account. Requires a current
    TOTP / recovery code to authorize. Wipes the encrypted secret +
    all recovery codes."""
    kind, account = caller
    if account.totp_enabled_at is None:
        return {"disabled": True, "noop": True}
    if not _verify_totp_or_recovery(db, kind, account, body.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current code didn't verify. Disable cancelled.",
        )
    account.totp_secret_encrypted = None
    account.totp_enabled_at = None
    db.commit()
    deleted = recovery_codes_service.wipe_codes(db, kind, account.id)
    logger.info(
        "2FA disabled for %s account #%d (%s); %d recovery codes wiped.",
        kind, account.id, getattr(account, "email", "?"), deleted,
    )
    return {"disabled": True}


# ─────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────
def _verify_totp_or_recovery(
    db: Session,
    kind: AccountKind,
    account: AccountRow,
    code: str,
) -> bool:
    """Try the code as a TOTP code first; if that fails, try as a
    recovery code (which burns it). Order matters: TOTP codes are
    cheap to verify (no DB hit) and overwhelmingly more common than
    recovery codes. Recovery codes also have a distinguishable format
    (XXXXX-XXXXX vs. 6 digits) — we could short-circuit on length,
    but trying TOTP first is simpler and the cost is negligible."""
    if account.totp_secret_encrypted:
        try:
            secret = totp_service.decrypt_secret(account.totp_secret_encrypted)
        except totp_service.InvalidTOTPSecret:
            # SESSION_SECRET rotated since enrollment — the user's
            # TOTP secret can't be recovered. Recovery codes still
            # work though (different hash path), so fall through.
            logger.warning(
                "TOTP secret could not be decrypted for %s account #%d; "
                "user will need to use a recovery code and re-enroll.",
                kind, account.id,
            )
        else:
            if totp_service.verify_code(secret, code):
                return True
    # Fall through: try as recovery code.
    return recovery_codes_service.consume_code(db, kind, account.id, code)


# ─────────────────────────────────────────────────────────────────────
# Admin override — reset 2FA on any account. Used when a user has
# lost their device AND their recovery codes. Per design decision in
# task #62 spec, this is the only recovery vector for the high-trust
# account types (admin, rep, candidate). Citizens can use the same
# path; we don't ship an email-self-reset for them in Phase 1.
# ─────────────────────────────────────────────────────────────────────
@router.post("/api/admin/accounts/{kind}/{account_id}/reset-2fa")
def admin_reset_2fa(
    kind: AccountKind,
    account_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
) -> dict:
    """Admin-only: wipe an account's TOTP secret + recovery codes so
    the user can re-enroll at next login. Audit-logged via the
    standard logging chain; future work could add a dedicated
    AdminAuditLog table.

    The caller must be in ADMIN_EMAILS. The reset doesn't sign the
    target user out — it just clears their 2FA state so they can
    enroll fresh. If they were enrolled and using 2FA-required
    endpoints (Phase 3+), the next request will succeed without the
    challenge step and they'll be prompted to re-enroll on the
    account settings surface."""
    model_by_kind = {
        "citizen": CitizenAccount,
        "rep": RepAccount,
        "candidate": CandidateAccount,
    }
    Model = model_by_kind.get(kind)
    if Model is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown account kind: {kind!r}",
        )
    account = db.get(Model, account_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No {kind} account with id={account_id}.",
        )
    had_2fa = account.totp_enabled_at is not None
    account.totp_secret_encrypted = None
    account.totp_enabled_at = None
    db.commit()
    deleted = recovery_codes_service.wipe_codes(db, kind, account_id)
    logger.warning(
        "ADMIN-RESET 2FA for %s account #%d (%s). Had 2FA: %s; recovery codes wiped: %d.",
        kind, account_id, getattr(account, "email", "?"), had_2fa, deleted,
    )
    return {"reset": True, "had_2fa": had_2fa, "recovery_codes_wiped": deleted}


# ─────────────────────────────────────────────────────────────────────
# Login-challenge helpers + endpoint (Task #62 Phase 3).
#
# Called from the three auth routers (auth.py / auth_citizen.py /
# auth_candidate.py) when password verification succeeds AND the
# account has 2FA enrolled. Issues a short-lived challenge token that
# the client passes back to /api/2fa/login-challenge along with the
# user's 6-digit code; on success the actual session cookie + bearer
# token are minted by the router.
# ─────────────────────────────────────────────────────────────────────


def issue_login_challenge(account_kind: AccountKind, account_id: int) -> str:
    """Mint a challenge token + stash the account binding. Returns the
    opaque urlsafe-base64 token the client should send back to
    /api/2fa/login-challenge. Token is single-use (popped on
    consumption) and expires after _LOGIN_CHALLENGE_TTL seconds."""
    token = _secrets.token_urlsafe(32)
    with _login_challenge_lock:
        _login_challenges[token] = {
            "account_kind": account_kind,
            "account_id": account_id,
            "created_at": _time.time(),
        }
        # Opportunistic cleanup of expired entries.
        cutoff = _time.time() - _LOGIN_CHALLENGE_TTL
        stale = [t for t, e in _login_challenges.items() if e["created_at"] < cutoff]
        for t in stale:
            _login_challenges.pop(t, None)
    return token


def _consume_login_challenge(token: str) -> Optional[Tuple[AccountKind, int]]:
    """Look up + pop a challenge token. Returns the (kind, id) tuple
    on success, None if missing or expired. Single-use by design —
    a token can't be replayed."""
    if not token:
        return None
    with _login_challenge_lock:
        entry = _login_challenges.pop(token, None)
    if entry is None:
        return None
    if entry["created_at"] < _time.time() - _LOGIN_CHALLENGE_TTL:
        return None
    return entry["account_kind"], entry["account_id"]


class LoginChallengeRequest(BaseModel):
    model_config = ConfigDict(from_attributes=False)
    challenge_token: str = Field(..., description="From the login response when two_factor_required is True.")
    code: str = Field(..., description="6-digit TOTP code OR a recovery code.")


@router.post("/api/2fa/login-challenge")
def login_challenge(
    body: LoginChallengeRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """Finish a login that paused for 2FA.

    Mints the session cookie + bearer token that the regular login
    endpoint would have issued, in the same response shape the
    matching login endpoint returns when 2FA is not enrolled. The
    client treats this response as if it had received it from the
    initial login call — same `rep` / `citizen` / `candidate` payload
    plus the matching token.

    Doesn't require an existing session — the challenge_token is
    self-contained proof that someone passed password verification
    within the last _LOGIN_CHALLENGE_TTL seconds for that specific
    account. The token is single-use; if the code mismatches, the
    user must restart the login (re-enter password) to mint a fresh
    challenge.
    """
    pair = _consume_login_challenge(body.challenge_token)
    if pair is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Challenge token expired or invalid. Please log in again.",
        )
    account_kind, account_id = pair

    model_by_kind = {
        "citizen": CitizenAccount,
        "rep": RepAccount,
        "candidate": CandidateAccount,
    }
    Model = model_by_kind[account_kind]
    account = db.get(Model, account_id)
    if account is None or not getattr(account, "is_active", True):
        # The account was deleted or deactivated between password
        # verify and code submission. Bail without leaking which.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is no longer available. Please log in again.",
        )
    if getattr(account, "suspended_at", None) is not None:
        # Same paranoia: the account might have been suspended
        # between the two halves of the login.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account has been suspended. "
                "Contact civicview@civicview.app if you think this is in error."
            ),
        )

    if not _verify_totp_or_recovery(db, account_kind, account, body.code):
        # Challenge token was already popped; user must restart the
        # full login flow (re-enter password) to mint a fresh one.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Code didn't verify. Please log in again to retry.",
        )

    # Mint the session for this account kind. We import the auth
    # helpers lazily here to avoid a circular import — the auth
    # routers import this module to call issue_login_challenge.
    from datetime import datetime as _dt
    from fastapi.responses import JSONResponse

    if account_kind == "rep":
        from app.auth import issue_session_token, set_session_cookie
        from app.schemas.pages import MeResponse
        token = issue_session_token(account.id)
        account.last_login_at = _dt.utcnow()
        db.commit()
        db.refresh(account)
        payload = {
            "rep": MeResponse.model_validate(account).model_dump(mode="json"),
            "session_token": token,
            "csrf_token": _secrets.token_urlsafe(16),
            "two_factor_required": False,
        }
        resp = JSONResponse(content=payload)
        set_session_cookie(resp, account.id)
        return resp
    if account_kind == "citizen":
        from app.auth_citizen import issue_citizen_token, set_citizen_cookie
        from app.schemas.pages import CitizenMeResponse
        token = issue_citizen_token(account.id)
        account.last_login_at = _dt.utcnow()
        db.commit()
        db.refresh(account)
        payload = {
            "citizen": CitizenMeResponse.model_validate(account).model_dump(mode="json"),
            "citizen_token": token,
            "two_factor_required": False,
        }
        resp = JSONResponse(content=payload)
        set_citizen_cookie(resp, account.id)
        return resp
    # candidate
    from app.auth_candidate import issue_candidate_token, set_candidate_cookie
    from app.schemas.pages import CandidateMeResponse
    token = issue_candidate_token(account.id)
    account.last_login_at = _dt.utcnow()
    db.commit()
    db.refresh(account)
    payload = {
        "candidate": CandidateMeResponse.model_validate(account).model_dump(mode="json"),
        "candidate_token": token,
        "two_factor_required": False,
    }
    resp = JSONResponse(content=payload)
    set_candidate_cookie(resp, account.id)
    return resp
