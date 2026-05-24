# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Citizen-auth router — parallel to app/routers/auth.py.

Endpoints:
  POST /api/citizen-auth/login   → verify credentials, issue cl_citizen cookie
  POST /api/citizen-auth/logout  → clear cl_citizen cookie
  GET  /api/citizen-auth/me      → return the logged-in citizen (or 401)

The cookie is independent of the rep `cl_session` cookie, so a single
browser can hold both at once. This is deliberate for the demo: the
same reviewer can post as Byron Donalds in one tab and engage as
Citizen Jane Doe in another without juggling logins.
"""
from __future__ import annotations

from datetime import datetime
import logging
import re
import secrets
import string
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.auth import hash_password, verify_password
from app.auth_citizen import (
    clear_citizen_cookie,
    get_optional_citizen_including_deleted,
    issue_citizen_token,
    set_citizen_cookie,
)
from app.db import get_db
from app.models.pages import CitizenAccount
from app.schemas.pages import (
    CitizenLoginRequest,
    CitizenLoginResponse,
    CitizenMeResponse,
    DeleteAccountRequest,
    DeleteAccountResponse,
    PasswordResetConfirmRequest,
    PasswordResetGenericResponse,
    PasswordResetRequestRequest,
)


logger = logging.getLogger(__name__)
router = APIRouter()

# Constant-ish-time failure hash for cases where the email doesn't exist.
# Running bcrypt on every path blunts a timing oracle that could otherwise
# enumerate registered emails.
_DUMMY_BCRYPT = "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalid"

# Two-letter state code, plus DC + a few US territories that have congressional
# delegates. Used to validate demo-signup payloads. Keep in sync with the
# frontend state dropdown.
_VALID_STATES = frozenset({
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
    "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
    "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY", "AS", "GU", "MP", "PR", "VI",
})

# Slug-friendly characters only. Stripped from display_name before being
# folded into the generated email handle.
_SLUG_RE = re.compile(r"[^a-z0-9]+")


# ── Rate limiting ─────────────────────────────────────────────────────
# Simple in-memory token bucket keyed by client IP. Five demo-account
# creations per IP per 24h is generous for legitimate testing and
# meaningful friction for someone trying to flood the system. Resets
# automatically as entries age out, so no cleanup job needed. On a
# multi-worker deploy this gets per-worker semantics, which is fine for
# demo-tier abuse mitigation; tighten to Redis-backed if we ever ship a
# production self-serve flow that's not strictly demo.
_DEMO_SIGNUP_LIMIT_PER_IP = 5
_DEMO_SIGNUP_WINDOW_SECS = 24 * 60 * 60
_demo_signup_log: dict[str, list[float]] = {}


def _check_demo_signup_rate_limit(client_ip: str) -> None:
    """Raise 429 if `client_ip` has exceeded the per-day demo-signup cap.
    Trims expired timestamps as a side effect so the dict doesn't grow
    unbounded."""
    now = time.time()
    cutoff = now - _DEMO_SIGNUP_WINDOW_SECS
    hits = [ts for ts in _demo_signup_log.get(client_ip, []) if ts > cutoff]
    if len(hits) >= _DEMO_SIGNUP_LIMIT_PER_IP:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many demo accounts created from this connection today. "
                "Try again tomorrow, or sign in to an existing demo account."
            ),
        )
    hits.append(now)
    _demo_signup_log[client_ip] = hits


def _client_ip(request: Request) -> str:
    """Resolve the caller's IP, preferring the first X-Forwarded-For hop
    when the app sits behind a proxy (Render, Vercel edge, Cloudflare).
    Falls back to the direct socket address."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # Pick the first non-empty entry — that's the original client per
        # the convention every standard proxy follows.
        first = fwd.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


