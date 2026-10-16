# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Push registration rules (2026-10-16): routers/push.py, middleware/rate_limit.py.

Run:  cd backend && python3 tests/test_push_registration_rules.py   (exit 0 = pass)

  1. A signed-out device's tracked list is merged, never wiped: an app
     keeps its tracking in memory, so each session starts empty, and a
     register used to replace the stored list with that session's keys.
     Only an untrack (tracked_remove) takes a key out.
  2. /api/push/register is rate limited (60 per 10 minutes per account
     or IP).
  3. Event creation is rate limited like posts and polls (10 per 10
     minutes), since each one fans out alerts and pushes.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import former_helpers as fh  # noqa: E402

fh.bootstrap()


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m
    from app.db import SessionLocal
    from app.models.pages import DeviceToken
    from app.services import rate_limit

    check = fh.Checks()
    db = SessionLocal()
    TOKEN = "fcm-token-merge-test-01"

    def stored():
        db.expire_all()
        row = db.query(DeviceToken).filter(DeviceToken.token == TOKEN).one()
        return json.loads(row.tracked_json) if row.tracked_json else []

    with TestClient(m.app) as c:
        rate_limit.reset_all()
        # ── 1. merge, remove only on untrack ─────────────────────────
        c.post("/api/push/register", json={"token": TOKEN, "tracked": ["S001217", "fl-sen-1"]})
        check("1 first session's keys stored", sorted(stored()) == ["fl-sen-1", "s001217"], stored())
        c.post("/api/push/register", json={"token": TOKEN, "tracked": ["tx-gov-1"]})
        check("1 a new session adds its key without wiping the others",
              sorted(stored()) == ["fl-sen-1", "s001217", "tx-gov-1"], stored())
        c.post("/api/push/register", json={"token": TOKEN})
        check("1 a register without keys changes nothing", len(stored()) == 3, stored())
        c.post("/api/push/register", json={"token": TOKEN, "tracked": [], "tracked_remove": ["FL-SEN-1"]})
        check("1 an untrack removes just that key", sorted(stored()) == ["s001217", "tx-gov-1"], stored())
        c.post("/api/push/register", json={"token": TOKEN, "tracked": ["s001217"], "tracked_remove": ["tx-gov-1"]})
        check("1 add and remove in one call", stored() == ["s001217"], stored())

        # ── 2. register rate limit ───────────────────────────────────
        rate_limit.reset_all()
        codes = [c.post("/api/push/register", json={"token": TOKEN}).status_code for _ in range(61)]
        check("2 sixty registers pass", codes[:60] == [200] * 60, codes[:60])
        check("2 the sixty-first is refused", codes[60] == 429, codes[60])

        # ── 3. event creation rate limit ─────────────────────────────
        rate_limit.reset_all()
        rep = fh.make_rep(db, "tst-off-events", "Eve Events", "eve@example.org")
        h = fh.rep_headers(rep)
        body = {"title": "Office hours", "start_at": "2030-01-01T15:00:00.000Z"}
        codes = [c.post("/api/pages/tst-off-events/events", json=body, headers=h).status_code for _ in range(11)]
        check("3 ten events pass", codes[:10] == [201] * 10, codes)
        check("3 the eleventh is refused", codes[10] == 429, codes)
        rate_limit.reset_all()

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
