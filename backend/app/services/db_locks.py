# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Cross-instance job locks (2026-10-16).

During a deploy Render runs the old and the new instance side by side
for a while, so a background job started by each would run twice.
AdvisoryLock makes the second one step aside:

  • Postgres: a session-level pg_try_advisory_lock on its own
    connection (outside the app's pool), held until release() or until
    that connection closes, which also frees it if the process dies.
  • SQLite (tests and local development, a single process): a plain
    in-process lock with the same interface.

try_acquire() never waits: it returns False when someone else holds it.
"""
from __future__ import annotations

import hashlib
import logging
import threading
from typing import Optional

from sqlalchemy import text

logger = logging.getLogger(__name__)

_LOCAL_LOCKS: dict[str, threading.Lock] = {}
_LOCAL_GUARD = threading.Lock()


def lock_key(name: str) -> int:
    """A stable signed 64-bit key for pg_advisory_lock, from the lock's name."""
    return int.from_bytes(hashlib.sha256(name.encode("utf-8")).digest()[:8], "big", signed=True)


class AdvisoryLock:
    def __init__(self, name: str, engine=None) -> None:
        from app import db as _db

        self.name = name
        self.key = lock_key(name)
        self._engine = engine
        self._is_sqlite = (engine.url.get_backend_name() == "sqlite") if engine is not None else _db._is_sqlite()
        self._conn = None
        self._owned_engine = None
        self._local: Optional[threading.Lock] = None

    def try_acquire(self) -> bool:
        if self._is_sqlite:
            with _LOCAL_GUARD:
                lock = _LOCAL_LOCKS.setdefault(self.name, threading.Lock())
            if lock.acquire(blocking=False):
                self._local = lock
                return True
            return False
        from app.db import make_isolated_engine

        engine = self._engine
        if engine is None:
            engine = self._owned_engine = make_isolated_engine(statement_timeout_ms=10000)
        conn = engine.connect()
        try:
            got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": self.key}).scalar())
            conn.commit()
        except Exception:
            conn.close()
            raise
        if not got:
            conn.close()
            self._dispose()
            return False
        self._conn = conn
        return True

    def release(self) -> None:
        if self._local is not None:
            self._local.release()
            self._local = None
            return
        if self._conn is None:
            return
        try:
            self._conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": self.key})
            self._conn.commit()
        except Exception:
            logger.warning("advisory unlock for %s failed; closing the connection frees it", self.name)
        finally:
            self._conn.close()
            self._conn = None
            self._dispose()

    def _dispose(self) -> None:
        if self._owned_engine is not None:
            self._owned_engine.dispose()
            self._owned_engine = None
