# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Sign-in and sign-out move the phone (2026-10-16): routers/push.py.

Run:  cd backend && python3 tests/test_push_binding.py   (exit 0 = pass)

Before this, register only ever set citizen_id and nothing re-registered
on sign-out, so a shared phone kept getting the last account's alerts.

  1. Sign-in: a register with a citizen session binds the device at once.
  2. Sign-out: /api/push/unbind leaves the device registered but bound to
     nobody, with an empty tracked list and no held summary updates;
     the old account's posts no longer reach it.
  3. A register with no citizen session (offline sign-out, expired
     session) unbinds a bound device too.
  4. Another citizen signing in on the same phone takes it over, and the
     first one's held updates are dropped.
  5. unbind for an unknown token is a harmless no-op.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()

PUSHES = []


class _CapturePush:
    def send_to_tokens(self, tokens, *, title, body, data=None, ttl_seconds=None):
        PUSHES.extend(tokens)
        return []

    def subscribe_to_topic(self, tokens, topic):
        pass

    def unsubscribe_from_topic(self, tokens, topic):
        pass


TOKEN = "fcm-token-shared-phone-0001"


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import DeviceToken, PushHeldItem

    ps._service = _CapturePush()
    check = fh.Checks()
    db = SessionLocal()

    def dev():
        db.expire_all()
        return db.query(DeviceToken).filter(DeviceToken.token == TOKEN).one()

    def held():
        return db.query(PushHeldItem).filter(PushHeldItem.device_token_id == dev().id).count()

    def push_from(cid):
        PUSHES.clear()
        db.expire_all()  # the API changed the row in its own session
        ps._deliver_tracked_push(db, [cid], anon_key="tst-off-1", title="t", body="b",
                                 data={"kind": "tracked_post", "official_id": "tst-off-1"})
        return TOKEN in PUSHES

    with TestClient(m.app) as c:
        ana = fh.make_citizen(db, "Ana Owner", "ana@example.org")
        ben = fh.make_citizen(db, "Ben Next", "ben@example.org", district="FL-12")

        # ── 1. sign-in binds at once ─────────────────────────────────
        r = c.post("/api/push/register", json={"token": TOKEN, "tracked": ["tst-off-9"]})
        check("1 anonymous register", r.status_code == 200 and r.json()["bound"] is False, r.text)
        r = c.post("/api/push/register", json={"token": TOKEN, "prefs": {"quiet_hours": "off"}},
                   headers=fh.citizen_headers(ana))
        check("1 register with a citizen session binds", r.json()["bound"] is True and dev().citizen_id == ana.id, r.text)
        check("1 the anonymous tracked list is dropped when it changes hands", dev().tracked_json is None)
        check("1 Ana's tracked posts reach the phone", push_from(ana.id))

        # ── 2. sign-out unbinds ──────────────────────────────────────
        ana.notification_prefs_json = json.dumps({"push_cadence": "daily", "tz_offset_minutes": -240})
        db.commit()
        push_from(ana.id)
        check("2 setup: an update held for Ana's summary", held() == 1)
        r = c.post("/api/push/unbind", json={"token": TOKEN})
        d = dev()
        check("2 unbind answers", r.status_code == 200 and r.json() == {"ok": True, "unbound": True}, r.text)
        check("2 still registered, bound to nobody", d.citizen_id is None)
        check("2 empty tracked list", d.tracked_json is None)
        check("2 held updates dropped", held() == 0)
        check("2 Ana's tracked posts no longer reach the phone", not push_from(ana.id))

        # ── 3. a register without a session unbinds too ─────────────
        c.post("/api/push/register", json={"token": TOKEN}, headers=fh.citizen_headers(ana))
        check("3 setup: bound to Ana again", dev().citizen_id == ana.id)
        r = c.post("/api/push/register", json={"token": TOKEN, "tracked": ["tst-off-2"]})
        d = dev()
        check("3 an anonymous register unbinds", r.json()["bound"] is False and d.citizen_id is None, r.text)
        check("3 and keeps the tracked list it sent", json.loads(d.tracked_json or "[]") == ["tst-off-2"], d.tracked_json)

        # ── 4. another citizen takes the phone over ──────────────────
        c.post("/api/push/register", json={"token": TOKEN}, headers=fh.citizen_headers(ana))
        push_from(ana.id)
        check("4 setup: an update held for Ana", held() == 1)
        r = c.post("/api/push/register", json={"token": TOKEN}, headers=fh.citizen_headers(ben))
        check("4 Ben's sign-in binds the phone to Ben", dev().citizen_id == ben.id, r.text)
        check("4 Ana's held updates are dropped", held() == 0)
        check("4 Ana's posts no longer reach it", not push_from(ana.id))
        check("4 Ben's do", push_from(ben.id))

        # ── 5. unknown token ─────────────────────────────────────────
        r = c.post("/api/push/unbind", json={"token": "fcm-token-never-seen-0002"})
        check("5 unknown token is a no-op", r.status_code == 200 and r.json()["unbound"] is False, r.text)

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
