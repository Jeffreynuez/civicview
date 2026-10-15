# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Former officials and candidates: every stage of a page (2026-10-15).

Run:  cd backend && python3 tests/test_former_lifecycle.py   (exit 0 = pass)

A claimed official's page is walked through each stage by moving the
date it left office through the admin Transitions API (the same call
an admin makes by hand), and an unclaimed page with citizen polls goes
the same way:

  1. In office: the owner posts, attaches polls, likes; citizens track.
  2. Farewell (day 0 to 30): the title reads "Former <office> (<years>)";
     the owner may publish posts but no polls, events, likes, votes or
     comments as the official; their own polls close to new votes with
     results visible; what they published in office is locked, farewell
     posts are not; citizens keep commenting and liking; nobody new can
     track the page, existing tracking continues.
  3. Read-only (day 30 to the archive): no more owner posts; citizens
     still take part.
  4. Archived (6 months): readable by direct link with every post,
     comment and vote still there; no engagement; reports still work;
     out of feeds and tracked lists.
  5. Unclaimed page: citizen polls stay open through farewell and
     read-only (answer 1) and close at the archive; reports still work.
  6. Rosters: from the day someone leaves, they are nobody's current
     official (the seat shows Vacant), but their page is still found by
     its id with the Former label.
  7. Titles name the state and are the same words for every party.
  8. Nothing is deleted at any step (row counts never drop).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m
    from app.db import SessionLocal
    from app.models.pages import (Notification, Poll, PollComment, PollVote, Post, PostComment,
                                  PostReaction, RepAccount, TrackedOfficial)
    from app.services import page_lifecycle as pl
    from datetime import datetime, timedelta, timezone

    check = fh.Checks()
    db = SessionLocal()

    def counts():
        db.expire_all()
        return {
            "posts": db.query(Post).count(),
            "comments": db.query(PostComment).count(),
            "reactions": db.query(PostReaction).count(),
            "polls": db.query(Poll).count(),
            "votes": db.query(PollVote).count(),
            "poll_comments": db.query(PollComment).count(),
            "tracked": db.query(TrackedOfficial).count(),
            "accounts": db.query(RepAccount).count(),
        }

    def not_fewer(before, after):
        return all(after[k] >= before[k] for k in before)

    with TestClient(m.app) as c:
        page = "tst-sen-1"
        rep = fh.make_rep(db, page, "Pat Example", "pat.example@example.org",
                          role="State Senator", state="FL", district="99")
        cit = fh.make_citizen(db, "Riley Tracker", "riley@example.org")
        cit2 = fh.make_citizen(db, "Sam Newcomer", "sam@example.org", district="FL-11")
        R, C, C2 = fh.rep_headers(rep), fh.citizen_headers(cit), fh.citizen_headers(cit2)

        # ── 1. in office ───────────────────────────────────────────
        r = c.post(f"/api/pages/{page}/posts", headers=R, json={
            "body": "Office hours this Friday.",
            "poll": {"question": "Which day works?", "options": [{"text": "Friday"}, {"text": "Saturday"}]}})
        check("1: in office, owner posts with a poll", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
        office_post = r.json()
        poll_id = office_post["poll"]["id"]
        opt = office_post["poll"]["options"][0]["id"]
        # Written well before the departure (moved back for the test).
        db.query(Post).filter(Post.id == office_post["id"]).update(
            {Post.created_at: datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=60)})
        db.commit()

        r = c.get(f"/api/pages/{page}")
        check("1: no lifecycle block while in office", r.status_code == 200 and r.json().get("lifecycle") is None,
              str(r.json().get("lifecycle")))
        r = c.post("/api/tracked/officials", headers=C, json={"official_key": page, "snapshot": {"name": "Pat Example"}})
        check("1: a citizen tracks the page", r.status_code == 200, r.text[:200])
        r = c.post(f"/api/pages/posts/{office_post['id']}/comments", headers=C, json={"body": "See you there."})
        check("1: a citizen comments", r.status_code == 201, r.text[:200])
        office_comment = r.json()
        r = c.post(f"/api/pages/posts/{office_post['id']}/reactions", headers=R, json={"kind": "up"})
        check("1: the official likes as the official", r.status_code == 200, r.text[:200])
        r = c.post(f"/api/pages/{page}/polls/{poll_id}/vote", headers=C, json={"option_id": opt})
        check("1: a citizen votes on the official's poll", r.status_code == 200, r.text[:200])
        r = c.get("/api/feed/posts")
        ids = [p.get("id") for p in (r.json().get("items") or r.json().get("posts") or [])] if r.status_code == 200 else []
        check("1: the post is in the feed", office_post["id"] in ids, f"{r.status_code} {ids[:5]}")
        before = counts()

        # ── 2. farewell ────────────────────────────────────────────
        left_on = fh.days(-3)
        fh.set_transition(c, db, page_id=page, page_kind="official", event="left_office", event_on=left_on,
                          office_label="State Senator, Florida District 99", served_from="2018",
                          served_to="2026", display_name="Pat Example", state="FL")
        r = c.get(f"/api/pages/{page}")
        lc = r.json().get("lifecycle") or {}
        check("2: stage is farewell", lc.get("stage") == "farewell", str(lc.get("stage")))
        check("2: title names office, state and years",
              lc.get("title") == "Former State Senator, Florida District 99 (2018 to 2026)", str(lc.get("title")))
        check("2: date line is the official date", lc.get("date_line") == f"Left office on {pl.long_date(left_on)}",
              str(lc.get("date_line")))
        check("2: farewell allows posts, not polls", lc.get("can_post") is True and lc.get("can_poll") is False, str(lc))
        check("2: archive is six months after leaving", lc.get("archive_on") == pl.add_months(left_on, 6).isoformat(),
              str(lc.get("archive_on")))

        r = c.post(f"/api/pages/{page}/posts", headers=R, json={"body": "Thank you for the honor of serving."})
        check("2: farewell post accepted", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
        farewell_post = r.json() if r.status_code == 201 else {}
        check("2: farewell post header reads Former",
              (farewell_post.get("author") or {}).get("role") == lc.get("title"), str(farewell_post.get("author")))
        r = c.post(f"/api/pages/{page}/posts", headers=R, json={
            "body": "One more?", "poll": {"question": "Q?", "options": [{"text": "A"}, {"text": "B"}]}})
        check("2: a poll is refused", r.status_code == 403 and "polls_ended" in r.text, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/{page}/events", headers=R, json={
            "title": "Town hall", "start_at": (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=5)).isoformat()})
        check("2: an event is refused", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/posts/{farewell_post.get('id')}/reactions", headers=R, json={"kind": "up"})
        check("2: liking as the official is refused", r.status_code == 403 and "official_identity_ended" in r.text,
              f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/posts/{office_post['id']}/comments", headers=R, json={"body": "Thanks all"})
        check("2: commenting as the official is refused", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        r = c.delete(f"/api/pages/posts/{office_post['id']}", headers=R)
        check("2: a post made in office cannot be deleted", r.status_code == 403 and "content_locked" in r.text,
              f"{r.status_code} {r.text[:200]}")
        r = c.patch(f"/api/pages/posts/{office_post['id']}", headers=R, json={"body": "rewritten"})
        check("2: a post made in office cannot be edited", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        r = c.patch(f"/api/pages/posts/{farewell_post.get('id')}", headers=R,
                    json={"body": "Thank you for the honor of serving, Florida."})
        check("2: a farewell post can still be edited", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        r = c.get(f"/api/pages/{page}/posts")
        posts = (r.json().get("posts") or r.json().get("items") or []) if r.status_code == 200 else []
        in_office = next((p for p in posts if p.get("id") == office_post["id"]), {})
        check("2: the in-office post keeps its in-office title", (in_office.get("author") or {}).get("role") == "State Senator",
              str(in_office.get("author")))

        r = c.post(f"/api/pages/{page}/polls/{poll_id}/vote", headers=C2, json={"option_id": opt})
        check("2: the official's poll is closed to new votes", r.status_code == 400 and "closed to new votes" in r.text,
              f"{r.status_code} {r.text[:200]}")
        r = c.get(f"/api/pages/{page}")
        p0 = next((p for p in r.json().get("posts") or [] if p["id"] == office_post["id"]), {})
        total = sum(o.get("vote_count", 0) for o in (p0.get("poll") or {}).get("options") or [])
        check("2: its results stay visible", total == 1, str((p0.get("poll") or {}).get("options")))
        r = c.post(f"/api/pages/posts/{office_post['id']}/comments", headers=C2, json={"body": "Thank you for serving."})
        check("2: citizens keep commenting", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/posts/{farewell_post.get('id')}/reactions", headers=C, json={"kind": "up"})
        check("2: citizens keep liking", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        r = c.post("/api/tracked/officials", headers=C2, json={"official_key": page, "snapshot": {}})
        check("2: no new tracking", r.status_code == 409 and "tracking_closed" in r.text, f"{r.status_code} {r.text[:200]}")
        r = c.get("/api/tracked/officials", headers=C)
        mine = [o for o in r.json() if o["official_key"] == page] if r.status_code == 200 else []
        check("2: existing tracking continues, with the Former title",
              len(mine) == 1 and (mine[0].get("lifecycle") or {}).get("title") == lc.get("title"), str(mine))

        # ── 3. read-only ───────────────────────────────────────────
        fh.set_transition(c, db, page_id=page, page_kind="official", event="left_office", event_on=fh.days(-45),
                          office_label="State Senator, Florida District 99", served_from="2018", served_to="2026")
        lc = c.get(f"/api/pages/{page}").json().get("lifecycle") or {}
        check("3: stage is read_only", lc.get("stage") == "read_only", str(lc.get("stage")))
        r = c.post(f"/api/pages/{page}/posts", headers=R, json={"body": "Late note"})
        check("3: owner posts are refused", r.status_code == 403 and "page_read_only" in r.text, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/posts/{office_post['id']}/comments", headers=C, json={"body": "Still reading."})
        check("3: citizens still comment", r.status_code == 201, f"{r.status_code} {r.text[:200]}")

        # ── 4. archived ────────────────────────────────────────────
        fh.set_transition(c, db, page_id=page, page_kind="official", event="left_office", event_on=fh.days(-200),
                          office_label="State Senator, Florida District 99", served_from="2018", served_to="2026")
        snapshot = counts()
        r = c.get(f"/api/pages/{page}")
        body = r.json()
        lc = body.get("lifecycle") or {}
        check("4: readable by direct link", r.status_code == 200 and lc.get("archived") is True, str(lc.get("stage")))
        check("4: every post is still there", {office_post["id"], farewell_post.get("id")} <= {p["id"] for p in body.get("posts") or []},
              str([p["id"] for p in body.get("posts") or []]))
        r = c.post(f"/api/pages/posts/{office_post['id']}/comments", headers=C, json={"body": "Hello?"})
        check("4: no new comments", r.status_code == 403 and "page_archived" in r.text, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/posts/{office_post['id']}/reactions", headers=C2, json={"kind": "down"})
        check("4: no new likes or dislikes", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/posts/{office_post['id']}/reports", headers=C2, json={"reason": "spam"})
        check("4: reports still work", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/comments/{office_comment['id']}/reports", headers=C2, json={"reason": "spam"})
        check("4: comment reports still work", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        r = c.get("/api/feed/posts")
        ids = [p.get("id") for p in (r.json().get("items") or r.json().get("posts") or [])] if r.status_code == 200 else [None]
        check("4: out of the feed", office_post["id"] not in ids and farewell_post.get("id") not in ids, str(ids[:5]))
        r = c.get("/api/tracked/officials", headers=C)
        check("4: out of tracked lists", r.status_code == 200 and not [o for o in r.json() if o["official_key"] == page],
              r.text[:200])
        summary = c.post("/api/admin/transitions/run", headers=fh.admin_headers(db)).json()
        db.expire_all()
        row = db.query(TrackedOfficial).filter(TrackedOfficial.official_key == page).first()
        check("4: tracking ends at the archive (row kept, stamped)",
              row is not None and row.ended_at is not None and row.ended_reason == "archived",
              str(summary))
        check("4: the person got the archived notice",
              db.query(Notification).filter(Notification.recipient_kind == "rep", Notification.recipient_id == rep.id,
                                            Notification.kind == "page_archived").count() == 1)
        check("4: nothing deleted while archived", not_fewer(snapshot, counts()), f"{snapshot} {counts()}")
        check("4: nothing deleted since in office", not_fewer(before, counts()), f"{before} {counts()}")

        # ── 5. unclaimed page, citizen polls ───────────────────────
        upage = "tst-sen-2"
        poll = {"poll": {"question": "Should the district get a new library?",
                         "options": [{"text": "Yes"}, {"text": "No"}]}}
        r = c.post(f"/api/pages/{upage}/citizen-polls", headers=C, json=poll)
        check("5: a citizen poll on an unclaimed page, in office", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
        cp = r.json() if r.status_code == 201 else {}
        cp_opt = ((cp.get("poll") or {}).get("options") or [{}])[0].get("id")
        fh.set_transition(c, db, page_id=upage, page_kind="official", event="left_office", event_on=fh.days(-2),
                          office_label="State Senator, Florida District 98", display_name="Jordan Unclaimed", state="FL")
        lc = c.get(f"/api/pages/{upage}").json().get("lifecycle") or {}
        check("5: unclaimed page gets the same label", lc.get("title") == "Former State Senator, Florida District 98",
              str(lc.get("title")))
        r = c.post(f"/api/citizen-polls/{cp.get('id')}/vote", headers=C2, json={"option_id": cp_opt})
        check("5: citizen polls stay open in farewell", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        fh.set_transition(c, db, page_id=upage, page_kind="official", event="left_office", event_on=fh.days(-60),
                          office_label="State Senator, Florida District 98")
        r = c.post(f"/api/pages/{upage}/citizen-polls", headers=C2, json=poll)
        check("5: and in read-only", r.status_code == 201, f"{r.status_code} {r.text[:200]}")
        fh.set_transition(c, db, page_id=upage, page_kind="official", event="left_office", event_on=fh.days(-190),
                          office_label="State Senator, Florida District 98")
        r = c.post(f"/api/citizen-polls/{cp.get('id')}/vote", headers=C, json={"option_id": cp_opt})
        check("5: archived, no votes", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/pages/{upage}/citizen-polls", headers=C, json=poll)
        check("5: archived, no new citizen polls", r.status_code == 403, f"{r.status_code} {r.text[:200]}")
        r = c.post(f"/api/citizen-polls/{cp.get('id')}/report", headers=C2, json={"reason": "spam"})
        check("5: archived, reports still work", r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}")

        # ── 6. rosters ─────────────────────────────────────────────
        import json
        fl = json.load(open(os.path.join(os.path.dirname(__file__), "..", "app", "data", "fl", "state_officials.json")))
        sitting = fl["state_senate"]["members"][0]
        r0 = c.get("/api/state-officials/FL").json()
        listed0 = [x["id"] for x in r0["state_senate"]["members"]]
        check("6: a sitting senator is listed", sitting["id"] in listed0)
        fh.set_transition(c, db, page_id=sitting["id"], page_kind="official", event="left_office",
                          event_on=fh.days(-1), office_label=f"State Senator, Florida District {sitting['district']}")
        r1 = c.get("/api/state-officials/FL").json()
        listed1 = [x["id"] for x in r1["state_senate"]["members"]]
        vac = [v for v in r1["state_senate"].get("vacancies") or [] if str(v.get("district")) == str(sitting["district"])]
        check("6: from the day they leave, not a current official", sitting["id"] not in listed1)
        check("6: the seat shows Vacant", bool(vac) and sitting["name"] in vac[0].get("previous_members", []), str(vac))
        r = c.get(f"/api/state-officials/FL/person/{sitting['id']}")
        check("6: still found by id, with the Former label",
              r.status_code == 200 and ((r.json().get("lifecycle") or {}).get("title") or "").startswith("Former State Senator, Florida"),
              f"{r.status_code} {r.text[:200]}")
        gov = fl["executive"]["governor"]
        fh.set_transition(c, db, page_id=gov["id"], page_kind="official", event="left_office", event_on=fh.days(0),
                          office_label="Governor of Florida")
        r2 = c.get("/api/state-officials/FL").json()
        check("6: a statewide seat with nobody in it reads Vacant",
              (r2["executive"]["governor"] or {}).get("name") == "Vacant" and r2["executive"]["governor"].get("id") is None,
              str(r2["executive"]["governor"]))
        # Data-file departures follow the same rule (the House seat of G000359's era is not needed: any
        # Congress departure in congress_profiles.json is filtered whatever its stage).
        from app.services import lifecycle_rosters as lr
        departed = lr.departed_ids(db)
        check("6: data-file departures count as departed",
              {"g000359", "c001127"} <= departed, str(sorted(departed)[:10]))
        keep, gone = lr.filter_congress_members(
            [{"bioguide_id": "G000359", "chamber": "Senate", "state": "SC"},
             {"bioguide_id": "X000001", "chamber": "House", "state": "FL", "district": 1}], departed)
        check("6: departed members drop from the Congress list",
              [x["bioguide_id"] for x in keep] == ["X000001"] and len(gone) == 1)
        idx = c.get("/api/former/search-index").json()
        stage = pl.get_transition(db, "G000359").stage()
        found = any(x["bioguide_id"] == "G000359" for x in idx["members"])
        check("6: search finds a former member until the archive",
              found == (stage in (pl.FAREWELL, pl.READ_ONLY)), f"{stage} {found}")

        # ── 7. titles ──────────────────────────────────────────────
        t = pl.get_transition(db, "fl-cand-jerry-demings")
        check("7: candidate title names the state", t.title() == "Former candidate for Governor of Florida (2026)",
              str(t.title()))
        check("7: a U.S. House race names the state",
              pl.candidate_office_label("U.S. House, FL-7") == "U.S. House, Florida District 7")
        a = pl.Transition(page_id="a", page_kind="official", event="left_office", event_on=fh.days(-1),
                          office_label="U.S. Senator from Florida", served_from="2019", served_to="2026")
        check("7: official title", a.title() == "Former U.S. Senator from Florida (2019 to 2026)", str(a.title()))
        rec = pl.Transition(page_id="b", page_kind="official", event="left_office", recorded_on=fh.days(-1),
                            office_label="State Representative, Ohio District 1")
        check("7: a recorded-on date never reads as the day they left",
              rec.date_line().startswith("CivicView recorded a departure from office on")
              and "Left office" not in rec.date_line(), rec.date_line())

        # ── 8. nothing deleted anywhere ────────────────────────────
        check("8: nothing deleted across every step", not_fewer(before, counts()), f"{before} {counts()}")
        from app.models.pages import PageTransition, PageTransitionLog
        check("8: every admin change is logged with who and when",
              db.query(PageTransitionLog).filter(PageTransitionLog.page_id == page).count() >= 3
              and db.query(PageTransition).filter(PageTransition.page_id == page).first().set_by == fh.ADMIN_EMAIL)
        routes = [(r.path, sorted(r.methods or [])) for r in m.app.routes if getattr(r, "path", "").startswith("/api/admin/transitions")]
        check("8: the admin transitions API has no delete", all("DELETE" not in meth for _, meth in routes), str(routes))

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
