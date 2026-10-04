# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
One name, one person (2026-10-03).

Jeffrey: "lets make sure that no two people can have the same name."
He chose the strict reading: two names are the same when they differ
only in capitals, spacing, punctuation or accents. "Tyron Bigums",
"tyron  bigums" and "Tyrón Bigums." are one name; "Tyron Bigums 2" is
another.

    name_key(name)       the comparison form: letters and digits only,
                         accents dropped, case folded
    clean_display_name   trims and collapses spaces; refuses a name with
                         no letters or digits
    name_conflict        why a new citizen can't use a name: another
                         citizen has it, a rep or candidate account has
                         it, or a sitting official holds it
    numbered_name        "Name 2", "Name 3", ... the first that is free

Citizens are held to it by the database too: citizen_accounts.name_key
carries a unique index, filled by an ORM hook on every insert and
update (models/pages.py), so two sign-ups racing for one name cannot
both win. Rep and candidate accounts use the person's real name, set
by an operator when the page is claimed, so they are checked here
rather than blocked: a citizen can't take one of their names, and the
seeds log a warning if one ever matches a citizen.

Reserved names (Jeffrey's "Block officials' names"): a citizen cannot
take the name of a sitting member of Congress, the President, the Vice
President, a Cabinet member, a Supreme Court justice, or a governor or
other statewide official. The names come from the same data the
officials index reads, so they follow the roster.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import unicodedata
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

MAX_DISPLAY_NAME = 80

# Suffixes and lone initials dropped to make a second, shorter form of
# an official's name: "John G. Roberts Jr." also reserves "John Roberts".
_SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v"})


def name_key(name: object) -> str:
    """Letters and digits only, accents dropped, case folded."""
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return "".join(ch for ch in text.casefold() if ch.isalnum())


def clean_display_name(raw: object) -> str:
    """Trimmed, inner runs of spaces collapsed. Raises ValueError with a
    message for the person when the name can't be used."""
    name = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not name:
        raise ValueError("Display name is required.")
    if len(name) > MAX_DISPLAY_NAME:
        raise ValueError(f"Keep your display name to {MAX_DISPLAY_NAME} characters or fewer.")
    if not name_key(name):
        raise ValueError("Use at least one letter or number in your display name.")
    return name


def _short_form(name: str) -> Optional[str]:
    words = [w for w in re.split(r"\s+", name.strip()) if w]
    kept = [
        w for w in words
        if not re.fullmatch(r"[A-Za-z]\.?", w)
        and w.strip(".,").casefold() not in _SUFFIXES
    ]
    if len(kept) >= 2 and len(kept) != len(words):
        return " ".join(kept)
    return None


# ── reserved names (sitting officials) ──────────────────────────────
_RESERVED: Optional[frozenset] = None
_RESERVED_LOCK = threading.Lock()


def _names_in(value) -> Iterable[str]:
    """Every "name" field in a dict, a list of dicts, or a dict of those."""
    if isinstance(value, dict):
        if isinstance(value.get("name"), str):
            yield value["name"]
        else:
            for v in value.values():
                yield from _names_in(v)
    elif isinstance(value, list):
        for v in value:
            yield from _names_in(v)


def _collect_reserved_names() -> set[str]:
    from app.services.officials_index import (
        DATA_DIR,
        _load_legislators_current_synchronously,
    )

    names: set[str] = set()

    fed_path = DATA_DIR / "federal" / "federal_officials.json"
    try:
        fed = json.loads(fed_path.read_text(encoding="utf-8"))
        names.update(_names_in(fed.get("executive") or {}))
        names.update(_names_in(((fed.get("judiciary") or {}).get("supreme_court") or {}).get("members") or []))
        congress = fed.get("congress") or {}
        for chamber in ("senate", "house"):
            names.update(_names_in((congress.get(chamber) or {}).get("leadership") or []))
    except (OSError, json.JSONDecodeError, AttributeError) as e:
        logger.warning("display_names: could not read %s: %s", fed_path, e)

    # Governors, lieutenant governors and the rest of each state's
    # executive branch. State legislators are not reserved.
    if DATA_DIR.exists():
        for sub in DATA_DIR.iterdir():
            path = sub / "state_officials.json"
            if not sub.is_dir() or not path.exists():
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                names.update(_names_in(payload.get("executive") or {}))
            except (OSError, json.JSONDecodeError, AttributeError) as e:
                logger.warning("display_names: could not read %s: %s", path, e)

    # Every sitting member of Congress.
    roster = _load_legislators_current_synchronously()
    if roster:
        for entry in roster:
            n = (entry or {}).get("name") or {}
            if n.get("official_full"):
                names.add(n["official_full"])
            first, last = n.get("first"), n.get("last")
            if first and last:
                names.add(f"{first} {last}")
                if n.get("nickname"):
                    names.add(f"{n['nickname']} {last}")
    else:
        try:
            from app.services.congress_service import CongressService
            for block in (CongressService.SAMPLE_DATA or {}).values():
                names.update(_names_in((block or {}).get("congress") or []))
        except Exception:  # pragma: no cover - sample data is optional
            logger.info("display_names: no Congress roster available for reserved names")

    for name in list(names):
        short = _short_form(name)
        if short:
            names.add(short)
    return names


def reserved_name_keys() -> frozenset:
    """Keys of officials' names, built once per process."""
    global _RESERVED
    if _RESERVED is None:
        with _RESERVED_LOCK:
            if _RESERVED is None:
                keys = {name_key(n) for n in _collect_reserved_names()}
                keys.discard("")
                _RESERVED = frozenset(keys)
                logger.info("display_names: %d official names reserved", len(_RESERVED))
    return _RESERVED


def reset_reserved_for_tests() -> None:
    global _RESERVED
    _RESERVED = None


# ── conflicts ───────────────────────────────────────────────────────
def name_conflict(db, name: str, *, exclude_citizen_id: Optional[int] = None) -> Optional[str]:
    """None when a citizen may use `name`; otherwise a message saying why
    not, written for the person signing up."""
    from app.models.pages import CandidateAccount, CitizenAccount, RepAccount

    key = name_key(name)
    if not key:
        return "Use at least one letter or number in your display name."
    taken = f'The name "{name}" is already taken. Add a middle initial, a middle name or a number to make it yours.'

    q = db.query(CitizenAccount.id).filter(CitizenAccount.name_key == key)
    if exclude_citizen_id is not None:
        q = q.filter(CitizenAccount.id != exclude_citizen_id)
    if q.first() is not None:
        return taken

    # Rep and candidate accounts have no key column; their numbers are
    # small (a few per claimed page), so compare in Python.
    for model in (RepAccount, CandidateAccount):
        for (other,) in db.query(model.display_name).all():
            if name_key(other) == key:
                return taken

    if key in reserved_name_keys():
        return (
            f'"{name}" is the name of a sitting official, so it can\'t be used '
            "for a citizen account. Choose another display name."
        )
    return None


def numbered_name(base: str, taken_keys: set[str]) -> str:
    """The first of "base 2", "base 3", ... whose key is not taken."""
    stem = base.strip()[: MAX_DISPLAY_NAME - 4].rstrip()
    n = 2
    while True:
        candidate = f"{stem} {n}"
        if name_key(candidate) not in taken_keys:
            return candidate
        n += 1
