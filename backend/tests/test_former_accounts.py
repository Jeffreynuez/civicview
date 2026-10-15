# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Former officials and candidates: the citizen account choices (2026-10-15).

Run:  cd backend && python3 tests/test_former_accounts.py   (exit 0 = pass)

  1. Linking: only a former account, and only with the citizen account
     signed in in the same browser.
  2. The name hand-off: only the verified person gets it. Waiting until
     ID.me verification; applied on a first and last name match;
     refused on a mismatch; a nickname (Chuck and Charles) goes to an
     admin, who approves with a source, after ID.me; everyone else is
     still kept off the name.
  3. The opt-in copies: tracked items, saved posts and notification
     settings are copied, never moved, and never twice.
  4. The "Served as" line: generated, off until chosen, removable from
     either account, only for former officials.
  5. The citizen card shows nothing that is not already public: the
     name, and the Served as line when chosen. No state or district.
  6. Deleting a rep or candidate account closes it and keeps what it
     published; deleting a citizen account works as before.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()


def main() -> int:
    import json
    from fastapi.testclient import TestClient
    import app.main as m
    from app.db import SessionLocal
    from app.models.pages import (CandidateAccount, CitizenAccount, FormerAccountLink, PageTransitionLog,
                                  Post, RepAccount, SavedItem, TrackedBill, TrackedOfficial)
    from app.services.display_names import name_conflict, name_key
    from app.services.former_links import legal_name_match
    from app.services.idme_service import encrypt_legal_name

    check = fh.Checks()
    db = SessionLocal()

    def idme_verify(citizen, legal_name):
        citizen.verified = True
        citizen.verified_method = "id.me"
        citizen.verified_legal_name_encrypted = encrypt_legal_name(legal_name)
        db.commit()

    def leave(page, office, **kw):
        fh.set_transition(c, db, page_id=page, page_kind="official", event="left_office", event_on=fh.days(-2),
                          office_label=office, served_from="2016", served_to="2026", **kw)

    with TestClient(m.app) as c:
        # ── 1. linking ────────────────────────────────────────────
        rep = fh.make_rep(db, "tst-sen-21", "Morgan Leaving", "morgan21@example.org")
        cit = fh.make_citizen(db, "Morgan Citizen", "morgan.citizen@example.org")
        R, C = fh.rep_headers(rep), fh.citizen_headers(cit)
        r = c.get("/api/former/me", headers=R)
        check("1: an account in office is not a former account", r.status_code == 404, f"{r.status_code}")
        leave("tst-sen-21", "State Senator, Florida District 21")
        r = c.get("/api/former/me", headers=R)
        check("1: the former account sees its dashboard", r.status_code == 200 and r.json()["link"] is None, r.text[:200])
        check("1: the Served as preview is generated from our records",
              r.json().get("served_as_preview") == "Served as State Senator, Florida District 21 (2016 to 2026)",
              str(r.json().get("served_as_preview")))
        r = c.post("/api/former/link", headers=R)
        check("1: linking needs the citizen account signed in too", r.status_code == 400, f"{r.status_code}")
        r = c.post("/api/former/link", headers=C)
        check("1: a citizen alone cannot link", r.status_code == 401, f"{r.status_code}")
        r = c.post("/api/former/link", headers=fh.both(R, C))
        check("1: linked with both signed in", r.status_code == 200 and r.json()["link"]["citizen_id"] == cit.id, r.text[:200])

        # ── 2. the name hand-off ──────────────────────────────────
        other = fh.make_citizen(db, "Someone Else", "someone@example.org", district="FL-14")
        check("2: before: the name is taken for citizens",
              name_conflict(db, "Morgan Leaving", exclude_citizen_id=cit.id) is not None)
        r = c.put("/api/former/optins", headers=R, json={"name": True})
        check("2: waits for ID.me verification", r.json()["link"]["name"]["status"] == "waiting", r.text[:300])
        idme_verify(cit, "Morgan Avery Leaving")
        r = c.get("/api/former/me", headers=R)
        db.expire_all()
        check("2: first and last name match: applied",
              r.json()["link"]["name"]["status"] == "approved" and r.json()["link"]["name"]["applied"]
              and db.get(CitizenAccount, cit.id).display_name == "Morgan Leaving", r.text[:300])
        check("2: the citizen name index follows", db.get(CitizenAccount, cit.id).name_key == name_key("Morgan Leaving"))
        check("2: the verified person may keep it", name_conflict(db, "Morgan Leaving", exclude_citizen_id=cit.id) is None)
        check("2: everyone else is still kept off it",
              name_conflict(db, "Morgan Leaving", exclude_citizen_id=other.id) is not None
              and name_conflict(db, "morgan  leaving!", exclude_citizen_id=None) is not None)
        check("2: the former account keeps its name (still reserved)",
              db.get(RepAccount, rep.id).display_name == "Morgan Leaving")

        rep_b = fh.make_rep(db, "tst-sen-22", "Jamie Former", "jamie22@example.org")
        cit_b = fh.make_citizen(db, "Pat Unrelated", "pat.b@example.org", district="FL-15")
        leave("tst-sen-22", "State Senator, Florida District 22")
        c.post("/api/former/link", headers=fh.both(fh.rep_headers(rep_b), fh.citizen_headers(cit_b)))
        idme_verify(cit_b, "Patricia Unrelated")
        r = c.put("/api/former/optins", headers=fh.rep_headers(rep_b), json={"name": True})
        db.expire_all()
        check("2: a mismatch is refused, not applied",
              r.json()["link"]["name"]["status"] == "refused" and db.get(CitizenAccount, cit_b.id).display_name == "Pat Unrelated",
              r.text[:300])
        check("2: and the name stays blocked for that citizen",
              name_conflict(db, "Jamie Former", exclude_citizen_id=cit_b.id) is not None)

        rep_n = fh.make_rep(db, "tst-sen-23", "Chuck Grassley-Test", "chuck23@example.org")
        cit_n = fh.make_citizen(db, "Charles Citizen", "charles@example.org", district="FL-16")
        leave("tst-sen-23", "State Senator, Florida District 23")
        c.post("/api/former/link", headers=fh.both(fh.rep_headers(rep_n), fh.citizen_headers(cit_n)))
        r = c.put("/api/former/optins", headers=fh.rep_headers(rep_n), json={"name": True})
        check("2: nickname waits for ID.me first", r.json()["link"]["name"]["status"] == "waiting")
        idme_verify(cit_n, "Charles Grassley-Test")
        r = c.get("/api/former/me", headers=fh.rep_headers(rep_n))
        check("2: a nickname goes to admin review", r.json()["link"]["name"]["status"] == "review", r.text[:300])
        reviews = c.get("/api/admin/transitions/name-reviews", headers=fh.admin_headers(db)).json()["items"]
        item = next((x for x in reviews if x["former_name"] == "Chuck Grassley-Test"), None)
        check("2: the admin sees it with the ID.me legal name",
              item is not None and item["legal_name"] == "Charles Grassley-Test", str(reviews))
        r = c.post(f"/api/admin/transitions/name-reviews/{item['link_id']}", headers=fh.admin_headers(db),
                   json={"decision": "approve", "source_url": "http://not-https.example"})
        check("2: approval needs an https source", r.status_code in (400, 422), f"{r.status_code}")
        r = c.post(f"/api/admin/transitions/name-reviews/{item['link_id']}", headers=fh.admin_headers(db),
                   json={"decision": "approve", "source_url": "https://www.flsenate.gov/Senators/test"})
        db.expire_all()
        check("2: approved with a source: applied",
              r.status_code == 200 and db.get(CitizenAccount, cit_n.id).display_name == "Chuck Grassley-Test", r.text[:200])
        link_n = db.get(FormerAccountLink, item["link_id"])
        check("2: the decision is recorded with who and the source",
              link_n.name_reviewed_by == fh.ADMIN_EMAIL and link_n.name_review_source.startswith("https://"))
        check("2: name rules", legal_name_match("Charles E. Grassley", "Chuck Grassley") == "review"
              and legal_name_match("Maria Elvira Salazar", "Maria Salazar") == "match"
              and legal_name_match("John Smith Jr.", "John Smith") == "match"
              and legal_name_match("Ana Lopez", "Ben Carter") == "mismatch")

        # ── 3. copies ─────────────────────────────────────────────
        R = fh.rep_headers(rep)
        db.add_all([TrackedBill(tracker_kind="rep", tracker_id=rep.id, bill_key="hr-1-119", snapshot_json="{}", prefs_json="{}"),
                    TrackedOfficial(tracker_kind="rep", tracker_id=rep.id, official_key="fl-sen-1", snapshot_json="{}",
                                    prefs_json="{}"),
                    SavedItem(tracker_kind="rep", tracker_id=rep.id, item_type="post", item_id=1)])
        rep_row = db.get(RepAccount, rep.id)
        rep_row.notification_prefs_json = json.dumps({"digest": True})
        db.commit()
        r = c.put("/api/former/optins", headers=R, json={"copies": True})
        counts = (r.json()["link"]["copies"] or {}).get("counts") or {}
        check("3: copies made", counts.get("bills") == 1 and counts.get("officials") == 1 and counts.get("saved") == 1, str(counts))
        db.expire_all()
        check("3: copies, not moves (the former account keeps its own)",
              db.query(TrackedBill).filter(TrackedBill.tracker_kind == "rep", TrackedBill.tracker_id == rep.id).count() == 1
              and db.query(TrackedBill).filter(TrackedBill.tracker_kind == "citizen", TrackedBill.tracker_id == cit.id).count() == 1)
        c.put("/api/former/optins", headers=R, json={"copies": True})
        check("3: never copied twice",
              db.query(TrackedBill).filter(TrackedBill.tracker_kind == "citizen", TrackedBill.tracker_id == cit.id).count() == 1)

        # ── 4. Served as ──────────────────────────────────────────
        C = fh.citizen_headers(db.get(CitizenAccount, cit.id))
        check("4: off until chosen", c.get("/api/former/citizen/served-as", headers=C).json()["served_as"] is None)
        r = c.put("/api/former/optins", headers=R, json={"served_as": True})
        line = c.get("/api/former/citizen/served-as", headers=C).json()["served_as"]
        check("4: on: the generated line", line == "Served as State Senator, Florida District 21 (2016 to 2026)", str(line))
        card = c.get(f"/api/former/citizen-card/{cit.id}").json()
        check("4: on the card", card.get("served_as") == line, str(card))
        c.put("/api/former/optins", headers=R, json={"served_as": False})
        check("4: removable from the former account",
              c.get("/api/former/citizen/served-as", headers=C).json()["served_as"] is None)
        c.put("/api/former/optins", headers=R, json={"served_as": True})
        r = c.post("/api/former/citizen/served-as/remove", headers=C)
        check("4: removable from the citizen account", r.json().get("removed") == 1
              and c.get("/api/former/citizen/served-as", headers=C).json()["served_as"] is None)
        check("4: each change is logged", db.query(PageTransitionLog).filter(
            PageTransitionLog.action == "optin_served_as").count() >= 3)
        cand = fh.make_candidate(db, "tst-cand-21", "Lee Lost", "lee21@example.org")
        cand_cit = fh.make_citizen(db, "Lee Citizen", "lee.citizen@example.org", district="FL-17")
        fh.set_transition(c, db, page_id="tst-cand-21", page_kind="candidate", event="lost_primary",
                          event_on=fh.days(-2), office_label="Governor of Florida", election_year="2026",
                          source_url="https://dos.fl.gov/elections/test")
        K = fh.candidate_headers(cand)
        c.post("/api/former/link", headers=fh.both(K, fh.citizen_headers(cand_cit)))
        r = c.put("/api/former/optins", headers=K, json={"served_as": True})
        check("4: no Served as line for candidates", r.status_code == 400, f"{r.status_code}")

        # ── 5. the card ───────────────────────────────────────────
        quiet = fh.make_citizen(db, "Quiet Reader", "quiet@example.org", district="FL-18")
        r = c.get(f"/api/former/citizen-card/{quiet.id}")
        check("5: no public content, no Served as: no card", r.status_code == 404, f"{r.status_code}")
        page_rep = fh.make_rep(db, "tst-sen-24", "Open Page", "open24@example.org")
        post = c.post("/api/pages/tst-sen-24/posts", headers=fh.rep_headers(page_rep), json={"body": "Hello"}).json()
        c.post(f"/api/pages/posts/{post['id']}/comments", headers=fh.citizen_headers(quiet), json={"body": "Hi"})
        r = c.get(f"/api/former/citizen-card/{quiet.id}")
        check("5: after a comment, the card shows the name only",
              r.status_code == 200 and set(r.json()) == {"citizen_id", "display_name", "served_as"}
              and r.json()["served_as"] is None, r.text[:200])

        # ── 6. closing rep and candidate accounts ─────────────────
        own = fh.make_rep(db, "tst-sen-25", "Taylor Record", "taylor25@example.org")
        OH = fh.rep_headers(own)
        p = c.post("/api/pages/tst-sen-25/posts", headers=OH, json={"body": "In office, on the record"}).json()
        n_posts = db.query(Post).filter(Post.official_id == "tst-sen-25").count()
        r = c.post("/api/auth/delete", headers=OH, json={"confirm_email": "taylor25@example.org",
                                                         "password": "pw-12345678", "mode": "hard"})
        db.expire_all()
        closed = db.query(RepAccount).filter(RepAccount.official_id == "tst-sen-25").first()
        check("6: deleting a rep account closes it", r.status_code == 200 and closed is not None
              and closed.closed_at is not None and not closed.is_active
              and closed.email.endswith("@closed.invalid") and closed.password_hash == "!closed", r.text[:200])
        check("6: what it published stays", db.query(Post).filter(Post.official_id == "tst-sen-25").count() == n_posts
              and db.get(Post, p["id"]).deleted_at is None)
        check("6: the closed account cannot sign in", c.get("/api/auth/me", headers=OH).status_code in (401, 403))
        r = c.get("/api/pages/tst-sen-25")
        check("6: the page still shows the posts", r.status_code == 200 and any(x["id"] == p["id"] for x in r.json()["posts"]))
        kc = fh.make_candidate(db, "tst-cand-25", "Casey Campaign", "casey25@example.org")
        KH = fh.candidate_headers(kc)
        kp = c.post("/api/pages/tst-cand-25/posts", headers=KH, json={"body": "Campaign promise"}).json()
        r = c.post("/api/candidate-auth/delete", headers=KH, json={"confirm_email": "casey25@example.org",
                                                                   "password": "pw-12345678", "mode": "hard"})
        db.expire_all()
        check("6: deleting a candidate account closes it too",
              r.status_code == 200 and db.get(CandidateAccount, kc.id).closed_at is not None
              and db.get(Post, kp["id"]) is not None, r.text[:200])
        gone = fh.make_citizen(db, "Gone Citizen", "gone@example.org", district="FL-19")
        gone_id = gone.id
        gone.password_hash = __import__("app.auth", fromlist=["hash_password"]).hash_password("pw-12345678")
        db.commit()
        c.post(f"/api/pages/posts/{post['id']}/comments", headers=fh.citizen_headers(gone), json={"body": "Bye"})
        r = c.post("/api/citizen-auth/delete", headers=fh.citizen_headers(gone),
                   json={"confirm_email": "gone@example.org", "password": "pw-12345678", "mode": "hard"})
        db.expire_all()
        # (Their comments go with the account through the database's
        # ON DELETE CASCADE, which SQLite here does not enforce.)
        check("6: citizen deletion stays as it is (the account is removed)",
              r.status_code == 200 and db.get(CitizenAccount, gone_id) is None, r.text[:200])

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
