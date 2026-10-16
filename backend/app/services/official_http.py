# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Polite HTTP for the official roll-call sources (2026-10-16).

Every request CivicView makes to clerk.house.gov, senate.gov and
api.congress.gov for roll-call data goes through fetch() here, so the
same manners apply everywhere:

  • One long-lived client per event loop (connections and the SSL
    context are reused; a new client per request cost tens of
    milliseconds of event-loop CPU each time).
  • A User-Agent that names CivicView and a contact address.
  • At most MAX_CONCURRENT requests in flight per host, and request
    starts at least MIN_SPACING_SECONDS apart per host (about two a
    second at most).
  • Retries on timeouts, connection errors, 429 and 5xx, waiting 2, 4
    and 8 seconds (plus a little jitter), or what Retry-After asks for.
  • Conditional GET: pass the ETag / Last-Modified from an earlier
    answer and an unchanged file comes back as 304 with no body.

The limits are per process. Two processes only overlap briefly during
a deploy, and the roll-call sync itself takes a database advisory lock
so only one of them runs it.
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

USER_AGENT = "CivicView/1.0 (+https://civicview.app; civicview@civicview.app)"
MAX_CONCURRENT = 2
MIN_SPACING_SECONDS = 0.5
RETRY_DELAYS = (2.0, 4.0, 8.0)
TIMEOUT_SECONDS = 25.0
_RETRY_STATUSES = {429, 500, 502, 503, 504}


@dataclass
class FetchResult:
    status: int  # HTTP status; 0 when no answer arrived at all
    text: Optional[str] = None
    headers: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == 200 and self.text is not None

    @property
    def not_modified(self) -> bool:
        return self.status == 304


class _HostGate:
    """Concurrency + spacing for one host, created inside the running loop."""

    def __init__(self) -> None:
        self.sem = asyncio.Semaphore(MAX_CONCURRENT)
        self.lock = asyncio.Lock()
        self.next_start = 0.0

    async def wait_turn(self) -> None:
        async with self.lock:
            now = time.monotonic()
            delay = self.next_start - now
            self.next_start = max(now, self.next_start) + MIN_SPACING_SECONDS
        if delay > 0:
            await asyncio.sleep(delay)


# Keyed by (event loop id, host): asyncio primitives belong to the loop
# that made them, and tests run several loops in one process.
_GATES: dict[tuple[int, str], _HostGate] = {}
# One long-lived client per event loop. Building an AsyncClient builds an
# SSL context, which cost 35 to 55 ms of CPU on the event loop per request
# during a backfill (review of 2026-10-16: loop-lag p99 50 ms, 4.9 ms with
# a shared context). Reused connections also mean fewer TLS handshakes
# against the official sites.
_CLIENTS: dict[int, tuple[asyncio.AbstractEventLoop, object]] = {}


def _gate(host: str) -> _HostGate:
    key = (id(asyncio.get_running_loop()), host)
    gate = _GATES.get(key)
    if gate is None:
        gate = _GATES[key] = _HostGate()
    return gate


def _client():
    import httpx

    loop = asyncio.get_running_loop()
    for key, (other, _) in list(_CLIENTS.items()):
        if other.is_closed():  # a finished loop (tests); its client died with it
            _CLIENTS.pop(key, None)
    entry = _CLIENTS.get(id(loop))
    if entry is None or entry[0] is not loop:
        client = httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4, keepalive_expiry=30.0),
        )
        entry = _CLIENTS[id(loop)] = (loop, client)
    return entry[1]


async def aclose() -> None:
    """Close this loop's client (app shutdown)."""
    entry = _CLIENTS.pop(id(asyncio.get_running_loop()), None)
    if entry is not None:
        await entry[1].aclose()


def _retry_after_seconds(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return min(max(float(value), 0.0), 120.0)
    except ValueError:
        return None


async def fetch(
    url: str,
    *,
    params: Optional[dict] = None,
    headers: Optional[dict] = None,
    etag: Optional[str] = None,
    last_modified: Optional[str] = None,
    retries: int = len(RETRY_DELAYS),
    timeout: float = TIMEOUT_SECONDS,
) -> FetchResult:
    """GET url politely. Never raises for network trouble: a request that
    fails every attempt returns FetchResult(status=0) or the last status."""
    host = urlsplit(url).hostname or ""
    gate = _gate(host)
    req_headers = {"User-Agent": USER_AGENT}
    if headers:
        req_headers.update(headers)
    if etag:
        req_headers["If-None-Match"] = etag
    if last_modified:
        req_headers["If-Modified-Since"] = last_modified

    last = FetchResult(status=0)
    for attempt in range(retries + 1):
        retry_wait: Optional[float] = None
        async with gate.sem:
            await gate.wait_turn()
            try:
                resp = await _client().get(url, params=params, headers=req_headers, timeout=timeout)
                hdrs = {k.lower(): v for k, v in resp.headers.items()}
                if resp.status_code == 200:
                    return FetchResult(200, resp.text, hdrs)
                if resp.status_code == 304:
                    return FetchResult(304, None, hdrs)
                last = FetchResult(resp.status_code, None, hdrs)
                if resp.status_code not in _RETRY_STATUSES:
                    logger.warning("official source %s answered %s", _short(url), resp.status_code)
                    return last
                retry_wait = _retry_after_seconds(hdrs.get("retry-after"))
            except Exception as exc:  # timeouts, resets, DNS: retry
                last = FetchResult(0)
                logger.info("official source %s failed (%s), attempt %d", _short(url), type(exc).__name__, attempt + 1)
        if attempt < retries:
            base = RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]
            await asyncio.sleep(retry_wait if retry_wait is not None else base + random.uniform(0, 0.5))  # nosec B311 - jitter, not security
    logger.warning("official source %s gave up after %d attempts (last status %s)", _short(url), retries + 1, last.status)
    return last


async def congress_api(url: str, params: Optional[dict] = None) -> Optional[dict]:
    """GET a Congress.gov API endpoint as JSON, or None when the key is
    unset or the call fails. The key goes in the X-Api-Key header, never
    the URL (audit S6)."""
    key = os.getenv("CONGRESS_API_KEY")
    if not key:
        return None
    p = dict(params or {})
    p.setdefault("format", "json")
    res = await fetch(url, params=p, headers={"X-Api-Key": key})
    if not res.ok:
        return None
    try:
        import json

        return await asyncio.to_thread(json.loads, res.text)
    except ValueError:
        logger.warning("congress.gov %s returned non-JSON", _short(url))
        return None


def _short(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.hostname}{parts.path}"