# ── Demo signup payload / response ────────────────────────────────────
class CitizenDemoSignupRequest(BaseModel):
    """Self-serve demo citizen payload. Display name is the only required
    field — state / district / city are optional but improve the engagement
    experience (poll scope filters, district-level rep matching)."""
    display_name: str = Field(..., min_length=1, max_length=80)
    state: Optional[str] = Field(default=None, min_length=2, max_length=2)
    congressional_district: Optional[str] = Field(default=None, max_length=8)
    city: Optional[str] = Field(default=None, max_length=128)


class CitizenDemoSignupResponse(BaseModel):
    """Return the new account's credentials alongside the standard login
    payload. The frontend shows email + password to the user so they can
    sign back in later from the same device or share the demo with a
    teammate. Auto-login also happens — cookies are set on the response,
    and `citizen_token` carries the bearer-mode mirror."""
    model_config = ConfigDict(from_attributes=True)
    citizen: CitizenMeResponse
    citizen_token: str
    # Plaintext credentials — only ever returned for newly-minted demo
    # accounts. The frontend stashes these in localStorage so the user can
    # see them in their account settings and reuse them across sessions.
    email: str
    password: str


def _slugify(name: str) -> str:
    """Lowercase + collapse non-alphanumeric runs to dashes. Used for the
    user-visible portion of the synthetic email handle."""
    s = _SLUG_RE.sub("-", name.lower()).strip("-")
    return s[:24] or "citizen"


def _generate_credentials(display_name: str) -> tuple[str, str]:
    """Mint a (email, password) pair for a brand-new demo account.

    Email pattern: `<slug>-<8 random chars>@demo-citizens.civicview.app`.
    The demo-citizens subdomain has no MX records and never will, so
    these addresses are syntactically valid but provably undeliverable.
    Pydantic's EmailStr validator rejects reserved TLDs like `.local`
    and `.invalid`, so we have to use a real domain we control.

    Password: 16 chars from URL-safe alphabet, generated via `secrets`
    for cryptographic randomness.
    """
    handle = _slugify(display_name)
    suffix = secrets.token_hex(4)  # 8 hex chars
    email = f"{handle}-{suffix}@demo-citizens.civicview.app"
    alphabet = string.ascii_letters + string.digits + "-_"
    password = "".join(secrets.choice(alphabet) for _ in range(16))
    return email, password


@router.post("/login", response_model=CitizenLoginResponse)
def login(
    payload: CitizenLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()
    citizen = db.query(CitizenAccount).filter(CitizenAccount.email == email).first()

    valid = False
    if citizen is not None and citizen.is_active:
        valid = verify_password(payload.password, citizen.password_hash)
    else:
        verify_password(payload.password, _DUMMY_BCRYPT)

    if not citizen or not valid or not citizen.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Suspended accounts get an explicit 403 with a contact path so
    # the user knows the credentials were correct but the account is
    # in a suspended state — see the rep login for the same pattern.
    if citizen.suspended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account has been suspended. "
                "Contact civicview@civicview.app if you think this is in error."
            ),
        )

    # 2FA gate (Task #62 Phase 3). See auth.py for the full rationale.
    if citizen.totp_enabled_at is not None:
        from app.routers.two_factor import issue_login_challenge
        return CitizenLoginResponse(
            two_factor_required=True,
            challenge_token=issue_login_challenge("citizen", citizen.id),
        )

    set_citizen_cookie(response, citizen.id)
    citizen.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(citizen)

    return CitizenLoginResponse(
        citizen=CitizenMeResponse.model_validate(citizen),
        # Mirror token for cross-site-cookie-restricted environments.
        # Identical to the value set in the cookie.
        citizen_token=issue_citizen_token(citizen.id),
    )


