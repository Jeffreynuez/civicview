# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
A former official's or candidate's account, linked to their citizen
account (2026-10-15, Jeffrey's decision 4).

Former officials "are considered just citizens if they are not in
office". What carries to their citizen account, each only if they opt
in from their former account's dashboard:

  (a) their own name, freed for their own citizen account only, matched
      by ID.me's verified legal name, and still reserved against
      everyone else. First and last names must match, ignoring case,
      accents and punctuation; middle names and suffixes may differ. A
      nickname case (Chuck and Charles) goes to an admin to approve with
      a source, after ID.me verification. Anything else is refused.
  (b) a copy of their tracked items, saved posts and notification
      settings (copied, never moved, merged without duplicates);
  (c) an optional "Served as" line on their citizen card, generated
      from our records (office, district or state, years), plain text,
      removable any time.

Not carried: the people tracking them, any title or badge, any
shortcut past verification. Linking needs both accounts signed in in
the same browser, which proves one person controls both.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.pages import (
    CandidateAccount,
    CitizenAccount,
    FormerAccountLink,
    RepAccount,
)
from app.services import page_lifecycle as pl

logger = logging.getLogger(__name__)

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


# ── which former account is this ─────────────────────────────────────

def page_id_of(kind: str, account) -> Optional[str]:
    if account is None:
        return None
    return account.official_id if kind == "rep" else account.candidate_id


def former_transition(db: Session, kind: str, account) -> Optional[pl.Transition]:
    """The transition that made this account a former one, or None
    while the person is in office or still running (and for winners)."""
    t = pl.get_transition(db, page_id_of(kind, account))
    if t is None or t.event == "won" or t.stage() not in pl.FORMER_STAGES:
        return None
    return t


def pick_former_account(db: Session, me_rep, me_candidate):
    """(kind, account, transition) for the signed-in former account,
    rep first. None when neither signed-in account is former."""
    for kind, account in (("rep", me_rep), ("candidate", me_candidate)):
        if account is None:
            continue
        t = former_transition(db, kind, account)
        if t is not None:
            return kind, account, t
    return None


def active_link(db: Session, kind: str, former_id: int) -> Optional[FormerAccountLink]:
    return (
        db.query(FormerAccountLink)
        .filter(FormerAccountLink.former_kind == kind, FormerAccountLink.former_id == former_id,
                FormerAccountLink.unlinked_at.is_(None))
        .order_by(FormerAccountLink.id.desc())
        .first()
    )


def former_account(db: Session, link: FormerAccountLink):
    model = RepAccount if link.former_kind == "rep" else CandidateAccount
    return db.get(model, link.former_id)


# ── names ────────────────────────────────────────────────────────────

def _tokens(name: str) -> list[str]:
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r'"[^"]*"|\([^)]*\)', " ", text)  # quoted nicknames
    words = [re.sub(r"[^0-9a-z-]", "", w.casefold()) for w in text.split()]
    return [w for w in words if w and w.strip("-") and w.strip(".") not in _SUFFIXES]


def _key(word: str) -> str:
    return re.sub(r"[^0-9a-z]", "", word)


def legal_name_match(legal_name: str, official_name: str) -> str:
    """'match' | 'review' | 'mismatch'.

    match     first and last names agree (middle names, initials and
              suffixes may differ)
    review    last names agree but first names differ (a nickname, such
              as Chuck and Charles), or one last name is part of the
              other (a hyphenated or two-word surname): an admin
              decides, with a source
    mismatch  anything else"""
    legal, official = _tokens(legal_name), _tokens(official_name)
    if len(legal) < 2 or len(official) < 2:
        return "mismatch"
    l_first, l_last = _key(legal[0]), _key(legal[-1])
    o_first, o_last = _key(official[0]), _key(official[-1])
    if l_last == o_last:
        return "match" if l_first == o_first else "review"
    l_all, o_all = _key("".join(legal)), _key("".join(official))
    if l_first == o_first and (o_last in l_all or l_last in o_all):
        return "review"
    return "mismatch"


def _citizen_legal_name(citizen: CitizenAccount) -> Optional[str]:
    if not citizen or not citizen.verified or citizen.verified_method != "id.me":
        return None
    from app.services.idme_service import decrypt_legal_name
    return decrypt_legal_name(citizen.verified_legal_name_encrypted or "")


