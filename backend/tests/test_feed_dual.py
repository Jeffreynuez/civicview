# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Integration test for the /api/feed/polls + /api/feed/posts dual-feed
endpoints that back the /polls + /posts page redesign.

What this test guards:

  1.  /api/feed/polls accepts repeated `kind` params and returns the
      union of the matched buckets (rep ∪ standalone, citizen ∪
      candidate, etc.).
  2.  /api/feed/polls accepts a `state` filter that applies across
      both author paths — rep polls match the parent post's
      author.owner_state; citizen polls match the author citizen's
      state column.
  3.  Each poll item in the response includes the new fields
      `parent_post_id` (non-null only for rep polls), `likes`, and
      `dislikes`.
  4.  /api/feed/posts returns only rep + candidate posts (citizens
      can't author posts) and includes the `attached_poll_id` /
      `has_attached_poll` cross-link fields.
  5.  /api/feed/posts orders by engagement score (likes + dislikes +
      comments + attached_poll_votes), tiebroken by recency.
  6.  Cross-feed reciprocity: when a rep post has an attached poll,
      the post item exposes `attached_poll_id == X` and the matching
      poll item exposes `parent_post_id == post.id`.

How to run (plain script — no pytest needed):

    cd backend
    python3 tests/test_feed_dual.py

Exit 0 = all phases pass. Non-zero = an assertion fired (the message
identifies the phase + the expectation it violated).
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta


def _bootstrap_env():
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")


def _seed(db):
    """Build a small but representative graph:

        Reps:        BD (FL, rep), NP (CA, rep)
        Candidates:  SL (WA, candidate)
        Citizens:    Marisol (FL), Andre (IL, standalone author)

        Posts:
            post-bd-1  by BD       (FL)  — has attached poll (rep)
            post-np-1  by NP       (CA)  — no attached poll
            post-sl-1  by SL       (WA)  — has attached poll (candidate-authored)

        Polls (active, archived_at NULL):
            rep-poll-bd (attached to post-bd-1)         FL
            rep-poll-sl (attached to post-sl-1)         WA, candidate-page
            citizen-poll-marisol (on BD's page)         FL, target=BD.official_id
            standalone-poll-andre                       IL, target=NULL

        Engagement:
            post-bd-1: 3 likes + 1 dislike + 1 comment + 10 poll votes  = 15
            post-np-1: 0 + 0 + 5 + 0                                     = 5
            post-sl-1: 1 + 0 + 0 + 3                                     = 4

        Comment shape lets the score test assert ordering deterministic.
    """
    from app.models.pages import (
        RepAccount,
        CandidateAccount,
        CitizenAccount,
        Post,
        Poll,
        PollOption,
        PollVote,
        PostReaction,
        PostComment,
    )
    # Reps
    bd = RepAccount(
        official_id="bd-fl-19",
        email="bd@example.test",
        password_hash="x",
        display_name="Byron Donalds",
        role="U.S. Representative · FL-19",
        owner_state="FL",
        owner_district="FL-19",
        is_active=True,
    )
    np_rep = RepAccount(
        official_id="np-ca-12",
        email="np@example.test",
        password_hash="x",
        display_name="Nancy Pelosi",
        role="U.S. Representative · CA-12",
        owner_state="CA",
        owner_district="CA-12",
        is_active=True,
    )
    db.add_all([bd, np_rep])
    db.flush()

    # Candidate
    sl = CandidateAccount(
        candidate_id="wa-cand-sarah-liu",
        email="sl@example.test",
        password_hash="x",
        display_name="Sarah-Jane Liu",
        owner_state="WA",
        owner_district="WA-07",
        claim_status="active",
        is_active=True,
    )
    db.add(sl)
    db.flush()

    # Citizens
    marisol = CitizenAccount(
        email="marisol@example.test",
        password_hash="x",
        display_name="Marisol Vega",
        state="FL",
        congressional_district="FL-19",
        city="Naples",
    )
    andre = CitizenAccount(
        email="andre@example.test",
        password_hash="x",
        display_name="Andre Boyle",
        state="IL",
        congressional_district="IL-13",
        city="Chicago",
    )
    db.add_all([marisol, andre])
    db.flush()

    now = datetime.utcnow()

    # Posts (rep + candidate). Stagger created_at so the recency
    # tiebreaker is deterministic.
    post_bd = Post(
        author_id=bd.id,
        official_id=bd.official_id,
        body="BD post body — bipartisan markup update.",
        created_at=now - timedelta(minutes=14),
    )
    post_np = Post(
        author_id=np_rep.id,
        official_id=np_rep.official_id,
        body="NP post body — climate resilience pilot.",
        created_at=now - timedelta(hours=4),
    )
    post_sl = Post(
        author_candidate_id=sl.id,
        official_id=sl.candidate_id,
        body="SL candidate post body — door-knock takeaways.",
        created_at=now - timedelta(days=1),
    )
    db.add_all([post_bd, post_np, post_sl])
    db.flush()

    # Polls
    rep_poll_bd = Poll(
        post_id=post_bd.id,
        question="SALT cap relief through 2030?",
        author_kind="rep",
        created_at=post_bd.created_at,
    )
    rep_poll_sl = Poll(
        post_id=post_sl.id,
        question="FAA per-route on-time disclosure?",
        author_kind="rep",  # rep_kind covers candidate-attached polls too
        created_at=post_sl.created_at,
    )
    citizen_poll_marisol = Poll(
        question="Hurricane relief portal worked for you?",
        author_kind="citizen",
        author_citizen_id=marisol.id,
        target_official_id=bd.official_id,
        created_at=now - timedelta(minutes=22),
    )
    standalone_poll_andre = Poll(
        question="Ranked-choice voting in federal primaries?",
        author_kind="citizen",
        author_citizen_id=andre.id,
        target_official_id=None,
        created_at=now - timedelta(minutes=45),
    )
    db.add_all([
        rep_poll_bd, rep_poll_sl, citizen_poll_marisol, standalone_poll_andre,
    ])
    db.flush()

    # Options + votes on rep_poll_bd — 10 total votes (engagement score
    # contributor on post-bd-1).
    bd_opts = [
        PollOption(poll_id=rep_poll_bd.id, text="Yes — extend",     sort_order=0),
        PollOption(poll_id=rep_poll_bd.id, text="Phase it out",     sort_order=1),
        PollOption(poll_id=rep_poll_bd.id, text="Let it expire",    sort_order=2),
    ]
    sl_opts = [
        PollOption(poll_id=rep_poll_sl.id, text="Per-route disclosure", sort_order=0),
        PollOption(poll_id=rep_poll_sl.id, text="Per-airline is enough", sort_order=1),
    ]
    cm_opts = [
        PollOption(poll_id=citizen_poll_marisol.id, text="Worked under a week", sort_order=0),
        PollOption(poll_id=citizen_poll_marisol.id, text="Took weeks",          sort_order=1),
    ]
    ab_opts = [
        PollOption(poll_id=standalone_poll_andre.id, text="Adopt nationally", sort_order=0),
        PollOption(poll_id=standalone_poll_andre.id, text="States decide",    sort_order=1),
    ]
    db.add_all(bd_opts + sl_opts + cm_opts + ab_opts)
    db.flush()

    # Votes — 10 on rep_poll_bd, 3 on rep_poll_sl, 0 on the others.
    for _ in range(7):
        db.add(PollVote(poll_id=rep_poll_bd.id, option_id=bd_opts[0].id))
    for _ in range(3):
        db.add(PollVote(poll_id=rep_poll_bd.id, option_id=bd_opts[1].id))
    for _ in range(3):
        db.add(PollVote(poll_id=rep_poll_sl.id, option_id=sl_opts[0].id))

    # Reactions on posts. The (post, identity-column) unique indexes
    # mean we need one row per identity-kind to count multiple likes
    # on the same post. For post_bd we use marisol + andre + BD-self
    # to land on 3 likes; the down is from the candidate identity.
    db.add(PostReaction(post_id=post_bd.id, kind="up",   citizen_id=marisol.id))
    db.add(PostReaction(post_id=post_bd.id, kind="up",   citizen_id=andre.id))
    db.add(PostReaction(post_id=post_bd.id, kind="up",   author_rep_id=bd.id))
    db.add(PostReaction(post_id=post_bd.id, kind="down", author_candidate_id=sl.id))
    db.add(PostReaction(post_id=post_sl.id, kind="up",   citizen_id=marisol.id))

    # Comments on posts.
    db.add(PostComment(post_id=post_bd.id, citizen_id=marisol.id, citizen_display_name=marisol.display_name, body="BD post comment"))
    for i in range(5):
        db.add(PostComment(post_id=post_np.id, citizen_id=marisol.id, citizen_display_name=marisol.display_name, body=f"NP post comment {i}"))

    db.commit()



def main() -> int:
    _bootstrap_env()
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import app.main as m
    from app.db import SessionLocal
    from fastapi.testclient import TestClient

    with TestClient(m.app) as c:
        # Seed
        with SessionLocal() as db:
            _seed(db)

        # Phase 1 — unfiltered polls feed should return all 4 polls.
        r = c.get("/api/feed/polls?limit=100")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) == 4, f"phase 1: expected 4 polls, got {len(items)}"

        # Phase 2 — kind=rep returns ONLY rep-authored polls. The seed's
        # "rep_poll_sl" is actually CANDIDATE-authored (its parent post
        # carries author_candidate_id), so it renders as kind='candidate'
        # and must NOT appear here — only Byron Donalds' rep poll does.
        # (Pre-fix this leaked because the SQL clause filters on the
        # Poll.author_kind column, which reads 'rep' for candidate-
        # attached polls; the endpoint now narrows on effective display
        # kind. See feed.py _effective_kind.)
        r = c.get("/api/feed/polls?limit=100&kind=rep")
        items = r.json()["items"]
        assert len(items) == 1, f"phase 2: expected 1 rep poll, got {len(items)}: {[(i['kind'], i['author']) for i in items]}"
        assert all(i["kind"] == "rep" for i in items), f"phase 2: non-rep leaked: {items}"
        assert items[0]["author"] == "Byron Donalds", f"phase 2: unexpected rep author {items[0]['author']}"

        # Phase 2b — kind=candidate returns the candidate-authored poll
        # (Sarah-Jane Liu). Guards the OTHER half of the ?kind=rep leak
        # fix: candidate-authored polls (target_official_id NULL,
        # author_kind=='rep') were previously dropped by the candidate
        # bucket too; they must now surface under kind=candidate.
        r = c.get("/api/feed/polls?limit=100&kind=candidate")
        items = r.json()["items"]
        assert all(i["kind"] == "candidate" for i in items), f"phase 2b: non-candidate leaked: {[(i['kind'], i['author']) for i in items]}"
        assert any(i["author"] == "Sarah-Jane Liu" for i in items), f"phase 2b: candidate-authored poll missing: {[(i['kind'], i['author']) for i in items]}"

        # Phase 3 — multi-kind union: kind=rep&kind=standalone returns
        # 1 rep poll (Byron Donalds) + 1 standalone poll (Andre) = 2.
        r = c.get("/api/feed/polls?limit=100&kind=rep&kind=standalone")
        items = r.json()["items"]
        assert len(items) == 2, f"phase 3: expected 2 polls (1 rep + 1 standalone), got {len(items)}: kinds={[i['kind'] for i in items]}"
        kinds = sorted(i["kind"] for i in items)
        assert kinds == ["rep", "standalone"], f"phase 3: kinds={kinds}"

        # Phase 4 — state filter FL returns only FL-author polls:
        # rep_poll_bd (BD owner_state=FL) + citizen_poll_marisol (citizen.state=FL).
        # Excludes rep_poll_sl (WA), standalone_poll_andre (IL).
        r = c.get("/api/feed/polls?limit=100&state=FL")
        items = r.json()["items"]
        assert len(items) == 2, f"phase 4: expected 2 FL polls, got {len(items)}: {[(i['kind'], i['author']) for i in items]}"
        authors = sorted(i["author"] for i in items)
        assert "Byron Donalds" in authors and "Marisol Vega" in authors, \
            f"phase 4: missing expected FL authors, got {authors}"

        # Phase 5 — every poll item has the new fields.
        r = c.get("/api/feed/polls?limit=100")
        items = r.json()["items"]
        for i in items:
            assert "likes" in i and "dislikes" in i and "parent_post_id" in i, \
                f"phase 5: item missing new fields: {list(i.keys())}"

        # Phase 6 — parent_post_id is non-null for POST-ATTACHED polls and
        # null for citizen-authored polls. Rep-authored AND candidate-
        # authored polls ride on a parent post (a candidate's poll is
        # attached to their post), so both carry a parent_post_id;
        # citizen polls (citizen + standalone) have no parent post.
        # (Pre-fix this lumped the candidate-authored poll in with the
        # citizen polls and wrongly expected parent_post_id=None.)
        rep_polls = [i for i in items if i["kind"] == "rep"]
        post_attached = [i for i in items if i["kind"] in ("rep", "candidate")]
        citizen_authored = [i for i in items if i["kind"] in ("citizen", "standalone")]
        for i in post_attached:
            assert i["parent_post_id"] is not None, \
                f"phase 6: {i['kind']} poll {i['id']} has null parent_post_id"
        for i in citizen_authored:
            assert i["parent_post_id"] is None, \
                f"phase 6: {i['kind']} poll {i['id']} has parent_post_id={i['parent_post_id']}"

        # Phase 7 — likes/dislikes propagate from the parent post for
        # POST-ATTACHED polls (rep- AND candidate-authored). rep_poll_bd's
        # post has 3 ups + 1 down; the candidate-authored poll's parent
        # post (post_sl) has 1 up — so it reports 1/0, NOT 0/0. (Pre-fix
        # this poll was treated as a citizen poll and expected 0/0.)
        rpbd = next(i for i in rep_polls if i["author"] == "Byron Donalds")
        assert rpbd["likes"] == 3, f"phase 7: rpbd likes={rpbd['likes']}"
        assert rpbd["dislikes"] == 1, f"phase 7: rpbd dislikes={rpbd['dislikes']}"
        cand_authored = next(i for i in items if i["author"] == "Sarah-Jane Liu")
        assert cand_authored["likes"] == 1 and cand_authored["dislikes"] == 0, \
            f"phase 7: candidate-authored poll engagement={cand_authored['likes']}/{cand_authored['dislikes']}"

        # Citizen-authored polls (citizen + standalone) report 0/0 today
        # (no PollReaction rows seeded).
        for i in citizen_authored:
            assert i["likes"] == 0 and i["dislikes"] == 0, \
                f"phase 7: citizen poll has non-zero engagement: {i}"

        # Phase 8 — /api/feed/posts: unfiltered returns the 3 posts.
        r = c.get("/api/feed/posts?limit=100")
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) == 3, f"phase 8: expected 3 posts, got {len(items)}"

        # Phase 9 — engagement-score ordering:
        # post-bd-1: 3 + 1 + 1 + 10 = 15
        # post-np-1: 0 + 0 + 5 + 0 = 5
        # post-sl-1: 1 + 0 + 0 + 3 = 4
        authors_order = [i["author"] for i in items]
        assert authors_order == ["Byron Donalds", "Nancy Pelosi", "Sarah-Jane Liu"], \
            f"phase 9: wrong order — {authors_order}"

        # Phase 10 — cross-feed reciprocity: post with attached poll
        # exposes attached_poll_id == the poll's id, and the poll
        # exposes parent_post_id == the post's id.
        post_bd_item = next(i for i in items if i["author"] == "Byron Donalds")
        assert post_bd_item["has_attached_poll"] is True
        assert post_bd_item["attached_poll_id"] is not None
        poll_items = c.get("/api/feed/polls?limit=100").json()["items"]
        matching_poll = next(
            (p for p in poll_items if p["id"] == post_bd_item["attached_poll_id"]),
            None,
        )
        assert matching_poll is not None, "phase 10: poll item not found"
        assert matching_poll["parent_post_id"] == post_bd_item["id"], \
            f"phase 10: reciprocity broken: post_id={post_bd_item['id']}, poll.parent_post_id={matching_poll['parent_post_id']}"

        # Phase 11 — posts feed state filter:
        # state=FL returns only post-bd-1.
        r = c.get("/api/feed/posts?limit=100&state=FL")
        items = r.json()["items"]
        assert len(items) == 1 and items[0]["author"] == "Byron Donalds", \
            f"phase 11: expected only BD, got {[i['author'] for i in items]}"

        # Phase 12 — posts feed kind filter:
        # kind=candidate returns only post-sl-1.
        r = c.get("/api/feed/posts?limit=100&kind=candidate")
        items = r.json()["items"]
        assert len(items) == 1 and items[0]["kind"] == "candidate", \
            f"phase 12: candidate filter returned {[(i['kind'], i['author']) for i in items]}"

        # Phase 13 — kind=rep on posts returns the two rep-authored posts.
        r = c.get("/api/feed/posts?limit=100&kind=rep")
        items = r.json()["items"]
        assert len(items) == 2, f"phase 13: rep filter on posts returned {len(items)}"
        assert all(i["kind"] == "rep" for i in items)

    print("ALL PHASES PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
