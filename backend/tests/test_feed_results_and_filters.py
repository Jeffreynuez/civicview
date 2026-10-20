# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Feed chips, the posts AI filter, the "Your view" Country choice and
poll result settings (2026-10-20).

Run:  cd backend && python3 tests/test_feed_results_and_filters.py   (exit 0 = pass)

What each part would have caught:

  Branch on posts   /api/feed/posts items had no `branch`, so the
                    Congress / Executive / Judicial chips on /posts were
                    always empty. A post now carries the same branch as
                    its official's polls; candidate posts carry none.
  Posts AI filter   /posts sent its prompt to /filter-polls and matched
                    poll ids against post ids. /filter-posts filters
                    posts: @author, the tags stored when the post was
                    created, Claude for free text, and Claude for posts
                    that have no tags yet. It is in the AI rate limit.
  Country choice    GET /api/pages/{id}?scope=country shows country-wide
                    counts for a poll whose default is the district;
                    with no scope each poll keeps its own default.
  From candidates   A candidate's poll is stored with author_kind
                    'candidate', which the kind=candidate filter left
                    out, so the chip was always empty, and its likes
                    read 0. It is now in that chip only, with its
                    post's likes.
  Result settings   A poll set to show results after it closes sent its
                    counts to the /polls feed, Popular polls, the posts
                    feed vote total and Explore results. Now none of
                    them get counts before the close, except the owner
                    of a post's page (as on the page); citizen polls
                    hold them from everyone, as on the page. A closed
                    poll shows them; a "hidden" poll still sends them
                    (the viewer opens them with Show results).