def evaluate_name(db: Session, link: FormerAccountLink) -> str:
    """Work out (or re-check) the name hand-off for an opted-in link and
    apply it when it is approved. Returns the status."""
    if link.name_on_at is None or link.name_off_at is not None or link.unlinked_at is not None:
        return link.name_status or "off"
    if link.name_status in ("approved", "refused") and link.name_applied_at is not None:
        return link.name_status
    citizen = db.get(CitizenAccount, link.citizen_id)
    former = former_account(db, link)
    if citizen is None or former is None:
        return link.name_status or "waiting"
    if link.name_status != "approved":
        legal = _citizen_legal_name(citizen)
        if legal is None:
            link.name_status = "waiting"
            return link.name_status
        verdict = legal_name_match(legal, former.display_name)
        link.name_status = {"match": "approved", "review": "review", "mismatch": "refused"}[verdict]
    if link.name_status == "approved" and link.name_applied_at is None:
        apply_name(db, link, citizen, former)
    return link.name_status


def apply_name(db: Session, link: FormerAccountLink, citizen: CitizenAccount, former) -> bool:
    """Give the citizen account the former account's name. Only this
    citizen can hold it: the name stays on the former account (so it is
    still reserved against everyone else) and the citizen name index
    keeps any other citizen off it."""
    from app.services.display_names import name_key
    taken = (
        db.query(CitizenAccount.id)
        .filter(CitizenAccount.name_key == name_key(former.display_name), CitizenAccount.id != citizen.id)
        .first()
    )
    if taken is not None:
        logger.warning("name hand-off: another citizen holds the name of %s account %s; not applied",
                       link.former_kind, link.former_id)
        return False
    citizen.display_name = former.display_name
    link.name_applied_at = datetime.utcnow()
    return True


def name_handoff_allowed(db: Session, citizen_id: Optional[int], key: str) -> bool:
    """True when `key` is the name of a former account linked to this
    citizen, opted in and approved (display_names.name_conflict)."""
    if citizen_id is None or not key:
        return False
    from app.services.display_names import name_key
    links = (
        db.query(FormerAccountLink)
        .filter(FormerAccountLink.citizen_id == citizen_id, FormerAccountLink.unlinked_at.is_(None),
                FormerAccountLink.name_on_at.isnot(None), FormerAccountLink.name_off_at.is_(None),
                FormerAccountLink.name_status == "approved")
        .all()
    )
    for link in links:
        former = former_account(db, link)
        if former is not None and name_key(former.display_name) == key:
            return True
    return False


def reevaluate_for_citizen(db: Session, citizen: CitizenAccount) -> None:
    """Called after ID.me verifies a citizen: any waiting name hand-off
    is checked against the verified legal name now."""
    links = (
        db.query(FormerAccountLink)
        .filter(FormerAccountLink.citizen_id == citizen.id, FormerAccountLink.unlinked_at.is_(None),
                FormerAccountLink.name_on_at.isnot(None), FormerAccountLink.name_off_at.is_(None))
        .all()
    )
    for link in links:
        if link.name_status in (None, "waiting"):
            evaluate_name(db, link)
    db.commit()


# ── copies ───────────────────────────────────────────────────────────

