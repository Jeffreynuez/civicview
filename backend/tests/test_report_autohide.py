"""Auto-hide counts only trusted reports; client IP cannot be spoofed.

Run:  cd backend && python3 tests/test_report_autohide.py   (exit 0 = pass)

Guards the 2026-09-24 fix for a reproduced abuse path: five free demo
accounts could report any post and hide it, and the per-IP demo-signup
limit could be dodged by sending a fake X-Forwarded-For header.
  1. Five demo-citizen reports: report_count is 5, the post stays up.
  2. Five verified (non-demo) citizen reports: the post is auto-hidden.
  3. client_ip ignores a caller-supplied X-Forwarded-For prefix.
  4. client_ip trusts CF-Connecting-IP only behind a Cloudflare edge.
"""
import os
import sys
import tempfile


def _bootstrap_env():
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ["REPORT_AUTO_HIDE_THRESHOLD"] = "5"


class _Req:
    def __init__(self, peer, headers):
        self.client = type("C", (), {"host": peer})()
        self.headers = {k.lower(): v for k, v in headers.items()}


def main() -> int:
    _bootstrap_env()
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.INFO)

    import app.main
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, Post, PostReport
    from app.services.moderation import record_report
    from app.services.client_ip import client_ip

    tc = TestClient(app.main.app)
    tc.__enter__()
    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    db = SessionLocal()

    def make_citizen(i, method):
        c = CitizenAccount(
            email=f"r{method}{i}@example.test", password_hash="x",
            display_name=f"Reporter {method} {i}", state="FL", city="Orlando",
            congressional_district="FL-10",
            verified=(method != "demo"), verified_method=method,
        )
        db.add(c)
        db.flush()
        return c

    def report(post, citizen):
        db.add(PostReport(post_id=post.id, reporter_citizen_id=citizen.id, reason="spam"))
        record_report(db, post, kind="post")
        db.commit()
        db.refresh(post)

    post = Post(official_id="bd-fl-19", body="A post five demo accounts dislike.")
    db.add(post)
    db.commit()
    db.refresh(post)
    for i in range(5):
        report(post, make_citizen(i, "demo"))
    check(post.report_count == 5, f"all demo reports are counted for the queue (got {post.report_count})")
    check(post.deleted_at is None, "five demo reports must NOT hide the post")

    post2 = Post(official_id="bd-fl-19", body="A post five verified citizens report.")
    db.add(post2)
    db.commit()
    db.refresh(post2)
    for i in range(5):
        report(post2, make_citizen(i, "idme"))
    check(post2.deleted_at is not None, "five verified reports DO hide the post")
    check(getattr(post2, "hide_reason", None) == "auto_hidden", "hide_reason is auto_hidden")

    # client_ip: spoofed prefix ignored, last hop used
    r = _Req("10.0.0.1", {"X-Forwarded-For": "1.2.3.4, 203.0.113.9"})
    check(client_ip(r) == "203.0.113.9", f"spoofed XFF prefix ignored (got {client_ip(r)})")
    # behind a Cloudflare edge, CF-Connecting-IP is the client
    r = _Req("10.0.0.1", {"X-Forwarded-For": "1.2.3.4, 198.51.100.7, 172.64.1.1",
                          "CF-Connecting-IP": "198.51.100.7"})
    check(client_ip(r) == "198.51.100.7", f"CF-Connecting-IP trusted behind Cloudflare (got {client_ip(r)})")
    # not behind Cloudflare: a CF-Connecting-IP header is forged and ignored
    r = _Req("10.0.0.1", {"X-Forwarded-For": "203.0.113.50", "CF-Connecting-IP": "1.1.1.1"})
    check(client_ip(r) == "203.0.113.50", f"forged CF-Connecting-IP ignored (got {client_ip(r)})")
    r = _Req("127.0.0.1", {})
    check(client_ip(r) == "127.0.0.1", "no proxy headers -> socket peer")

    db.close()
    tc.__exit__(None, None, None)
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ALL REPORT AUTO-HIDE CHECKS PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
