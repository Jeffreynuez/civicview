# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Shared in-process sliding-window rate limiter (Task #101).

One mechanism for every rate-limited surface:

  • Engagement writes — enforced centrally by
    app/middleware/rate_limit.py (comments / reactions / votes /
    reports + poll/post creation), keyed by session token.
  • Demo signups — routers/auth_citizen.py delegates here, keyed by
    client IP (5 / 24h, unchanged from the original inline limiter).

Deployment reality check: this is process-local memory. The backend
runs as a single Render web service worker today, so one process sees
all traffic and the limits are exact. If we ever scale to N workers,
each holds its own window — effective limits become up to N× looser,
which still blocks scripted abuse (the thing this exists for). Move
to Redis/Postgres-backed buckets only if/when that matters.

Why not a third-party lib (slowapi etc.): the need is ~40 lines, the
deque approach is exact (true sliding window, not fixed buckets), and
zero new dependencies keeps the Render image lean.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Optional

from fastapi import HTTPException, status

# bucket key -> deque of monotonic timestamps (oldest first)
_buckets: dict[str, deque] = {}
_lock = threading.Lock()

# Defensive cap so a scripted key-spray (e.g. rotating fake tokens)
# can't grow the dict unbounded. When exceeded, fully-expired buckets
# are dropped; live ones are kept.
_MAX_BUCKETS = 50_000


def check_rate_limit(
    scope: str,
    key: str,
    limit: int,
    window_secs: float,
    detail: Optional[str] = None,
) -> None:
    """Record a hit for (scope, key) and raise 429 once `limit` hits
    land inside the trailing `window_secs` window.

    The hit is only recorded when allowed — a blocked caller doesn't
    extend their own lockout by retrying (friendlier for humans who
    just wait out the window; scripts gain nothing either way)."""
    now = time.monotonic()
    bucket_key = f"{scope}:{key}"
    with _lock:
        if len(_buckets) > _MAX_BUCKETS:
            _prune_locked(now)
        dq = _buckets.get(bucket_key)
        if dq is None:
            dq = deque()
            _buckets[bucket_key] = dq
        cutoff = now - window_secs
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= limit:
            retry_after = max(int(dq[0] - cutoff) + 1, 1)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=detail
                or "You\u2019re doing that too fast \u2014 wait a moment and try again.",
                headers={"Retry-After": str(retry_after)},
            )
        dq.append(now)


def _prune_locked(now: float) -> None:
    """Drop buckets whose newest hit is older than any plausible window
    (24h covers the demo-signup window, our longest). Caller holds _lock."""
    stale_before = now - 24 * 60 * 60
    for k in [k for k, dq in _buckets.items() if not dq or dq[-1] < stale_before]:
        del _buckets[k]


def reset_all() -> None:
    """Test hook — clear every bucket."""
    with _lock:
        _buckets.clear()