def copy_items(db: Session, link: FormerAccountLink) -> dict:
    """Copy the former account's tracked items, saved posts and
    notification settings to the citizen account. Copies, never moves;
    anything the citizen already has is left as it is."""
    from app.models.pages import SavedItem, TrackedBill, TrackedElection, TrackedOfficial
    from app.routers.auth_citizen import sanitize_notification_prefs

    kind, fid, cid = link.former_kind, link.former_id, link.citizen_id
    counts = {"bills": 0, "officials": 0, "elections": 0, "saved": 0, "settings": 0}
    for model, key_attr, label in ((TrackedBill, "bill_key", "bills"),
                                   (TrackedOfficial, "official_key", "officials"),
                                   (TrackedElection, "election_key", "elections")):
        mine = {getattr(r, key_attr) for r in db.query(model).filter(
            model.tracker_kind == "citizen", model.tracker_id == cid).all()}
        q = db.query(model).filter(model.tracker_kind == kind, model.tracker_id == fid)
        if model is TrackedOfficial:
            q = q.filter(TrackedOfficial.ended_at.is_(None))
        for row in q.all():
            key = getattr(row, key_attr)
            if key in mine:
                continue
            db.add(model(tracker_kind="citizen", tracker_id=cid, **{key_attr: key},
                         snapshot_json=row.snapshot_json, prefs_json=row.prefs_json))
            mine.add(key)
            counts[label] += 1
    have = {(r.item_type, r.item_id) for r in db.query(SavedItem).filter(
        SavedItem.tracker_kind == "citizen", SavedItem.tracker_id == cid).all()}
    for row in db.query(SavedItem).filter(SavedItem.tracker_kind == kind, SavedItem.tracker_id == fid).all():
        if (row.item_type, row.item_id) in have:
            continue
        db.add(SavedItem(tracker_kind="citizen", tracker_id=cid, item_type=row.item_type, item_id=row.item_id))
        have.add((row.item_type, row.item_id))
        counts["saved"] += 1
    former = former_account(db, link)
    citizen = db.get(CitizenAccount, cid)
    if former is not None and citizen is not None and former.notification_prefs_json:
        try:
            theirs = json.loads(former.notification_prefs_json) or {}
            mine = json.loads(citizen.notification_prefs_json) if citizen.notification_prefs_json else {}
        except (ValueError, TypeError):
            theirs, mine = {}, {}
        merged = dict(mine)
        added = 0
        for k, v in theirs.items():
            if k not in merged:
                merged[k] = v
                added += 1
        if added:
            try:
                citizen.notification_prefs_json = json.dumps(sanitize_notification_prefs(merged),
                                                             ensure_ascii=False)
                counts["settings"] = added
            except Exception:
                logger.warning("copy_items: notification settings did not pass the sanitizer; skipped")
    link.copies_at = datetime.utcnow()
    link.copies_counts_json = json.dumps(counts)
    return counts


# ── the Served as line ───────────────────────────────────────────────

def served_as_for_citizen(db: Session, citizen_id: int) -> Optional[str]:
    """The generated line, when this citizen turned it on from a linked
    former official's account and has not removed it."""
    link = (
        db.query(FormerAccountLink)
        .filter(FormerAccountLink.citizen_id == citizen_id, FormerAccountLink.unlinked_at.is_(None),
                FormerAccountLink.former_kind == "rep",
                FormerAccountLink.served_as_on_at.isnot(None), FormerAccountLink.served_as_off_at.is_(None))
        .order_by(FormerAccountLink.id.desc())
        .first()
    )
    if link is None:
        return None
    former = former_account(db, link)
    t = pl.get_transition(db, page_id_of("rep", former)) if former is not None else None
    return pl.served_as_line(t) if t is not None else None


# ── the dashboard view ───────────────────────────────────────────────

def dashboard(db: Session, kind: str, account, t: pl.Transition) -> dict:
    link = active_link(db, kind, account.id)
    if link is not None and link.name_on_at is not None and link.name_off_at is None:
        evaluate_name(db, link)
        db.commit()
    citizen = db.get(CitizenAccount, link.citizen_id) if link is not None else None
    return {
        "kind": kind,
        "page_id": page_id_of(kind, account),
        "lifecycle": t.as_dict(),
        "served_as_preview": pl.served_as_line(t) if kind == "rep" else None,
        "link": None if link is None else {
            "citizen_id": link.citizen_id,
            "citizen_name": citizen.display_name if citizen else None,
            "citizen_verified": bool(citizen and citizen.verified and citizen.verified_method == "id.me"),
            "linked_at": link.linked_at.isoformat() if link.linked_at else None,
            "name": {
                "on": link.name_on_at is not None and link.name_off_at is None,
                "status": link.name_status,
                "applied": link.name_applied_at is not None,
            },
            "copies": {
                "done": link.copies_at is not None,
                "at": link.copies_at.isoformat() if link.copies_at else None,
                "counts": json.loads(link.copies_counts_json) if link.copies_counts_json else None,
            },
            "served_as": {
                "on": link.served_as_on_at is not None and link.served_as_off_at is None,
            },
        },
    }
