# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
TOTP service — generate, encrypt, verify, and provision 6-digit
authenticator-app codes for the three account types.

Design:
  • Each enrolled account stores a single TOTP secret (160-bit base32
    string) encrypted at rest using Fernet symmetric encryption.
  • The Fernet key is derived from SESSION_SECRET via HKDF-SHA256 with
    a fixed app-specific info string, so the encryption key rotates
    in lockstep with the session secret. Rotating SESSION_SECRET
    intentionally invalidates every existing TOTP enrollment — users
    re-enroll on next login. This is the same trust model the session
    cookie itself uses, so we don't add a new secret to the
    operations burden.
  • We verify codes with pyotp's built-in 30-second-window check plus
    a single-step backwards/forwards tolerance window to absorb minor
    clock drift between the user's phone and the server. The window
    is tight enough that brute force is impractical given the 6-digit
    code space + Cloudflare's rate limiting on /api/2fa/*.
  • Provisioning URIs follow the otpauth:// standard (RFC 6238) so any
    authenticator app — Google Authenticator, Authy, 1Password,
    Microsoft Authenticator — works without app-specific tweaks.

Failure modes:
  • Missing SESSION_SECRET at import time raises immediately. The 2FA
    feature CANNOT operate without a stable encryption key. Production
    deployments must have SESSION_SECRET set (verified in
    backend/.env.example and render.yaml).
  • Decrypt failures (e.g. SESSION_SECRET was rotated between
    enrollment and verify) raise InvalidTOTPSecret. The caller should
    treat this as "user needs to re-enroll" rather than as a generic
    auth failure.
"""

from __future__ import annotations

import base64
import logging
import os
import secrets
from typing import Optional

import pyotp
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

logger = logging.getLogger(__name__)


ISSUER = "CivicView"
TOTP_DIGITS = 6
TOTP_INTERVAL = 30  # seconds — RFC 6238 standard
# Tolerance window: how many ±intervals a code is accepted in.
# valid_window=1 means the code from the previous OR next 30-second
# window also passes. This absorbs ~30s of clock drift between the
# user's phone and the server without giving an attacker meaningfully
# more attempts. 1 is the OWASP-recommended default.
TOTP_VERIFY_WINDOW = 1


class TOTPServiceUnavailable(RuntimeError):
    """Raised when SESSION_SECRET is not set at import — the encryption
    key can't be derived, so the 2FA feature can't operate."""


class InvalidTOTPSecret(ValueError):
    """Raised when a stored encrypted secret can't be decrypted (e.g.
    SESSION_SECRET rotated since enrollment). Caller should prompt the
    user to re-enroll."""


def _fernet_key() -> bytes:
    """Derive the Fernet encryption key from SESSION_SECRET via HKDF.

    HKDF gives us a deterministic 32-byte key from an arbitrary-length
    input secret. The `info` string scopes the derivation to this
    specific use (TOTP secret encryption), so even if SESSION_SECRET
    is reused for another purpose elsewhere, the keys are independent.
    """
    raw = os.getenv("SESSION_SECRET", "").strip()
    if not raw:
        raise TOTPServiceUnavailable(
            "SESSION_SECRET not set — TOTP service cannot derive encryption key. "
            "Set SESSION_SECRET in the environment before using 2FA endpoints."
        )
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"civicview-totp-fernet-v1",
        info=b"civicview-totp-secret-encryption",
    )
    derived = hkdf.derive(raw.encode("utf-8"))
    # Fernet expects a urlsafe base64-encoded 32-byte key.
    return base64.urlsafe_b64encode(derived)


# Module-level fernet instance — derived once at first use, cached.
# We don't compute at import time because tests may set SESSION_SECRET
# after the module loads.
_fernet_cache: Optional[Fernet] = None


def _fernet() -> Fernet:
    global _fernet_cache
    if _fernet_cache is None:
        _fernet_cache = Fernet(_fernet_key())
    return _fernet_cache


def reset_fernet_cache_for_tests() -> None:
    """Clear the cached Fernet instance. Test-only helper for cases
    that mutate SESSION_SECRET mid-test."""
    global _fernet_cache
    _fernet_cache = None


def generate_secret() -> str:
    """Generate a fresh 160-bit base32 TOTP secret. Pyotp accepts this
    format directly via TOTP(secret); authenticator apps accept it via
    the otpauth:// URI."""
    return pyotp.random_base32(length=32)


def encrypt_secret(secret_b32: str) -> str:
    """Encrypt a base32 TOTP secret for at-rest storage. Returns a
    Fernet token (urlsafe-base64 string) suitable for a TEXT column."""
    if not secret_b32:
        raise ValueError("Cannot encrypt empty secret")
    token = _fernet().encrypt(secret_b32.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(encrypted: str) -> str:
    """Decrypt a previously-encrypted TOTP secret. Raises
    InvalidTOTPSecret if the token is malformed or was encrypted under
    a different key (i.e. SESSION_SECRET rotated)."""
    if not encrypted:
        raise InvalidTOTPSecret("Encrypted secret is empty")
    try:
        plaintext = _fernet().decrypt(encrypted.encode("utf-8"))
    except InvalidToken as exc:
        raise InvalidTOTPSecret(
            "TOTP secret could not be decrypted — likely SESSION_SECRET "
            "was rotated. User must re-enroll in 2FA."
        ) from exc
    return plaintext.decode("utf-8")


def provisioning_uri(secret_b32: str, account_label: str) -> str:
    """Build the otpauth:// URI an authenticator app scans from a QR
    code. The `account_label` becomes the human-readable label inside
    the app (e.g. "Jeffrey (CivicView Rep)"). Convention: include both
    the email and the account-type so the user can tell their three
    CivicView identities apart in one app."""
    return pyotp.TOTP(secret_b32, digits=TOTP_DIGITS, interval=TOTP_INTERVAL).provisioning_uri(
        name=account_label,
        issuer_name=ISSUER,
    )


def verify_code(secret_b32: str, code: str) -> bool:
    """Verify a 6-digit code against a base32 secret.

    Accepts the current 30-second window plus ±TOTP_VERIFY_WINDOW
    adjacent windows to tolerate clock drift. Returns True iff the
    code matches.

    Defensive: strips whitespace and rejects anything that isn't
    exactly 6 digits before hitting pyotp (so a malformed input
    doesn't accidentally match due to library quirks)."""
    if not secret_b32 or not code:
        return False
    cleaned = code.strip().replace(" ", "").replace("-", "")
    if len(cleaned) != TOTP_DIGITS or not cleaned.isdigit():
        return False
    totp = pyotp.TOTP(secret_b32, digits=TOTP_DIGITS, interval=TOTP_INTERVAL)
    return totp.verify(cleaned, valid_window=TOTP_VERIFY_WINDOW)


def generate_recovery_code() -> str:
    """Generate one cryptographically-strong recovery code.

    Format: 10 chars from a confusion-resistant alphabet (no 0/O, 1/I,
    etc.), grouped as XXXXX-XXXXX for readability. Users see codes in
    this format on the enrollment screen + can paste them back during
    recovery. We hash before storing — see recovery_codes_service.
    """
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    half = "".join(secrets.choice(alphabet) for _ in range(5))
    half2 = "".join(secrets.choice(alphabet) for _ in range(5))
    return f"{half}-{half2}"
