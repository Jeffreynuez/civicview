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
import json
import logging
import re
import secrets
import string
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import compute_csrf_token, hash_password, verify_password
from app.auth_citizen import (
    clear_citizen_cookie,
    get_optional_citizen,
    get_optional_citizen_including_deleted,
    issue_citizen_token,
    set_citizen_cookie,
)
from app.db import get_db
from app.services.session_epoch import epoch_of
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
from app.services import login_attempts
from app.services.rate_limit import check_rate_limit


logger = logging.getLogger(__name__)
router = APIRouter()

# Constant-ish-time failure hash for cases where the email doesn't exist.
# Running bcrypt on every path blunts a timing oracle that could otherwise
# enumerate registered emails.
_DUMMY_BCRYPT = "$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalid"

# States, DC and the territories with a House delegate, and the seat
# count of each, live in services/citizen_geo.py (shared with the
# location endpoint and the boot repair). The frontend keeps the same
# table in lib/usStates.js.

# Slug-friendly characters only. Stripped from display_name before being
# folded into the generated email handle.
_SLUG_RE = re.compile(r"[^a-z0-9]+")

# Domain of every generated demo sign-in email. No MX records, ever.
DEMO_LOGIN_SUFFIX = "@demo-citizens.civicview.app"


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


def _check_demo_signup_rate_limit(client_ip: str) -> None:
    """Raise 429 if `client_ip` has exceeded the per-day demo-signup cap.
    Delegates to the shared sliding-window limiter (Task #101) — same
    5 / 24h policy the original inline limiter enforced."""
    check_rate_limit(
        "demo-signup",
        client_ip,
        _DEMO_SIGNUP_LIMIT_PER_IP,
        _DEMO_SIGNUP_WINDOW_SECS,
        detail=(
            "Too many demo accounts created from this connection today. "
            "Try again tomorrow, or sign in to an existing demo account."
        ),
    )


def _client_ip(request: Request) -> str:
    """The caller's IP. See app/services/client_ip.py: the first
    X-Forwarded-For entry is caller-supplied and was letting anyone
    choose their own IP to get around the demo-signup limit."""
    from app.services.client_ip import client_ip
    return client_ip(request)


# ── Contact-email normalization (demo-sunset PRD §4) ──────────────────
def normalize_contact_email(raw: Optional[str]) -> Optional[str]:
    """Strip + lowercase a contact address, returning None for anything
    empty or obviously malformed.

    Deliberately permissive: this address only has to survive an SMTP
    handoff months from now, and a regex strict enough to reject every
    bad address also rejects real ones (plus-tags, new TLDs, unicode
    locals). We check the two things a typo actually breaks — a single
    @ with something either side, and the column width. Callers decide
    what None means: signup drops it silently, the dashboard 422s.
    """
    value = (raw or "").strip().lower()
    if not value or len(value) > 255:
        return None
    local, sep, domain = value.partition("@")
    if not sep or not local or not domain or "@" in domain or "." not in domain:
        return None
    return value


# ── Demo signup payload / response ────────────────────────────────────
class CitizenDemoSignupRequest(BaseModel):
    """Self-serve demo citizen payload.

    Required (2026-10-03): display name, state and congressional
    district. Jeffrey: "no one that creates a demo account should not
    have a state and district. The only thing they can forgo is not
    having their city or county." Engagement is counted by state and
    district, so an account without them has nothing to count under.
    state and congressional_district are typed Optional only so a
    missing one gets a readable message from demo_signup instead of
    pydantic's generic 422."""
    display_name: str = Field(..., min_length=1, max_length=120)
    state: Optional[str] = Field(default=None, max_length=2)
    congressional_district: Optional[str] = Field(default=None, max_length=16)
    city: Optional[str] = Field(default=None, max_length=128)
    # Optional reachable address (demo-sunset PRD §4). Stored on
    # CitizenAccount.contact_email, never as the login email. Used for
    # the one migration notice, and since 2026-10-03 for this account's
    # own sign-in help: the sign-in email below when asked for, and
    # "Forgot password?" (services/password_reset.py). The sign-up form
    # and the privacy policy say exactly that; keep them in step.
    contact_email: Optional[str] = Field(default=None, max_length=255)
    # "Email me my sign-in details": send the generated sign-in email
    # and a link to choose a new password to contact_email. Never the
    # password. Ignored without a contact email.
    send_signin_email: bool = False


