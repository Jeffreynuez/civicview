# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Keep API keys and home addresses out of the logs (audit S6).

Two leaks, two fixes:

1. httpx logs every outbound request at INFO with the full URL. Several
   upstream APIs took the key as a query parameter, and Google Civic
   and the Census geocoder take the user's street address the same
   way. The httpx and httpcore loggers now log at WARNING only, and the
   keys moved to request headers.

2. Anything that still prints a URL (uvicorn's access log for our own
   /api/address/lookup?address=..., an exception message that quotes a
   request URL) passes through RedactingFilter, which masks the values
   of sensitive query parameters before the record is written.

install() is idempotent and is called once from app.main right after
logging is configured.
"""
from __future__ import annotations

import logging
import re

# Query parameters whose values never belong in a log line.
_SENSITIVE_PARAMS = (
    "api_key", "apikey", "key", "token", "access_token", "password",
    "address", "street", "zip", "zipcode", "lat", "lon", "lng",
    "latitude", "longitude", "email",
)
_PARAM_RE = re.compile(
    r"(?i)([?&](?:" + "|".join(_SENSITIVE_PARAMS) + r")=)[^&\s\"'#]*"
)
# Header-style secrets that sometimes end up in exception text.
_HEADER_RE = re.compile(r"(?i)((?:x-api-key|x-goog-api-key|authorization)['\"]?\s*[:=]\s*['\"]?)[^'\"\s,}]+")

REDACTED = "[redacted]"


def redact(text: str) -> str:
    if not text:
        return text
    text = _PARAM_RE.sub(lambda m: m.group(1) + REDACTED, text)
    return _HEADER_RE.sub(lambda m: m.group(1) + REDACTED, text)


class RedactingFilter(logging.Filter):
    """Rewrites a record's final message with sensitive values masked.

    The message is rendered once (msg % args), redacted, and stored back
    with empty args, so every handler downstream sees the clean text."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            rendered = record.getMessage()
        except Exception:  # noqa: BLE001 - a bad format string is not ours to fix here
            return True
        clean = redact(rendered)
        if clean != rendered:
            record.msg = clean
            record.args = ()
        return True


_installed = False


def install() -> None:
    global _installed
    if _installed:
        return
    _installed = True

    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)

    flt = RedactingFilter()
    # Handler-level on the root logger covers every logger that
    # propagates (all of app.*). uvicorn's loggers keep their own
    # handlers and do not propagate, so they get the filter directly.
    for handler in logging.getLogger().handlers:
        handler.addFilter(flt)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.addFilter(flt)
        for handler in lg.handlers:
            handler.addFilter(flt)
