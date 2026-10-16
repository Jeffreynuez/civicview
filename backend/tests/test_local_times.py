# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Times in the recipient's own clock (2026-10-16): services/local_time.py.

Run:  cd backend && python3 tests/test_local_times.py   (exit 0 = pass)

Event pushes printed the start time in UTC ("2026-10-17 23:00") and the
weekly digest printed UTC dates. Now:

  1. With the recipient's tz offset: their own time, no zone label.
  2. Without one: Eastern time with "ET", in daylight and standard time.
  3. Event pushes: each device gets the time in its own clock.
  4. The digest: event and poll closing times local, dates local (an
     evening event in the Americas is not shown as the next day).
  5. Anything unparseable is shown as it was.
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
        for t in tokens:
            PUSHES.append({"token": t, "body": body})
        return []


def main() -> int:
    from fastapi.testclient import TestClient
    import app.main as m
    import app.services.push_service as ps
    from app.db import SessionLocal
    from app.models.pages import DeviceToken
    from app.services import digest_service as dg
    from app.services.local_time import format_when

    check = fh.Checks()
    ps._service = _CapturePush()
    db = SessionLocal()

    # ── 1. own offset ────────────────────────────────────────────────
    check("1 Central daylight time", format_when("2026-10-17T23:00:00.000Z", {"tz_offset_minutes": -300})
          == "Sat, Oct 17, 6 p.m.")
    check("1 Pacific, minutes", format_when("2026-10-17T23:30:00Z", {"tz_offset_minutes": -420})
          == "Sat, Oct 17, 4:30 p.m.")
    check("1 a prefs blob works too", format_when("2026-10-17T16:00:00Z", json.dumps({"tz_offset_minutes": -240}))
          == "Sat, Oct 17, noon")
    # ── 2. Eastern fallback ──────────────────────────────────────────
    check("2 Eastern daylight with ET", format_when("2026-10-17T23:00:00.000Z", None) == "Sat, Oct 17, 7 p.m. ET")
    check("2 Eastern standard with ET", format_when("2026-12-05T17:30:00Z", {}) == "Sat, Dec 5, 12:30 p.m. ET")
    check("2 a bad offset falls back", format_when("2026-10-17T23:00:00Z", {"tz_offset_minutes": 99999})
          == "Sat, Oct 17, 7 p.m. ET")

    with TestClient(m.app):
        # ── 3. event pushes ──────────────────────────────────────────
        west = fh.make_citizen(db, "Wes West", "wes@example.org")
        east = fh.make_citizen(db, "Eli East", "eli@example.org", district="FL-12")
        west.notification_prefs_json = json.dumps({"tz_offset_minutes": -420, "quiet_hours": "off"})
        db.add(DeviceToken(token="tok-west-0001", citizen_id=west.id))
        db.add(DeviceToken(token="tok-east-0001", citizen_id=east.id))
        db.commit()
        PUSHES.clear()
        ps.push_tracked_event(db, [west.id, east.id], official_id="tst-off-1", official_name="Pat Page",
                              event_id=5, title="Town hall", start_at="2026-10-17T23:00:00.000Z",
                              location="Library")
        by = {p["token"]: p["body"] for p in PUSHES}
        check("3 the Pacific device sees its own time",
              by.get("tok-west-0001") == "Town hall · Sat, Oct 17, 4 p.m. · Library", by)
        check("3 a device with no time zone sees Eastern with ET",
              by.get("tok-east-0001") == "Town hall · Sat, Oct 17, 7 p.m. ET · Library", by)
        check("3 no UTC clock left in the push", not any("23:00" in b for b in by.values()), by)

    # ── 4. digest ────────────────────────────────────────────────────
    from datetime import datetime
    data = {
        "citizen_name": "Reader", "tracked_count": 1, "tz_prefs": None,
        "posts": [{"official_id": "x", "preview": "Hello", "created_at": datetime(2026, 10, 18, 2, 30)}],
        "new_polls": [],
        "closing_polls": [{"question": "Rebuild the bridge?", "closes_at": datetime(2026, 10, 20, 3, 59)}],
        "events": [{"title": "Town hall", "start_at": "2026-10-18T00:30:00.000Z", "location": None,
                    "official_id": "x"}],
    }
    _s, html_body, text_body = dg.render_digest(data)
    check("4 an evening post keeps its local date (Eastern)", "(Sat, Oct 17)" in text_body, text_body)
    check("4 event time local with ET", "Sat, Oct 17, 8:30 p.m. ET" in text_body, text_body)
    check("4 closing time local with ET", "closes Mon, Oct 19, 11:59 p.m. ET" in text_body, text_body)
    data["tz_prefs"] = json.dumps({"tz_offset_minutes": 60})
    _s, html_body, text_body = dg.render_digest(data)
    check("4 with an offset: that clock, no label", "Sun, Oct 18, 1:30 a.m." in text_body
          and " ET" not in text_body, text_body)
    check("4 the HTML matches", "Sun, Oct 18, 1:30 a.m." in html_body)

    # ── 5. unparseable ───────────────────────────────────────────────
    check("5 unparseable values come back as they were", format_when("sometime soon", None) == "sometime soon")

    db.close()
    return check.exit_code()


if __name__ == "__main__":
    sys.exit(main())