class CitizenDemoSignupResponse(BaseModel):
    """Return the new account's credentials alongside the standard login
    payload. The frontend shows email + password to the user so they can
    sign back in later from the same device or share the demo with a
    teammate. Auto-login also happens — cookies are set on the response,
    and `citizen_token` carries the bearer-mode mirror."""
    model_config = ConfigDict(from_attributes=True)
    citizen: CitizenMeResponse
    citizen_token: str
    # Plaintext credentials, only ever returned for newly minted demo
    # accounts. The frontend shows them once with ways to keep them
    # (copy, download, the browser's password manager); it does not
    # store them. The server keeps only the bcrypt hash.
    email: str
    password: str
    # True when the sign-in email went out (send_signin_email with a
    # contact email, and the email service accepted it).
    signin_email_sent: bool = False


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
    email = f"{handle}-{suffix}{DEMO_LOGIN_SUFFIX}"
    alphabet = string.ascii_letters + string.digits + "-_"
    password = "".join(secrets.choice(alphabet) for _ in range(16))
    return email, password


@router.post("/login", response_model=CitizenLoginResponse)
def login(
    payload: CitizenLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Citizen login with lockout enforcement (Task #29).
    Threshold is 5 attempts (vs. 3 for reps/candidates) — citizens
    are general users with a less-elevated trust surface. See
    services/login_attempts.py for the full state-machine."""
    ip, ua = login_attempts.extract_client_signals(request)
    email = payload.email.strip().lower()
    citizen = db.query(CitizenAccount).filter(CitizenAccount.email == email).first()

    # Lockout gate — same generic 401 to avoid leaking state.
    if citizen is not None and login_attempts.is_locked(citizen):
        verify_password(payload.password, _DUMMY_BCRYPT)
        login_attempts.register_locked_out(
            db, account=citizen, identity_kind="citizen",
            email_attempted=email, ip_address=ip, user_agent=ua,
        )
        db.commit()
        # Lockout transparency (Task #56 revision). The earlier silent-
        # 401 design changed because the compensating Postmark email
        # isn't live yet — see lockout_response_detail() docstring.
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=login_attempts.lockout_response_detail(citizen),
        )

    valid = False
    if citizen is not None and citizen.is_active:
        valid = verify_password(payload.password, citizen.password_hash)
    else:
        verify_password(payload.password, _DUMMY_BCRYPT)

    if not citizen or not valid or not citizen.is_active:
        if citizen is None:
            login_attempts.register_no_account(
                db, identity_kind="citizen", email_attempted=email,
                ip_address=ip, user_agent=ua,
            )
        elif not valid:
            login_attempts.register_failure(
                db, account=citizen, identity_kind="citizen",
                email_attempted=email, ip_address=ip, user_agent=ua,
            )
        else:
            login_attempts.register_blocked(
                db, account=citizen, identity_kind="citizen",
                email_attempted=email, ip_address=ip, user_agent=ua,
                reason="inactive",
            )
        db.commit()
        # If THIS failed-password attempt just tripped the lockout,
        # surface the 423 instead of the generic 401 so the UI can
        # render the countdown immediately on the locking attempt
        # (not just on the NEXT attempt against an already-locked
        # account).
        if citizen is not None and login_attempts.is_locked(citizen):
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=login_attempts.lockout_response_detail(citizen),
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Suspended accounts get an explicit 403 with a contact path so
    # the user knows the credentials were correct but the account is
    # in a suspended state — see the rep login for the same pattern.
    if citizen.suspended_at is not None:
        login_attempts.register_blocked(
            db, account=citizen, identity_kind="citizen",
            email_attempted=email, ip_address=ip, user_agent=ua,
            reason="suspended",
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account has been suspended. "
                "Contact civicview@civicview.app if you think this is in error."
            ),
        )

    # 2FA gate (Task #62 Phase 3). See auth.py for the full rationale.
    if citizen.totp_enabled_at is not None:
        login_attempts.register_two_factor_required(
            db, account=citizen, identity_kind="citizen",
            email_attempted=email, ip_address=ip, user_agent=ua,
        )
        db.commit()
        from app.routers.two_factor import issue_login_challenge
        return CitizenLoginResponse(
            two_factor_required=True,
            challenge_token=issue_login_challenge("citizen", citizen.id),
        )

    # Full sign-in success — reset counters + set cookie.
    login_attempts.register_success(
        db, account=citizen, identity_kind="citizen",
        email_attempted=email, ip_address=ip, user_agent=ua,
    )
    set_citizen_cookie(response, citizen.id, epoch_of(citizen))
    citizen.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(citizen)

    # Session-tied CSRF (Task #31). See app/routers/auth.py for the
    # rationale — same HMAC-of-session-token pattern across all three
    # identity tracks.
    citizen_tok = issue_citizen_token(citizen.id, epoch_of(citizen))
    return CitizenLoginResponse(
        citizen=CitizenMeResponse.model_validate(citizen),
        # Mirror token for cross-site-cookie-restricted environments.
        # Identical to the value set in the cookie.
        citizen_token=citizen_tok,
        csrf_token=compute_csrf_token(citizen_tok),
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
      display name, state and congressional district they choose (city
      optional), with no shared inbox and real engagement attribution.

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
    from app.services.citizen_geo import normalize_district, normalize_state
    from app.services.display_names import clean_display_name, name_conflict

    try:
        display_name = clean_display_name(payload.display_name)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # One name, one person (2026-10-03, services/display_names.py):
    # ignoring capitals, spacing, punctuation and accents, the name must
    # not belong to another citizen, a rep or candidate account, or a
    # sitting official. Soft-deleted rows count: a closed account's name
    # isn't up for grabs during its grace period. The unique index on
    # citizen_accounts.name_key backs this up against a race (below).
    conflict = name_conflict(db, display_name)
    if conflict:
        raise HTTPException(status_code=409, detail=conflict)

    raw_state = (payload.state or "").strip()
    if not raw_state:
        raise HTTPException(status_code=422, detail="Choose your state.")
    state = normalize_state(raw_state)
    if not state:
        raise HTTPException(status_code=422, detail=f"Unknown state code: {raw_state.upper()!r}")

    # Canonical "FL-17" / "WY-AL" (services/citizen_geo.py). The form
    # sends "17", "AL" or "FL-17"; anything that isn't a real seat in
    # the chosen state is refused.
    if not (payload.congressional_district or "").strip():
        raise HTTPException(status_code=422, detail="Choose your congressional district.")
    district = normalize_district(state, payload.congressional_district)
    if not district:
        raise HTTPException(
            status_code=422,
            detail=f"That isn't a congressional district in {state}. Choose one from the list.",
        )

    # Optional. An empty string, not a placeholder: "Demo City" used to
    # be stored here and showed up as a real place.
    city = re.sub(r"\s+", " ", (payload.city or "")).strip()

    # Optional sunset-notice address (demo-sunset PRD §4). Light-touch
    # validation only: this is a courtesy channel, not an auth factor, so
    # a typo costs the user a notice rather than access. A malformed value
    # is dropped silently HERE rather than failing the signup — nobody
    # should lose their demo account over an email typo. The dashboard
    # endpoint below makes the opposite call (422) because there the user
    # is submitting the address deliberately and can fix it.
    contact_email = normalize_contact_email(payload.contact_email)
    # Except when they asked us to email their sign-in details there:
    # dropping the address then would leave them waiting for an email
    # that never comes.
    if payload.send_signin_email and (payload.contact_email or "").strip() and not contact_email:
        raise HTTPException(
            status_code=422,
            detail="That email address doesn't look right. Check it, or untick the email option.",
        )

    # The per-IP cap counts accounts, not attempts: it runs after the
    # checks above, so a taken name or a missing district doesn't use
    # up one of the day's five sign-ups.
    _check_demo_signup_rate_limit(_client_ip(request))

    # Generate creds; retry once on the astronomically unlikely email
    # collision before failing out.
    email, password = _generate_credentials(display_name)
    if db.query(CitizenAccount.id).filter(CitizenAccount.email == email).first():
        email, password = _generate_credentials(display_name)

    citizen = CitizenAccount(
        email=email,
        contact_email=contact_email,
        password_hash=hash_password(password),
        display_name=display_name,
        city=city,
        state=state,
        congressional_district=district,
        verified=False,  # Always false for demo. ID.me flips this in v2.
        is_active=True,
        # ── Temporary demo-grant for subscription (Task #88) ──
        # Real billing isn't live yet (Stripe + ID.me both pending).
        # Demo citizens get is_subscribed=True so the subscriber-tier
        # feature (creating polls on the poll page / unclaimed pages)
        # works end-to-end during preview. Commenting is VERIFIED-tier
        # since 2026-07-28 and does not depend on this flag. stripe_subscription_id stays NULL, which
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
    try:
        db.commit()
    except IntegrityError:
        # Another sign-up took the same name between the check above and
        # this insert; the unique index on name_key caught it.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                f'The name "{display_name}" was just taken. Add a middle initial, '
                "a middle name or a number to make it yours."
            ),
        )
    db.refresh(citizen)

    set_citizen_cookie(response, citizen.id, epoch_of(citizen))
    citizen.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(citizen)

    logger.info(
        "Demo citizen created: id=%d, display_name=%r, state=%s, district=%s",
        citizen.id, citizen.display_name, citizen.state, citizen.congressional_district,
    )

    # "Email me my sign-in details" (2026-10-03): the sign-in email and a
    # link to choose a new password, to the contact address. Best effort:
    # the account exists either way and the screen still shows both.
    signin_email_sent = False
    if payload.send_signin_email and contact_email:
        from app.services.password_reset import send_demo_signin_email
        signin_email_sent = send_demo_signin_email(db, citizen)

    return CitizenDemoSignupResponse(
        citizen=CitizenMeResponse.model_validate(citizen),
        citizen_token=issue_citizen_token(citizen.id, epoch_of(citizen)),
        email=email,
        password=password,
        signin_email_sent=signin_email_sent,
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


# ── Start-page preference (Task #102) ──────────────────────────────
# Allowlist of surfaces the app can open on. Keys are stable route
# identifiers, NOT paths — the frontend owns the key→route mapping so
# a future route rename doesn't strand stored preferences.
START_PAGE_CHOICES = {"home", "polls", "posts", "bills", "dashboard", "stats"}


class StartPageRequest(BaseModel):
    """Body for PUT /me/start-page. None or 'home' clears the
    preference (home is the default surface)."""
    start_page: Optional[str] = None


@router.put("/me/start-page", response_model=CitizenMeResponse)
def set_start_page(
    body: StartPageRequest,
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
    db: Session = Depends(get_db),
):
    """Save the citizen's start-page preference. Validates against the
    allowlist; 'home'/None both store NULL (the default)."""
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    value = (body.start_page or "").strip().lower() or None
    if value is not None and value not in START_PAGE_CHOICES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"start_page must be one of {sorted(START_PAGE_CHOICES)} or null",
        )
    citizen.start_page = None if value in (None, "home") else value
    db.add(citizen)
    db.commit()
    db.refresh(citizen)
    return CitizenMeResponse.model_validate(citizen)


# ── Contact email for the demo-sunset notice (PRD §4, increment 2) ──
# Increment 1 added the field to the SIGNUP form. Every account created
# before that ships — the entire existing demo population — has no way
# to supply one, which is the exact unnotifiable cohort the sunset email
# exists to reach. These two endpoints back a dismissible dashboard card
# that closes that gap without a modal, a nag, or a second signup step.


class ContactEmailRequest(BaseModel):
    """Body for PUT /me/contact-email. Pass null (or "") to clear a
    previously-saved address — the user who gave us an address must be
    able to take it back without deleting their account."""
    contact_email: Optional[str] = Field(default=None, max_length=255)


@router.put("/me/contact-email", response_model=CitizenMeResponse)
def set_contact_email(
    body: ContactEmailRequest,
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
    db: Session = Depends(get_db),
):
    """Save (or clear) the reachable address for the demo-sunset notice.

    Unlike signup, a malformed address 422s here. At signup the field is
    incidental and silently dropping a typo protects account creation; on
    the dashboard the user came specifically to give us this address, and
    silently discarding it would leave them believing they are reachable
    when they are not — the worst possible failure for a notice channel.

    Saving also clears contact_email_prompt_dismissed_at so the card's
    state is derived from one fact (do we have an address?) rather than
    two that can disagree.
    """
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    raw = (body.contact_email or "").strip()
    if not raw:
        citizen.contact_email = None
    else:
        normalized = normalize_contact_email(raw)
        if normalized is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="That doesn't look like an email address. Check it and try again.",
            )
        citizen.contact_email = normalized
        citizen.contact_email_prompt_dismissed_at = None
    db.add(citizen)
    db.commit()
    db.refresh(citizen)
    return CitizenMeResponse.model_validate(citizen)


@router.post("/me/contact-email/dismiss", response_model=CitizenMeResponse)
def dismiss_contact_email_prompt(
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
    db: Session = Depends(get_db),
):
    """Stop showing the contact-email card on this account.

    Server-side rather than localStorage so the dismissal follows the
    account across devices. Idempotent: re-dismissing keeps the ORIGINAL
    timestamp, because the age of the refusal is the interesting fact and
    a stray double-click should not reset it.
    """
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if citizen.contact_email_prompt_dismissed_at is None:
        citizen.contact_email_prompt_dismissed_at = datetime.utcnow()
        db.add(citizen)
        db.commit()
        db.refresh(citizen)
    return CitizenMeResponse.model_validate(citizen)


# ── State and congressional district (2026-10-03) ─────────────────
# Every citizen account needs both before it can engage (the location
# gate, services/entitlements.require_location). This is where an
# account without them sets them, from the prompt the app shows, and
# where a demo account corrects them later (Account settings).
# Verified accounts keep the state ID.me confirmed: they can choose
# their district within it, not move the account to another state.
# Jeffrey, 2026-10-03: "Edit location in settings".

class LocationRequest(BaseModel):
    """Body for PUT /me/location. city: omit to keep the current one,
    "" to clear it."""
    state: Optional[str] = Field(default=None, max_length=2)
    congressional_district: Optional[str] = Field(default=None, max_length=16)
    city: Optional[str] = Field(default=None, max_length=128)


_LOCATION_CHANGES_PER_DAY = 10


@router.put("/me/location", response_model=CitizenMeResponse)
def set_location(
    body: LocationRequest,
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
    db: Session = Depends(get_db),
):
    """Set the account's state, congressional district and (optional)
    city. Rows already written keep the district they were stamped
    with; new likes, votes and comments use the new one."""
    from app.services.citizen_geo import normalize_district, normalize_state

    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    raw_state = (body.state or "").strip()
    if citizen.verified:
        state = normalize_state(citizen.state)
        if raw_state and raw_state.upper() != (citizen.state or "").upper():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Your state comes from your identity verification, so it can't be "
                    "changed here. You can choose your district within it."
                ),
            )
    else:
        state = normalize_state(raw_state)
        if not raw_state:
            raise HTTPException(status_code=422, detail="Choose your state.")
    if not state:
        raise HTTPException(status_code=422, detail=f"Unknown state code: {raw_state.upper()!r}")

    if not (body.congressional_district or "").strip():
        raise HTTPException(status_code=422, detail="Choose your congressional district.")
    district = normalize_district(state, body.congressional_district)
    if not district:
        raise HTTPException(
            status_code=422,
            detail=f"That isn't a congressional district in {state}. Choose one from the list.",
        )

    city = None if body.city is None else re.sub(r"\s+", " ", body.city).strip()
    moved = state != (citizen.state or "").upper()
    if state == citizen.state and district == citizen.congressional_district and (
        city is None or city == citizen.city
    ):
        return CitizenMeResponse.model_validate(citizen)

    # Moving an account around is not free: the counts by state and
    # district are the point of the product.
    check_rate_limit(
        "location-change", str(citizen.id), _LOCATION_CHANGES_PER_DAY, 24 * 3600,
        detail="You've changed your location several times today. Try again tomorrow.",
    )

    citizen.state = state
    citizen.congressional_district = district
    if city is not None:
        citizen.city = city
    if moved:
        # The rest of the old address belonged to the old state.
        citizen.county = None
        citizen.zip_code = None
        citizen.address_line1 = None
        if city is None:
            citizen.city = ""
    db.add(citizen)
    db.commit()
    db.refresh(citizen)
    logger.info("Citizen id=%d set location %s (moved state: %s)", citizen.id, district, moved)
    return CitizenMeResponse.model_validate(citizen)


# ── Weekly digest opt-in + preview (Task #104) ─────────────────────


class DigestOptInRequest(BaseModel):
    opt_in: bool


@router.put("/me/digest", response_model=CitizenMeResponse)
def set_digest_opt_in(
    body: DigestOptInRequest,
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
    db: Session = Depends(get_db),
):
    """Toggle the weekly civic digest. Explicit opt-in only — the
    column defaults to False and nothing flips it server-side."""
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    citizen.digest_opt_in = bool(body.opt_in)
    db.add(citizen)
    db.commit()
    db.refresh(citizen)
    return CitizenMeResponse.model_validate(citizen)


@router.get("/me/digest/preview")
def digest_preview(
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
    db: Session = Depends(get_db),
):
    """Render the caller's digest as it would send right now. Works for
    demo accounts too (sending skips demo domains, previewing doesn't) —
    lets anyone see what they'd get before opting in."""
    from app.services.digest_service import build_digest, is_demo_email, render_digest

    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    data = build_digest(db, citizen)
    if data is None:
        return {
            "empty": True,
            "demo_email": is_demo_email(citizen.email),
            "reason": (
                "Nothing to digest yet — track some officials and check back "
                "after they post, poll, or schedule events."
            ),
        }
    subject, html_body, _text = render_digest(data)
    return {
        "empty": False,
        "demo_email": is_demo_email(citizen.email),
        "subject": subject,
        "html": html_body,
    }


# ── Account-synced notification prefs (Notifications v2 part 2) ─────
# The navbar bell panel's delivery-channel prefs (in_app, mobile_push,
# quiet_hours, digest_cadence, ...) were localStorage-only. These two
# endpoints make the signed-in citizen's account the source of truth so
# choices follow them across devices. The frontend still keeps its
# localStorage mirror for anonymous visitors and as an offline cache.
#
# Validation is shape-based rather than a key allowlist: the schema
# lives in the frontend (lib/notificationPrefs.js CHANNEL_SCHEMA) and
# evolves there; a server-side allowlist would go stale silently. We
# instead cap size and value types hard so the column can't become a
# junk drawer. The push send path (services/push_service.py) reads
# quiet_hours / digest_cadence / tz_offset_minutes out of this blob.

_NOTIF_PREFS_MAX_KEYS = 64
_NOTIF_PREFS_MAX_KEY_LEN = 64
_NOTIF_PREFS_MAX_STR_LEN = 64


def sanitize_notification_prefs(raw: object) -> dict:
    """Validate + normalize a prefs payload. Raises HTTP 422 on shape
    violations. Values must be bool, int (bounded), or short strings —
    nothing nested, so the JSON blob stays flat and small. Shared with
    routers/push.py for the per-device prefs snapshot."""
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="prefs must be an object",
        )
    if len(raw) > _NOTIF_PREFS_MAX_KEYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"prefs may hold at most {_NOTIF_PREFS_MAX_KEYS} keys",
        )
    out: dict = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key or len(key) > _NOTIF_PREFS_MAX_KEY_LEN:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="prefs keys must be non-empty strings (max 64 chars)",
            )
        # bool check must precede int — bool is an int subclass.
        if isinstance(value, bool):
            out[key] = value
        elif isinstance(value, int):
            # Only small ints have a legitimate use here (tz offset in
            # minutes is the widest: ±14h = ±840).
            if abs(value) > 100000:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"prefs int value out of range for {key!r}",
                )
            out[key] = value
        elif isinstance(value, str):
            if len(value) > _NOTIF_PREFS_MAX_STR_LEN:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"prefs string value too long for {key!r}",
                )
            out[key] = value
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"prefs values must be bool, int, or string ({key!r})",
            )
    return out


