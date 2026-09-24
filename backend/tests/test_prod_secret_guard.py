"""Production refuses to run with a missing or public session secret, and
never logs email bodies (audit S11).

Run:  cd backend && python3 tests/test_prod_secret_guard.py   (exit 0 = pass)

Each case runs in a fresh interpreter so module-level checks re-run.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)


def run(code: str, env_over: dict) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items()
           if k not in ("SESSION_SECRET", "RENDER", "CIVICVIEW_ENV", "POSTMARK_API_TOKEN")}
    env.update(env_over)
    env.setdefault("DATABASE_URL", "sqlite:///:memory:")
    return subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env,
                          capture_output=True, text=True, timeout=120)


def main() -> int:
    failures = []

    r = run("import app.auth", {"RENDER": "true"})
    if r.returncode == 0 or "SESSION_SECRET" not in r.stderr:
        failures.append("production import without SESSION_SECRET should fail loudly")

    r = run("import app.auth", {"RENDER": "true", "SESSION_SECRET": "civicview-dev-secret-DO-NOT-USE-IN-PROD"})
    if r.returncode == 0:
        failures.append("production import with the public fallback secret should fail")

    r = run("import app.auth_citizen, app.auth_candidate; print('ok')",
            {"RENDER": "true", "SESSION_SECRET": "x" * 40})
    if r.returncode != 0 or "ok" not in r.stdout:
        failures.append(f"production with a real secret should import: {r.stderr[-300:]}")

    r = run("import app.auth; print('ok')", {})
    if r.returncode != 0:
        failures.append(f"dev without a secret should still import: {r.stderr[-300:]}")

    code = (
        "import logging, io\n"
        "buf = io.StringIO(); logging.basicConfig(level=logging.INFO, stream=buf)\n"
        "from app.services.email_service import DevEmailService\n"
        "ok = DevEmailService().send(to='a@b.c', subject='Reset', text_body='https://civicview.app/password-reset?token=SECRETTOKEN')\n"
        "out = buf.getvalue()\n"
        "print('SENT' if ok else 'NOTSENT', 'LEAK' if 'SECRETTOKEN' in out else 'CLEAN')\n"
    )
    r = run(code, {"RENDER": "true", "SESSION_SECRET": "x" * 40})
    if "NOTSENT CLEAN" not in r.stdout:
        failures.append(f"production dev-email must not send or log the body: {r.stdout} {r.stderr[-200:]}")
    r = run(code, {})
    if "SENT LEAK" not in r.stdout:
        failures.append(f"local dev-email should still print the body: {r.stdout} {r.stderr[-200:]}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("PRODUCTION SECRET AND EMAIL GUARDS HOLD.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
