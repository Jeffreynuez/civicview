"""Small correctness fixes from the audit's B9 list.

Run:  cd backend && python3 tests/test_b9_correctness.py   (exit 0 = pass)

  1. Two votes from the same citizen racing on a rep poll or a citizen
     poll: the loser no longer gets a 500; it updates the winning row
     to its choice, and the citizen still has exactly one vote.
  2. report_count is incremented atomically: two reports filed from two
     sessions that both read the old count still add up to two.
  3. Comments sorted by most liked or most disliked are ranked before
     the limit, so the top comment is not dropped from a long thread.
  4. A failed stats count answers 503 (never cached) instead of a 0
     that browsers and Cloudflare kept for ten minutes. /stats detail
     keeps no failed result, serves the last good one when it has it,
     and waits before running the counts again.
"""
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
    logging.disable(logging.CRITICAL)

    from fastapi.testclient import TestClient
    import app.main
    import app.routers.pages as pages_router
    import app.routers.citizen_polls as citizen_polls_router
    import app.routers.stats as stats_router
    from app.db import SessionLocal
    from app.auth import compute_csrf_token
    from app.auth_citizen import issue_citizen_token
    from app.models.pages import (
        RepAccount, CitizenAccount, Post, Poll, PollOption, PollVote, PostComment, CommentReaction,
    )
    from app.services.moderation import record_report

    with TestClient(app.main.app) as client:
        db = SessionLocal()
        rep = RepAccount(official_id="xx-b9-rep", email="b9rep@x.test", password_hash="x",
                         display_name="B9 Rep", owner_state="FL")
        cz = CitizenAccount(email="b9c@x.test", password_hash="x", display_name="B9 Citizen",
                            city="Miami", state="FL")
        rivals = [CitizenAccount(email=f"b9r{i}@x.test", password_hash="x", display_name=f"Rival {i}",
                                 city="Tampa", state="FL") for i in range(3)]
        db.add_all([rep, cz, *rivals])
        db.flush()
        post = Post(official_id=rep.official_id, body="post with poll", author_id=rep.id)
        db.add(post)
        db.flush()
        rep_poll = Poll(question="Rep poll?", author_kind="rep", post_id=post.id)
        cit_poll = Poll(question="Citizen poll?", author_kind="citizen", author_citizen_id=rivals[0].id)
        db.add_all([rep_poll, cit_poll])
        db.flush()
        rp_opts = [PollOption(poll_id=rep_poll.id, text=t, sort_order=i) for i, t in enumerate(["A", "B"])]
        cp_opts = [PollOption(poll_id=cit_poll.id, text=t, sort_order=i) for i, t in enumerate(["A", "B"])]
        db.add_all(rp_opts + cp_opts)
        db.commit()
        token = issue_citizen_token(cz.id)
        hdr = {"X-Citizen-Token": token, "X-CSRF-Token": compute_csrf_token(token)}

        # 1. Vote race. The first authored_verified_flag call happens
        # after the endpoint looked for an existing vote and found none;
        # a competing request's vote is committed right then.
        def racing(module, poll, first_option):
            real = module.authored_verified_flag
            state = {"fired": False}

            def flag(*a, **k):
                if not state["fired"]:
                    state["fired"] = True
                    other = SessionLocal()
                    other.add(PollVote(poll_id=poll.id, option_id=first_option.id, citizen_id=cz.id))
                    other.commit()
                    other.close()
                return real(*a, **k)

            module.authored_verified_flag = flag
            return real

        real = racing(pages_router, rep_poll, rp_opts[0])
        try:
            r = client.post(f"/api/pages/{rep.official_id}/polls/{rep_poll.id}/vote",
                            json={"option_id": rp_opts[1].id}, headers=hdr)
        finally:
            pages_router.authored_verified_flag = real
        db.expire_all()
        mine = db.query(PollVote).filter(PollVote.poll_id == rep_poll.id, PollVote.citizen_id == cz.id).all()
        check("rep poll: racing vote answers 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        check("rep poll: one vote, on the later choice",
              len(mine) == 1 and mine[0].option_id == rp_opts[1].id, str([(v.id, v.option_id) for v in mine]))

        real = racing(citizen_polls_router, cit_poll, cp_opts[0])
        try:
            r = client.post(f"/api/citizen-polls/{cit_poll.id}/vote",
                            json={"option_id": cp_opts[1].id}, headers=hdr)
        finally:
            citizen_polls_router.authored_verified_flag = real
        db.expire_all()
        mine = db.query(PollVote).filter(PollVote.poll_id == cit_poll.id, PollVote.citizen_id == cz.id).all()
        check("citizen poll: racing vote answers 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        check("citizen poll: one vote, on the later choice",
              len(mine) == 1 and mine[0].option_id == cp_opts[1].id, str([(v.id, v.option_id) for v in mine]))

        # 2. Atomic report_count.
        s1, s2 = SessionLocal(), SessionLocal()
        p1, p2 = s1.get(Post, post.id), s2.get(Post, post.id)
        before = p1.report_count or 0
        record_report(s1, p1, kind="post")
        s1.commit()
        record_report(s2, p2, kind="post")  # s2 read the count before s1 wrote
        s2.commit()
        s1.close()
        s2.close()
        db.expire_all()
        check("two racing reports both counted", db.get(Post, post.id).report_count == before + 2,
              str(db.get(Post, post.id).report_count))

        # 3. Most liked is ranked before the limit.
        comments = [PostComment(post_id=post.id, citizen_display_name="x", body=f"c{i}", citizen_id=cz.id)
                    for i in range(5)]
        db.add_all(comments)
        db.flush()
        top = comments[-1]  # the newest, so it is not in the first rows by id
        for rv in rivals:
            db.add(CommentReaction(comment_id=top.id, kind="up", citizen_id=rv.id))
        db.add(CommentReaction(comment_id=comments[0].id, kind="up", citizen_id=rivals[0].id))
        db.add(CommentReaction(comment_id=comments[1].id, kind="down", citizen_id=rivals[0].id))
        db.add(CommentReaction(comment_id=comments[1].id, kind="down", citizen_id=rivals[1].id))
        db.commit()
        r = client.get(f"/api/pages/posts/{post.id}/comments?sort=most_liked&limit=2")
        ids = [c["id"] for c in r.json()]
        check("most liked comment first even past the limit", ids == [top.id, comments[0].id], str(ids))
        r = client.get(f"/api/pages/posts/{post.id}/comments?sort=most_disliked&limit=1")
        check("most disliked comment first", [c["id"] for c in r.json()] == [comments[1].id],
              str([c["id"] for c in r.json()]))

        # 4. Stats: a failed count is a 503 (or the last good result),
        # never a cached zero.
        real_count = stats_router._count
        calls = {"n": 0}

        def failing(db_, fn, label, failures):
            calls["n"] += 1
            if label in ("reps_joined", "posts"):
                failures.append(label)
                return 0
            return real_count(db_, fn, label, failures)

        stats_router._count = failing
        stats_router._detail_cache.update({"at": 0.0, "payload": None, "failed_at": None})
        try:
            r = client.get("/api/stats/summary")
            check("summary answers 503 when a count fails", r.status_code == 503, str(r.status_code))
            check("503 is not marked cacheable", "public" not in (r.headers.get("cache-control") or ""),
                  str(r.headers.get("cache-control")))
            r = client.get("/api/stats/detail")
            check("detail answers 503 when a count fails and nothing good is cached",
                  r.status_code == 503, str(r.status_code))
            before = calls["n"]
            r = client.get("/api/stats/detail")
            check("a failure is not retried at once (no count storm)",
                  r.status_code == 503 and calls["n"] == before, f"{r.status_code} {calls['n'] - before} counts")
        finally:
            stats_router._count = real_count
        check("failed detail was not cached", stats_router._detail_cache["payload"] is None)
        stats_router._detail_cache["failed_at"] = None
        r = client.get("/api/stats/detail")
        good = r.json() if r.status_code == 200 else {}
        check("detail recovers once counts work", r.status_code == 200 and good.get("posts", 0) >= 1,
              f"{r.status_code} {r.text[:120]}")
        # With a good result on hand, a later failure serves it (it
        # carries its own generated_at) instead of an error or zeros.
        stats_router._detail_cache["at"] = 0.0
        stats_router._count = failing
        try:
            r = client.get("/api/stats/detail")
        finally:
            stats_router._count = real_count
        check("a later failure serves the last good result",
              r.status_code == 200 and r.json().get("generated_at") == good.get("generated_at")
              and r.json().get("posts") == good.get("posts"), f"{r.status_code}")
        r = client.get("/api/stats/summary")
        check("summary recovers and is cacheable", r.status_code == 200
              and "public" in (r.headers.get("cache-control") or ""), str(r.status_code))
        db.close()

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
