"""GET /api/photo-credits serves the Wikimedia Commons credits (audit P2).

Run:  cd backend && python3 tests/test_photo_credits.py   (exit 0 = pass)

  1. The endpoint returns every entry in data/photo_credits.json.
  2. Each entry names its photo URL, a Commons file page and a license.
  3. Every photo whose license requires attribution also names an author.
  4. The response is marked cacheable (it is the same for every visitor).
"""
import json
import os
import sys
import tempfile

_failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod-" + "x" * 32)
    os.environ["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.INFO)

    from fastapi.testclient import TestClient
    import app.main

    path = os.path.join(os.path.dirname(__file__), "..", "app", "data", "photo_credits.json")
    with open(path, encoding="utf-8") as f:
        on_disk = json.load(f)["credits"]

    with TestClient(app.main.app) as client:
        r = client.get("/api/photo-credits")
    check("200", r.status_code == 200, str(r.status_code))
    body = r.json()
    credits = body.get("credits", [])
    check("every entry served", len(credits) == len(on_disk), f"{len(credits)} vs {len(on_disk)}")
    check("each has url, file page, license",
          all(c.get("photo_url") and str(c.get("file_page", "")).startswith("https://commons.wikimedia.org/")
              and c.get("license") for c in credits))
    needs = [c for c in credits if c.get("attribution_required")]
    check("attribution-required photos name an author", all(c.get("author") for c in needs),
          str([c["photo_url"] for c in needs if not c.get("author")][:3]))
    check("cacheable", "public" in (r.headers.get("cache-control") or ""), str(r.headers.get("cache-control")))

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
