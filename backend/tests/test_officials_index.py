"""Every statewide officeholder in the data has state scope in the officials index.

Run:  cd backend && python3 tests/test_officials_index.py   (exit 0 = pass)

services/officials_index.py tells the citizen-polls feature which
scopes a page supports. The state files keep the governor and lieutenant
governor in their own keys and every other statewide officeholder
(attorney general, secretary of state, treasurer, auditor) in an
"executive.cabinet" list. Until 2026-10-15 the index never read that
list, so all 82 of those pages fell back to Country-only scope.

  1. Every executive.cabinet id in every state file is in the index,
     with that state's code.
  2. A state attorney general's page offers Country and State scope.
  3. Governors and legislators still resolve (no regression).
  4. A cabinet entry in a synthetic payload is indexed with its state.
"""
import json
import os
import sys
from pathlib import Path

_failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


def main() -> int:
    os.environ["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.CRITICAL)
    from app.services import officials_index as oi

    oi.build_index()
    data = Path(oi.DATA_DIR)
    cabinet, wrong = [], []
    for path in sorted(data.glob("*/state_officials.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        state = (doc.get("state") or path.parent.name).upper()
        for rec in (doc.get("executive") or {}).get("cabinet") or []:
            cabinet.append(rec["id"])
            geo = oi.lookup(rec["id"])
            if not geo or geo.get("state") != state:
                wrong.append(f"{rec['id']} -> {geo}")
    check(f"1: all {len(cabinet)} statewide cabinet ids resolve with their state",
          bool(cabinet) and not wrong, "; ".join(wrong[:5]))

    ma_ag = next((c for c in cabinet if c.startswith("ma-exec-attorney-general")), None)
    check("2: a state attorney general's page offers country + state",
          ma_ag is not None and oi.allowed_scopes_for_official(ma_ag) == ["country", "state"],
          f"{ma_ag}: {ma_ag and oi.allowed_scopes_for_official(ma_ag)}")

    fl = json.loads((data / "fl" / "state_officials.json").read_text(encoding="utf-8"))
    gov_id = fl["executive"]["governor"]["id"]
    sen = fl["state_senate"]["members"][0]
    check("3: governor and a state senator still resolve",
          (oi.lookup(gov_id) or {}).get("state") == "FL"
          and (oi.lookup(sen["id"]) or {}).get("district") == str(sen["district"]),
          f"{oi.lookup(gov_id)} / {oi.lookup(sen['id'])}")

    oi._INDEX.clear()
    oi._ingest_state_officials("zz", {"executive": {"cabinet": [{"id": "zz-exec-treasurer", "name": "T"}]}})
    check("4: a synthetic cabinet entry is indexed with its state",
          oi._INDEX.get("zz-exec-treasurer", {}).get("state") == "ZZ", str(oi._INDEX))

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
