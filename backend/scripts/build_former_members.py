# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Give every retired state official id back its own record (one-off backfill).

Run from backend/:

    python scripts/build_former_members.py              # dry run: report only
    python scripts/build_former_members.py --write      # write the files

The 2026-10-14 state roster refresh (PR #266) moved 66 departed
legislators into each file's _retired_ids list (id, name, retired_on,
reason, openstates_id) and their old ids stopped opening anything.
Jeffrey, 2026-10-15: build former-official records "from that list plus
the full pre-refresh record in git history (office, district, party,
photo, service years), so each old id resolves again as a former
official's page."

For each _retired_ids entry with no _former_members record yet:
  * the record itself comes from the newest commit of the state file
    that still listed the id (git history of this repository);
  * the years served come from the person's role dates in the Open
    States people archive (the same source as the roster, CC0), with a
    link to the person's file;
  * recorded_on is the entry's retired_on, the day the refresh noticed.
    left_office_on stays empty: only an official source fills it, and
    recorded_on is never shown as the day the person left;
  * successor_ids are the members now listed for the same district who
    were not listed before the refresh.

From now on refresh_state_officials.py writes these records itself
when it retires an id, so this script only has to run once. Running it
again is safe: ids that already have a record are skipped.

Needs git and network access to github.com (a sparse clone of
openstates/people), or --people-dir with an existing checkout.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess  # nosec B404 - runs git with fixed arguments only
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from refresh_state_officials import (  # noqa: E402
    DATA_DIR,
    EXEC_OFFICES,
    STATES,
    checkout_people,
    dump,
    former_record,
    load_people,
    name_key,
    order_keys,
)

REPO_ROOT = DATA_DIR.parents[2]


def _git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(REPO_ROOT), *args],  # nosec B603 B607
                          check=True, capture_output=True, text=True).stdout


def _records(doc: dict):
    """(record, chamber or None, exec role type or None) for every
    current record in a state file."""
    exe = doc.get("executive") or {}
    label_to_type = {label: rtype for rtype, (_slot, label, _stem) in EXEC_OFFICES.items()}
    for key in ("governor", "lt_governor"):
        rec = exe.get(key)
        if isinstance(rec, dict):
            yield rec, None, label_to_type.get(rec.get("role") or "", key)
    for rec in exe.get("cabinet") or []:
        if isinstance(rec, dict):
            yield rec, None, label_to_type.get(rec.get("role") or "")
    for chamber in ("state_senate", "state_house"):
        block = doc.get(chamber) or {}
        for bucket in ("members", "leadership"):
            for rec in block.get(bucket) or []:
                if isinstance(rec, dict):
                    yield rec, chamber, None


def _same_name_same_seat(people: dict, rec: dict) -> dict | None:
    """Open States sometimes merges two records for one person, so our
    openstates_id can be missing from the archive. Fall back to the one
    person with the same name who held the same district."""
    key = name_key(rec.get("name"))
    hits = [p for p in people.values()
            if name_key(p.get("name")) == key
            and any(str(r.get("district")) == str(rec.get("district")) for r in p.get("roles") or [])]
    return hits[0] if len(hits) == 1 else None


class History:
    """Versions of one state file, newest first, parsed on demand."""

    def __init__(self, rel_path: str):
        self.rel = rel_path
        self.shas = [s for s in _git("log", "--format=%H", "--", rel_path).split() if s]
        self.cache: dict[str, dict] = {}

    def doc(self, sha: str) -> dict:
        if sha not in self.cache:
            try:
                self.cache[sha] = json.loads(_git("show", f"{sha}:{self.rel}"))
            except (subprocess.CalledProcessError, json.JSONDecodeError):
                self.cache[sha] = {}
        return self.cache[sha]

    def find(self, rid: str):
        """(record, chamber, exec type, doc it came from) from the newest
        version that still listed rid as a current record."""
        for sha in self.shas:
            doc = self.doc(sha)
            for rec, chamber, exec_type in _records(doc):
                if rec.get("id") == rid:
                    return rec, chamber, exec_type, doc
        return None, None, None, None


def backfill_state(state: str, data: Path, people_cache: dict) -> tuple[dict | None, list[str]]:
    path = DATA_DIR / state / "state_officials.json"
    if not path.exists():
        return None, []
    doc = json.loads(path.read_text(encoding="utf-8"))
    retired = doc.get("_retired_ids") or []
    if not retired:
        return None, []
    former = list(doc.get("_former_members") or [])
    have = {f.get("id") for f in former}
    todo = [r for r in retired if isinstance(r, dict) and r.get("id") and r["id"] not in have]
    if not todo:
        return None, []
    if state not in people_cache:
        people_cache[state] = load_people(data, state)
    people = people_cache[state]
    history = History(str(path.relative_to(REPO_ROOT)))
    current_ids = {rec.get("id") for rec, _c, _e in _records(doc)}
    report: list[str] = []
    for entry in todo:
        rid = entry["id"]
        rec, chamber, exec_type, old_doc = history.find(rid)
        if rec is None:
            report.append(f"{rid} ({entry.get('name')}): no earlier version lists it; skipped")
            continue
        person = people.get(entry.get("openstates_id") or rec.get("openstates_id") or "")
        if person is None:
            person = _same_name_same_seat(people, rec)
        out = former_record(rec, person, recorded_on=entry.get("retired_on"),
                            reason=entry.get("reason") or "", chamber=chamber, exec_type=exec_type)
        if chamber:
            before = {m.get("id") for m in ((old_doc.get(chamber) or {}).get("members") or [])}
            district = str(rec.get("district"))
            out["successor_ids"] = [
                m["id"] for m in (doc.get(chamber) or {}).get("members") or []
                if str(m.get("district")) == district and m.get("id") not in before
                and m.get("openstates_id") != rec.get("openstates_id")
            ]
        else:
            moved_to = (entry.get("reason") or "").removeprefix("officeholder changed to ").strip()
            if moved_to in current_ids:
                out["successor_ids"] = [moved_to]
        years = f"{out['served_from'] or '?'} to {out['served_to'] or '?'}"
        report.append(f"{rid} ({rec.get('name')}): {rec.get('role') or chamber} {rec.get('district') or ''}, "
                      f"served {years}, successor {', '.join(out['successor_ids']) or 'none (vacant)'}")
        former.append(out)
    doc["_former_members"] = former
    return order_keys(doc), report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--write", action="store_true", help="write the changed files")
    ap.add_argument("--people-dir", help="existing checkout of openstates/people (skips the clone)")
    args = ap.parse_args(argv)

    data, sha = checkout_people(args.people_dir)
    people_cache: dict = {}
    pending: list[tuple[Path, dict]] = []
    total = 0
    for state in STATES:
        new_doc, report = backfill_state(state, data, people_cache)
        if new_doc is None:
            continue
        total += sum(1 for line in report if "skipped" not in line)
        print(f"\n== {state.upper()} ==")
        for line in report:
            print("  " + line)
        pending.append((DATA_DIR / state / "state_officials.json", new_doc))
    if args.write:
        for path, new_doc in pending:
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(dump(new_doc), encoding="utf-8")
            json.loads(tmp.read_text(encoding="utf-8"))
            os.replace(tmp, path)
    print(f"\n{total} former records from Open States people data at commit {sha[:12]}.")
    print("Files written." if args.write else "Dry run: nothing written. Add --write to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