"""
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone


def _first_id(node):
    """First official id in a federal_officials.json subtree."""
    if isinstance(node, dict):
        oid = node.get("id") or node.get("official_id")
        if isinstance(oid, str) and oid:
            return oid
        for v in node.values():
            found = _first_id(v)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _first_id(item)
            if found:
                return found
    return None


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ.pop("ANTHROPIC_API_KEY", None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, issue_session_token
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.middleware import rate_limit
    from app.models.pages import (
        CandidateAccount, CitizenAccount, Poll, PollOption, PollVote, Post, PostReaction, RepAccount,
    )
    from app.services import ai_service

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    with open(os.path.join(os.path.dirname(__file__), "..", "app", "data", "federal",
                           "federal_officials.json")) as f:
        exec_id = _first_id(json.load(f)["executive"])
    assert exec_id, "no executive official in federal_officials.json"

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    house_id = "test-house-fl-07"
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            house = RepAccount(official_id=house_id, email="house@example.test", password_hash="x",
                               display_name="Hollis Member", role="U.S. Representative",
                               owner_state="FL", owner_district="FL-07", is_active=True)
            execu = RepAccount(official_id=exec_id, email="exec@example.test", password_hash="x",
                               display_name="Avery Secretary", role="Cabinet Secretary", is_active=True)
            cand = CandidateAccount(candidate_id="fl-cand-test-hopeful", email="cand@example.test",
                                    password_hash="x", display_name="Casey Hopeful",
                                    owner_state="FL", claim_status="active", is_active=True)
            db.add_all([house, execu, cand])
            db.flush()
            # Five voters: two in FL-07, three in FL-10.
            voters = []
            for i, district in enumerate(["FL-07", "FL-07", "FL-10", "FL-10", "FL-10"]):
                cz = CitizenAccount(email=f"voter{i}@example.test", password_hash="x",
                                    display_name=f"Voter Number{i}", state="FL",
                                    congressional_district=district, city="", is_active=True)
                db.add(cz)
                voters.append(cz)
            author = CitizenAccount(email="asker@example.test", password_hash="x",
                                    display_name="Poll Asker", state="FL",
                                    congressional_district="FL-07", city="", is_active=True)
            db.add(author)
            db.flush()

            def post(by, body, minutes, tagged=None):
                p = Post(official_id=by.official_id if isinstance(by, RepAccount) else by.candidate_id,
                         author_id=by.id if isinstance(by, RepAccount) else None,
                         author_candidate_id=by.id if isinstance(by, CandidateAccount) else None,
                         body=body, created_at=now - timedelta(minutes=minutes))
                if tagged:
                    p.ai_sentiment, p.ai_tones = tagged
                    p.ai_classified_at = now
                db.add(p)
                db.flush()
                return p

            def poll(question, n_votes, *, post_row=None, mode="full", closes_at=None,
                     scope="country", citizen_author=None, author_kind="rep"):
                pl = Poll(post_id=post_row.id if post_row else None, question=question,
                          author_kind="citizen" if citizen_author else author_kind,
                          author_citizen_id=citizen_author.id if citizen_author else None,
                          default_visibility_scope=scope, presentation_mode=mode,
                          closes_at=closes_at, created_at=now)
                db.add(pl)
                db.flush()
                yes = PollOption(poll_id=pl.id, text="Yes", sort_order=0)
                no = PollOption(poll_id=pl.id, text="No", sort_order=1)
                db.add_all([yes, no])
                db.flush()
                for v in voters[:n_votes]:
                    db.add(PollVote(poll_id=pl.id, option_id=yes.id, citizen_id=v.id,
                                    scope_state=v.state, scope_district=v.congressional_district))
                db.flush()
                return pl

            p_full = post(house, "Town hall next week.", 1)
            p_held = post(house, "Results after the vote closes.", 2)
            p_closed = post(house, "This one already closed.", 3)
            p_hidden = post(house, "Open the results yourself.", 4)
            p_exec = post(execu, "Proud of the new broadband grants.", 5, tagged=("positive", "supportive"))
            p_cand = post(cand, "Door knocking report from the weekend.", 6)

            q_full = poll("District default?", 5, post_row=p_full, scope="district")
            q_held = poll("Held until close?", 3, post_row=p_held, mode="reveal_after_close",
                          closes_at=now + timedelta(days=1))
            q_closed = poll("Closed already?", 2, post_row=p_closed, mode="reveal_after_close",
                            closes_at=now - timedelta(hours=1))
            q_hidden = poll("On request?", 4, post_row=p_hidden, mode="hidden")
            q_citizen = poll("Citizen held?", 2, mode="reveal_after_close",
                             closes_at=now + timedelta(days=1), citizen_author=author)
            # As create_post stores it: a candidate's poll says 'candidate'.
            q_cand = poll("Candidate asks?", 1, post_row=p_cand, author_kind="candidate")
            db.add(PostReaction(post_id=p_cand.id, citizen_id=voters[0].id, kind="up"))
            db.commit()
            ids = {k: v.id for k, v in dict(
                p_full=p_full, p_held=p_held, p_closed=p_closed, p_hidden=p_hidden, p_exec=p_exec,
                p_cand=p_cand, q_full=q_full, q_held=q_held, q_closed=q_closed, q_hidden=q_hidden,
                q_citizen=q_citizen, q_cand=q_cand,
            ).items()}
            house_rep_id, author_id = house.id, author.id

        rep_tok = issue_session_token(house_rep_id)
        owner_h = {"Authorization": f"Bearer {rep_tok}"}
        cit_tok = issue_citizen_token(author_id)
        author_h = {"X-Citizen-Token": cit_tok}

        # ── Branch on posts ──────────────────────────────────────────
        posts = {i["id"]: i for i in c.get("/api/feed/posts?limit=100").json()["items"]}
        polls = {i["id"]: i for i in c.get("/api/feed/polls?limit=100").json()["items"]}
        check(posts[ids["p_full"]].get("branch") == "congress",
              f"house post branch: {posts[ids['p_full']].get('branch')}")
        check(posts[ids["p_full"]].get("branch") == polls[ids["q_full"]].get("branch"),
              "a post and its official's poll must share a branch")
        check(posts[ids["p_exec"]].get("branch") == "executive",
              f"curated executive post branch: {posts[ids['p_exec']].get('branch')}")
        check("branch" in posts[ids["p_cand"]] and posts[ids["p_cand"]]["branch"] is None,
              "candidate posts carry no branch")

        # ── From candidates ──────────────────────────────────────────
        cand_ids = [i["id"] for i in c.get("/api/feed/polls?limit=100&kind=candidate").json()["items"]]
        rep_ids = [i["id"] for i in c.get("/api/feed/polls?limit=100&kind=rep").json()["items"]]
        check(cand_ids == [ids["q_cand"]], f"kind=candidate should hold the candidate's poll only: {cand_ids}")
        check(ids["q_cand"] not in rep_ids and ids["q_full"] in rep_ids,
              f"kind=rep should hold rep polls only: {rep_ids}")
        check(polls[ids["q_cand"]].get("kind") == "candidate" and polls[ids["q_cand"]].get("likes") == 1,
              f"a candidate's poll shows as a candidate poll with its post's likes: {polls[ids['q_cand']]}")

        # ── Posts AI filter ──────────────────────────────────────────
        house_posts = {ids[k] for k in ("p_full", "p_held", "p_closed", "p_hidden")}
        r = c.post("/api/ai/filter-posts", json={"prompt": "from @Hollis"})
        check(r.status_code == 200, f"filter-posts author: {r.status_code} {r.text[:200]}")
        j = r.json()
        check(j.get("method") == "author" and set(j.get("matched_ids", [])) == house_posts,
              f"filter-posts @author should return that official's post ids: {j}")
        # AI off: the tagged post matches its tone, untagged posts can't be asked about.
        j = c.post("/api/ai/filter-posts", json={"prompt": "positive posts"}).json()
        check(j.get("method") == "structured" and j.get("matched_ids") == [ids["p_exec"]],
              f"filter-posts tone chip from stored tags: {j}")
        j = c.post("/api/ai/filter-posts", json={"prompt": "about broadband"}).json()
        check(j.get("method") == "passthrough" and set(j.get("matched_ids", [])) == set(posts),
              f"filter-posts free text with AI off falls back to every post: {j}")
        check(rate_limit._AI_RE.match("/api/ai/filter-posts") is not None,
              "/api/ai/filter-posts must be in the AI rate-limit bucket")

        asked = []

        def fake_chat(*, system, messages, **_kw):
            asked.append(messages[0]["content"])
            if "classify a single post" in system:
                return ai_service.AIResult(text='{"sentiment": "neutral", "tones": ["informative"], '
                                                '"intensity": 2, "topic": "town hall"}', error=None)
            if "filter a list of posts" in system:
                return ai_service.AIResult(text=f"[{ids['p_cand']}, 99999]", error=None)
            return ai_service.AIResult(text=None, error="not_configured")

        real_chat = ai_service.chat
        ai_service.chat = fake_chat
        try:
            # A tone chip also asks Claude about the posts with no tags yet.
            j = c.post("/api/ai/filter-posts", json={"prompt": "positive posts"}).json()
            check(set(j.get("matched_ids", [])) == {ids["p_exec"], ids["p_cand"]},
                  f"tone chip should add untagged matches from Claude: {j}")
            check(asked and not re.search(rf"(?m)^{ids['p_exec']}\|", asked[-1]),
                  "only untagged posts are sent to Claude for a tone chip")
            j = c.post("/api/ai/filter-posts", json={"prompt": "about broadband"}).json()
            check(j.get("method") == "semantic" and j.get("matched_ids") == [ids["p_cand"]],
                  f"free text goes to Claude and unknown ids are dropped: {j}")
            # Posts are tagged when created.
            h = {**owner_h, "X-CSRF-Token": compute_csrf_token(rep_tok)}
            r = c.post(f"/api/pages/{house_id}/posts", json={"body": "Hearing recap."}, headers=h)
            check(r.status_code == 201, f"create post: {r.status_code} {r.text[:200]}")
            if r.status_code == 201:
                with SessionLocal() as db:
                    created = db.get(Post, r.json()["id"])
                    check(getattr(created, "ai_classified_at", None) is not None and getattr(created, "ai_tones", None) == "informative",
                          f"new post should be tagged: {getattr(created, 'ai_tones', None)}")
                    db.query(Post).filter(Post.id == created.id).update({"deleted_at": now})
                    db.commit()
        finally:
            ai_service.chat = real_chat

        # ── Country choice on a page ─────────────────────────────────
        def page_poll(scope=None):
            url = f"/api/pages/{house_id}" + (f"?scope={scope}" if scope else "")
            page = c.get(url).json()
            return next(p["poll"] for p in page["posts"] if p["poll"] and p["poll"]["id"] == ids["q_full"])

        pp = page_poll()
        check(pp["active_scope"] == "district" and pp["total_votes"] == 2,
              f"no choice keeps the poll's district default: {pp['active_scope']} {pp['total_votes']}")
        pp = page_poll("country")
        check(pp["active_scope"] == "country" and pp["total_votes"] == 5,
              f"scope=country shows country-wide counts: {pp['active_scope']} {pp['total_votes']}")
        more = c.get(f"/api/pages/{house_id}/posts?limit=50&scope=country").json()["items"]
        mp = next(p["poll"] for p in more if p["poll"] and p["poll"]["id"] == ids["q_full"])
        check(mp["total_votes"] == 5, "the load-more endpoint honors scope=country too")

        # ── Result settings: /polls feed and Popular polls ───────────
        def zeroed(item):
            return item["votes"] == 0 and all(o["count"] == 0 and o["percent"] == 0 for o in item["options"])

        held = polls[ids["q_held"]]
        check(held.get("counts_suppressed") is True and zeroed(held),
              f"held poll must send no counts before it closes: {held}")
        check(held.get("presentation_mode") == "reveal_after_close" and held.get("closes_at"),
              "held poll says its setting and when it closes")
        closed = polls[ids["q_closed"]]
        check(closed.get("counts_suppressed") is False and closed["votes"] == 2,
              f"closed poll shows its counts: {closed['votes']}")
        hidden = polls[ids["q_hidden"]]
        check(hidden.get("presentation_mode") == "hidden" and hidden.get("counts_suppressed") is False
              and hidden["votes"] == 4, "a 'hidden' poll still sends counts for Show results")
        cpoll = polls[ids["q_citizen"]]
        check(cpoll.get("counts_suppressed") is True and zeroed(cpoll), "held citizen poll sends no counts")
        check(polls[ids["q_full"]].get("counts_suppressed") is False and polls[ids["q_full"]]["votes"] == 5,
              "a 'full' poll is unchanged")

        mine = {i["id"]: i for i in c.get("/api/feed/polls?limit=100", headers=owner_h).json()["items"]}
        check(mine[ids["q_held"]].get("counts_suppressed") is False and mine[ids["q_held"]]["votes"] == 3,
              "the page owner sees their held poll's counts, as on the page")
        mine = {i["id"]: i for i in c.get("/api/feed/polls?limit=100", headers=author_h).json()["items"]}
        check(mine[ids["q_citizen"]].get("counts_suppressed") is True,
              "a citizen poll's author does not see early counts, as on the page")

        popular = {i["id"]: i for i in c.get("/api/feed/popular-polls?limit=30").json()["items"]}
        check(popular[ids["q_held"]].get("counts_suppressed") is True and zeroed(popular[ids["q_held"]]),
              "Popular polls holds the counts too")

        # ── Result settings: posts feed vote total ───────────────────
        check(posts[ids["p_held"]]["attached_poll_votes"] == 0,
              f"posts feed must not send a held poll's vote total: {posts[ids['p_held']]['attached_poll_votes']}")
        check(posts[ids["p_closed"]]["attached_poll_votes"] == 2, "closed poll's total is sent")
        mine = {i["id"]: i for i in c.get("/api/feed/posts?limit=100", headers=owner_h).json()["items"]}
        check(mine[ids["p_held"]]["attached_poll_votes"] == 3, "the page owner gets the total")

        # ── Result settings: Explore results (and so the CSV) ────────
        def breakdown(poll_id, headers=None):
            r = c.get(f"/api/polls/{poll_id}/results/breakdown", headers=headers or {})
            check(r.status_code == 200, f"breakdown {poll_id}: {r.status_code}")
            return r.json()

        b = breakdown(ids["q_held"])
        check(b.get("counts_suppressed") is True and b.get("options") == [] and b.get("subset_total") == 0
              and b.get("closes_at"), f"Explore results must hold a held poll's counts: {b}")
        b = breakdown(ids["q_held"], owner_h)
        check(b.get("counts_suppressed") is False and b.get("subset_total") == 3,
              f"the page owner sees them in Explore results: {b}")
        b = breakdown(ids["q_citizen"], author_h)
        check(b.get("counts_suppressed") is True and b.get("options") == [],
              "a held citizen poll stays held in Explore results, the author included")
        b = breakdown(ids["q_closed"])
        check(b.get("counts_suppressed") is False and b.get("subset_total") == 2,
              "a closed poll's results show in Explore results")
        b = breakdown(ids["q_hidden"])
        check(b.get("counts_suppressed") is False and b.get("subset_total") == 4,
              "opening Explore results on a 'hidden' poll is the viewer's choice to see them")

    if failures:
        print("FAILED:")
        for f in failures:
            print("  - " + f)
        return 1
    print("ALL CHECKS PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
