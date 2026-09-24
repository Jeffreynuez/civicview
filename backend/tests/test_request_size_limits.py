"""Request body caps (audit S12).

Run:  cd backend && python3 tests/test_request_size_limits.py   (exit 0 = pass)

1. A declared body over 1 MB gets 413 before it is read.
2. A streamed (chunked) body over 1 MB gets 413 while it is read.
3. A tracked-item snapshot over 32 KB gets 422; a normal one is stored.
"""
import json
import os
import sys
import tempfile


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        r = c.post("/api/citizen-auth/demo-signup", json={
            "display_name": "Size Tester", "state": "FL",
            "congressional_district": "FL-10", "city": "Orlando",
        })
        assert r.status_code == 201, r.text
        tok = r.json()["citizen_token"]
        h = {"X-Citizen-Token": tok, "X-CSRF-Token": compute_csrf_token(tok),
             "Content-Type": "application/json"}

        big = json.dumps({"bill_key": "119-hr-1", "snapshot": {"blob": "x" * (5 * 1024 * 1024)}})
        c.cookies.clear()
        r = c.post("/api/tracked/bills", content=big, headers=h)
        check(r.status_code == 413, f"5 MB declared body should 413, got {r.status_code}")

        def chunks():
            piece = b"x" * (256 * 1024)
            yield b'{"bill_key": "119-hr-2", "snapshot": {"blob": "'
            for _ in range(6):
                yield piece
            yield b'"}}'

        c.cookies.clear()
        r = c.post("/api/tracked/bills", content=chunks(), headers=h)
        check(r.status_code == 413, f"streamed 1.5 MB body should 413, got {r.status_code}")

        c.cookies.clear()
        r = c.post("/api/tracked/bills", json={"bill_key": "119-hr-3", "snapshot": {"blob": "x" * 40000}},
                   headers=h)
        check(r.status_code == 422, f"40 KB snapshot should 422, got {r.status_code}")

        c.cookies.clear()
        r = c.post("/api/tracked/bills", json={"bill_key": "119-hr-4", "snapshot": {"title": "A normal bill"}},
                   headers=h)
        check(r.status_code == 200, f"normal snapshot should store, got {r.status_code} {r.text[:120]}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("REQUEST SIZE LIMITS HOLD.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
