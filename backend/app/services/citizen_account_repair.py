# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Boot pass that brings existing citizen accounts in line with the
account rules of 2026-10-03. Runs from main.py's lifespan right after
init_db() and before the seeds. Idempotent: on a clean table it reads
every row and writes nothing.

1. Districts. Every stored congressional_district is rewritten to the
   canonical form (services/citizen_geo.py): "FL-07" becomes "FL-7",
   an at-large "WY-1" becomes "WY-AL". A district that is not a real
   seat in the account's state is cleared, and the app then asks the
   person for it (the location gate).

2. Names. No two citizens may share a name (services/display_names.py).
   Where they already do, the account with the most activity keeps the
   name (the older account on a tie) and each other one becomes
   "Name 2", "Name 3", ... Jeffrey, 2026-10-03: "Strict, rename the
   duplicate". The name is also rewritten on the comments that copied
   it (post_comments and poll_comments keep the author's name).

3. Keys. name_key is filled on every row whose key is missing or stale,
   after the renames, so the unique index never sees two equal keys.

4. Placeholder city. Sign-up used to store "Demo City" when no city was
   given; city is optional now and stored empty, so the placeholder is
   cleared on the accounts that still carry it (Jeffrey, 2026-10-03).

Separately, flag_official_name_matches() logs any citizen whose name is
now a sitting official's (a person can share a name with someone newly
elected). It only reports: Jeffrey chose "log it for review" over a
rename, since renaming a person who really has that name would be
unfair. It runs from the boot warm-up in main.py, after the reserved
names are built, so a slow Congress roster fetch never holds up boot.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# What demo sign-up stored before city became optional (2026-10-03).
PLACEHOLDER_CITY = "Demo City"


def _activity_counts(db: Session, ids: list[int]) -> dict[int, int]:
    """Rows each citizen has written: reactions, comments, polls, votes."""
    from app.models.pages import (
        BillReaction, CommentReaction, Poll, PollComment, PollCommentReaction,
        PollReaction, PollVote, PostComment, PostReaction,
    )

    counts: dict[int, int] = defaultdict(int)
    columns = [
        PostReaction.citizen_id, PollReaction.citizen_id, PostComment.citizen_id,
        CommentReaction.citizen_id, BillReaction.citizen_id, Poll.author_citizen_id,
        PollComment.citizen_id, PollCommentReaction.citizen_id, PollVote.citizen_id,
    ]
    for col in columns:
        rows = (
            db.query(col, func.count())
            .filter(col.in_(ids))
            .group_by(col)
            .all()
        )
        for cid, n in rows:
            counts[cid] += int(n or 0)
    return counts


def repair_citizen_accounts(db: Optional[Session] = None) -> dict:
    """Run the three steps above. Returns what changed, for the log and
    for tests."""
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount, PollComment, PostComment
    from app.services.citizen_geo import normalize_district
    from app.services.display_names import name_key, numbered_name

    owns = db is None
    db = db or SessionLocal()
    report = {
        "districts_fixed": 0, "districts_cleared": 0, "renamed": [], "keys_filled": 0,
        "placeholder_cities_cleared": 0,
    }
    try:
        citizens = db.query(CitizenAccount).order_by(CitizenAccount.id).all()

        # 1. Districts.
        for c in citizens:
            raw = c.congressional_district
            if not raw:
                continue
            canonical = normalize_district(c.state, raw)
            if canonical == raw:
                continue
            c.congressional_district = canonical
            report["districts_cleared" if canonical is None else "districts_fixed"] += 1

        # 2. Names.
        groups: dict[str, list] = defaultdict(list)
        for c in citizens:
            key = name_key(c.display_name)
            if key:
                groups[key].append(c)
        taken = set(groups)
        dupes = [rows for rows in groups.values() if len(rows) > 1]
        if dupes:
            activity = _activity_counts(db, [c.id for rows in dupes for c in rows])
            for rows in dupes:
                keeper = max(rows, key=lambda c: (activity.get(c.id, 0), -c.id))
                for c in sorted(rows, key=lambda r: r.id):
                    if c is keeper:
                        continue
                    old = c.display_name
                    new = numbered_name(old, taken)
                    taken.add(name_key(new))
                    c.display_name = new
                    for model in (PostComment, PollComment):
                        db.query(model).filter(model.citizen_id == c.id).update(
                            {model.citizen_display_name: new}, synchronize_session=False,
                        )
                    report["renamed"].append({"id": c.id, "from": old, "to": new})

        # 3. Keys (the ORM hook also sets them on update; this covers the
        # rows nothing else touched).
        for c in citizens:
            key = name_key(c.display_name) or None
            if c.name_key != key:
                c.name_key = key
                report["keys_filled"] += 1

        # 4. The old sign-up placeholder city.
        for c in citizens:
            if (c.city or "").strip().casefold() == PLACEHOLDER_CITY.casefold():
                c.city = ""
                report["placeholder_cities_cleared"] += 1

        db.commit()
        if (report["districts_fixed"] or report["districts_cleared"] or report["renamed"]
                or report["placeholder_cities_cleared"]):
            logger.info(
                "Citizen account repair: %d district(s) reformatted, %d invalid district(s) "
                "cleared (those accounts will be asked again), %d placeholder city value(s) "
                "cleared, renamed %s",
                report["districts_fixed"], report["districts_cleared"],
                report["placeholder_cities_cleared"],
                [f"#{r['id']} {r['from']!r} -> {r['to']!r}" for r in report["renamed"]] or "none",
            )
        return report
    except Exception:
        db.rollback()
        raise
    finally:
        if owns:
            db.close()


def flag_official_name_matches(db: Optional[Session] = None) -> list[dict]:
    """Log every citizen whose display name is a sitting official's.

    Sign-up already refuses those names (display_names.name_conflict);
    this catches accounts that got one some other way, most likely a
    real person who shares a name with someone newly elected. Nothing
    is changed: the warning is for review. Returns the matches."""
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount
    from app.services.display_names import reserved_name_keys

    reserved = reserved_name_keys()
    if not reserved:
        return []
    owns = db is None
    db = db or SessionLocal()
    try:
        rows = (
            db.query(CitizenAccount.id, CitizenAccount.display_name, CitizenAccount.name_key)
            .filter(CitizenAccount.name_key.in_(reserved))
            .order_by(CitizenAccount.id)
            .all()
        )
        matches = [{"id": r.id, "name": r.display_name} for r in rows]
        if matches:
            logger.warning(
                "Citizen account(s) whose name matches a sitting official, for review "
                "(not changed): %s",
                ", ".join(f"#{m['id']} {m['name']!r}" for m in matches),
            )
        return matches
    finally:
        if owns:
            db.close()
