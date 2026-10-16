"""The site-wide notice comes from env vars and is off when unset (2026-10-16).

Run:  cd backend && python3 tests/test_site_notice.py   (exit 0 = pass)

The privacy policy and the Terms promise "a notice on CivicView" at
least 30 days before a material change, and there was no way to post
one. GET /api/app/notice now returns SITE_NOTICE_TEXT and an optional
SITE_NOTICE_URL for the banner (components/SiteNoticeBanner.js):
1. unset text means no notice, even with a URL set;
2. the text comes back with its whitespace collapsed, capped in length;
3. the link is kept only when it is a web address or a path on the
   site; a javascript: link, a protocol-relative //host link or text
   with spaces is dropped and the notice shows without one;
4. the answer may be cached for a minute only, so taking a notice
   down is quick.
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
    os.environ.pop("SITE_NOTICE_TEXT", None)
    os.environ.pop("SITE_NOTICE_URL", None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.routers.app_meta import SITE_NOTICE_MAX_CHARS

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    def notice(text=None, url=None):
        for key, value in (("SITE_NOTICE_TEXT", text), ("SITE_NOTICE_URL", url)):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        r = c.get("/api/app/notice")
        check(r.status_code == 200, f"status {r.status_code}")
        return r

    with TestClient(m.app) as c:
        # 1. off when unset, or blank, even with a URL
        for text in (None, "", "   "):
            body = notice(text, "/privacy").json()
            check(body == {"text": None, "url": None}, f"text={text!r}: expected no notice, got {body}")

        # 2. on, with the link
        r = notice("  We're updating our privacy policy\non November 16, 2026.  ", "/privacy")
        body = r.json()
        check(body.get("text") == "We're updating our privacy policy on November 16, 2026.",
              f"text should be trimmed and collapsed: {body.get('text')!r}")
        check(body.get("url") == "/privacy", f"site path kept: {body.get('url')!r}")
        check("max-age=60" in r.headers.get("cache-control", ""), f"cache header: {r.headers.get('cache-control')}")

        body = notice("x" * (SITE_NOTICE_MAX_CHARS + 50)).json()
        check(len(body.get("text") or "") == SITE_NOTICE_MAX_CHARS, "text is capped")
        check(body.get("url") is None, "no URL set means no link")

        # 3. links
        for url, want in (
            ("https://civicview.app/privacy", "https://civicview.app/privacy"),
            ("HTTP://example.org/x", "HTTP://example.org/x"),
            ("/terms#changes", "/terms#changes"),
            ("javascript:alert(1)", None),
            ("//evil.example/x", None),
            ("privacy", None),
            ("https://civicview.app/a b", None),
        ):
            body = notice("Policy update", url).json()
            check(body.get("text") == "Policy update", f"{url!r}: the notice still shows")
            check(body.get("url") == want, f"{url!r}: url {body.get('url')!r}, want {want!r}")

    os.environ.pop("SITE_NOTICE_TEXT", None)
    os.environ.pop("SITE_NOTICE_URL", None)
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: site notice from env vars, off when unset")
    return 0


if __name__ == "__main__":
    sys.exit(main())
