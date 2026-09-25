"""The feeds stay a fixed number of queries as they grow (audit O5).

Run:  cd backend && python3 tests/test_feed_queries.py   (exit 0 = pass)

  1. /api/feed/polls?limit=100 runs the same number of SQL statements
     for 12 polls and for 72 (it used to run four or five per poll:
     453 for a 100-poll page).
  2. /api/feed/popular-polls and /api/feed/posts likewise.
  3. The batched serializer still returns the right values: option
     order and tallies, comment counts without deleted comments, the
     four display kinds, author names, page tags, saved flags and the
     signed-in viewer's own vote.
  4. /api/feed/posts ranks by likes + dislikes + comments + attached
     poll votes in SQL, newest first on ties, and offset pages neither
     overlap nor skip a post.

A one-off comparison of 43 feed responses (three viewers, filters,
pagination) against the previous implementation, on SQLite and on
Postgres 16, found them identical before this test was written.
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta

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
    logging.disable(logging.CRITICAL)

    from fastapi.testclient import TestClient
    from sqlalchemy import event
    import app.main
    from app.db import engine, SessionLocal
    from app.auth_citizen import issue_citizen_token
    from app.models.pages import (
        RepAccount, CandidateAccount, CitizenAccount, Post, Poll, PollOption, PollVote,
        PollComment, PostComment, SavedItem,
    )

    statements = [0]

    @event.listens_for(engine, "before_cursor_execute")
    def _count(*_a, **_k):
        statements[0] += 1

    t0 = datetime(2026, 9, 1, 12, 0, 0)
    tick = [0]

    def ts():
        tick[0] += 1
        return t0 + timedelta(minutes=tick[0])

    with TestClient(app.main.app) as client:
        db = SessionLocal()
        rep = RepAccount(official_id="us-sen-min-leader", email="rep@x.test", password_hash="x",
                         display_name="Rep One", role="U.S. Senator", owner_state="NY")
        cand = CandidateAccount(candidate_id="fl-cand-byron-donalds", email="cand@x.test",
                                password_hash="x", display_name="Cand One", owner_state="FL")
        viewer = CitizenAccount(email="v@x.test", password_hash="x", display_name="Viewer",
                                city="Miami", state="FL")
        other = CitizenAccount(email="o@x.test", password_hash="x", display_name="Other",
                               city="Austin", state="TX")
        db.add_all([rep, cand, viewer, other])
        db.flush()

        def add_poll(question, **kw):
            p = Poll(question=question, created_at=ts(), **kw)
            db.add(p)
            db.flush()
            opts = [PollOption(poll_id=p.id, text=t, sort_order=i) for i, t in enumerate(["Yes", "No"])]
            db.add_all(opts)
            db.flush()
            return p, opts

        rep_post = Post(official_id=rep.official_id, body="rep post", author_id=rep.id, created_at=ts())
        cand_post = Post(official_id=cand.candidate_id, body="cand post",
                         author_candidate_id=cand.id, created_at=ts())
        db.add_all([rep_post, cand_post])
        db.flush()
        rep_poll, rep_opts = add_poll("Rep poll?", author_kind="rep", post_id=rep_post.id)
        cand_poll, _ = add_poll("Cand poll?", author_kind="rep", post_id=cand_post.id)
        standalone, st_opts = add_poll("Standalone?", author_kind="citizen", author_citizen_id=other.id)
        on_rep, _ = add_poll("On rep page?", author_kind="citizen", author_citizen_id=other.id,
                             target_official_id=rep.official_id)
        on_cand, _ = add_poll("On candidate page?", author_kind="citizen", author_citizen_id=other.id,
                              target_official_id="fl-cand-james-fishback")
        # Tallies: standalone gets 2 No and 1 Yes; the viewer voted No.
        db.add_all([
            PollVote(poll_id=standalone.id, option_id=st_opts[1].id, citizen_id=viewer.id),
            PollVote(poll_id=standalone.id, option_id=st_opts[1].id, citizen_id=other.id),
            PollVote(poll_id=standalone.id, option_id=st_opts[0].id, author_rep_id=rep.id),
            PollVote(poll_id=rep_poll.id, option_id=rep_opts[0].id, citizen_id=other.id),
        ])
        # Comments: one live and one deleted on each kind of parent.
        db.add_all([
            PollComment(poll_id=standalone.id, citizen_display_name="x", body="c", citizen_id=other.id),
            PollComment(poll_id=standalone.id, citizen_display_name="x", body="c", citizen_id=other.id,
                        deleted_at=ts()),
            PostComment(post_id=rep_post.id, citizen_display_name="x", body="c", citizen_id=other.id),
            PostComment(post_id=rep_post.id, citizen_display_name="x", body="c", citizen_id=other.id,
                        deleted_at=ts()),
            SavedItem(tracker_kind="citizen", tracker_id=viewer.id, item_type="poll", item_id=on_rep.id),
        ])
        db.commit()
        viewer_hdr = {"X-Citizen-Token": issue_citizen_token(viewer.id)}

        def run(url, headers=None):
            statements[0] = 0
            r = client.get(url, headers=headers or {})
            return r, statements[0]

        # 3. Values.
        r, _ = run("/api/feed/polls?limit=100", viewer_hdr)
        items = {i["question"]: i for i in r.json()["items"]}
        st = items["Standalone?"]
        check("options in sort order with tallies",
              [(o["label"], o["count"], o["percent"]) for o in st["options"]] == [("Yes", 1, 33), ("No", 2, 67)],
              str(st["options"]))
        check("total votes", st["votes"] == 3, str(st["votes"]))
        check("deleted poll comment not counted", st["comments"] == 1, str(st["comments"]))
        check("deleted post comment not counted", items["Rep poll?"]["comments"] == 1,
              str(items["Rep poll?"]["comments"]))
        check("display kinds",
              [items[q]["kind"] for q in ("Standalone?", "On rep page?", "On candidate page?", "Rep poll?", "Cand poll?")]
              == ["standalone", "citizen", "candidate", "rep", "candidate"],
              str({q: i["kind"] for q, i in items.items()}))
        check("author names",
              (items["Standalone?"]["author"], items["Rep poll?"]["author"], items["Cand poll?"]["author"])
              == ("Other", "Rep One", "Cand One"))
        check("citizen author role is state and city", items["Standalone?"]["role"] == "TX · Austin",
              str(items["Standalone?"]["role"]))
        check("page tags resolved", items["Rep poll?"]["page_tag"] and items["Cand poll?"]["page_tag"]
              and items["On candidate page?"]["page_tag"] and items["Standalone?"]["page_tag"] is None,
              str({q: i["page_tag"] for q, i in items.items()}))
        check("viewer's own vote", st["viewer"]["voter_choice_id"] == st_opts[1].id, str(st["viewer"]))
        check("saved flag", items["On rep page?"]["viewer"]["is_saved"] is True
              and st["viewer"]["is_saved"] is False)

        # 1 and 2. Constant query counts.
        _, small_polls = run("/api/feed/polls?limit=100", viewer_hdr)
        _, small_popular = run("/api/feed/popular-polls?limit=30")
        for i in range(60):
            add_poll(f"Extra {i}?", author_kind="citizen", author_citizen_id=other.id,
                     target_official_id=(rep.official_id if i % 2 else None))
        for i in range(30):
            db.add(Post(official_id=rep.official_id, body=f"extra {i}", author_id=rep.id, created_at=ts()))
        db.commit()
        r, big_polls = run("/api/feed/polls?limit=100", viewer_hdr)
        check("polls feed grew", len(r.json()["items"]) == 65, str(len(r.json()["items"])))
        check("polls feed query count does not grow with polls", big_polls <= small_polls,
              f"{small_polls} -> {big_polls}")
        check("polls feed stays under 20 statements", big_polls < 20, str(big_polls))
        _, big_popular = run("/api/feed/popular-polls?limit=30")
        check("popular polls query count does not grow", big_popular <= small_popular,
              f"{small_popular} -> {big_popular}")
        r, posts_q = run("/api/feed/posts?limit=100", viewer_hdr)
        check("posts feed stays under 12 statements for 32 posts", posts_q < 12, str(posts_q))

        # 4. Ranking and pagination.
        body = r.json()
        order = [i["body"] for i in body["items"]]
        # rep post: one live comment + one vote on its poll. Everything
        # else scores 0 and falls back to newest first.
        check("posts ranked by engagement", order[0] == "rep post", str(order[:3]))
        check("ties newest first", order[1:4] == ["extra 29", "extra 28", "extra 27"]
              and order[-1] == "cand post", str(order[1:4] + order[-1:]))
        check("engagement counts", body["items"][0]["comments"] == 1
              and body["items"][0]["attached_poll_votes"] == 1, str(body["items"][0]))
        seen = []
        offset = 0
        while True:
            page = client.get(f"/api/feed/posts?limit=7&offset={offset}").json()
            seen += [i["id"] for i in page["items"]]
            if not page["has_more"]:
                check("last page has no next_offset", page["next_offset"] is None)
                break
            offset = page["next_offset"]
        check("offset pages cover every post once", len(seen) == 32 and len(set(seen)) == 32,
              f"{len(seen)} ids, {len(set(seen))} unique")
        db.close()

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
