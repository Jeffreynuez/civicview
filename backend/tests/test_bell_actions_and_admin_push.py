# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Bell actions, lockout emails, the admin test push (2026-10-16).

Run:  cd backend && python3 tests/test_bell_actions_and_admin_push.py   (exit 0 = pass)

  1. "Mark as read" and "Clear" act only on the rows the bell shows: the
     ids it sends, and never a rep or candidate identity's rows that the
     bell keeps out of a citizen's view.
  2. A lockout alert email is not sent to a demo account's generated
     address; a real address still gets it.
  3. Admin "Send me a test push": to the admin's devices and this
     device's registered token, with counts; dead tokens pruned; admins
     only; an unregistered token is not used.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

MAILS = []
PUSHES = []


class _CaptureEmail:
    def send(self, *, to, subject, text_body, html_body=None, reply_to=None, headers=None, message_stream=None):
        MAILS.append({"to": to, "subject": subject})
        return True


class _CapturePush:
    dead = set()

    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        PUSHES.extend(tokens)
        return [t for t in tokens if t in self.dead]


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.email_service as es
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import DeviceToken, Notification
    from app.services import login_attempts

    es.get_email_service = lambda: _CaptureEmail()
    ps._service = _CapturePush()
    check = fh.Checks()
    db = SessionLocal()

    def note(kind, rid, text):
        n = Notification(recipient_kind=kind, recipient_id=rid, kind="reply",
                         payload_json='{"preview": "%s"}' % text)
        db.add(n)
        db.commit()
        return n.id

    def row(nid):
        db.expire_all()
        return db.get(Notification, nid)

    with TestClient(m.app) as c:
        # ── 1. bell actions ──────────────────────────────────────────
        cit = fh.make_citizen(db, "Cara Both", "cara@example.org")
        rep = fh.make_rep(db, "tst-off-bell", "Cara Rep", "cara.rep@example.org")
        a, b, d = note("citizen", cit.id, "a"), note("citizen", cit.id, "b"), note("citizen", cit.id, "c")
        r_row = note("rep", rep.id, "rep row")
        both = fh.both(fh.citizen_headers(cit), fh.rep_headers(rep))
        shown = [n["id"] for n in c.get("/api/notifications", headers=both).json()["items"]]
        check("1 setup: the bell shows the citizen rows only", sorted(shown) == sorted([a, b, d]), shown)
        r = c.post("/api/notifications/read-all", json={"ids": [a, b]}, headers=both)
        check("1 Mark as read with ids marks just those", r.json()["updated"] == 2
              and row(a).read_at and row(b).read_at and row(d).read_at is None, r.text)
        check("1 the rep row the bell does not show is untouched", row(r_row).read_at is None)
        r = c.post("/api/notifications/read-all", headers=both)
        check("1 without ids: the bell's rows, still not the rep's",
              row(d).read_at is not None and row(r_row).read_at is None, r.text)
        r = c.post("/api/notifications/clear-all", json={"ids": [a]}, headers=both)
        check("1 Clear with ids clears just those", r.json()["cleared"] == 1
              and row(a).cleared_at and row(b).cleared_at is None and row(r_row).cleared_at is None, r.text)
        r = c.post("/api/notifications/clear-all", json={"ids": [r_row]}, headers=both)
        check("1 an id the bell does not show is ignored", r.json()["cleared"] == 0 and row(r_row).cleared_at is None)
        rep_only = c.post("/api/notifications/read-all", headers=fh.rep_headers(rep))
        check("1 a rep signed in alone still manages their own rows", rep_only.json()["updated"] == 1
              and row(r_row).read_at is not None, rep_only.text)

        # ── 2. lockout emails ────────────────────────────────────────
        demo = fh.make_citizen(db, "Demo Locked", "locked@demo-citizens.civicview.app", district="FL-12")
        real = fh.make_citizen(db, "Real Locked", "real.locked@example.org", district="FL-13")
        for acct in (demo, real):
            for _ in range(login_attempts.MAX_ATTEMPTS["citizen"]):
                login_attempts.register_failure(db, account=acct, identity_kind="citizen",
                                                email_attempted=acct.email, ip_address="203.0.113.9",
                                                user_agent="test")
            db.commit()
        to = [mm["to"] for mm in MAILS]
        check("2 no lockout email to a demo address", "locked@demo-citizens.civicview.app" not in to, to)
        check("2 a real address still gets it", "real.locked@example.org" in to, to)

        # ── 3. admin test push ───────────────────────────────────────
        admin = fh.admin_headers(db)
        db.add(DeviceToken(token="tok-admin-phone-01"))
        db.add(DeviceToken(token="tok-admin-dead-01"))
        db.commit()
        PUSHES.clear()
        r = c.post("/api/admin/push/test", json={"token": "tok-admin-phone-01"}, headers=admin)
        out = r.json()
        check("3 sent to this device", r.status_code == 200 and out["devices"] == 1 and out["sent"] == 1
              and PUSHES == ["tok-admin-phone-01"], (r.text, PUSHES))
        PUSHES.clear()
        r = c.post("/api/admin/push/test", json={"token": "tok-never-registered"}, headers=admin)
        check("3 an unregistered token is not used", r.json()["devices"] == 0 and not PUSHES, r.text)
        _CapturePush.dead = {"tok-admin-dead-01"}
        r = c.post("/api/admin/push/test", json={"token": "tok-admin-dead-01"}, headers=admin)
        db.expire_all()
        check("3 a dead token is pruned", r.json()["pruned"] == 1
              and db.query(DeviceToken).filter(DeviceToken.token == "tok-admin-dead-01").count() == 0, r.text)
        r = c.post("/api/admin/push/test", json={"token": "tok-admin-phone-01"}, headers=fh.citizen_headers(cit))
        check("3 admins only", r.status_code == 403, r.status_code)

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