class NotificationPrefsRequest(BaseModel):
    """Body for PUT /me/notification-prefs. The full prefs object is
    sent each time (it's tiny) — no patch semantics to get wrong."""
    prefs: dict


@router.get("/me/notification-prefs")
def get_notification_prefs(
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
):
    """Return the account's synced channel prefs, or prefs=null when
    the citizen has never synced (frontend keeps its local values)."""
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    prefs = None
    if citizen.notification_prefs_json:
        try:
            prefs = json.loads(citizen.notification_prefs_json)
        except (ValueError, TypeError):
            prefs = None  # Corrupt blob — treat as never-synced.
    return {"prefs": prefs}


@router.put("/me/notification-prefs")
def put_notification_prefs(
    body: NotificationPrefsRequest,
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen_including_deleted),
    db: Session = Depends(get_db),
):
    """Replace the account's synced channel prefs with the sanitized
    payload. Returns the stored prefs so the client can reconcile."""
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    prefs = sanitize_notification_prefs(body.prefs)
    citizen.notification_prefs_json = json.dumps(prefs, ensure_ascii=False)
    db.add(citizen)
    db.commit()
    return {"prefs": prefs}


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
        verify_password_confirmation,
    )
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not verify_email_confirmation(citizen, payload.confirm_email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email confirmation doesn't match the signed-in account.",
        )
    if not verify_password_confirmation(citizen, payload.password):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enter your current password to delete this account.",
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
