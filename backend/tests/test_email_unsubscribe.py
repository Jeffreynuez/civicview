# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""One-click unsubscribe, the page-change email setting, the digest
(2026-10-16).

Run:  cd backend && python3 tests/test_email_unsubscribe.py   (exit 0 = pass)

  1. The token: signed, one account and one email type; a changed or
     made-up token does nothing.
  2. The digest carries List-Unsubscribe (https) and List-Unsubscribe-Post
     (RFC 8058), a visible footer link and the settings line, in both the
     HTML and the plain text; POSTMARK_DIGEST_STREAM picks its stream.
  3. The one-click POST turns off only the digest; a GET turns nothing
     off and opens the page that asks; the page's info call says what.
  4. A page-changes token turns off only those emails (citizens, reps
     and candidates); an election reminders token only reminder emails.
  5. Unsubscribe needs no CSRF header, even from a browser that is
     signed in.
  6. The setting: on by default, off and on again from settings; signed
     in only.
  7. The former-pages job honors it: the bell notice goes, the email
     does not; the preview counts the emails that will really go.
  8. The digest names the official on every item and links to it, lists
     no citizen polls and nothing hidden or deleted, and has no dashes.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()
os.environ["PUBLIC_API_URL"] = "https://api.civicview.app"

SENT = []


class _CaptureEmail:
    def send(self, *, to, subject, text_body, html_body=None, reply_to=None, headers=None,
             message_stream=None):
        SENT.append({"to": to, "subject": subject, "text": text_body, "html": html_body or "",
                     "headers": dict(headers or {}), "stream": message_stream})
        return True


