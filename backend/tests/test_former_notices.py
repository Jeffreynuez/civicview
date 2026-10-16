# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Former officials and candidates: the daily job's notices (2026-10-15).

Run:  cd backend && python3 tests/test_former_notices.py   (exit 0 = pass)

The job (services/page_lifecycle_job.py) runs on boot and once a day.
Here it is run with chosen dates, so one test walks a page through
months. Email is captured, never sent.

  1. Leaving office: the person gets one notice (in-app and email) whose
     ID.me sentence is true before ID.me opens; every tracker gets one,
     with the successor to follow; a second run the same day sends
     nothing.
  2. 30 days before the archive: one reminder to the person.
  3. At the archive: one notice to the person; tracking ends (rows
     kept, stamped); trackers get nothing more.
  4. First run after deploy, no backlog: a page already past the archive
     gets only the archived notice, once; the skipped ones are recorded.
  5. Unclaimed pages: trackers are notified; there is nobody else to tell.
  6. A candidate who lost the primary, and one who withdrew: same steps
     on the candidate clock (3 months).
  7. A winner: "-elect" until sworn in; hand-off with admin approval on
     or after the swearing-in; the campaign page is archived and linked;
     followers get one "Follow in office" notice; nothing moves.
  8. A re-elected incumbent: no "-elect", no hand-off; the campaign page
     is archived 3 months after certification with a link to the
     official page; followers get the notice.
  9. An incumbent who loses: the campaign page follows the candidate
     clock; the official page turns Former on the day the term ends.
 10. Demo and closed accounts get in-app notices but never email.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

SENT = []


class _CaptureEmail:
    # headers joined EmailService.send on 2026-10-16 (one-click
    # unsubscribe on the tracker notices).
    def send(self, *, to, subject, text_body, html_body=None, reply_to=None, headers=None,
             message_stream=None):
        SENT.append({"to": to, "subject": subject, "body": text_body, "headers": dict(headers or {})})
        return True


