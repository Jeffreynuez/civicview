"""Transitions: look before you leap, and take back a mistake (2026-10-26 admin audit).

Run:  cd backend && python3 tests/test_admin_transitions_safety.py   (exit 0 = pass)

Guards:
  1. A source that isn't .gov, .us or .mil needs the admin's explicit
     "this is an official source".
  2. dry_run answers what a save would do (stage, dates, warnings) and
     saves nothing.
  3. An admin entry can be withdrawn, with a reason: the page goes back
     to what the data files say, nothing is deleted, the log and the
     admin History keep it.
  4. The hand-off preview names the person, the role and the follower
     count, and creates nothing.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402


def main() -> int:
    fh.bootstrap()
    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import AdminAction, PageTransition, PageTransitionLog, RepAccount
    from app.routers.admin_transitions import is_official_looking
    from app.services import page_lifecycle as pl

    check = fh.Checks()

    # 1a. What counts as official-looking.
    check("1: .gov is official-looking", is_official_looking("https://dos.fl.gov/elections"))
    check("1: a state .us host is official-looking", is_official_looking("https://www.arkleg.state.ar.us/x"))
    check("1: .org is not", not is_official_looking("https://ballotpedia.org/x"))
    check("1: http is not", not is_official_looking("http://dos.fl.gov/x"))
    check("1: a .gov label in the middle is not", not is_official_looking("https://dos.fl.gov.example.com/x"))

    with TestClient(m.app) as c, SessionLocal() as db:
        ah = fh.admin_headers(db)

        def post(path, json=None):
            c.cookies.clear()
            return c.post(path, headers=ah, json=json)

        page = "fl-sen-97-safety"
        body = {"page_id": page, "page_kind": "official", "event": "left_office",
                "event_on": fh.days(-3).isoformat(), "source_url": "https://ballotpedia.org/Someone",
                "office_label": "State Senator, Florida District 97", "display_name": "Sam Safety", "state": "FL"}

        # 1b. Non-official source refused unless confirmed.
        r = post("/api/admin/transitions", body)
        check("1: a .org source is refused without confirmation", r.status_code == 400 and ".gov" in r.text,
              f"{r.status_code} {r.text[:120]}")

        # 2. Dry run: what it would do, nothing saved.
        dry = dict(body, source_url="https://www.flsenate.gov/x", event_on=fh.days(-60).isoformat())
        r = post("/api/admin/transitions?dry_run=true", dry)
        data = r.json() if r.status_code == 200 else {}
        check("2: dry run answers", r.status_code == 200 and data.get("dry_run") is True, f"{r.status_code} {r.text[:160]}")
        check("2: dry run says the stage it would land in", (data.get("item") or {}).get("stage") == "read_only",
              str((data.get("item") or {}).get("stage")))
        check("2: dry run warns it skips the farewell window",
              any("farewell" in w for w in data.get("warnings", [])), str(data.get("warnings")))
        db.expire_all()
        check("2: dry run saves no row", db.query(PageTransition).filter_by(page_id=page).first() is None)
        check("2: dry run logs nothing", db.query(PageTransitionLog).filter_by(page_id=page).count() == 0)
        check("2: dry run adds nothing to the History",
              db.query(AdminAction).filter_by(target_id=page).count() == 0)
        future = dict(dry, event_on=fh.days(5).isoformat())
        r = post("/api/admin/transitions?dry_run=true", future)
        check("2: a future date is flagged", any("future" in w for w in r.json().get("warnings", [])), r.text[:160])

        # 1c + save for real with a confirmed non-.gov source.
        r = post("/api/admin/transitions", dict(body, source_confirmed=True))
        check("1: a confirmed .org source saves", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
        pl.invalidate_cache()
        check("3: the page is in its farewell window", pl.stage_of(db, page) == "farewell", pl.stage_of(db, page))

        # 3. Withdraw: reason required, back to the data (here: nothing, so active).
        r = post(f"/api/admin/transitions/page/{page}/withdraw", {"reason": ""})
        check("3: withdraw needs a reason", r.status_code == 422, f"{r.status_code}")
        r = post(f"/api/admin/transitions/page/{page}/withdraw", {"reason": "Wrong person, the source was a namesake"})
        check("3: withdraw works", r.status_code == 200 and r.json().get("stage") == "active", f"{r.status_code} {r.text[:160]}")
        db.expire_all()
        row = db.query(PageTransition).filter_by(page_id=page).first()
        check("3: the row is kept, no longer an admin entry", row is not None and row.origin == "data",
              str(row and row.origin))
        check("3: the log keeps the withdrawal",
              db.query(PageTransitionLog).filter_by(page_id=page, action="withdraw").count() == 1)
        act = db.query(AdminAction).filter_by(action="transition_withdraw", target_id=page).first()
        check("3: the History keeps it with the reason",
              act is not None and act.reason == "Wrong person, the source was a namesake")
        r = post(f"/api/admin/transitions/page/{page}/withdraw", {"reason": "again"})
        check("3: nothing left to withdraw", r.status_code == 404, f"{r.status_code}")

        # 3b. A page the data files know falls back to the data's stage.
        data_page = next((pid for pid, t in pl.registry.all().items()
                          if t.page_kind == "official" and t.event == "left_office"), None)
        check("3: the data files have a former official to test with", data_page is not None)
        if data_page:
            data_stage = pl.registry.get(data_page).stage(pl.today_et())
            post("/api/admin/transitions", dict(body, page_id=data_page, source_url="https://www.flsenate.gov/x",
                                                event_on=fh.days(-1).isoformat()))
            r = post(f"/api/admin/transitions/page/{data_page}/withdraw", {"reason": "Entered on the wrong page"})
            check("3: withdrawing goes back to the data's stage",
                  r.status_code == 200 and r.json().get("stage") == data_stage, f"{r.text[:160]} vs {data_stage}")

        # 4. Hand-off preview: the facts, and nothing created.
        camp = "fl-cand-safety-winner"
        fh.make_candidate(db, camp, "Wendy Winner", "wendy.winner@example.com")
        post("/api/admin/transitions", {
            "page_id": camp, "page_kind": "candidate", "event": "won", "event_on": fh.days(-20).isoformat(),
            "sworn_in_on": fh.days(-1).isoformat(), "source_url": "https://dos.fl.gov/results",
            "office_label": "State Senator, Florida District 96", "display_name": "Wendy Winner", "state": "FL",
        })
        c.cookies.clear()
        r = c.get("/api/admin/transitions/handoff/preview", headers=ah,
                  params={"campaign_page_id": camp, "official_page_id": "fl-sen-96-safety"})
        data = r.json() if r.status_code == 200 else {}
        check("4: preview answers", r.status_code == 200, f"{r.status_code} {r.text[:160]}")
        check("4: preview names the person and the role",
              data.get("name") == "Wendy Winner" and data.get("role") == "State Senator", str(data))
        check("4: preview counts the followers", data.get("followers") == 0, str(data.get("followers")))
        db.expire_all()
        check("4: preview creates no rep account",
              db.query(RepAccount).filter_by(official_id="fl-sen-96-safety").first() is None)
        c.cookies.clear()
        r = c.get("/api/admin/transitions/handoff/preview", headers=ah,
                  params={"campaign_page_id": "no-such-campaign", "official_page_id": "fl-sen-96-safety"})
        check("4: preview runs the same checks", r.status_code == 400, f"{r.status_code}")

    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
