"""Public stats count only real verifications (2026-10-03).

Run:  cd backend && python3 tests/test_stats_verified_honest.py   (exit 0 = pass)

Before: "verified citizens" counted every verified=True row, so the
operator's admin account (verified set by hand, no method) showed on the
public /stats page as "1 verified citizen" before ID.me was live, and
the detail page's demo tile was "total minus verified".

Now both endpoints use the is_verified_person rule (verified=True and a
method other than empty or 'demo'), and the demo tile counts the
unverified signups directly.
"""
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
    import app.routers.stats as stats_router
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            for i, (verified, method) in enumerate([
                (False, "demo"),    # demo signup
                (False, None),      # older demo signup
                (True, None),       # operator account, flag set by hand
                (True, "demo"),     # a demo grant never counts
                (True, "id.me"),    # the only real verification here
            ]):
                db.add(CitizenAccount(
                    email=f"c{i}@example.com", password_hash="x", display_name=f"C{i}",
                    city="Orlando", state="FL", verified=verified, verified_method=method, is_active=True,
                ))
            db.commit()

        summary = c.get("/api/stats/summary").json()
        check(summary.get("verified_citizens") == 1, f"summary verified: {summary.get('verified_citizens')!r}")
        check(summary.get("demo_accounts_created") == 2, f"summary demo: {summary.get('demo_accounts_created')!r}")

        stats_router._detail_cache.update({"at": 0.0, "payload": None, "failed_at": None})
        detail = c.get("/api/stats/detail").json()
        check(detail.get("citizens_total") == 5, f"detail total: {detail.get('citizens_total')!r}")
        check(detail.get("citizens_verified") == 1, f"detail verified: {detail.get('citizens_verified')!r}")
        check(detail.get("citizens_demo") == 2,
              f"detail demo counts unverified signups, not total minus verified: {detail.get('citizens_demo')!r}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: honest verified count")
    return 0


if __name__ == "__main__":
    sys.exit(main())
