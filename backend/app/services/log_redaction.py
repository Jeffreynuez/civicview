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

Email addresses (2026-10-16): code that logs an address passes it
through mask_email(), which keeps the first letter and the domain
(j***@example.org). As a backstop, RedactingFilter masks any address
still in a message, its arguments or its traceback (Postmark's error
text can quote the recipient), and the browser's voter_token query
parameter is masked like the other tokens.

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
    "latitude", "longitude", "email", "q", "onelineaddress",
    "voter_token",
)
_PARAM_RE = re.compile(
    r"(?i)([?&](?:" + "|".join(_SENSITIVE_PARAMS) + r")=)[^&\s\"'#]*"
)
# Header-style secrets that sometimes end up in exception text.
_HEADER_RE = re.compile(r"(?i)((?:x-api-key|x-goog-api-key|authorization)['\"]?\s*[:=]\s*['\"]?)[^'\"\s,}]+")

# An email address anywhere in free text. The local part must start with
# a letter or digit, so an already masked "j***@example.org" is left as
# it is.
_EMAIL_RE = re.compile(r"(?i)\b([a-z0-9])[a-z0-9._%+\-]*@((?:[a-z0-9\-]+\.)+[a-z]{2,})\b")

REDACTED = "[redacted]"


def mask_email(address) -> str:
    """The form an email address takes in a log line: its first letter
    and its domain, like j***@example.org. Never the whole address."""
    text = str(address or "").strip()
    if not text:
        return "(none)"
    local, at, domain = text.rpartition("@")
    if not at or not local or not domain:
        return "***"
    return f"{local[0]}***@{domain.lower()}"


def redact(text: str) -> str:
    if not text:
        return text
    text = _PARAM_RE.sub(lambda m: m.group(1) + REDACTED, text)
    text = _HEADER_RE.sub(lambda m: m.group(1) + REDACTED, text)
    return _EMAIL_RE.sub(lambda m: f"{m.group(1)}***@{m.group(2).lower()}", text)


class RedactingFilter(logging.Filter):
    """Masks sensitive values in a record before any handler formats it.

    The args are redacted one by one, in place, and the arg count and
    types are kept. Some formatters need them: uvicorn's access
    formatter unpacks exactly five args, so flattening the message into
    msg with empty args made it raise and drop the line. A record with
    no args has its msg redacted directly."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.args, tuple) and record.args:
                record.args = tuple(redact(a) if isinstance(a, str) else a for a in record.args)
            elif isinstance(record.args, dict) and record.args:
                record.args = {k: (redact(v) if isinstance(v, str) else v) for k, v in record.args.items()}
            if isinstance(record.msg, str):
                record.msg = redact(record.msg)
            # The traceback is formatted here, once, so its text can be
            # redacted too; formatters reuse exc_text when it is set.
            if record.exc_info and not record.exc_text:
                record.exc_text = redact(_TRACEBACK_FORMATTER.formatException(record.exc_info))
        except Exception:  # noqa: BLE001 - never let redaction break logging
            pass
        return True


_TRACEBACK_FORMATTER = logging.Formatter()


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