def main() -> int:
    from datetime import timedelta
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.email_service as es
    from app.db import SessionLocal
    from app.models.pages import (CandidateAccount, Notification, PageTransition, Post, RepAccount,
                                  TrackedOfficial)
    from app.services import page_lifecycle as pl
    from app.services.page_lifecycle_job import run_page_lifecycle

    es.get_email_service = lambda: _CaptureEmail()
    check = fh.Checks()
    db = SessionLocal()

    def notes(kind_of_recipient, rid, kind=None):
        db.expire_all()
        q = db.query(Notification).filter(Notification.recipient_kind == kind_of_recipient,
                                          Notification.recipient_id == rid)
        if kind:
            q = q.filter(Notification.kind == kind)
        return q.all()

    def payload(n):
        import json
        return json.loads(n.payload_json)

    def run(day):
        return run_page_lifecycle(db, today=day)

    def track(headers, key):
        r = c.post("/api/tracked/officials", headers=headers, json={"official_key": key, "snapshot": {}})
        assert r.status_code == 200, r.text

    with TestClient(m.app) as c:
        cit = fh.make_citizen(db, "Ana Tracker", "ana@example.org")
        cit2 = fh.make_citizen(db, "Ben Tracker", "ben@example.org", district="FL-12")
        demo = fh.make_citizen(db, "Demo Person", "demo1@demo-citizens.civicview.app", district="FL-13")
        C, C2, D = fh.citizen_headers(cit), fh.citizen_headers(cit2), fh.citizen_headers(demo)

        # ── 1. leaving office ─────────────────────────────────────
        page = "tst-sen-5"
        rep = fh.make_rep(db, page, "Morgan Leaving", "morgan@example.org")
        for h in (C, C2, D):
            track(h, page)
        left = fh.days(0)
        fh.set_transition(c, db, page_id=page, page_kind="official", event="left_office", event_on=left,
                          office_label="State Senator, Florida District 95", served_from="2020", served_to="2026",
                          display_name="Morgan Leaving", successor_ids=["tst-sen-5-next"])
        SENT.clear()
        run(left)
        mine = notes("rep", rep.id, "office_ended")
        check("1: the person gets one notice", len(mine) == 1, str(len(mine)))
        text = payload(mine[0])["text"] if mine else ""
        check("1: it says when and what the page now reads",
              f"You left office as State Senator, Florida District 95 on {pl.long_date(left)}." in text
              and 'Your page now reads "Former State Senator, Florida District 95 (2020 to 2026)".' in text, text)
        check("1: the ID.me sentence is true before ID.me opens",
              "verify it once ID.me verification opens" in text and "Served as line" in text, text)
        check("1: farewell wording while the window is open",
              f"Until {pl.long_date(left + timedelta(days=30))} you can still publish posts." in text, text)
        check("1: email to the person", any(e["to"] == "morgan@example.org"
                                            and e["subject"] == "Your CivicView page is now a former official's page"
                                            for e in SENT), str(SENT))
        tn = notes("citizen", cit.id, "tracked_left_office")
        check("1: each tracker gets one notice", len(tn) == 1 and len(notes("citizen", cit2.id, "tracked_left_office")) == 1)
        tp = payload(tn[0]) if tn else {}
        check("1: tracker text and successor",
              tp.get("text", "").startswith(f"Morgan Leaving left office as State Senator, Florida District 95 on {pl.long_date(left)}.")
              and tp.get("successors") == [{"id": "tst-sen-5-next", "name": None}], str(tp))
        check("1: tracker email", any(e["to"] == "ana@example.org" and e["subject"] == "Morgan Leaving is no longer in office"
                                      for e in SENT))
        tmail = next((e for e in SENT if e["to"] == "ana@example.org"), {"body": "", "headers": {}})
        check("1: the tracker email says where to turn these emails off (2026-10-16)",
              'turn off "Email me when a page I track changes" in your notification settings' in tmail["body"]
              and "/unsubscribe?token=" in tmail["body"]
              and tmail["headers"].get("List-Unsubscribe-Post") == "List-Unsubscribe=One-Click", tmail)
        pmail = next((e for e in SENT if e["to"] == "morgan@example.org"), {"headers": {}})
        check("1: the person's own notice has no unsubscribe", not pmail["headers"], pmail)
        before = db.query(Notification).count()
        run(left)
        run(left + timedelta(days=1))
        check("1: no duplicates on later runs", db.query(Notification).count() == before,
              f"{before} -> {db.query(Notification).count()}")

        # ── 2. 30 days before the archive ─────────────────────────
        t = pl.get_transition(db, page)
        run(t.pre_archive_notice_on)
        soon = notes("rep", rep.id, "page_archive_soon")
        check("2: one reminder before the archive",
              len(soon) == 1 and payload(soon[0])["text"].startswith(f"Your page will be archived on {pl.long_date(t.archive_on)}."),
              str([payload(n)["text"] for n in soon]))
        run(t.pre_archive_notice_on + timedelta(days=3))
        check("2: sent once", len(notes("rep", rep.id, "page_archive_soon")) == 1)

        # ── 3. at the archive ─────────────────────────────────────
        SENT.clear()
        n_tracker_before = len(notes("citizen", cit.id))
        run(t.archive_on)
        arch = notes("rep", rep.id, "page_archived")
        check("3: archived notice to the person",
              len(arch) == 1 and "Nothing on it was deleted." in payload(arch[0])["text"], str(arch))
        rows = db.query(TrackedOfficial).filter(TrackedOfficial.official_key == page).all()
        check("3: tracking ended, rows kept", len(rows) == 3 and all(r.ended_at and r.ended_reason == "archived" for r in rows))
        check("3: trackers get nothing more", len(notes("citizen", cit.id)) == n_tracker_before)
        run(t.archive_on + timedelta(days=10))
        check("3: no repeats", len(notes("rep", rep.id, "page_archived")) == 1)

        # ── 4. first run after deploy: no backlog ─────────────────
        old = "tst-sen-7"
        rep_old = fh.make_rep(db, old, "Casey Longgone", "casey@example.org")
        track(C, old)
        fh.set_transition(c, db, page_id=old, page_kind="official", event="left_office", event_on=fh.days(-200),
                          office_label="State Representative, Florida District 7", display_name="Casey Longgone")
        # Tracking rows from before the job existed (archived pages refuse new ones).
        run(fh.days(0))
        got = notes("rep", rep_old.id)
        check("4: only the notice that fits today", [n.kind for n in got] == ["page_archived"], str([n.kind for n in got]))
        row = db.query(PageTransition).filter(PageTransition.page_id == old).first()
        check("4: the skipped notices are recorded, not sent", row.skipped_notices == "left,pre_archive", str(row.skipped_notices))
        tn = [n for n in notes("citizen", cit.id) if payload(n).get("official_id") == old]
        check("4: trackers get one notice, in archived wording",
              len(tn) == 1 and "so you no longer track it" in payload(tn[0])["text"], str([payload(n)["text"] for n in tn]))

        # ── 5. unclaimed page ─────────────────────────────────────
        un = "tst-sen-8"
        track(C2, un)
        fh.set_transition(c, db, page_id=un, page_kind="official", event="left_office", event_on=fh.days(-1),
                          office_label="State Senator, Florida District 8", display_name="Drew Unclaimed")
        run(fh.days(0))
        tn = [n for n in notes("citizen", cit2.id, "tracked_left_office") if payload(n).get("official_id") == un]
        check("5: trackers of an unclaimed page are notified", len(tn) == 1, str(len(tn)))
        check("5: nobody else is told", db.query(Notification).filter(Notification.recipient_kind == "rep",
                                                                       Notification.payload_json.contains(un)).count() == 0)

        # ── 6. candidates who lost or withdrew ────────────────────
        lose = "tst-cand-5"
        cand = fh.make_candidate(db, lose, "Lee Primary", "lee@example.org")
        track(C, lose)
        cert = fh.days(-1)
        fh.set_transition(c, db, page_id=lose, page_kind="candidate", event="lost_primary", event_on=cert,
                          office_label="Governor of Florida", election_year="2026", display_name="Lee Primary",
                          source_url="https://dos.fl.gov/elections/test-certification")
        tl = pl.get_transition(db, lose)
        check("6: candidate title", tl.title() == "Former candidate for Governor of Florida (2026)", str(tl.title()))
        check("6: archive 3 months after certification", tl.archive_on == pl.add_months(cert, 3), str(tl.archive_on))
        run(fh.days(0))
        cn = notes("candidate", cand.id, "campaign_ended")
        ctext = payload(cn[0])["text"] if cn else ""
        check("6: the candidate's notice",
              ctext.startswith(f"Your campaign for Governor of Florida ended when the result was certified on {pl.long_date(cert)}.")
              and "Served as" not in ctext, ctext)
        tn = [n for n in notes("citizen", cit.id, "tracked_campaign_ended") if payload(n).get("official_id") == lose]
        check("6: followers told", len(tn) == 1 and payload(tn[0])["text"].startswith(
            f"Lee Primary's campaign for Governor of Florida ended on {pl.long_date(cert)}."), str(tn))
        wd = "tst-cand-6"
        cand_wd = fh.make_candidate(db, wd, "Robin Withdrew", "robin@example.org")
        fh.set_transition(c, db, page_id=wd, page_kind="candidate", event="withdrew", event_on=fh.days(-2),
                          office_label="U.S. House, Florida District 7", election_year="2026",
                          source_url="https://dos.fl.gov/elections/test-withdrawal")
        run(fh.days(0))
        wn = notes("candidate", cand_wd.id, "campaign_ended")
        check("6: withdrawal wording", wn and "ended when you withdrew on" in payload(wn[0])["text"], str(wn))
        r = c.post(f"/api/pages/{wd}/posts", headers=fh.candidate_headers(cand_wd), json={"body": "Thank you, supporters."})
        check("6: a withdrawn candidate can post a farewell", r.status_code == 201, f"{r.status_code} {r.text[:200]}")

        # ── 7. a winner ───────────────────────────────────────────
        win, office_page = "tst-cand-7", "tst-gov-1"
        cand_win = fh.make_candidate(db, win, "Quinn Winner", "quinn@example.org")
        track(C, win)
        track(C2, win)
        r = c.post(f"/api/pages/{win}/posts", headers=fh.candidate_headers(cand_win), json={"body": "Campaign kickoff"})
        camp_post = r.json()["id"]
        fh.set_transition(c, db, page_id=win, page_kind="candidate", event="won", event_on=fh.days(-10),
                          sworn_in_on=fh.days(20), office_label="Governor of Florida", election_year="2026",
                          display_name="Quinn Winner", source_url="https://dos.fl.gov/elections/test-canvass")
        lc = c.get(f"/api/pages/{win}").json().get("lifecycle") or {}
        check("7: -elect until sworn in", lc.get("stage") == "elect" and lc.get("title") == "Governor-elect of Florida", str(lc))
        r = c.post("/api/admin/transitions/handoff", headers=fh.admin_headers(db),
                   json={"campaign_page_id": win, "official_page_id": office_page})
        check("7: no hand-off before the swearing-in", r.status_code == 400, f"{r.status_code} {r.text[:200]}")
        fh.set_transition(c, db, page_id=win, page_kind="candidate", event="won", event_on=fh.days(-60),
                          sworn_in_on=fh.days(0), office_label="Governor of Florida", election_year="2026",
                          source_url="https://dos.fl.gov/elections/test-canvass")
        SENT.clear()
        r = c.post("/api/admin/transitions/handoff", headers=fh.admin_headers(db),
                   json={"campaign_page_id": win, "official_page_id": office_page})
        check("7: hand-off approved", r.status_code == 200 and r.json().get("followers_notified") == 2,
              f"{r.status_code} {r.text[:200]}")
        db.expire_all()
        new_rep = db.query(RepAccount).filter(RepAccount.official_id == office_page).first()
        check("7: the official page is claimed by the same person",
              new_rep is not None and new_rep.email == "quinn@example.org" and new_rep.password_hash == cand_win.password_hash
              and new_rep.role == "Governor")
        lc = c.get(f"/api/pages/{win}").json().get("lifecycle") or {}
        check("7: the campaign page is archived with a link", lc.get("archived") is True and lc.get("linked_page_id") == office_page,
              str(lc))
        olc = c.get(f"/api/pages/{office_page}").json().get("lifecycle") or {}
        check("7: the official page links back", olc.get("linked_page_id") == win and olc.get("title") is None, str(olc))
        fn = notes("citizen", cit.id, "tracked_now_in_office")
        fp = payload(fn[0]) if fn else {}
        check("7: followers get Follow in office",
              len(fn) == 1 and fp.get("follow") == {"id": office_page, "name": "Quinn Winner", "label": "Follow in office"}
              and fp.get("text", "").startswith("Quinn Winner took office as Governor of Florida."), str(fp))
        check("7: and an email", any(e["subject"] == "Quinn Winner took office" for e in SENT))
        check("7: campaign tracking ended", all(r.ended_at for r in db.query(TrackedOfficial).filter(
            TrackedOfficial.official_key == win).all()))
        check("7: campaign posts stay on the campaign page", db.get(Post, camp_post).official_id == win
              and db.get(Post, camp_post).deleted_at is None)
        run(fh.days(1))
        check("7: the job does not notify followers again", len(notes("citizen", cit.id, "tracked_now_in_office")) == 1)
        check("7: the candidate account is kept", db.get(CandidateAccount, cand_win.id) is not None)

        # ── 8. a re-elected incumbent ─────────────────────────────
        inc, inc_office = "tst-cand-8", "tst-sen-9"
        fh.make_rep(db, inc_office, "Avery Incumbent", "avery.rep@example.org")
        track(C2, inc)
        cert = fh.days(-1)
        fh.set_transition(c, db, page_id=inc, page_kind="candidate", event="won", event_on=cert, incumbent=True,
                          linked_page_id=inc_office, office_label="State Senator, Florida District 9",
                          election_year="2026", display_name="Avery Incumbent",
                          source_url="https://dos.fl.gov/elections/test-canvass")
        lc = c.get(f"/api/pages/{inc}").json().get("lifecycle") or {}
        check("8: no -elect label", lc.get("title") is None and lc.get("stage") == "active", str(lc))
        r = c.post("/api/admin/transitions/handoff", headers=fh.admin_headers(db),
                   json={"campaign_page_id": inc, "official_page_id": inc_office})
        check("8: no hand-off", r.status_code == 400)
        run(fh.days(0))
        rn = [n for n in notes("citizen", cit2.id, "tracked_now_in_office") if payload(n).get("official_id") == inc]
        rp = payload(rn[0]) if rn else {}
        check("8: followers get Follow in office",
              len(rn) == 1 and rp.get("text", "").startswith("Avery Incumbent was re-elected (State Senator, Florida District 9).")
              and (rp.get("follow") or {}).get("id") == inc_office, str(rp))
        ti = pl.get_transition(db, inc)
        check("8: campaign archived 3 months after certification", ti.archive_on == pl.add_months(cert, 3))
        check("8: official page carries on", (c.get(f"/api/pages/{inc_office}").json().get("lifecycle") or {}).get("title") is None)
        run(ti.archive_on)
        check("8: campaign tracking ends at its archive", all(r.ended_at for r in db.query(TrackedOfficial).filter(
            TrackedOfficial.official_key == inc).all()))
        # An admin who corrects a win to a loss drops the win's link and
        # hand-off date (the log keeps the earlier entry).
        fh.set_transition(c, db, page_id=win, page_kind="candidate", event="lost_general", event_on=fh.days(-60),
                          office_label="Governor of Florida", election_year="2026",
                          source_url="https://dos.fl.gov/elections/test-correction")
        tw = pl.get_transition(db, win)
        check("8b: a corrected result drops the official-page link",
              tw.linked_page_id is None and tw.handoff_on is None and tw.title() == "Former candidate for Governor of Florida (2026)",
              f"{tw.linked_page_id} {tw.handoff_on} {tw.title()}")

        # ── 9. an incumbent who loses ─────────────────────────────
        li, li_office = "tst-cand-9", "tst-sen-10"
        fh.make_rep(db, li_office, "Blake Outgoing", "blake.rep@example.org")
        fh.set_transition(c, db, page_id=li, page_kind="candidate", event="lost_general", event_on=fh.days(-5),
                          incumbent=True, office_label="State Senator, Florida District 10", election_year="2026",
                          source_url="https://dos.fl.gov/elections/test-canvass")
        term_end = fh.days(25)
        fh.set_transition(c, db, page_id=li_office, page_kind="official", event="left_office", event_on=term_end,
                          office_label="State Senator, Florida District 10", served_from="2022", served_to="2026",
                          source_url="https://www.flsenate.gov/test-term-end")
        check("9: the campaign page follows the candidate clock",
              pl.get_transition(db, li).stage() == "farewell")
        to = pl.get_transition(db, li_office)
        check("9: the official stays in office until the term ends",
              to.stage() == "active" and (c.get(f"/api/pages/{li_office}").json().get("lifecycle") or {}).get("title") is None)
        check("9: Former on the day the term ends",
              to.stage(term_end) == "farewell" and to.stage(term_end - timedelta(days=1)) == "active")

        # ── 10. demo and closed accounts: no email ────────────────
        check("10: demo trackers got the in-app notice", len(notes("citizen", demo.id, "tracked_left_office")) == 1)
        check("10: but no email to a demo address", not any("demo-citizens" in e["to"] for e in SENT)
              and not [1 for e in SENT if e["to"].endswith("@closed.invalid")])

        # The ID.me sentence once ID.me is live.
        os.environ["IDME_ENABLED"] = "true"
        from app.services.page_lifecycle_job import person_left_text
        check("1b: the ID.me sentence once ID.me is live",
              "verify it with ID.me." in person_left_text(pl.get_transition(db, page), left))
        os.environ.pop("IDME_ENABLED", None)

        # No dashes in any notice text.
        texts = [n.payload_json for n in db.query(Notification).all()] + [e["subject"] + e["body"] for e in SENT]
        check("no em or en dashes in notices", not any(("\u2014" in t or "\u2013" in t) for t in texts))

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
