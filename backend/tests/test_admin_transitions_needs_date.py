"""Transitions: find the pages with no official date yet (2026-10-26 admin audit, M12).

Run:  cd backend && python3 tests/test_admin_transitions_needs_date.py   (exit 0 = pass)

Guards:
  1. needs_date=official lists only official pages whose clock runs from
     the day our data noticed the change; needs_date=candidate only
     campaign pages; the whole counts come back whatever the filter.
  2. A state official's row carries the Open States record as a lead,
     and a page with an official date carries none.
  3. Saving an official date takes the page off the list.
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
    from app.services import page_lifecycle as pl

    check = fh.Checks()
    data = [t for t in pl.registry.all().values() if t.date_is_recorded]
    want_official = sum(1 for t in data if t.page_kind == "official")
    want_candidate = sum(1 for t in data if t.page_kind == "candidate")
    check("the data files have official pages with no official date", want_official > 0, str(want_official))

    with TestClient(m.app) as c, SessionLocal() as db:
        ah = fh.admin_headers(db)

        def get(**params):
            c.cookies.clear()
            return c.get("/api/admin/transitions", headers=ah, params={"limit": 1000, **params})

        # 1. The filter and the counts.
        r = get(needs_date="official")
        body = r.json() if r.status_code == 200 else {}
        items = body.get("items", [])
        check("1: answers", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
        check("1: only official pages with no official date",
              items and all(i["page_kind"] == "official" and i["date_is_recorded"] for i in items),
              str([(i["page_id"], i["page_kind"], i["date_is_recorded"]) for i in items[:5]]))
        check("1: all of them", body.get("count") == want_official, f"{body.get('count')} vs {want_official}")
        check("1: the counts by kind",
              body.get("needs_date_counts") == {"official": want_official, "candidate": want_candidate},
              str(body.get("needs_date_counts")))
        r = get(needs_date="candidate")
        cand = r.json().get("items", [])
        check("1: campaign pages on their own",
              len(cand) == want_candidate and all(i["page_kind"] == "candidate" for i in cand), str(len(cand)))
        check("1: the counts don't depend on the filter", get().json().get("needs_date_counts")
              == {"official": want_official, "candidate": want_candidate})
        r = get(needs_date="everything")
        check("1: an unknown value is refused", r.status_code == 422, str(r.status_code))

        # 2. The lead.
        state_rows = [i for i in items if i.get("lead_url")]
        check("2: rows carry the record our data took their years from",
              state_rows and all(i["lead_url"].startswith("https://") for i in state_rows)
              and any(i["lead_url"].startswith("https://github.com/openstates/people/") for i in state_rows),
              str([i.get("lead_url") for i in items[:3]]))
        dated = [i for i in get().json().get("items", []) if not i["date_is_recorded"]]
        check("2: a page with an official date has no lead", all(i.get("lead_url") is None for i in dated))

        # 3. Saving the official date takes it off the list.
        target = next(i for i in items if i.get("lead_url"))
        c.cookies.clear()
        r = c.post("/api/admin/transitions", headers=ah, json={
            "page_id": target["page_id"], "page_kind": "official", "event": "left_office",
            "event_on": fh.days(-70).isoformat(), "source_url": "https://www.example-legislature.gov/members",
        })
        check("3: the date saves", r.status_code == 200, f"{r.status_code} {r.text[:160]}")
        pl.invalidate_cache()
        after = get(needs_date="official").json()
        check("3: the page is off the list",
              all(i["page_id"] != target["page_id"] for i in after.get("items", [])))
        check("3: the count drops by one", after.get("needs_date_counts", {}).get("official") == want_official - 1,
              str(after.get("needs_date_counts")))

    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
