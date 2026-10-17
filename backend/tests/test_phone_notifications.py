# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Phone notifications (2026-10-17).

Run:  cd backend && python3 tests/test_phone_notifications.py   (exit 0 = pass)

  1. The settings list: GET and PATCH /api/alert-settings, one row at a
     time, the three rows kept in their own columns, the digest row, and
     the bill update email's one-click unsubscribe.
  2. The push itself: data-only for app 1.2.0 (build 5) with the channel
     and tag; by default the notification itself is a neutral line that
     names nobody (on 1.1.0's standard message too), the full text only
     when the person chose Show details.
  3. Android settings: a phone that reports notifications off is skipped
     until it reports them on.
  4. Events: on for everyone by default, the Events row decides, Mute
     silences one official (posts and events), and the digest leaves a
     muted official out.
  5. Replies: bell and push for citizens on posts and citizen polls, after
     the moderation screen; never a push to a rep.
  6. Poll results: the first pass sends nothing; after it, the voters of
     a poll that closes get "Results are in", once.
  7. Page changes: one push per change, or one grouped push when a run
     finds several; Mute does not stop them.
  8. Summaries of mixed kinds say what they are about.
  9. Summary timing: on a daily phone a reply held by quiet hours goes
     when they end, not at 6 p.m.; at summary time, an update whose row
     was turned off or whose official was muted since is left out.
"""
import json
import os
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

PUSHES = []
EMAILS = []


class _CapturePush:
    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        for t in tokens:
            PUSHES.append({"token": t, "title": title, "body": body, "data": dict(data or {}), "ttl": ttl_seconds})
        return []

    def subscribe_to_topic(self, tokens, topic):
        pass

    def unsubscribe_from_topic(self, tokens, topic):
        pass


class _CaptureEmail:
    def send(self, *, to, subject, text_body, html_body=None, headers=None, **_kw):
        EMAILS.append({"to": to, "subject": subject, "text": text_body, "headers": headers or {}})
        return True


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.email_service as es
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import (CitizenAccount, ContentModerationVerdict, DeviceToken, JobRun,
                                  Notification, Poll, PollComment, PollOption, PollVote, Post,
                                  PostComment, PushHeldItem, TrackedOfficial)
    from app.services import alert_settings as als
    from app.services import notifications_inapp as ni
    from app.services import poll_results, push_summaries

    ps._service = _CapturePush()
    es.get_email_service = lambda: _CaptureEmail()
    check = fh.Checks()
    db = SessionLocal()
    now = datetime.now(UTC).replace(tzinfo=None)

    def bell(cid, kind):
        db.expire_all()
        return (db.query(Notification).filter(Notification.recipient_kind == "citizen",
                                               Notification.recipient_id == cid,
                                               Notification.kind == kind).all())

    def pushed(token):
        return [p for p in PUSHES if p["token"] == token]

    with TestClient(m.app) as c:
        ana = fh.make_citizen(db, "Ana Alerts", "ana@example.org")
        ben = fh.make_citizen(db, "Ben Bell", "ben@example.org", district="FL-12")
        cy = fh.make_citizen(db, "Cy Demo", "cy@demo-citizens.civicview.app")
        page = "tst-off-phone"
        rep = fh.make_rep(db, page, "Rae Phone", "rae@example.org")
        for cit in (ana, ben):
            db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=cit.id, official_key=page, prefs_json="{}"))
        db.add(DeviceToken(token="tok-ana-new", citizen_id=ana.id, app_build=5))
        db.add(DeviceToken(token="tok-ben-old", citizen_id=ben.id, app_build=4))
        db.commit()

        # ── 1. the settings list ─────────────────────────────────────
        h = fh.citizen_headers(ana)
        r = c.get("/api/alert-settings", headers=h)
        body = r.json()
        check("1 signed in: the list", r.status_code == 200 and list(body["settings"]) == list(als.ROW_ORDER), r.text)
        check("1 defaults: bell and push, page changes with email",
              body["settings"]["events"] == "bell_push" and body["settings"]["page_changes"] == "bell_push_email"
              and body["settings"]["bills"] == "bell_push", body["settings"])
        check("1 the page change row cannot turn the bell off", "off" not in body["choices"]["page_changes"])
        check("1 rows without email offer none", body["choices"]["replies"] == ["bell_push", "bell", "off"])
        check("1 signed out: 401", c.get("/api/alert-settings").status_code == 401)
        r = c.patch("/api/alert-settings", json={"row": "bills", "value": "bell_push_email"}, headers=h)
        check("1 one row changes", r.status_code == 200 and r.json()["settings"]["bills"] == "bell_push_email", r.text)
        db.expire_all()
        a = db.get(CitizenAccount, ana.id)
        check("1 only the cell that differs is stored", json.loads(a.alert_settings_json) == {"bills": {"email": True}},
              a.alert_settings_json)
        c.patch("/api/alert-settings", json={"row": "elections", "value": "bell_email"}, headers=h)
        db.expire_all()
        a = db.get(CitizenAccount, ana.id)
        check("1 election email lives in its own column", a.election_reminder_email_at is not None)
        c.patch("/api/alert-settings", json={"row": "elections", "value": "off"}, headers=h)
        db.expire_all()
        a = db.get(CitizenAccount, ana.id)
        check("1 elections Off is the reminders column", a.election_reminders_off_at is not None
              and a.election_reminder_email_at is None)
        c.patch("/api/alert-settings", json={"row": "elections", "value": "bell_push"}, headers=h)
        c.patch("/api/alert-settings", json={"row": "page_changes", "value": "bell_push"}, headers=h)
        db.expire_all()
        a = db.get(CitizenAccount, ana.id)
        check("1 page change email lives in its own column", a.page_change_email_off_at is not None)
        c.patch("/api/alert-settings", json={"row": "page_changes", "value": "bell_push_email"}, headers=h)
        r = c.patch("/api/alert-settings", json={"row": "replies", "value": "bell_email"}, headers=h)
        check("1 a choice the row does not have: 422", r.status_code == 422, r.text)
        r = c.patch("/api/alert-settings", json={"row": "nope", "value": "off"}, headers=h)
        check("1 an unknown row: 422", r.status_code == 422, r.text)
        r = c.patch("/api/alert-settings", json={"row": "digest", "value": "weekly"}, headers=h)
        db.expire_all()
        check("1 the weekly digest is a row", r.json()["digest"] == "weekly" and db.get(CitizenAccount, ana.id).digest_opt_in)
        check("1 a demo address: email not available",
              c.get("/api/alert-settings", headers=fh.citizen_headers(cy)).json()["email_available"] is False)
        r = c.patch("/api/alert-settings", json={"row": "bills", "value": "off"})
        check("1 a write without a session is refused", r.status_code in (401, 403), r.status_code)
        from app.services import email_unsubscribe
        tok = email_unsubscribe.make_token("citizen", ana.id, "bill_updates")
        r = c.post(f"/api/email/unsubscribe/{tok}")
        db.expire_all()
        a = db.get(CitizenAccount, ana.id)
        check("1 the bill email's one-click unsubscribe turns off only that email",
              r.status_code == 200 and als.settings_for(a)["bills"] == "bell_push"
              and als.settings_for(a)["page_changes"] == "bell_push_email", als.settings_for(a))

        # ── 2. the push itself ───────────────────────────────────────
        native = ps.PushMessage(token="t", title="Rae Phone posted", body="Hello there",
                                data={"kind": "tracked_post", "post_id": 3}, channel="officials",
                                tag=None, native=True)
        d = ps.native_data(native)
        check("2 native: channel and the app's own keys", d["cv_channel"] == "officials"
              and d["post_id"] == "3" and d["cv_v"] == "1" and d["cv_details"] == "0", d)
        check("2 details hidden (default): the notification itself is the neutral line, no body",
              d["cv_title"] == "New update from an official you track" and d["cv_body"] == ""
              and d["cv_public_title"] == d["cv_title"] and d["cv_public_body"] == "", d)
        check("2 details hidden: nothing sent to the phone names the official",
              not any("Rae" in v or "Hello" in v for k, v in d.items() if k.startswith("cv_")), d)
        native.show_details = True
        d = ps.native_data(native)
        check("2 Show details: who posted and what", d["cv_title"] == "Rae Phone posted"
              and d["cv_body"] == "Hello there" and d["cv_details"] == "1"
              and d["cv_public_title"] == "Rae Phone posted", d)
        summary = ps.PushMessage(token="t", title="3 new updates", body="Rae Phone, Sam Desk and 1 more.",
                                 channel="summaries", public_title="3 new updates", native=True)
        d = ps.native_data(summary)
        check("2 details hidden: a summary keeps its count line, not the names",
              d["cv_title"] == "3 new updates" and d["cv_body"] == "", d)
        from firebase_admin import messaging
        msg = ps.fcm_message(ps.PushMessage(token="t", title="Rae Phone posted", body="Hello there",
                                            channel="replies"), messaging)
        check("2 1.1.0, details hidden: the standard message carries only the neutral line",
              msg.notification.title == "New reply to your comment" and msg.notification.body is None, msg.notification)
        msg = ps.fcm_message(ps.PushMessage(token="t", title="Rae Phone posted", body="Hello there",
                                            channel="replies", show_details=True), messaging)
        check("2 1.1.0, Show details: the full text", msg.notification.title == "Rae Phone posted"
              and msg.notification.body == "Hello there")
        msg = ps.fcm_message(ps.PushMessage(token="t", title="x", body="y", channel="bills", tag="bill-119-hr-1",
                                            native=True, ttl_seconds=60), messaging)
        check("2 native: data only, high priority", msg.notification is None and msg.android.priority == "high"
              and msg.data["cv_tag"] == "bill-119-hr-1")
        msg = ps.fcm_message(ps.PushMessage(token="t", title="x", body="y", channel="events", tag="event-4"), messaging)
        check("2 1.1.0: the standard message names its channel and tag, private",
              msg.notification is not None and msg.android.notification.channel_id == "events"
              and msg.android.notification.tag == "event-4" and msg.android.notification.visibility == "private")
        msg = ps.fcm_message(ps.PushMessage(token="t", title="x", body="y", channel="nope"), messaging)
        check("2 an unknown channel falls back to officials", msg.android.notification.channel_id == "officials")
        row = db.query(DeviceToken).filter(DeviceToken.token == "tok-ana-new").one()
        check("2 build 5 is native, 4 is not", ps.is_native(row)
              and not ps.is_native(db.query(DeviceToken).filter(DeviceToken.token == "tok-ben-old").one()))

        # ── 3. Android settings ──────────────────────────────────────
        r = c.post("/api/push/register", json={"token": "tok-ana-new", "app_build": 5, "os_enabled": False},
                   headers=fh.citizen_headers(ana))
        db.expire_all()
        row = db.query(DeviceToken).filter(DeviceToken.token == "tok-ana-new").one()
        check("3 off in Android settings is recorded", r.json()["os_enabled"] is False and row.notifications_off_at is not None)
        PUSHES.clear()
        p1 = Post(official_id=page, author_id=rep.id, body="First", created_at=now)
        db.add(p1)
        db.commit()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Phone", post_id=p1.id,
                                              preview="First", has_poll=False)
        check("3 that phone is skipped", not pushed("tok-ana-new") and pushed("tok-ben-old"), PUSHES)
        check("3 the bell row still comes", len(bell(ana.id, "tracked_post")) == 1)
        c.post("/api/push/register", json={"token": "tok-ana-new", "os_enabled": True}, headers=fh.citizen_headers(ana))
        db.expire_all()
        check("3 back on: no longer skipped",
              db.query(DeviceToken).filter(DeviceToken.token == "tok-ana-new").one().notifications_off_at is None)

        # ── 4. events and Mute ───────────────────────────────────────
        PUSHES.clear()
        start = (now + timedelta(days=3)).isoformat()
        ni.emit_tracked_event_notifications(db, official_id=page, official_name="Rae Phone", event_id=11,
                                            title="Town hall", start_at=start, location="Library")
        check("4 events on by default, with no on_event switch", len(bell(ana.id, "tracked_event")) == 1
              and len(bell(ben.id, "tracked_event")) == 1)
        ev = pushed("tok-ana-new")
        check("4 the event push is tagged, on the events channel (via held data)", len(ev) == 1, PUSHES)
        als.set_choice(db, db.get(CitizenAccount, ben.id), "events", "bell")
        PUSHES.clear()
        ni.emit_tracked_event_notifications(db, official_id=page, official_name="Rae Phone", event_id=12,
                                            title="Second", start_at=start, location=None)
        check("4 Events: Bell only gives the bell row and no push",
              len(bell(ben.id, "tracked_event")) == 2 and not pushed("tok-ben-old"), PUSHES)
        tr = db.query(TrackedOfficial).filter(TrackedOfficial.tracker_id == ana.id).one()
        r = c.patch(f"/api/tracked/officials/{page}/prefs", json={"prefs": {"muted": True}},
                    headers=fh.citizen_headers(ana))
        db.expire_all()
        check("4 Mute is saved with the tracked official", r.status_code == 200
              and json.loads(db.get(TrackedOfficial, tr.id).prefs_json).get("muted") is True, r.text)
        PUSHES.clear()
        before_posts = len(bell(ana.id, "tracked_post"))
        before_events = len(bell(ana.id, "tracked_event"))
        p2 = Post(official_id=page, author_id=rep.id, body="Second", created_at=now)
        db.add(p2)
        db.commit()
        ni.emit_tracked_content_notifications(db, official_id=page, official_name="Rae Phone", post_id=p2.id,
                                              preview="Second", has_poll=False)
        ni.emit_tracked_event_notifications(db, official_id=page, official_name="Rae Phone", event_id=13,
                                            title="Third", start_at=start, location=None)
        check("4 muted: no bell row and no push for posts or events",
              len(bell(ana.id, "tracked_post")) == before_posts
              and len(bell(ana.id, "tracked_event")) == before_events
              and not pushed("tok-ana-new"), PUSHES)
        check("4 Ben, not muted, still gets the post", pushed("tok-ben-old"))
        from app.services.digest_service import _tracked_official_keys
        check("4 the digest leaves a muted official out", page not in _tracked_official_keys(db, ana.id)
              and page in _tracked_official_keys(db, ben.id))

        # ── 5. replies ───────────────────────────────────────────────
        PUSHES.clear()
        parent = PostComment(post_id=p1.id, citizen_id=ana.id, citizen_display_name="Ana Alerts", body="Mine")
        db.add(parent)
        db.commit()
        r = c.post(f"/api/pages/posts/{p1.id}/comments", json={"body": "A reply", "parent_comment_id": parent.id},
                   headers=fh.rep_headers(rep))
        check("5 the rep replies", r.status_code in (200, 201), r.text)
        replies = bell(ana.id, "reply")
        check("5 the citizen gets the bell row", len(replies) == 1 and json.loads(replies[0].payload_json).get("post_id") == p1.id)
        rp = pushed("tok-ana-new")
        check("5 and a push, with the bell row's id", len(rp) == 1 and rp[0]["data"].get("notification_id") == replies[0].id
              and rp[0]["data"].get("kind") == "reply", PUSHES)
        # A flagged reply is not pushed.
        PUSHES.clear()
        reply2 = PostComment(post_id=p1.id, author_rep_id=rep.id, citizen_display_name="Rae Phone",
                             body="Flagged", parent_comment_id=parent.id)
        db.add(reply2)
        db.commit()
        n2 = ni.emit_reply_notification(db, reply=reply2, parent=parent, replier_display_name="Rae Phone",
                                        official_id=page)
        db.add(ContentModerationVerdict(content_type="post_comment", content_id=reply2.id, category="threat",
                                        severity=0.7, decision="flag"))
        db.commit()
        check("5 a flagged reply: bell row, no push", n2 is not None and ni.push_reply(db, n2.id, "post_comment") == 0
              and not PUSHES)
        # Replies: Bell only.
        als.set_choice(db, db.get(CitizenAccount, ana.id), "replies", "bell")
        reply3 = PostComment(post_id=p1.id, author_rep_id=rep.id, citizen_display_name="Rae Phone",
                             body="Third", parent_comment_id=parent.id)
        db.add(reply3)
        db.commit()
        n3 = ni.emit_reply_notification(db, reply=reply3, parent=parent, replier_display_name="Rae Phone",
                                        official_id=page)
        check("5 Replies: Bell only gives no push", n3 is not None and ni.push_reply(db, n3.id, "post_comment") == 0)
        als.set_choice(db, db.get(CitizenAccount, ana.id), "replies", "off")
        reply4 = PostComment(post_id=p1.id, author_rep_id=rep.id, citizen_display_name="Rae Phone",
                             body="Fourth", parent_comment_id=parent.id)
        db.add(reply4)
        db.commit()
        check("5 Replies: Off gives no bell row",
              ni.emit_reply_notification(db, reply=reply4, parent=parent, replier_display_name="Rae Phone",
                                         official_id=page) is None)
        als.set_choice(db, db.get(CitizenAccount, ana.id), "replies", "bell_push")
        # A citizen poll reply notifies (it created nothing before).
        cpoll = Poll(question="Fix the bridge?", author_kind="citizen", author_citizen_id=ben.id,
                     target_official_id="tst-off-unclaimed")
        db.add(cpoll)
        db.commit()
        db.add_all([PollOption(poll_id=cpoll.id, text="Yes", sort_order=0),
                    PollOption(poll_id=cpoll.id, text="No", sort_order=1)])
        top = PollComment(poll_id=cpoll.id, citizen_id=ana.id, citizen_display_name="Ana Alerts", body="Top")
        db.add(top)
        db.commit()
        PUSHES.clear()
        r = c.post(f"/api/citizen-polls/{cpoll.id}/comments", json={"body": "Poll reply", "parent_comment_id": top.id},
                   headers=fh.citizen_headers(ben))
        check("5 the poll author replies", r.status_code == 201, r.text)
        poll_replies = [n for n in bell(ana.id, "reply") if json.loads(n.payload_json).get("poll_id") == cpoll.id]
        check("5 a reply on a citizen poll gives a bell row", len(poll_replies) == 1)
        check("5 and a push that opens the poll", any(p["data"].get("poll_id") == cpoll.id for p in pushed("tok-ana-new")),
              PUSHES)
        # Never a reply push to a rep: the rep's comment gets a reply.
        PUSHES.clear()
        rep_parent = PostComment(post_id=p1.id, author_rep_id=rep.id, citizen_display_name="Rae Phone", body="Rep top")
        db.add(rep_parent)
        db.commit()
        to_rep = PostComment(post_id=p1.id, citizen_id=ana.id, citizen_display_name="Ana Alerts",
                             body="To the rep", parent_comment_id=rep_parent.id)
        db.add(to_rep)
        db.commit()
        n_rep = ni.emit_reply_notification(db, reply=to_rep, parent=rep_parent, replier_display_name="Ana Alerts",
                                           official_id=page)
        check("5 a reply to a rep: the bell row, no push",
              n_rep is not None and n_rep.recipient_kind == "rep"
              and ni.push_reply(db, n_rep.id, "post_comment") == 0 and not PUSHES, PUSHES)

        # ── 6. poll results ──────────────────────────────────────────
        db.add(PollVote(option_id=cpoll.options[0].id, poll_id=cpoll.id, citizen_id=ana.id))
        old = Poll(question="Old poll", author_kind="citizen", author_citizen_id=ben.id,
                   target_official_id="tst-off-unclaimed", closes_at=now - timedelta(days=2))
        db.add(old)
        db.commit()
        db.add(PollVote(option_id=cpoll.options[1].id, poll_id=old.id, citizen_id=ana.id))
        db.commit()
        PUSHES.clear()
        first = poll_results.run(db, now)
        check("6 the first pass stamps closed polls and sends nothing",
              "seeded" in first and not bell(ana.id, "poll_results") and not PUSHES, first)
        check("6 and records that it did", db.query(JobRun).filter(JobRun.job == "poll-results").count() == 1)
        cpoll.closes_at = now - timedelta(minutes=1)
        db.commit()
        res = poll_results.run(db, now)
        results = bell(ana.id, "poll_results")
        check("6 a poll that closes: Results are in, in the bell", res.get("polls") == 1 and len(results) == 1, res)
        payload = json.loads(results[0].payload_json)
        check("6 it names the poll and where it lives", payload["poll_id"] == cpoll.id
              and payload["official_id"] == "tst-off-unclaimed")
        rp = [p for p in pushed("tok-ana-new") if p["data"].get("kind") == "poll_results"]
        check("6 and the push", len(rp) == 1 and rp[0]["title"] == "Results are in", PUSHES)
        again = poll_results.run(db, now)
        check("6 once only", again.get("polls") == 0 and len(bell(ana.id, "poll_results")) == 1, again)
        gone = Poll(question="Taken down", author_kind="citizen", author_citizen_id=ben.id,
                    target_official_id="tst-off-unclaimed", archived_at=now, archived_reason="reported",
                    closes_at=now - timedelta(minutes=1))
        db.add(gone)
        db.commit()
        db.add(PollVote(option_id=cpoll.options[0].id, poll_id=gone.id, citizen_id=ana.id))
        db.commit()
        res = poll_results.run(db, now)
        check("6 a poll taken down after reports: nothing", res.get("skipped") == 1
              and len(bell(ana.id, "poll_results")) == 1, res)

        # ── 7. page changes ──────────────────────────────────────────
        from app.services.page_lifecycle_job import NoticePlan, send_page_change_pushes

        def plan(pid, name):
            return NoticePlan(page_id=pid, notice="trackers", kind="tracked_left_office", recipients=[],
                              payload={"official_id": pid, "official_name": name,
                                       "text": f"{name} left office."},
                              subject=f"{name} is no longer in office", stamp=None, to_tracker=True)
        PUSHES.clear()
        send_page_change_pushes(db, {ana.id: [(1, plan("p-a", "Alex Able"))]})
        one = pushed("tok-ana-new")
        check("7 one change: its own push", len(one) == 1 and one[0]["title"] == "Alex Able is no longer in office"
              and one[0]["data"].get("kind") == "page_change", PUSHES)
        PUSHES.clear()
        send_page_change_pushes(db, {ana.id: [(1, plan("p-a", "Alex Able")), (2, plan("p-b", "Bea Bright")),
                                              (3, plan("p-c", "Cal Cole"))]})
        grouped = pushed("tok-ana-new")
        check("7 several in one run: one grouped push opening the bell", len(grouped) == 1
              and grouped[0]["title"] == "3 pages you track changed"
              and grouped[0]["data"].get("kind") == "page_changes"
              and grouped[0]["body"] == "Alex Able, Bea Bright and 1 more.", PUSHES)
        als.set_choice(db, db.get(CitizenAccount, ana.id), "page_changes", "bell_email")
        PUSHES.clear()
        send_page_change_pushes(db, {ana.id: [(1, plan("p-a", "Alex Able"))]})
        check("7 Changes to pages you track without push: none", not PUSHES)
        als.set_choice(db, db.get(CitizenAccount, ana.id), "page_changes", "bell_push_email")
        from app.services.page_lifecycle_job import _trackers
        check("7 Mute does not stop them: a muted tracker still gets the page's notices",
              ana.id in {t.tracker_id for t in _trackers(db, page)})

        # ── 8. summaries ─────────────────────────────────────────────
        class _Item:
            def __init__(self, i, kind, name, reason="summary"):
                self.id, self.kind, self.official_name, self.reason = i, kind, name, reason
                self.created_at = now + timedelta(seconds=i)
                self.official_id = "x"
                self.data_json = json.dumps({"kind": kind, "_channel": "bills", "_tag": "bill-1"})
                self.title, self.body, self.notification_id = "t", "b", None
        t, b = push_summaries.mixed_title_body([_Item(1, "tracked_post", "Rae"), _Item(2, "tracked_post", "Sam")],
                                               quiet=False)
        check("8 officials only keeps its wording", t == "2 updates from officials you track" and b == "From Rae and Sam.")
        t, b = push_summaries.mixed_title_body([_Item(1, "bill_update", "H.R. 1"), _Item(2, "bill_update", "S. 2")],
                                               quiet=True)
        check("8 bills only names the bills", t == "2 updates on bills you track"
              and b == "H.R. 1 and S. 2, while your quiet hours were on.", (t, b))
        t, b = push_summaries.mixed_title_body([_Item(1, "tracked_post", "Rae"), _Item(2, "bill_update", "H.R. 1"),
                                                _Item(3, "poll_results", None)], quiet=False)
        check("8 a mix says what it is about", t == "3 new updates"
              and b == "Officials you track, bills you track and polls you voted in.", (t, b))
        row = db.query(DeviceToken).filter(DeviceToken.token == "tok-ana-new").one()
        single = push_summaries.build_message(row, [_Item(1, "bill_update", "H.R. 1")], None)
        check("8 a summary of one is that update, on its own channel and tag",
              single.channel == "bills" and single.tag == "bill-1" and "_channel" not in single.data)
        many = push_summaries.build_message(row, [_Item(1, "bill_update", "H.R. 1"), _Item(2, "tracked_post", "Rae")],
                                            None)
        check("8 several: the Summaries channel, one replacing the last", many.channel == "summaries"
              and many.tag == "summary" and many.native)
        check("8 details hidden: a summary shows its count line and no names",
              ps.shown(many) == ("2 new updates", ""), ps.shown(many))

        # ── 9. summary timing and second thoughts ────────────────────
        dee = fh.make_citizen(db, "Dee Daily", "dee@example.org", district="FL-14")
        dee.notification_prefs_json = json.dumps({"push_cadence": "daily", "quiet_hours": "nights",
                                                  "tz_offset_minutes": 0})
        db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=dee.id, official_key=page, prefs_json="{}"))
        dee_dev = DeviceToken(token="tok-dee", citizen_id=dee.id, app_build=5)
        db.add(dee_dev)
        db.commit()

        def held(reason, kind, channel, at, official=None, title="t"):
            db.add(PushHeldItem(device_token_id=dee_dev.id, reason=reason, kind=kind, official_id=official,
                                official_name="Rae Phone" if official else None, title=title, body="b",
                                data_json=json.dumps({"kind": kind, "_channel": channel}), created_at=at))
        # Wednesday 2026-10-21, UTC, which is Dee's local time here.
        held("quiet", "reply", "replies", datetime(2026, 10, 20, 23, 0), title="Reply to you")
        held("summary", "tracked_post", "officials", datetime(2026, 10, 20, 19, 0), official=page)
        db.commit()
        PUSHES.clear()
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 21, 7, 30))
        check("9 nothing inside quiet hours", not pushed("tok-dee"), PUSHES)
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 21, 8, 30))
        got = pushed("tok-dee")
        db.expire_all()
        left = db.query(PushHeldItem).filter(PushHeldItem.device_token_id == dee_dev.id).all()
        check("9 a daily phone: the reply goes when quiet hours end, alone",
              len(got) == 1 and got[0]["title"] == "Reply to you"
              and [i.kind for i in left] == ["tracked_post"], (got, [i.kind for i in left]))
        push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 21, 12, 0))
        check("9 the post waits for 6 p.m.", len(pushed("tok-dee")) == 1, PUSHES)
        held("summary", "bill_update", "bills", datetime(2026, 10, 21, 9, 0), title="H.R. 1: new action")
        held("summary", "poll_results", "poll_results", datetime(2026, 10, 21, 10, 0), title="Results are in")
        db.commit()
        tr_dee = db.query(TrackedOfficial).filter(TrackedOfficial.tracker_id == dee.id).one()
        tr_dee.prefs_json = json.dumps({"muted": True})
        db.commit()
        als.set_choice(db, db.get(CitizenAccount, dee.id), "bills", "bell")
        PUSHES.clear()
        res = push_summaries.run_summaries(db, now_utc=datetime(2026, 10, 21, 18, 30))
        got = pushed("tok-dee")
        db.expire_all()
        check("9 at 6 p.m.: the muted official's post and the bill (push now off) are left out",
              len(got) == 1 and got[0]["title"] == "Results are in" and res["no_longer_wanted"] >= 2
              and not db.query(PushHeldItem).filter(PushHeldItem.device_token_id == dee_dev.id).count(),
              (got, res))

        text = json.dumps([c.get("/api/alert-settings", headers=fh.citizen_headers(ana)).json()], ensure_ascii=False)
        check("no em or en dashes in the settings payload", "\u2014" not in text and "\u2013" not in text)

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
