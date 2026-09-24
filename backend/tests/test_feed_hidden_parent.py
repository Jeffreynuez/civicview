"""Polls inside a hidden or deleted post never reach the public feeds.

Run:  cd backend && python3 tests/test_feed_hidden_parent.py   (exit 0 = pass)

Audit finding B2: hiding or deleting a post sets only post.deleted_at,
and /api/feed/polls and /api/feed/popular-polls filtered only on
Poll.archived_at, so the hidden post's poll stayed public.
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
    logging.disable(logging.INFO)
    from datetime import datetime, timezone

    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import Poll, PollOption, Post

    failures = []
    with TestClient(m.app) as c:
        db = SessionLocal()
        ids = {}
        for label in ("visible", "hidden"):
            post = Post(official_id="bd-fl-19", body=f"{label} post with a poll")
            db.add(post)
            db.flush()
            poll = Poll(post_id=post.id, question=f"{label} poll question?", author_kind="rep")
            db.add(poll)
            db.flush()
            for t in ("Yes", "No"):
                db.add(PollOption(poll_id=poll.id, text=t))
            ids[label] = (post.id, poll.id)
        db.commit()
        hidden_post = db.get(Post, ids["hidden"][0])
        hidden_post.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        hidden_post.hide_reason = "admin_hidden"
        db.commit()
        db.close()

        for path in ("/api/feed/polls?limit=50", "/api/feed/popular-polls?limit=30"):
            r = c.get(path)
            if r.status_code != 200:
                failures.append(f"{path} -> {r.status_code} {r.text[:120]}")
                continue
            text = r.text
            if "hidden poll question?" in text:
                failures.append(f"{path} still shows the poll of a hidden post")
            if "visible poll question?" not in text:
                failures.append(f"{path} lost the visible poll")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("HIDDEN-PARENT POLLS STAY HIDDEN.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
