# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Boot the API the way Render does and check it answers (audit O1).

Usage, from backend/, with a Postgres database you can throw away:

    DATABASE_URL=postgres://user:pass@localhost:5432/civicview_test python scripts/smoke_boot.py

(On Windows, set DATABASE_URL first: in PowerShell,
$env:DATABASE_URL = "postgres://..." then python scripts/smoke_boot.py.)

It starts uvicorn in production mode (RENDER=true, a random
SESSION_SECRET, the same postgres:// URL shape Render provides), waits
for /healthz, checks a handful of public endpoints and the production
switches, stops the server, then boots a second time against the now
populated database to prove a restart is clean. Exit 0 means pass.

CI runs this against a fresh PostgreSQL service container on every pull
request. It never touches a real database unless you point it at one,
so do not.
"""
from __future__ import annotations

import os
import secrets
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parent.parent
BOOT_TIMEOUT_SECONDS = 120

# (method, path, expected status) checked on every boot.
CHECKS = [
    ("GET", "/healthz", 200),
    ("GET", "/", 200),
    ("GET", "/api/stats/summary", 200),
    ("GET", "/api/elections/fl", 200),
    ("GET", "/api/feed/polls", 200),
    ("GET", "/api/feed/posts", 200),
    # Production switches.
    ("GET", "/docs", 404),
    ("GET", "/openapi.json", 404),
    ("POST", "/api/sessions/sign-out-everywhere", 401),
]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _boot(label: str, env: dict) -> list[str]:
    port = _free_port()
    base = f"http://127.0.0.1:{port}"
    log_path = BACKEND_DIR / f".smoke_boot_{label}.log"
    failures: list[str] = []
    with open(log_path, "w") as log:
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app",
             "--host", "127.0.0.1", "--port", str(port)],
            cwd=BACKEND_DIR, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.time() + BOOT_TIMEOUT_SECONDS
            ready = False
            while time.time() < deadline:
                if proc.poll() is not None:
                    failures.append(f"{label}: server exited during startup (status {proc.returncode})")
                    break
                try:
                    if httpx.get(base + "/healthz", timeout=5).status_code == 200:
                        ready = True
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(1)
            if ready:
                for method, path, want in CHECKS:
                    try:
                        got = httpx.request(method, base + path, timeout=30).status_code
                    except httpx.HTTPError as e:
                        got = f"error {type(e).__name__}"
                    ok = got == want
                    print(f"{'PASS' if ok else 'FAIL'} {label}: {method} {path} -> {got} (want {want})")
                    if not ok:
                        failures.append(f"{label}: {method} {path} returned {got}, want {want}")
            elif not failures:
                failures.append(f"{label}: /healthz never returned 200 within {BOOT_TIMEOUT_SECONDS}s")
        finally:
            if proc.poll() is None:
                # SIGINT gives uvicorn a clean shutdown; Windows has no
                # SIGINT for a child process, so terminate there.
                if os.name == "nt":
                    proc.terminate()
                else:
                    proc.send_signal(signal.SIGINT)
                try:
                    proc.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    proc.kill()
    text = log_path.read_text(errors="replace")
    for marker in ("Auto-migrate FAILED", "Traceback (most recent call last)"):
        if marker in text:
            failures.append(f"{label}: server log contains '{marker}'")
    if failures:
        print(f"----- {label} server log (last 80 lines) -----")
        print("\n".join(text.splitlines()[-80:]))
    log_path.unlink(missing_ok=True)
    return failures


def main() -> int:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url.startswith(("postgres://", "postgresql://", "postgresql+")):
        print("Set DATABASE_URL to a throwaway Postgres database first.")
        return 2
    env = dict(os.environ)
    env.update({
        "RENDER": "true",
        "SESSION_SECRET": env.get("SESSION_SECRET") or secrets.token_urlsafe(48),
        "CIVICVIEW_SKIP_LEGISLATORS_FETCH": "1",
        "PYTHONUNBUFFERED": "1",
    })
    env.pop("CIVICVIEW_ENV", None)
    env.pop("ENABLE_API_DOCS", None)

    failures = _boot("first-boot", env) + _boot("restart", env)
    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print("  " + f)
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
