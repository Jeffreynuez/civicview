# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
ID.me identity verification service (Task #89).

Scaffolds the citizen verification flow without requiring an ID.me
account at boot. Same env-gated swappable pattern as Postmark + R2 +
Stripe — IdMeService when creds are present, DevIdMeService otherwise.

What the verification does for the product:
  • Confirms the citizen is a real US person who has actually lived
    at the address they claim. The address is what pins them to a
    state + congressional district, which gates which polls /
    rep-pages they can engage on. Without verified addresses, the
    "verified constituent" claim on every comment is empty.
  • Provides legal name for the verification archive's
    same-person-different-email re-signup cost-skip (Task #81
    archive, now wired up here).
  • Flips CitizenAccount.verified to True + writes verified_at +
    verified_method='id.me' + verified_legal_name_encrypted +
    verified_address_hash.

What the verification does NOT do:
  • Store DOB / SSN / driver's-license-number / selfie photos.
    ID.me retains those; we just take their "verified yes" + the
    address + the legal name.
  • Replace 2FA. A verified citizen still has to enroll 2FA
    separately if they want it (TOTP/recovery codes; opt-in for
    citizens).
  • Verify reps / candidates. Those identities have their own
    admin-mediated verification paths.

OAuth flow at a high level:
  1. Client POSTs /api/identity-verification/start. Backend mints a
     signed state token containing the citizen_id + a nonce,
     returns the ID.me authorize URL (with the state, redirect_uri,
     client_id, scope).
  2. Browser redirects to id.me. User completes verification.
  3. ID.me redirects back to /api/identity-verification/callback?
     code=<>&state=<>. Backend:
       a. Verifies the state token (signed, <10min, matches the
          signed-in citizen).
       b. Exchanges code for an access_token at ID.me's token URL.
       c. Calls ID.me's userinfo endpoint with the token.
       d. Hashes the returned address + legal name.
       e. Cost-skip lookup against VerifiedIdentityArchive (email
          first; falls back to legal_name + address composite).
       f. Updates the citizen row + writes a fresh archive entry.
       g. Redirects the browser back to the citizen dashboard.

State token CSRF protection:
  Without state, an attacker could trick a signed-in citizen into
  hitting the callback URL with a token tied to the attacker's ID.me
  account — granting the attacker's identity to the victim's
  account. The state token is signed (itsdangerous URLSafeTimedSerializer),
  time-bounded (10 min), and bound to the citizen_id. The callback
  refuses if the signed-in citizen doesn't match the state.

Configuration env vars (all required to flip to real IdMeService):
  IDME_CLIENT_ID          — from the ID.me developer console
                            (api.id.me → Workshop → your app).
  IDME_CLIENT_SECRET      — same source.
  IDME_REDIRECT_URI       — must match the URI registered with ID.me
                            (e.g. https://api.civicview.app/api/
                            identity-verification/callback).

Optional:
  IDME_AUTHORIZE_URL      — defaults to ID.me's standard. Override
                            only for sandbox / testing tenants.
  IDME_TOKEN_URL          — defaults to ID.me's standard.
  IDME_USERINFO_URL       — defaults to ID.me's standard.
  IDME_SCOPES             — space-separated. Defaults to
                            'identity verification' which gives us
                            verified attributes for an IAL2 verified
                            user. Adjust per ID.me's docs if their
                            scope names change.
  IDME_POST_AUTH_REDIRECT — where the callback bounces the browser
                            after success / failure. Defaults to
                            https://civicview.app/?verified=1
"""
from __future__ import annotations

import hashlib
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


logger = logging.getLogger(__name__)


# ID.me's standard OAuth endpoints. Override via env vars only if
# you're integrating against a sandbox tenant or ID.me rotates the
# URLs. (Their public docs at developers.id.me have the canonical
# list — check there before changing.)
DEFAULT_AUTHORIZE_URL = "https://api.id.me/oauth/authorize"
DEFAULT_TOKEN_URL = "https://api.id.me/oauth/token"
DEFAULT_USERINFO_URL = "https://api.id.me/api/public/v3/attributes.json"

# Scopes determine which attributes we can read back. 'identity'
# returns name + DOB + address; 'verification' returns the IAL2
# verified flag. Adjust if ID.me's scope names change — their
# console will show what's available for your registered app.
DEFAULT_SCOPES = "identity verification"

# Where the browser lands after a successful or failed callback.
# Configurable per environment so localhost dev hits the local
# frontend rather than civicview.app.
DEFAULT_POST_AUTH_REDIRECT = "https://civicview.app/?verified=1"


class IdMeError(Exception):
    """Raised by the verification operations that can't complete
    (network, invalid state, ID.me rejected the auth code).
    Routers catch this and surface a user-safe message."""


@dataclass
class VerifiedAttributes:
    """Subset of ID.me's userinfo response that we actually persist.

    Note we never persist dob / SSN / selfie image — those stay at
    ID.me. We accept them in this dataclass only so the service can
    compute the verified_attributes_hash (for the secondary cost-
    skip lookup) before discarding them.
    """
    legal_name: str          # "Jeffrey Nuez"
    address_line1: str       # "123 Main St"
    address_city: str        # "Naples"
    address_state: str       # "FL"
    address_zip: str         # "34102"
    # IAL2 means "remote identity proofing was performed" per NIST
    # SP 800-63A. Anything below that we treat as unverified.
    ial_level: int = 2


# ─────────────────────────────────────────────────────────────────────
# Abstract interface
# ─────────────────────────────────────────────────────────────────────
class IdentityVerificationService(ABC):
    """Verification backend protocol. Both ID.me + Dev backends
    implement these methods."""

    @abstractmethod
    def build_authorize_url(self, *, state_token: str) -> str:
        """Return the URL the client should redirect the user to in
        order to begin verification. state_token must be the signed
        token minted by mint_state_token() — ID.me will pass it
        back verbatim on the callback."""

    @abstractmethod
    def exchange_code_for_attributes(self, *, code: str) -> VerifiedAttributes:
        """Exchange an OAuth authorization code for the verified
        attributes. Raises IdMeError on any failure."""

    @abstractmethod
    def is_configured(self) -> bool:
        """True if real ID.me API calls work. False means the dev
        backend is active (Start Verification button is inert)."""


# ─────────────────────────────────────────────────────────────────────
# ID.me — production backend
# ─────────────────────────────────────────────────────────────────────
class IdMeService(IdentityVerificationService):
    """OAuth2 client for ID.me's verification API. Uses httpx
    (already a dep for the federal-data fetchers) so no new package
    install is required."""

    def __init__(self):
        # All three are required — partial config is a runtime trap.
        self._client_id = _require_env("IDME_CLIENT_ID")
        self._client_secret = _require_env("IDME_CLIENT_SECRET")
        self._redirect_uri = _require_env("IDME_REDIRECT_URI")
        self._authorize_url = (
            os.getenv("IDME_AUTHORIZE_URL") or DEFAULT_AUTHORIZE_URL
        )
        self._token_url = (
            os.getenv("IDME_TOKEN_URL") or DEFAULT_TOKEN_URL
        )
        self._userinfo_url = (
            os.getenv("IDME_USERINFO_URL") or DEFAULT_USERINFO_URL
        )
        self._scopes = (
            os.getenv("IDME_SCOPES") or DEFAULT_SCOPES
        )

    def is_configured(self) -> bool:
        return True

    def build_authorize_url(self, *, state_token: str) -> str:
        # urlencode the query params. ID.me expects standard OAuth2
        # parameters: response_type, client_id, redirect_uri, scope,
        # state. Some integrations also require `op` to select the
        # verification product variant — keep simple here; the env
        # IDME_AUTHORIZE_URL override lets you bake that in if your
        # tenant needs it.
        from urllib.parse import urlencode
        params = {
            "response_type": "code",
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,
            "scope": self._scopes,
            "state": state_token,
        }
        return f"{self._authorize_url}?{urlencode(params)}"

    def exchange_code_for_attributes(self, *, code: str) -> VerifiedAttributes:
        import httpx
        try:
            # Step 1: trade the authorization code for an access
            # token. ID.me's token endpoint speaks standard OAuth2 —
            # POST application/x-www-form-urlencoded.
            token_resp = httpx.post(
                self._token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": self._redirect_uri,
                },
                timeout=20.0,
            )
            token_resp.raise_for_status()
            token_payload = token_resp.json()
            access_token = token_payload.get("access_token")
            if not access_token:
                raise IdMeError("ID.me token exchange returned no access_token.")

            # Step 2: fetch the verified attributes with the access
            # token. ID.me returns a JSON blob; the exact shape
            # depends on the scopes granted. Defensive parsing — if
            # an attribute is missing we still want a partial fail
            # rather than a 500.
            user_resp = httpx.get(
                self._userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=20.0,
            )
            user_resp.raise_for_status()
            data = user_resp.json() or {}
        except IdMeError:
            raise
        except Exception as e:
            logger.exception("ID.me API call failed during code exchange")
            raise IdMeError("Could not complete verification — please try again.") from e

        # Parse — ID.me's response shape (subject to docs at
        # developers.id.me; field names occasionally drift). The
        # cutover person should verify against an actual response
        # and tighten this parser if their tenant returns
        # different keys.
        try:
            attrs = data.get("attributes") or data
            full_name = (
                (attrs.get("name") or "").strip()
                or " ".join([
                    (attrs.get("fname") or "").strip(),
                    (attrs.get("lname") or "").strip(),
                ]).strip()
            )
            return VerifiedAttributes(
                legal_name=full_name,
                address_line1=(attrs.get("street") or attrs.get("address") or "").strip(),
                address_city=(attrs.get("city") or "").strip(),
                address_state=(attrs.get("state") or "").strip().upper()[:2],
                address_zip=(attrs.get("zip") or attrs.get("postal_code") or "").strip(),
                # ID.me sometimes returns 'verified' as a boolean,
                # sometimes as a level string. Default IAL2 since
                # we only ever request the identity+verification
                # scope set that produces IAL2 verification.
                ial_level=int(attrs.get("ial_level") or 2),
            )
        except Exception as e:
            logger.exception("ID.me userinfo parse failed; data=%r", data)
            raise IdMeError("Verification response was malformed.") from e


# ─────────────────────────────────────────────────────────────────────
# Dev — fail-closed fallback
# ─────────────────────────────────────────────────────────────────────
class DevIdMeService(IdentityVerificationService):
    """Inert verification backend. Use whenever IDME_* env vars
    aren't set.

    build_authorize_url returns an about:blank URL with a marker so
    the frontend can detect the dev backend and render 'Verification
    isn't activated yet' instead of redirecting to a dead page.

    exchange_code_for_attributes always raises — never grant
    verification through the dev backend. The fail-closed posture
    means an accidental ship of the dev backend to prod can't grant
    forged verifications.
    """

    def is_configured(self) -> bool:
        return False

    def build_authorize_url(self, *, state_token: str) -> str:
        return (
            "about:blank?idme-dev=1&reason=idme_not_configured"
            f"&state={state_token}"
        )

    def exchange_code_for_attributes(self, *, code: str) -> VerifiedAttributes:
        raise IdMeError(
            "ID.me verification isn't activated yet (no IDME_CLIENT_ID set).",
        )


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise RuntimeError(
            f"ID.me verification requested but {name} is not set. "
            f"Set IDME_CLIENT_ID + IDME_CLIENT_SECRET + IDME_REDIRECT_URI "
            f"together — partial config breaks at runtime."
        )
    return val


# ─── Hashing helpers (used by the router) ────────────────────────────
#
# All three hashes use sha256(value + SESSION_SECRET) so a DB leak
# alone doesn't reveal the underlying PII. Same pattern as the
# password-reset tokens + verification archive's email_hash.

def _session_salt() -> str:
    """SESSION_SECRET pulled fresh on each call so tests can mutate
    it between cases. Falls back to a dev sentinel + logs the
    warning — production deployments MUST set SESSION_SECRET, so
    the warning is intentionally loud."""
    salt = os.getenv("SESSION_SECRET", "").strip()
    if not salt:
        logger.warning(
            "SESSION_SECRET unset; using dev fallback for ID.me hashes. "
            "Set SESSION_SECRET before going live or the archive lookup "
            "will silently mismatch across environments.",
        )
        salt = "civicview-dev-fallback-secret"
    return salt


def hash_email(email: str) -> str:
    """Match the format the existing VerifiedIdentityArchive.email_hash
    rows use (services/account_deletion.hash_email_for_archive).
    Lowercased + trimmed before hashing so capitalization /
    whitespace don't fragment the archive."""
    norm = (email or "").strip().lower()
    return hashlib.sha256(f"{norm}|{_session_salt()}".encode("utf-8")).hexdigest()


def hash_legal_name(name: str) -> str:
    """Normalize whitespace + casing before hashing. Internal
    spaces collapse so 'Jeff  Nuez' and 'Jeff Nuez' hash identically.
    Trim + lowercase so different casings of the same name don't
    fragment the archive."""
    norm = " ".join((name or "").strip().lower().split())
    return hashlib.sha256(f"{norm}|{_session_salt()}".encode("utf-8")).hexdigest()


def hash_address(attrs: VerifiedAttributes) -> str:
    """Compose a stable address string + hash. Strips internal
    whitespace + lowercases + uppercases the state so the same
    address with different formatting hashes the same way.

    We deliberately don't include line2 (apartment unit) — it lets
    two different units at the same building share the cost-skip
    if needed, which is a benign collision. If unit-level
    distinction matters later, add line2 here.
    """
    norm = "|".join([
        " ".join((attrs.address_line1 or "").strip().lower().split()),
        " ".join((attrs.address_city or "").strip().lower().split()),
        (attrs.address_state or "").strip().upper()[:2],
        (attrs.address_zip or "").strip()[:5],  # 5-digit ZIP — strip ZIP+4
    ])
    return hashlib.sha256(f"{norm}|{_session_salt()}".encode("utf-8")).hexdigest()


# ─── Encryption helpers (legal name at rest) ─────────────────────────
#
# Re-uses the TOTP module's Fernet derivation so we don't have a
# second key floating around. If TOTP's key rotates, the verified
# legal names rotate with it — same single SESSION_SECRET as the
# root of trust.

def encrypt_legal_name(name: str) -> str:
    """Fernet-encrypt the verified legal name for at-rest storage.
    Returns a URL-safe base64 string. Decryption requires
    SESSION_SECRET, so a DB-only leak doesn't expose the plaintext."""
    from app.services.totp_service import _fernet  # local import to avoid cycles
    token = _fernet().encrypt((name or "").encode("utf-8"))
    return token.decode("utf-8")


def decrypt_legal_name(encrypted: str) -> Optional[str]:
    """Inverse of encrypt_legal_name. Returns None on decryption
    failure (rotated key, corrupted blob, etc.) so a single bad row
    doesn't take down a whole UI render."""
    if not encrypted:
        return None
    from app.services.totp_service import _fernet
    from cryptography.fernet import InvalidToken
    try:
        return _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.warning("decrypt_legal_name: InvalidToken — was SESSION_SECRET rotated?")
        return None


# ─── State token (OAuth CSRF protection) ─────────────────────────────
#
# itsdangerous gives us a signed, time-bounded blob. We bind the
# citizen_id into the payload so the callback can refuse if the
# signed-in citizen doesn't match the citizen who initiated the
# verification.

_STATE_MAX_AGE_SECONDS = 10 * 60  # 10 minutes


def mint_state_token(citizen_id: int) -> str:
    """Return a signed state token to embed in the ID.me authorize
    URL. Includes a nonce so two consecutive verifications for the
    same citizen produce different tokens (defense against replay)."""
    import secrets
    from itsdangerous import URLSafeTimedSerializer
    serializer = URLSafeTimedSerializer(
        os.getenv("SESSION_SECRET", "civicview-dev-fallback-secret"),
        salt="cl-idme-state-v1",
    )
    return serializer.dumps({
        "citizen_id": citizen_id,
        "nonce": secrets.token_urlsafe(16),
    })


def verify_state_token(token: str) -> Optional[int]:
    """Validate the state token returned by ID.me and extract the
    citizen_id. Returns None on signature failure or expiry."""
    from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
    serializer = URLSafeTimedSerializer(
        os.getenv("SESSION_SECRET", "civicview-dev-fallback-secret"),
        salt="cl-idme-state-v1",
    )
    try:
        payload = serializer.loads(token, max_age=_STATE_MAX_AGE_SECONDS)
    except SignatureExpired:
        logger.info("ID.me state token expired")
        return None
    except BadSignature:
        logger.warning("ID.me state token has bad signature")
        return None
    cid = payload.get("citizen_id") if isinstance(payload, dict) else None
    return int(cid) if cid is not None else None


# ─────────────────────────────────────────────────────────────────────
# Factory
# ─────────────────────────────────────────────────────────────────────
_VERIFICATION_SINGLETON: Optional[IdentityVerificationService] = None


def get_verification_service() -> IdentityVerificationService:
    """Return the active verification backend. Picks IdMeService when
    the full env var set is present; falls back to DevIdMeService
    otherwise."""
    global _VERIFICATION_SINGLETON
    if _VERIFICATION_SINGLETON is not None:
        return _VERIFICATION_SINGLETON

    if _idme_env_present():
        try:
            _VERIFICATION_SINGLETON = IdMeService()
            logger.info("Verification service: ID.me backend active")
            return _VERIFICATION_SINGLETON
        except Exception:
            logger.exception(
                "ID.me env vars are set but IdMeService failed to "
                "initialize — falling back to DevIdMeService. Check the "
                "IDME_* env vars + that the redirect URI is registered "
                "with ID.me.",
            )

    _VERIFICATION_SINGLETON = DevIdMeService()
    logger.info(
        "Verification service: Dev backend active (Verify button + "
        "callback are inert until IDME_* env vars are set).",
    )
    return _VERIFICATION_SINGLETON


def reset_verification_service_for_tests() -> None:
    """Test-only hook to clear the cached singleton so env-var changes
    take effect between test cases."""
    global _VERIFICATION_SINGLETON
    _VERIFICATION_SINGLETON = None


def _idme_env_present() -> bool:
    """True iff every required ID.me env var is set + non-empty."""
    required = ("IDME_CLIENT_ID", "IDME_CLIENT_SECRET", "IDME_REDIRECT_URI")
    return all((os.getenv(name) or "").strip() for name in required)


# ─────────────────────────────────────────────────────────────────────
# Archive lookup + apply (used by the router)
# ─────────────────────────────────────────────────────────────────────
def cost_skip_match(db, *, email: str) -> Optional["VerifiedIdentityArchiveRow"]:  # noqa: F821
    """Primary cost-skip path: look up the email hash in the
    archive. Returns the row if found (caller treats this as
    'this person was previously ID.me-verified; mark verified now
    + skip the $1.50 charge'). Returns None if no match.

    The secondary path (legal_name + address cross-check) requires
    actually completing the ID.me flow — we don't know the user's
    legal name + address until ID.me tells us. Routed via
    cost_skip_match_by_attributes() after a successful exchange.
    """
    from app.models.pages import VerifiedIdentityArchive
    h = hash_email(email)
    return (
        db.query(VerifiedIdentityArchive)
        .filter(VerifiedIdentityArchive.email_hash == h)
        .first()
    )


def cost_skip_match_by_attributes(
    db, *, attrs: VerifiedAttributes,
) -> Optional["VerifiedIdentityArchiveRow"]:  # noqa: F821
    """Secondary cost-skip path: after ID.me returns the verified
    attributes, check whether the legal-name + address hashes
    match an existing archive row (left behind by a previously-
    deleted account at a different email).

    Requires BOTH legal_name AND address to match — name collisions
    exist (two "John Smith"s) so name alone isn't a strong enough
    signal to grant the skip. Returns None if no match or only one
    of the two hashes matches.
    """
    from app.models.pages import VerifiedIdentityArchive
    name_h = hash_legal_name(attrs.legal_name)
    addr_h = hash_address(attrs)
    return (
        db.query(VerifiedIdentityArchive)
        .filter(VerifiedIdentityArchive.legal_name_hash == name_h)
        .filter(VerifiedIdentityArchive.address_hash == addr_h)
        .first()
    )


def write_archive_entry(
    db, *, email: str, attrs: VerifiedAttributes, verified_at,
) -> None:
    """Write a fresh archive row tying email + legal_name + address
    hashes together. Called after a successful ID.me verification so
    a future re-signup at the same email OR a future re-signup with
    the same legal_name + address hits the cost-skip.

    Idempotent on email_hash — if a row already exists for this
    email (e.g., we're re-verifying after a re-grant), we update
    the legal_name + address hashes in case they shifted (married
    name change, moved address, etc.). Real cutover may want to
    audit this case — a same-email re-verification with a different
    name+address could be a stolen-account signal.
    """
    from app.models.pages import VerifiedIdentityArchive
    h = hash_email(email)
    row = (
        db.query(VerifiedIdentityArchive)
        .filter(VerifiedIdentityArchive.email_hash == h)
        .first()
    )
    name_h = hash_legal_name(attrs.legal_name)
    addr_h = hash_address(attrs)
    if row is None:
        row = VerifiedIdentityArchive(
            email_hash=h,
            legal_name_hash=name_h,
            address_hash=addr_h,
            verified_at=verified_at,
        )
        db.add(row)
    else:
        # Top up missing fields without overwriting a still-valid
        # verified_at (preserves the original verification date).
        row.legal_name_hash = name_h
        row.address_hash = addr_h
    db.commit()
