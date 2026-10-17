# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""The notification settings the app shows are the ones the server
enforces, and the Android channels agree everywhere (2026-10-17).

Run:  cd backend && python3 tests/test_notification_switches.py   (exit 0 = pass)

The 32 per-item "Notify me when..." switches were replaced by one short
list (services/alert_settings.py, frontend/lib/notificationPrefs.js
ALERT_ROWS) and a Mute button per official. This test reads the
frontend, the Android project and the backend, so they cannot drift:

  1. The settings list: the same rows, in the same order, with the same
     defaults, in the app and on the server.
  2. No per-item switch is shown, and the backend reads none (no
     on_event, no per-election switch, no in_app).
  3. The Android channels: the same ids in the server's CHANNELS, the
     app's NotificationChannels.java and strings.xml, and lib/push.js,
     with the same names; the manifest's default channel is one of them.
  4. Wording: no em or en dashes, and nothing promises state bill alerts.
"""
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        failures.append(name)


def read(*parts) -> str:
    return open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def main() -> int:
    from app.services import alert_settings as als
    from app.services import push_service as ps

    prefs_js = read("frontend", "lib", "notificationPrefs.js")
    push_js = read("frontend", "lib", "push.js")
    java = read("frontend", "android", "app", "src", "main", "java", "app", "civicview", "NotificationChannels.java")
    strings = read("frontend", "android", "app", "src", "main", "res", "values", "strings.xml")
    manifest = read("frontend", "android", "app", "src", "main", "AndroidManifest.xml")

    # ── 1. the list ──────────────────────────────────────────────────
    rows_block = prefs_js[prefs_js.index("export const ALERT_ROWS"):prefs_js.index("export const ALERT_CHOICE_LABELS")]
    app_rows = re.findall(r"key: '([a-z_]+)'", rows_block)
    check("1 the app's rows are the server's rows, in order", app_rows == list(als.ROW_ORDER),
          (app_rows, als.ROW_ORDER))
    defaults_block = prefs_js[prefs_js.index("export const ALERT_DEFAULTS"):prefs_js.index("export const DIGEST_ROW")]
    app_defaults = dict(re.findall(r"([a-z_]+): '([a-z_]+)'", defaults_block))
    server_defaults = {row: als.choice_of(cells) for row, cells in als.ROWS.items()}
    check("1 the app's defaults are the server's", app_defaults == server_defaults, (app_defaults, server_defaults))
    check("1 events are on for everyone by default (Jeffrey, 2026-10-17)", server_defaults["events"] == "bell_push")
    check("1 page change pushes are on by default", server_defaults["page_changes"] == "bell_push_email")
    labels_block = prefs_js[prefs_js.index("export const ALERT_CHOICE_LABELS"):prefs_js.index("export const ALERT_DEFAULTS")]
    check("1 every server choice has a label in the app",
          set(als.CHOICE_CELLS) == set(re.findall(r"([a-z_]+): '", labels_block)))

    # ── 2. no per-item switch ────────────────────────────────────────
    check("2 no per-item option is shown", "enforced: true" not in prefs_js and "options: []" in prefs_js)
    readers = []
    for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "backend", "app")):
        for f in files:
            if not f.endswith(".py"):
                continue
            text = open(os.path.join(dirpath, f), encoding="utf-8").read()
            if re.search(r"""prefs\.get\(["']on_[a-z_]+["']\)""", text) or re.search(r"""["']in_app["']""", text):
                readers.append(f)
    check("2 nothing in the backend reads a per-item switch or in_app", not readers, readers)
    from app.services import election_reminders as er
    check("2 election reminders read no per-election switch", not hasattr(er, "_ELECTION_PREF_KEYS"))

    # ── 3. channels ──────────────────────────────────────────────────
    server = list(ps.CHANNELS)
    java_ids = re.findall(r'public static final String [A-Z_]+ = "([a-z_]+)";', java)
    js_block = push_js[push_js.index("export const CHANNELS"):]
    js_block = js_block[:js_block.index("];")]
    js_ids = re.findall(r"id: '([a-z_]+)'", js_block)
    check("3 server, app and web list the same channels", server == java_ids == js_ids, (server, java_ids, js_ids))
    for cid in server:
        xml_name = re.search(rf'<string name="channel_{cid}">([^<]+)</string>', strings)
        js_name = re.search(rf"id: '{cid}', name: '([^']+)'", js_block)
        check(f"3 channel {cid} has the same name in the app and the web",
              bool(xml_name and js_name and xml_name.group(1) == js_name.group(1)),
              (xml_name and xml_name.group(1), js_name and js_name.group(1)))
    m = re.search(r'default_notification_channel_id"\s+android:value="([a-z_]+)"', manifest)
    check("3 the manifest's default channel is a real channel", bool(m) and m.group(1) in server, m and m.group(1))
    check("3 every channel is private on the lock screen (Java)", "setLockscreenVisibility(Notification.VISIBILITY_PRIVATE)" in java)
    check("3 replies and election reminders pop up",
          "REPLIES.equals(id) || ELECTIONS.equals(id)) return NotificationManager.IMPORTANCE_HIGH" in java)

    # ── 4. wording ───────────────────────────────────────────────────
    copy = "\n".join([
        rows_block, labels_block, js_block, strings,
        "\n".join(v["public"] + " " + v["group"] for v in ps.CHANNELS.values()),
        ps.PUBLIC_TITLE, ps.GROUP_PUBLIC,
    ])
    check("4 no em or en dashes", not re.search("[\u2013\u2014]", copy))
    check("4 nothing promises state bill alerts", not re.search(r"state bill", copy, re.I))
    check("4 the lock screen names no official",
          all("{" not in v["public"] for v in ps.CHANNELS.values()))

    if failures:
        print(f"\nFAILED ({len(failures)})")
        return 1
    print("\nALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