def main() -> int:
    from datetime import UTC, datetime, timedelta
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.email_service as es
    from app.db import SessionLocal
    from app.models.pages import (CitizenAccount, Notification, PageNoticeDelivery, Poll, Post, RepAccount,
                                  RepEvent, TrackedOfficial)
    from app.services import digest_service as dg
    from app.services import email_unsubscribe as eu
    from app.services import page_lifecycle_job as job

    es.get_email_service = lambda: _CaptureEmail()
    check = fh.Checks()
    db = SessionLocal()
    now = datetime.now(UTC).replace(tzinfo=None)

    def fresh(model, pk):
        db.expire_all()
        return db.get(model, pk)

    with TestClient(m.app) as c:
        # ── 1. token ─────────────────────────────────────────────────
        ana = fh.make_citizen(db, "Ana Reader", "ana@example.org")
        tok = eu.make_token("citizen", ana.id, "digest")
        check("1 a token reads back", eu.read_token(tok) == {"k": "citizen", "i": ana.id, "t": "digest"})
        check("1 a changed token does nothing", eu.read_token(tok[:-2] + ("aa" if tok[-2:] != "aa" else "bb")) is None)
        check("1 a made-up token does nothing", eu.read_token("not-a-token") is None)
        try:
            eu.make_token("rep", 1, "digest")
            check("1 no digest token for a rep account", False)
        except ValueError:
            check("1 no digest token for a rep account", True)

        # ── 2. the digest email ──────────────────────────────────────
        rep = fh.make_rep(db, "tst-off-mail", "Jordan Official", "jordan@example.org")
        ana.digest_opt_in = True
        ana.election_reminder_email_at = now
        db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=ana.id, official_key="tst-off-mail"))
        db.add(Post(official_id="tst-off-mail", author_id=rep.id, body="Budget hearing recap", created_at=now))
        db.commit()
        os.environ["POSTMARK_DIGEST_STREAM"] = "digest"
        SENT.clear()
        dg.send_weekly_digests(db)
        os.environ.pop("POSTMARK_DIGEST_STREAM")
        mail = next((e for e in SENT if e["to"] == "ana@example.org"), None)
        check("2 the digest went out", mail is not None, SENT)
        mail = mail or {"headers": {}, "text": "", "html": "", "stream": None}
        lu = mail["headers"].get("List-Unsubscribe", "")
        check("2 List-Unsubscribe is one https URL", re.fullmatch(r"<https://api\.civicview\.app/api/email/unsubscribe/[^>]+>", lu)
              is not None, lu)
        check("2 List-Unsubscribe-Post: one-click", mail["headers"].get("List-Unsubscribe-Post") == "List-Unsubscribe=One-Click")
        check("2 a visible unsubscribe link in the HTML and the text",
              "/unsubscribe?token=" in mail["html"] and "/unsubscribe?token=" in mail["text"])
        check("2 the plain text has the settings line too",
              "Turn it off any time in Dashboard" in mail["text"] and "/?open=settings" in mail["text"], mail["text"])
        check("2 the digest's own stream when POSTMARK_DIGEST_STREAM is set", mail["stream"] == "digest", mail["stream"])
        token = lu[1:-1].rsplit("/", 1)[-1]

        # ── 3. one click turns off only the digest ───────────────────
        r = c.get(f"/api/email/unsubscribe/{token}", follow_redirects=False)
        check("3 a GET does not unsubscribe, it opens the page that asks",
              r.status_code == 303 and r.headers["location"].endswith(f"/unsubscribe?token={token}")
              and fresh(CitizenAccount, ana.id).digest_opt_in is True, r.status_code)
        r = c.get(f"/api/email/unsubscribe/{token}/info")
        check("3 the page learns what the link turns off",
              r.json() == {"email_type": "digest", "label": "the weekly digest email", "already_off": False}, r.text)
        r = c.post(f"/api/email/unsubscribe/{token}", data={"List-Unsubscribe": "One-Click"})
        a = fresh(CitizenAccount, ana.id)
        check("3 the one-click POST turns the digest off", r.status_code == 200 and a.digest_opt_in is False, r.text)
        check("3 and nothing else", a.election_reminder_email_at is not None and a.page_change_email_off_at is None
              and a.election_reminders_off_at is None)
        check("3 a second click is harmless", c.post(f"/api/email/unsubscribe/{token}").json()["already_off"] is True)
        check("3 no-store", r.headers.get("cache-control") == "no-store")
        check("3 a bad token is a 404", c.post("/api/email/unsubscribe/nope").status_code == 404)
        for bad in ("nope", token + "x", "x&next=@evil.example"):
            r = c.get(f"/api/email/unsubscribe/{bad}", follow_redirects=False)
            check(f"3 a GET with a link that does not verify opens the page without it ({bad[:12]})",
                  r.status_code == 303 and r.headers["location"] == "https://civicview.app/unsubscribe",
                  r.headers.get("location"))

        # ── 4. the other types ───────────────────────────────────────
        ptok = eu.make_token("citizen", ana.id, "page_changes")
        c.post(f"/api/email/unsubscribe/{ptok}")
        a = fresh(CitizenAccount, ana.id)
        check("4 page changes off, reminder email still on",
              a.page_change_email_off_at is not None and a.election_reminder_email_at is not None)
        etok = eu.make_token("citizen", ana.id, "election_reminders")
        c.post(f"/api/email/unsubscribe/{etok}")
        a = fresh(CitizenAccount, ana.id)
        check("4 reminder emails off, reminders themselves still on",
              a.election_reminder_email_at is None and a.election_reminders_off_at is None)
        rtok = eu.make_token("rep", rep.id, "page_changes")
        c.post(f"/api/email/unsubscribe/{rtok}")
        check("4 a rep account's page-change emails", fresh(RepAccount, rep.id).page_change_email_off_at is not None)

        # ── 5. no CSRF needed ────────────────────────────────────────
        ben = fh.make_citizen(db, "Ben Signed", "ben@example.org", district="FL-12")
        btok = eu.make_token("citizen", ben.id, "page_changes")
        h = {k: v for k, v in fh.citizen_headers(ben).items() if k != "X-CSRF-Token"}
        r = c.post(f"/api/email/unsubscribe/{btok}", headers=h)
        check("5 a signed-in browser with no CSRF header can unsubscribe", r.status_code == 200, r.status_code)
        r = c.put("/api/email/page-changes", json={"enabled": True}, headers=h)
        check("5 but the settings write still needs CSRF", r.status_code == 403, r.status_code)

        # ── 6. the setting ───────────────────────────────────────────
        cy = fh.make_citizen(db, "Cy Setting", "cy@example.org", district="FL-13")
        H = fh.citizen_headers(cy)
        r = c.get("/api/email/page-changes", headers=H)
        check("6 on by default", r.json() == {"identity": "citizen", "enabled": True, "email_available": True}, r.text)
        r = c.put("/api/email/page-changes", json={"enabled": False}, headers=H)
        check("6 off from settings", r.json()["enabled"] is False and fresh(CitizenAccount, cy.id).page_change_email_off_at)
        r = c.put("/api/email/page-changes", json={"enabled": True}, headers=H)
        check("6 and on again", r.json()["enabled"] is True and fresh(CitizenAccount, cy.id).page_change_email_off_at is None)
        r = c.get("/api/email/page-changes?identity=rep", headers=fh.rep_headers(rep))
        check("6 reps have it too", r.json()["identity"] == "rep" and r.json()["enabled"] is False, r.text)
        check("6 signed in only", c.get("/api/email/page-changes").status_code == 401)

        # ── 7. the former-pages job honors it ────────────────────────
        page = "tst-sen-mail"
        fh.make_rep(db, page, "Morgan Leaving", "morgan@example.org")
        on = fh.make_citizen(db, "Ola On", "ola@example.org", district="FL-14")
        off = fh.make_citizen(db, "Oz Off", "oz@example.org", district="FL-15")
        off.page_change_email_off_at = now
        db.commit()
        for t in (on, off):
            db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=t.id, official_key=page))
        db.commit()
        fh.set_transition(c, db, page_id=page, page_kind="official", event="left_office", event_on=fh.days(0),
                          office_label="State Senator, Florida District 96", served_from="2020", served_to="2026",
                          display_name="Morgan Leaving")
        pv = c.get("/api/admin/transitions/run/preview", headers=fh.admin_headers(db)).json()
        tr = next((i for i in pv["items"] if i["page_id"] == page and i["notice"] == "trackers"), {})
        check("7 the preview counts only the emails that will go", tr.get("bell") == 2 and tr.get("emails") == 1, tr)
        SENT.clear()
        job.run_page_lifecycle(db)
        db.expire_all()
        bell_off = db.query(Notification).filter(Notification.recipient_id == off.id,
                                                 Notification.kind == "tracked_left_office").count()
        check("7 turned off: the bell notice still comes", bell_off == 1)
        check("7 but no email", not any(e["to"] == "oz@example.org" for e in SENT), [e["to"] for e in SENT])
        check("7 turned on: the email goes", any(e["to"] == "ola@example.org" for e in SENT))
        claim = db.query(PageNoticeDelivery).filter(PageNoticeDelivery.recipient_id == off.id,
                                                    PageNoticeDelivery.notice == "trackers").one()
        check("7 recorded as turned off", claim.email_status == "turned_off", claim.email_status)

        # ── 8. digest content ────────────────────────────────────────
        dee = fh.make_citizen(db, "Dee Digest", "dee@example.org", district="FL-16")
        dee.digest_opt_in = True
        db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=dee.id, official_key="tst-off-mail"))
        hidden = Post(official_id="tst-off-mail", author_id=rep.id, body="Hidden one", created_at=now,
                      hide_reason="reported")
        gone = Post(official_id="tst-off-mail", author_id=rep.id, body="Deleted one", created_at=now,
                    deleted_at=now)
        survey = Post(official_id="tst-off-mail", author_id=rep.id, body="Survey", created_at=now)
        db.add_all([hidden, gone, survey])
        db.flush()
        db.add(Poll(question="Which road first?", post_id=survey.id, created_at=now))
        db.add(Poll(question="Poll on a hidden post?", post_id=hidden.id, created_at=now))
        db.add(Poll(question="A citizen poll about Jordan?", target_official_id="tst-off-mail",
                    author_kind="citizen", created_at=now))
        db.add(RepEvent(official_id="tst-off-mail", author_id=rep.id, title="Town hall",
                        start_at=(now + timedelta(days=2)).isoformat()))
        db.add(RepEvent(official_id="tst-off-mail", author_id=rep.id, title="Cancelled",
                        start_at=(now + timedelta(days=2)).isoformat(), deleted_at=now))
        db.commit()
        data = dg.build_digest(db, fresh(CitizenAccount, dee.id))
        subject, html_body, text_body = dg.render_digest(data, unsubscribe_url="https://civicview.app/unsubscribe?token=x")
        items = data["posts"] + data["new_polls"] + data["closing_polls"] + data["events"]
        check("8 every item names the official", items and all(i["official_name"] == "Jordan Official" for i in items),
              [i.get("official_name") for i in items])
        check("8 every item links to it", all(i["url"].startswith("https://civicview.app/?page=tst-off-mail") for i in items))
        check("8 posts link to the post", all(p["url"].endswith(f"#post-{p['url'].rsplit('#post-', 1)[-1]}")
                                              and "#post-" in p["url"] for p in data["posts"]))
        previews = [p["preview"] for p in data["posts"]]
        check("8 hidden and deleted posts are left out", "Hidden one" not in previews and "Deleted one" not in previews,
              previews)
        polls = [p["question"] for p in data["new_polls"]]
        check("8 the official's poll is listed", "Which road first?" in polls, polls)
        check("8 no citizen polls, no polls on hidden posts",
              "A citizen poll about Jordan?" not in polls and "Poll on a hidden post?" not in polls, polls)
        check("8 deleted events are left out", [e["title"] for e in data["events"]] == ["Town hall"], data["events"])
        check("8 the name and link are in the text", "Jordan Official: Budget hearing recap" in text_body
              and "https://civicview.app/?page=tst-off-mail#post-" in text_body, text_body)
        check("8 no dashes in the digest", not re.search("[\u2013\u2014]", subject + html_body + text_body))

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
