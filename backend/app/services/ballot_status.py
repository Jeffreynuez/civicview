# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Who is on a November ballot, for the "On ballot" badge.

A candidate record counts only when its id is on a race's
general_candidates list, that race's roster was checked against the
state's certified list (roster_status "verified_nominees") and is
printed (not an unopposed, uncontested race), and the record is not
withdrawn, eliminated or a duplicate. Having a candidate
record is not enough: old filer lists named people who lost, withdrew
or never qualified, and the badge must not say they are running.

Read once per process from the data files, like every other election
reader (data changes take effect on deploy or restart).
"""
import json
import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _load(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (OSError, json.JSONDecodeError) as e:
        logger.error("ballot_status: failed to load %s: %s", path, e)
        return {}


@lru_cache(maxsize=1)
def on_ballot_ids() -> frozenset:
    """Candidate ids on a verified general election list."""
    ids: set = set()
    if not DATA_DIR.exists():
        return frozenset()
    for state_dir in sorted(DATA_DIR.iterdir()):
        if not state_dir.is_dir() or state_dir.name.startswith("_"):
            continue
        e_path = state_dir / "elections.json"
        c_path = state_dir / "candidates.json"
        if not e_path.exists() or not c_path.exists():
            continue
        cands = _load(c_path).get("candidates") or {}
        for race in _load(e_path).get("races") or []:
            if race.get("roster_status") != "verified_nominees":
                continue
            # An unopposed race is not printed (Florida law), so nobody in
            # it is "on the ballot".
            if race.get("uncontested_general"):
                continue
            for cid in race.get("general_candidates") or []:
                rec = cands.get(cid)
                if not isinstance(rec, dict):
                    continue
                if rec.get("withdrawn") or rec.get("eliminated") or rec.get("duplicate_of"):
                    continue
                ids.add(cid)
    return frozenset(ids)


def is_on_ballot(candidate_id) -> bool:
    return bool(candidate_id) and candidate_id in on_ballot_ids()
