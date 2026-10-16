# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Every alert switch the app shows does something (2026-10-16).

Run:  cd backend && python3 tests/test_notification_switches.py   (exit 0 = pass)

My Tracked showed 32 "Notify me when..." switches and the bell an
"In-app toasts" switch, most of which nothing read. Now the app shows
only the switches marked enforced in frontend/lib/notificationPrefs.js.
This test reads that file and the backend, so the two cannot drift:

  1. The switches marked enforced are exactly the ones the backend
     reads: on_event (the event alert) and the four election reminder
     switches.
  2. The in-app toasts switch is hidden, and nothing in the backend
     reads in_app.
  3. No bill switch is shown (no bill alert is sent yet).
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


def objects(js: str, section: str) -> list:
    """The option objects of one PREF_SCHEMA type, as raw text."""
    start = js.index(f"\n  {section}: {{")
    end = js.index("\n  },", start)
    return re.findall(r"\{[^{}]*key: '[^']+'[^{}]*\}", js[start:end])


def main() -> int:
    js = open(os.path.join(ROOT, "frontend", "lib", "notificationPrefs.js"), encoding="utf-8").read()
    shown = {}
    for section in ("representative", "candidate", "bill", "election"):
        shown[section] = sorted(re.search(r"key: '([^']+)'", o).group(1)
                                for o in objects(js, section) if "enforced: true" in o)

    from app.services import election_reminders as er
    inapp = open(os.path.join(ROOT, "backend", "app", "services", "notifications_inapp.py"), encoding="utf-8").read()

    check("1 officials and candidates: only the event alert", shown["representative"] == ["on_event"]
          and shown["candidate"] == ["on_event"], shown)
    check("1 the backend reads on_event", 'prefs.get("on_event") is True' in inapp)
    check("1 elections: exactly the switches election reminders read",
          shown["election"] == sorted(er._ELECTION_PREF_KEYS), (shown["election"], er._ELECTION_PREF_KEYS))
    check("3 no bill switch", shown["bill"] == [], shown["bill"])

    toasts = re.search(r"\{[^{}]*key: 'in_app'[^{}]*\}", js).group(0)
    check("2 in-app toasts hidden", "hidden: true" in toasts, toasts)
    used = []
    for dirpath, _dirs, files in os.walk(os.path.join(ROOT, "backend", "app")):
        for f in files:
            if f.endswith(".py"):
                text = open(os.path.join(dirpath, f), encoding="utf-8").read()
                if re.search(r"""["']in_app["']""", text):
                    used.append(f)
    check("2 nothing in the backend reads in_app", not used, used)

    if failures:
        print(f"\nFAILED ({len(failures)})")
        return 1
    print("\nALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
