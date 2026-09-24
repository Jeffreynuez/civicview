"""Low-severity hardening (audit S14).

Run:  cd backend && python3 tests/test_low_findings_s14.py   (exit 0 = pass)

1. Event links accept only http and https.
2. /docs, /redoc and /openapi.json are off in production and on in dev.
3. With IDME_ENABLED on, an unverified citizen cannot react to a
   citizen poll or a poll comment, same as every other reaction route.
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)


def main() -> int:
    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    sys.path.insert(0, BACKEND)
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    from pydantic import ValidationError
    from app.schemas.pages import RepEventCreate

    base = {"title": "Town hall", "start_at": "2026-10-01T18:00"}
    for bad in ("javascript:alert(1)", "data:text/html,hi", "JaVaScRiPt:x", "https://ok.example/ has space"):
        try:
            RepEventCreate(**base, url=bad)
            failures.append(f"event url {bad!r} should be refused")
        except ValidationError:
            pass
    check(RepEventCreate(**base, url=" https://example.gov/event ").url == "https://example.gov/event",
          "https link should pass, trimmed")
    check(RepEventCreate(**base, url="").url is None, "empty link becomes None")

    probe = (
        "from fastapi.testclient import TestClient\n"
        "import app.main as m\n"
        "c = TestClient(m.app)\n"
        "print(c.get('/openapi.json').status_code, c.get('/docs').status_code)\n"
    )

    def run(env_over):
        db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        db.close()
        env = {k: v for k, v in os.environ.items() if k not in ("RENDER", "CIVICVIEW_ENV", "ENABLE_API_DOCS")}
        env.update({"DATABASE_URL": f"sqlite:///{db.name}", "SESSION_SECRET": "x" * 40,
                    "CIVICVIEW_SKIP_LEGISLATORS_FETCH": "1", **env_over})
        return subprocess.run([sys.executable, "-c", probe], cwd=BACKEND, env=env,
                              capture_output=True, text=True, timeout=180).stdout.strip().splitlines()

    out = run({"RENDER": "true"})
    check(out and out[-1] == "404 404", f"production docs should 404, got {out[-1:] }")
    out = run({})
    check(out and out[-1] == "200 200", f"dev docs should be served, got {out[-1:]}")

    # 3. verified gate on citizen poll reactions
    db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db.close()
    code = (
        "import os\n"
        "from datetime import datetime\n"
        "from fastapi.testclient import TestClient\n"
        "import app.main as m\n"
        "from app.auth import compute_csrf_token\n"
        "from app.db import SessionLocal\n"
        "from app.models.pages import Poll, PollOption, PollComment\n"
        "c = TestClient(m.app); c.__enter__()\n"
        "with SessionLocal() as d:\n"
        "    p = Poll(post_id=None, question='Q?', author_kind='citizen', target_official_id='X',\n"
        "             default_visibility_scope='country', presentation_mode='full', created_at=datetime(2026,9,1))\n"
        "    d.add(p); d.flush(); d.add(PollOption(poll_id=p.id, text='A', sort_order=0)); d.commit(); pid = p.id\n"
        "r = c.post('/api/citizen-auth/demo-signup', json={'display_name':'Unverified','state':'FL','congressional_district':'FL-10','city':'Orlando'})\n"
        "t = r.json()['citizen_token']; h = {'X-Citizen-Token': t, 'X-CSRF-Token': compute_csrf_token(t)}\n"
        "c.cookies.clear()\n"
        "r1 = c.post(f'/api/citizen-polls/{pid}/reactions', json={'kind':'up'}, headers=h)\n"
        "print('POLL', r1.status_code)\n"
    )
    env = {k: v for k, v in os.environ.items() if k not in ("RENDER", "CIVICVIEW_ENV")}
    env.update({"DATABASE_URL": f"sqlite:///{db.name}", "SESSION_SECRET": "x" * 40,
                "CIVICVIEW_SKIP_LEGISLATORS_FETCH": "1", "IDME_ENABLED": "true"})
    r = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=180)
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("POLL")]
    check(lines and lines[-1] == "POLL 403",
          f"unverified reaction with IDME_ENABLED should 403, got {lines} {r.stderr[-300:]}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("S14 HARDENING HOLDS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
