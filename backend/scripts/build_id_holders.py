# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Keep app/data/id_holders.json: which person each official id belongs to.

Run from backend/:

    python scripts/build_id_holders.py           # dry run: report only
    python scripts/build_id_holders.py --write   # add new ids to the ledger

Why (Jeffrey, 2026-10-15): "When the person in any seat changes, the
successor must never inherit the predecessor's page, posts, polls,
followers or account; the outgoing person moves to their own former
record." Posts, polls, follows, citizen polls and claimed accounts are
all keyed on an official's id. Legislators now get ids of their own
(tx-sen-4-ligon), but many ids were named for the seat (fl-exec-gov,
us-ag, fl-cir-1-chief), and on 2026-09-24 three of them (us-ag,
us-sec-labor, us-sec-dhs) passed to the next officeholder.

The ledger records, for every id in the officials files, the person it
was first given to: [name, the first 8 characters of their Open States
id or null, then any other spellings of their name]. One line per id.
The three ids that passed to a successor before the rule keep naming
the current holder (see "_pre_rule" in the ledger); the people who held
them before have their own former records (us-ag-bondi and so on).
tests/test_data_lint.py rule S-1 fails when a record carries an id that
belongs to someone else, so a hand edit cannot hand a page to a
successor. The fix is always the same: give the new person a new id
(the seat id plus their family name) and move the person who left to
the file's _former_members list.

--write only ADDS ids. It never changes who an id belongs to; a
conflict is reported and the script exits 1. When a person's name
changes (a correction or a new legal name), add the new spelling to
their entry's "aliases" by hand.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "app" / "data"
LEDGER = DATA / "id_holders.json"


def name_key(name: object) -> str:
    """Same comparison form as app/services/display_names.name_key."""
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return "".join(ch for ch in text.casefold() if ch.isalnum())


def officials_files() -> list[Path]:
    files = sorted(DATA.glob("*/state_officials.json"))
    for extra in (DATA / "fl" / "local_officials.json", DATA / "federal" / "federal_officials.json"):
        if extra.exists():
            files.append(extra)
    return files


def people(node, path: str = ""):
    """(json path, record) for every dict with a string id and name,
    current or former (election and source blocks are skipped)."""
    if isinstance(node, dict):
        if isinstance(node.get("id"), str) and isinstance(node.get("name"), str):
            yield path, node
        for k, v in node.items():
            if k in ("elections", "_refresh", "_source", "_note"):
                continue
            yield from people(v, f"{path}.{k}" if path else str(k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from people(v, f"{path}[{i}]")


def os_short(openstates_id: object) -> str | None:
    """First 8 characters of an ocd-person uuid: enough to tell people apart."""
    text = str(openstates_id or "")
    return text.removeprefix("ocd-person/")[:8] or None


def holder_matches(entry: list, rec: dict) -> bool:
    """Is rec the person the ledger entry [name, os8, *aliases] names?"""
    name, short, *aliases = entry
    if short and os_short(rec.get("openstates_id")) == short:
        return True
    return name_key(rec.get("name")) in {name_key(name), *(name_key(a) for a in aliases)}


def load_ledger() -> dict:
    if LEDGER.exists():
        return json.loads(LEDGER.read_text(encoding="utf-8"))
    return {
        "_note": ("Who each official id belongs to: [name, first 8 characters of the Open States id "
                  "or null, other spellings...]. An id never passes to a successor (Jeffrey, "
                  "2026-10-15). Maintained by backend/scripts/build_id_holders.py; checked by "
                  "tests/test_data_lint.py rule S-1."),
        "_pre_rule": ("us-ag, us-sec-labor and us-sec-dhs passed to the next officeholder on "
                      "2026-09-24, before the rule. They keep naming the current holder; the people "
                      "who held them before have their own former records in federal_officials.json "
                      "(us-ag-bondi, us-sec-labor-chavez-deremer, us-sec-dhs-noem)."),
        "holders": {},
    }


def dump_ledger(ledger: dict) -> str:
    """One id per line, so a diff shows exactly which ids were added."""
    head = {k: v for k, v in ledger.items() if k != "holders"}
    lines = ["{"]
    for k, v in head.items():
        lines.append(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)},")
    lines.append('  "holders": {')
    items = sorted(ledger["holders"].items())
    for i, (rid, entry) in enumerate(items):
        comma = "," if i < len(items) - 1 else ""
        lines.append(f"    {json.dumps(rid, ensure_ascii=False)}: {json.dumps(entry, ensure_ascii=False)}{comma}")
    lines.append("  }")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--write", action="store_true", help="add new ids to the ledger")
    args = ap.parse_args(argv)

    ledger = load_ledger()
    holders: dict = ledger.setdefault("holders", {})
    added, conflicts = [], []
    for path in officials_files():
        doc = json.loads(path.read_text(encoding="utf-8"))
        rel = str(path.relative_to(DATA))
        for where, rec in people(doc):
            rid = rec["id"]
            entry = holders.get(rid)
            if entry is None:
                holders[rid] = [rec["name"], os_short(rec.get("openstates_id"))]
                added.append(f"{rid}: {rec['name']} ({rel})")
            elif not holder_matches(entry, rec):
                conflicts.append(f"{rel} {where}: id {rid} belongs to {entry[0]}, "
                                 f"not {rec['name']}")
    for line in conflicts:
        print("CONFLICT " + line)
    print(f"{len(added)} new id(s); {len(conflicts)} conflict(s); {len(holders)} in the ledger.")
    if conflicts:
        print("Give each new person a new id and move the person who left to _former_members.")
        return 1
    if args.write and added:
        tmp = LEDGER.with_suffix(".json.tmp")
        tmp.write_text(dump_ledger(ledger), encoding="utf-8")
        json.loads(tmp.read_text(encoding="utf-8"))
        os.replace(tmp, LEDGER)
        print("Ledger written.")
    elif added:
        print("Dry run: nothing written. Add --write to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
