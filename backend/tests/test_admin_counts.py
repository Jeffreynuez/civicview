"""The admin tiles and queue rows tell the truth (2026-10-26 admin audit).

Run:  cd backend && python3 tests/test_admin_counts.py   (exit 0 = pass)

Guards:
  1. Queue rows say whether the reporter is a demo account and whether
     the report counts toward auto-hide, and how many open trusted
     reports the item has.
  2. The queue's counts cover the whole queue: unresolved reports,
     reports resolved this week, and hidden ITEMS (one item with three
     reports is one), the same whether or not resolved rows are loaded.
  3. The appeals list counts pending, granted this week and denied this
     week, whatever include_acted says.
  4. The Transitions tiles count every page, whatever the stage filter.
"""
import os
import sys
import tempfile
from datetime import datetime


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ["REPORT_AUTO_HIDE_THRESHOLD"] = "5"
    os.environ["ADMIN_EMAILS"] = "counts.admin@example.com"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password, issue_session_token
    from app.db import SessionLocal
    from app.models.pages import Appeal, CitizenAccount, Post, PostReport, RepAccount
    from app.services.moderation import record_report

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    oid = "counts-official"
    with TestClient(m.app) as c:
        with SessionLocal() as db:
            adm = RepAccount(email="counts.admin@example.com", password_hash=hash_password("pw-12345678"),
                             display_name="Counts Admin", official_id="counts-admin-official",
                             is_active=True, totp_enabled_at=datetime.utcnow())
            reporter_rep = RepAccount(email="reporter.rep@example.com", password_hash="x",
                                      display_name="Reporting Rep", official_id="reporting-rep-official",
                                      is_active=True)
            db.add_all([adm, reporter_rep])
            db.commit()
            adm_id, rep_reporter_id = adm.id, reporter_rep.id
        at = issue_session_token(adm_id)
        ah = {"Authorization": f"Bearer {at}", "X-CSRF-Token": compute_csrf_token(at)}

        def get(path, **params):
            c.cookies.clear()
            r = c.get(path, headers=ah, params=params or None)
            check(r.status_code == 200, f"{path} {r.status_code} {r.text[:120]}")
            return r.json()

        n = [0]

        def citizen(method):
            n[0] += 1
            with SessionLocal() as db:
                cz = CitizenAccount(email=f"c{n[0]}@example.com", password_hash="x", display_name=f"C{n[0]}",
                                    state="FL", city="Orlando", congressional_district="FL-10",
                                    verified=(method != "demo"), verified_method=method, is_active=True)
                db.add(cz)
                db.commit()
                return cz.id

        def report(post_id, *, citizen_id=None, rep_id=None):
            with SessionLocal() as db:
                db.add(PostReport(post_id=post_id, reporter_citizen_id=citizen_id, reporter_rep_id=rep_id,
                                  reason="spam"))
                record_report(db, db.get(Post, post_id), kind="post")
                db.commit()

        with SessionLocal() as db:
            a = Post(official_id=oid, body="Post A, three kinds of reporter.")
            b = Post(official_id=oid, body="Post B, five verified reports.")
            db.add_all([a, b])
            db.commit()
            a_id, b_id = a.id, b.id

        demo = citizen("demo")
        report(a_id, citizen_id=demo)
        report(a_id, citizen_id=citizen("idme"))
        report(a_id, rep_id=rep_reporter_id)
        for _ in range(5):
            report(b_id, citizen_id=citizen("idme"))

        # 1. Reporter flags and trusted counts.
        items = get("/api/admin/reports")["items"]
        a_rows = [i for i in items if i["target_id"] == a_id]
        by_reporter = {(i["reporter_kind"], i["reporter_is_demo"], i["reporter_trusted"]) for i in a_rows}
        check(("citizen", True, False) in by_reporter, f"demo reporter is labeled and not trusted: {by_reporter}")
        check(("citizen", False, True) in by_reporter, f"verified citizen is trusted: {by_reporter}")
        check(("rep", False, True) in by_reporter, f"rep reporter is trusted: {by_reporter}")
        check(all(i["target_trusted_reports"] == 2 for i in a_rows),
              f"post A has 2 open trusted reports, got {[i['target_trusted_reports'] for i in a_rows]}")

        # 2. Whole-queue counts.
        counts = get("/api/admin/reports")["counts"]
        check(counts.get("unresolved") == 8, f"8 unresolved reports, got {counts}")
        check(counts.get("hidden_items") == 1, f"post B is one hidden item, not 5, got {counts}")
        check(counts.get("auto_hide_threshold") == 5, f"threshold is sent, got {counts}")
        rid = [i for i in a_rows if i["reporter_is_demo"]][0]["id"]
        c.cookies.clear()
        r = c.post(f"/api/admin/reports/post/{rid}/dismiss", headers=ah)
        check(r.status_code == 200, f"dismiss {r.status_code}")
        open_counts = get("/api/admin/reports")["counts"]
        all_counts = get("/api/admin/reports", include_acted="true")["counts"]
        check(open_counts == all_counts, f"counts don't depend on include_acted: {open_counts} vs {all_counts}")
        check(open_counts.get("unresolved") == 7 and open_counts.get("resolved_week") == 1,
              f"after one dismiss: 7 unresolved, 1 resolved this week, got {open_counts}")
        dash = get("/api/admin/dashboard")
        check(dash.get("reports", {}).get("counts") == open_counts, "the dashboard carries the same counts")

        # 3. Appeal counts.
        author = citizen("idme")
        with SessionLocal() as db:
            db.add_all([
                Appeal(target_kind="post_comment", target_id=901, appellant_kind="citizen", appellant_id=author,
                       rationale="a" * 60),
                Appeal(target_kind="post_comment", target_id=902, appellant_kind="citizen", appellant_id=author,
                       rationale="b" * 60, acted_at=datetime.utcnow(), decision="granted"),
                Appeal(target_kind="post_comment", target_id=903, appellant_kind="citizen", appellant_id=author,
                       rationale="c" * 60, acted_at=datetime.utcnow(), decision="denied"),
            ])
            db.commit()
        for flag in ("false", "true"):
            ac = get("/api/admin/appeals", include_acted=flag)["counts"]
            check(ac == {"pending": 1, "granted_week": 1, "denied_week": 1},
                  f"appeal counts with include_acted={flag}: {ac}")

        # 4. Transitions tiles ignore the stage filter.
        whole = get("/api/admin/transitions")
        archived = get("/api/admin/transitions", stage="archived")
        check(whole.get("counts") == archived.get("counts"),
              f"transition counts don't change with the stage filter: {whole.get('counts')} vs {archived.get('counts')}")
        check(all(i.get("stage") == "archived" for i in archived.get("items", [])), "the filter still filters the list")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("THE ADMIN TILES AND ROWS TELL THE TRUTH.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
