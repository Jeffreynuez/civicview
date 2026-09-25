# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Run every backend test script under pytest, one process per script.

See backend/pytest.ini for why the scripts are not collected directly.
A new tests/test_*.py file is picked up automatically; it only has to
exit with status 0 when it passes and non-zero when it fails.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = TESTS_DIR.parent
SCRIPTS = sorted(TESTS_DIR.glob("test_*.py"))
# Generous ceiling: the slowest script (auth throttles, bcrypt) takes
# well under a minute on a laptop.
TIMEOUT_SECONDS = 300


def _env() -> dict:
    env = dict(os.environ)
    # Never reach out to the network for the legislators roster during
    # tests; the scripts use the bundled data.
    env["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    # A test must never think it is running in production.
    env.pop("RENDER", None)
    env.pop("CIVICVIEW_ENV", None)
    env.setdefault("PYTHONUNBUFFERED", "1")
    return env


def test_scripts_found():
    assert SCRIPTS, "no tests/test_*.py scripts found"


@pytest.mark.parametrize("script", SCRIPTS, ids=[p.stem for p in SCRIPTS])
def test_script(script: Path):
    proc = subprocess.run(
        [sys.executable, str(script)],
        cwd=BACKEND_DIR,
        env=_env(),
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        tail = (proc.stdout + "\n" + proc.stderr).strip().splitlines()[-60:]
        pytest.fail(
            f"{script.name} exited with status {proc.returncode}\n" + "\n".join(tail),
            pytrace=False,
        )
