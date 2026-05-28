# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Integration test for the Saved-items feature (Task #16).

Guards:
  1.  POST /api/saved saves a poll/post (verified-citizen gated) and is
      idempotent (re-saving doesn't duplicate).
  2.  viewer.is_saved surfaces True on /api/feed/polls + /api/feed/posts
      for the saving citizen, and False for everyone else / unsaved.
  3.  GET /api/saved lists refs keyset-paginated, newest-saved first.
  4.  /api/feed/{polls,posts}?ids= returns the specific saved cards live.
  5.  DELETE /api/saved/{type}/{id} unsaves; is_saved flips back to False.
  6.  Dangling saves (target archived/deleted) are skipped in the list.
  7.  Saving a nonexistent item 404s; anonymous GET returns empty.

Run:  cd backend && python3 tests/test_saved.py   (exit 0 = pass)
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


def main() -> int:
    _bootstrap_env()
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.INFO)

    import tests.test_feed_dual as t  # reuse its seed graph
    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.auth_citizen import get_current_citizen, get_optional_citizen
    from app.models.pages import CitizenAccount, Poll, Post
    from datetime import datetime

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with TestClient(m.app) as c:
        with SessionLocal() as db:
            t._seed(db)
            marisol_id = db.query(CitizenAccount.id).filter(
                CitizenAccount.display_name == "Marisol Vega").first()[0]
            poll_id = db.query(Poll.id).filter(Poll.archived_at.is_(None)).order_by(Poll.id).first()[0]
            post_id = db.query(Post.id).filter(Post.deleted_at.is_(None)).order_by(Post.id).first()[0]

        def _as_marisol():
            with SessionLocal() as d:
                return d.get(CitizenAccount, marisol_id)

        # Anonymous GET is empty (before overriding the optional dep).
        anon = c.get("/api/saved?item_type=poll").json()
        check(anon["items"] == [], "anonymous GET /api/saved empty")

        m.app.dependency_overrides[get_current_citizen] = _as_marisol
        m.app.dependency_overrides[get_optional_citizen] = _as_marisol

        # 1) save poll (idempotent)
        check(c.post("/api/saved", json={"item_type": "poll", "item_id": poll_id}).json().get("saved") is True,
              "phase 1: save poll -> saved True")
        c.post("/api/saved", json={"item_type": "poll", "item_id": poll_id})  # re-save
        sv = c.get("/api/saved?item_type=poll").json()
        check(sum(1 for it in sv["items"] if it["item_id"] == poll_id) == 1, "phase 1: re-save idempotent")
        check("next_cursor" in sv and "has_more" in sv, "phase 1: list has paging fields")

        # 2) is_saved on /polls
        polls = c.get("/api/feed/polls?limit=100").json()["items"]
        pm = next((p for p in polls if p["id"] == poll_id), None)
        check(pm and pm["viewer"].get("is_saved") is True, "phase 2: poll is_saved True")
        check(all(p["viewer"].get("is_saved") is False for p in polls if p["id"] != poll_id),
              "phase 2: other polls is_saved False")

        # 3) ?ids= renders the saved poll
        byids = c.get(f"/api/feed/polls?ids={poll_id}").json()["items"]
        check(len(byids) == 1 and byids[0]["id"] == poll_id, "phase 3: /polls?ids= returns saved poll")

        # 4) save post + is_saved + ?ids=
        c.post("/api/saved", json={"item_type": "post", "item_id": post_id}).raise_for_status()
        posts = c.get("/api/feed/posts?limit=100").json()["items"]
        pm2 = next((p for p in posts if p["id"] == post_id), None)
        check(pm2 and pm2["viewer"].get("is_saved") is True, "phase 4: post is_saved True")
        byids_p = c.get(f"/api/feed/posts?ids={post_id}").json()["items"]
        check(len(byids_p) == 1 and byids_p[0]["id"] == post_id, "phase 4: /posts?ids= returns saved post")

        # 5) unsave
        check(c.delete(f"/api/saved/poll/{poll_id}").json().get("saved") is False, "phase 5: unsave -> saved False")
        polls2 = c.get("/api/feed/polls?limit=100").json()["items"]
        pm3 = next((p for p in polls2 if p["id"] == poll_id), None)
        check(pm3 and pm3["viewer"].get("is_saved") is False, "phase 5: is_saved False after unsave")

        # 6) dangling: save another poll, archive it -> skipped in list
        with SessionLocal() as db:
            other_id = db.query(Poll.id).filter(Poll.archived_at.is_(None)).order_by(Poll.id.desc()).first()[0]
        c.post("/api/saved", json={"item_type": "poll", "item_id": other_id}).raise_for_status()
        with SessionLocal() as db:
            op = db.get(Poll, other_id); op.archived_at = datetime.utcnow(); db.add(op); db.commit()
        sv3 = c.get("/api/saved?item_type=poll").json()
        check(all(it["item_id"] != other_id for it in sv3["items"]), "phase 6: archived poll skipped (dangling)")

        # 7) nonexistent -> 404
        check(c.post("/api/saved", json={"item_type": "poll", "item_id": 999999}).status_code == 404,
              "phase 7: save nonexistent -> 404")

        m.app.dependency_overrides.clear()

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ALL SAVED PHASES PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
