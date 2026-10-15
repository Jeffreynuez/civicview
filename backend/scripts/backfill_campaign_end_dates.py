# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Record when our data first marked each campaign as over (one-off backfill).

Run from backend/:

    python scripts/backfill_campaign_end_dates.py           # dry run
    python scripts/backfill_campaign_end_dates.py --write   # write the files

A campaign page moves to "Former candidate" when the candidate
withdraws or loses, and is archived 3 months later (Jeffrey,
2026-10-15). The clock needs a date, and only an official source may
give the day it happened ("with official sources only ... not news").
None of the withdrawn or eliminated records has one today: the Florida
primary losses cite the results site, which carries no certification
date, and the one withdrawal date we hold (Jerry Demings) cites a news
outlet.

So each such record gets ended_recorded_on: the date of the first
commit of this repository whose candidates file marked it withdrawn or
eliminated. That is the day our data recorded the change, and the app
only ever words it that way ("recorded on"), never as the day the
campaign ended. When an official source gives the real date, set
ended_on and ended_on_source by hand; they win.

Records that already have ended_recorded_on are left alone.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess  # nosec B404 - runs git with fixed arguments only
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "app" / "data"
REPO = DATA.parents[2]


def _git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO), *args],  # nosec B603 B607
                          check=True, capture_output=True, text=True).stdout


def _ended(c: dict) -> bool:
    return bool(c.get("withdrawn") or c.get("eliminated"))


def first_marked(rel: str, ids: set[str]) -> dict[str, str]:
    """{candidate id: date of the oldest commit in the unbroken run of
    versions, ending at HEAD, that mark it withdrawn or eliminated}."""
    log = [line.split(" ", 1) for line in _git("log", "--format=%H %cs", "--", rel).splitlines() if line]
    since: dict[str, str] = {}
    open_ids = set(ids)
    for sha, day in log:  # newest first
        try:
            cands = (json.loads(_git("show", f"{sha}:{rel}")).get("candidates") or {})
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            break
        for cid in list(open_ids):
            c = cands.get(cid)
            if c is not None and _ended(c):
                since[cid] = day
            else:
                open_ids.discard(cid)
        if not open_ids:
            break
    return since


def _format_of(text: str, doc: dict) -> tuple[int, str]:
    """(indent, trailing text) the file was written with, so a write
    changes only the added lines."""
    for indent in (2, 1, 4):
        for tail in ("\n", ""):
            if json.dumps(doc, indent=indent, ensure_ascii=False) + tail == text:
                return indent, tail
    raise SystemExit("unrecognised JSON layout; not rewriting")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)
    total = 0
    for path in sorted(DATA.glob("*/candidates.json")):
        original = path.read_text(encoding="utf-8")
        doc = json.loads(original)
        fmt = _format_of(original, doc)
        cands = doc.get("candidates") or {}
        # A duplicate_of record is a second copy of one person's record,
        # not a campaign that ended.
        todo = {cid for cid, c in cands.items()
                if _ended(c) and not c.get("duplicate_of") and not c.get("ended_recorded_on")}
        if not todo:
            continue
        rel = str(path.relative_to(REPO))
        since = first_marked(rel, todo)
        for cid in sorted(todo):
            day = since.get(cid)
            if not day:
                print(f"{rel} {cid}: no commit marks it; left alone")
                continue
            new = {}
            for k, v in cands[cid].items():
                new[k] = v
            new["ended_recorded_on"] = day
            cands[cid] = new
            total += 1
        print(f"{rel}: {len(since)} of {len(todo)} dated")
        if args.write:
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(doc, indent=fmt[0], ensure_ascii=False) + fmt[1], encoding="utf-8")
            json.loads(tmp.read_text(encoding="utf-8"))
            os.replace(tmp, path)
    print(f"{total} records dated." + ("" if args.write else " Dry run: add --write to apply."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