@router.post(
    "/demo-signup",
    response_model=CitizenDemoSignupResponse,
    status_code=status.HTTP_201_CREATED,
)
def demo_signup(
    payload: CitizenDemoSignupRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Create a self-serve demo citizen account and auto-log them in.

    Why this exists:
      The Phase 1.5 demo seeded 60 fixed citizen accounts so testers
      could exercise the engagement features. That list maxes out at
      60 and forces every reviewer to share the same identities. This
      endpoint lets any visitor mint their own demo account with a
      display name + (optional) state / district they choose — no
      cap, no shared inbox, real engagement attribution.

      `verified=False` on every demo account: the schema's existing
      "Unverified" labeling continues to mark these throughout the UI,
      so a future real-rep viewer can tell their demo polls from real-
      citizen polls at a glance.

    Rate limiting: 5 accounts per IP per 24h. Generous for legitimate
    multi-user testing on a household network, tight enough that
    automated abuse hits a wall fast.

    Returns the freshly-minted email + password so the frontend can
    auto-populate the standard login form (display them to the user
    so they can sign in later from another device, share with a
    teammate, etc.). Cookies + bearer token are also set, so the
    user is signed in immediately — they don't need to call /login
    after this.
    """
    _check_demo_signup_rate_limit(_client_ip(request))

    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="Display name is required.")

    # Display-name uniqueness, case-insensitive. Two demo citizens
    # with the same visible name break the @-mention semantics in
    # the AI comment filter ("@Fred" can't disambiguate between
    # multiple Freds) and create general identity confusion in
    # threads. We use func.lower() for the compare so "Fred Smith"
    # and "fred smith" are treated as the same name. Soft-deleted
    # rows DO count (you can't squat on a name even after closing
    # an account, mirroring most social-platform conventions).
    from sqlalchemy import func as _sa_func
    existing = (
        db.query(CitizenAccount.id)
        .filter(_sa_func.lower(CitizenAccount.display_name) == display_name.lower())
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f'The display name "{display_name}" is already in use. '
                "Try a variation (initials, middle name, location, etc.)."
            ),
        )

    state = (payload.state or "").strip().upper() or None
    if state and state not in _VALID_STATES:
        raise HTTPException(status_code=400, detail=f"Unknown state code: {state!r}")

    district = (payload.congressional_district or "").strip() or None
    if district:
        # Normalize "19" + state "FL" → "FL-19" so the value stored
        # matches the format used elsewhere (CitizenAccount rows,
        # scope filtering, address-lookup output).
        if district.isdigit() and state:
            district = f"{state}-{int(district)}"
        if len(district) > 8:
            raise HTTPException(
                status_code=400,
                detail="Congressional district must be in 'XX-NN' format.",
            )

    city = (payload.city or "").strip() or None

    # Generate creds; retry once on the astronomically unlikely email
    # collision before failing out.
    email, password = _generate_credentials(display_name)
    if db.query(CitizenAccount.id).filter(CitizenAccount.email == email).first():
        email, password = _generate_credentials(display_name)

    citizen = CitizenAccount(
        email=email,
        password_hash=hash_password(password),
        display_name=display_name,
        city=city or "Demo City",
        state=state or "FL",  # Backend column is NOT NULL; default to FL.
        congressional_district=district,
        verified=False,  # Always false for demo. ID.me flips this in v2.
        is_active=True,
        # ── Temporary demo-grant for subscription (Task #88) ──
        # Real billing isn't live yet (Stripe + ID.me both pending).
        # Demo citizens get is_subscribed=True so the engagement
        # features (creating polls on poll page / unclaimed pages,
        # commenting on posts + polls) work end-to-end during
        # preview. stripe_subscription_id stays NULL, which
        # distinguishes these rows from real paid subscribers when
        # we cut over post-launch. REMOVE THIS LINE once real
        # billing goes live.
        is_subscribed=True,
        subscription_status="demo",
        # ── Verification method tag (Task #89) ──
        # Marks this row as a demo-flavored grant so the UI can
        # render "Demo access" badges on the verification card,
        # parallel to the Stripe demo grant. `verified` stays
        # False per the existing demo policy — demo accounts never
        # claim to have passed ID.me, only the engagement features
        # are unlocked. REMOVE alongside the is_subscribed line
        # above once ID.me ships.
        verified_method="demo",
    )
    db.add(citizen)
    db.commit()
    db.refresh(citizen)

    set_citizen_cookie(response, citizen.id)
    citizen.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(citizen)

    logger.info(
        "Demo citizen created: id=%d, display_name=%r, state=%s, district=%s",
        citizen.id, citizen.display_name, citizen.state, citizen.congressional_district,
    )

    return CitizenDemoSignupResponse(
        citizen=CitizenMeResponse.model_validate(citizen),
        citizen_token=issue_citizen_token(citizen.id),
        email=email,
        password=password,
    )


@router.post("/logout")
def logout(response: Response):
    """Clear the citizen session cookie. Always returns 200."""
    clear_citizen_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=CitizenMeResponse)
def me(citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted)):
    # Uses the _including_deleted variant so soft-deleted citizens
    # still see their own /me during the 30-day grace window — the
    # frontend reads self_deleted_at + purge_after to render the
    # recovery banner. 2FA enforcement stays disabled on this path
    # by design (citizens are opt-in only).
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return CitizenMeResponse.model_validate(citizen)


# ── Self-serve account deletion (Task #81) ──────────────────────────
@router.post("/delete", response_model=DeleteAccountResponse)
def delete_account(
    payload: DeleteAccountRequest,
    response: Response,
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
):
    """Delete the signed-in citizen account. See app/routers/auth.py
    delete_account for the rep equivalent (same shape, same modes).

    Hard delete archives the citizen's ID.me verification (preserving
    the cost-skip on a future re-signup) before dropping the row."""
    from app.services.account_deletion import (
        hard_delete_account,
        soft_delete_account,
        verify_email_confirmation,
    )
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not verify_email_confirmation(citizen, payload.confirm_email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email confirmation doesn't match the signed-in account.",
        )
    if payload.mode == "hard":
        hard_delete_account(db, "citizen", citizen)
        clear_citizen_cookie(response)
        return DeleteAccountResponse(mode="hard", purge_after=None)
    purge_at = soft_delete_account(db, "citizen", citizen)
    return DeleteAccountResponse(mode="soft", purge_after=purge_at)


@router.post("/recover", response_model=CitizenMeResponse)
def recover_account(
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
):
    """Recover a soft-deleted citizen account."""
    from app.services.account_deletion import recover_account as _recover
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if citizen.self_deleted_at is None:
        return CitizenMeResponse.model_validate(citizen)
    _recover(db, "citizen", citizen)
    db.refresh(citizen)
    return CitizenMeResponse.model_validate(citizen)


# ── Password reset (Task #87) ───────────────────────────────────────
# See app/routers/auth.py for the shared design + rationale; this is
# the citizen-identity surface for the same flow.
@router.post("/password-reset/request", response_model=PasswordResetGenericResponse)
def request_reset(
    payload: PasswordResetRequestRequest,
    db: Session = Depends(get_db),
):
    """Step 1: mint + email a citizen reset token if the email matches
    a CitizenAccount row. Anti-enumeration: 200 either way."""
    from app.services.password_reset import request_password_reset
    request_password_reset(db, "citizen", payload.email)
    return PasswordResetGenericResponse(ok=True)


@router.post("/password-reset/confirm", response_model=PasswordResetGenericResponse)
def confirm_reset(
    payload: PasswordResetConfirmRequest,
    db: Session = Depends(get_db),
):
    """Step 2: validate the token + write the new bcrypt password
    hash + send the confirmation email."""
    from app.services.password_reset import confirm_password_reset, ResetConfirmResult
    result = confirm_password_reset(db, "citizen", payload.token, payload.new_password)
    if result == ResetConfirmResult.OK:
        return PasswordResetGenericResponse(ok=True)
    if result == ResetConfirmResult.INVALID_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters.",
        )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This reset link is invalid or has expired. Request a new one.",
    )
