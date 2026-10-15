# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Rosters show who holds each seat today (2026-10-15).

Jeffrey: "From the day someone leaves office, they never appear as
anyone's current official (address lookup, map, officials lists); show
the successor or 'Vacant'. Until the archive they can still be found
through search and direct links, with the Former label."

The roster files are refreshed by script, so a departure an admin
records by hand (with its official source) can reach the app before
the next refresh. These helpers take that person out of the current
lists the moment the date passes, and mark the seat vacant unless
someone else already holds it. Departures the refresh already handled
are not in the lists to begin with.

Every helper returns a new object; the services' cached payloads are
never changed in place.
"""
from __future__ import annotations

import copy
from typing import Optional

from app.services import page_lifecycle


def departed_ids(db) -> set:
    """Lowercased ids of officials who have left office as of today."""
    return {pid.lower() for pid in page_lifecycle.departed_page_ids(db)}


def _gone(record: Optional[dict], departed: set, key: str = "id") -> bool:
    return bool(record) and str(record.get(key) or "").lower() in departed


# ── Congress ─────────────────────────────────────────────────────────

def filter_congress_members(members: list, departed: set) -> tuple[list, list]:
    """(members still serving, House members who left) for one list."""
    if not departed:
        return members, []
    keep, gone = [], []
    for m in members or []:
        (gone if _gone(m, departed, "bioguide_id") else keep).append(m)
    return keep, gone


def add_house_vacancies(vacant: list, gone: list, keep: list) -> list:
    """Districts of House members who left, when nobody else holds them."""
    out = list(vacant or [])
    held = {(m.get("state"), m.get("district")) for m in keep if m.get("chamber") == "House"}
    for m in gone:
        if m.get("chamber") != "House":
            continue
        d = m.get("district")
        try:
            num = int(d) if d is not None else 0
        except (TypeError, ValueError):
            continue
        if (m.get("state"), d) not in held and num not in out:
            out.append(num)
    return sorted(out)


# ── State officials ──────────────────────────────────────────────────

def _vacant_executive(record: dict) -> dict:
    """What a statewide office shows while nobody holds it."""
    return {"id": None, "name": "Vacant", "vacant": True, "role": record.get("role"),
            "office": record.get("office"), "party": None, "photo_url": None}


def filter_state_payload(payload: Optional[dict], departed: set) -> Optional[dict]:
    if not payload or not departed:
        return payload
    exe = payload.get("executive") or {}
    chambers = [payload.get(k) or {} for k in ("state_senate", "state_house")]
    touched = any(_gone(exe.get(k), departed) for k in ("governor", "lt_governor")) or \
        any(_gone(c, departed) for c in exe.get("cabinet") or []) or \
        any(_gone(m, departed) for ch in chambers for b in ("members", "leadership") for m in ch.get(b) or [])
    if not touched:
        return payload
    out = copy.deepcopy(payload)
    exe = out.get("executive") or {}
    for k in ("governor", "lt_governor"):
        if _gone(exe.get(k), departed):
            exe[k] = _vacant_executive(exe[k])
    if exe.get("cabinet"):
        exe["cabinet"] = [_vacant_executive(c) if _gone(c, departed) else c for c in exe["cabinet"]]
    for key in ("state_senate", "state_house"):
        block = out.get(key) or {}
        gone = [m for m in block.get("members") or [] if _gone(m, departed)]
        if not gone and not any(_gone(m, departed) for m in block.get("leadership") or []):
            continue
        block["members"] = [m for m in block.get("members") or [] if not _gone(m, departed)]
        block["leadership"] = [m for m in block.get("leadership") or [] if not _gone(m, departed)]
        vacancies = list(block.get("vacancies") or [])
        listed = {str(v.get("district")): v for v in vacancies}
        for m in gone:
            d = str(m.get("district"))
            if d in listed:
                listed[d]["seats_vacant"] = int(listed[d].get("seats_vacant") or 0) + 1
                listed[d].setdefault("previous_members", []).append(m.get("name"))
            else:
                entry = {"district": d, "seats_vacant": 1, "previous_members": [m.get("name")]}
                vacancies.append(entry)
                listed[d] = entry
        block["vacancies"] = vacancies
    return out


def find_former_state_person(payload: Optional[dict], person_id: str) -> Optional[dict]:
    """A state official who left keeps their id as a former official's
    page: their record from _former_members."""
    for rec in (payload or {}).get("_former_members") or []:
        if rec.get("id") == person_id:
            role_type = "state_legislator" if rec.get("district") else "state_cabinet"
            return {**rec, "role_type": role_type, "former": True,
                    "chamber": rec.get("chamber") or "Executive"}
    return None


# ── Federal officials ────────────────────────────────────────────────

def filter_federal_payload(payload: Optional[dict], departed: set) -> Optional[dict]:
    if not payload or not departed:
        return payload
    exe = payload.get("executive") or {}
    if not (any(_gone(exe.get(k), departed) for k in ("president", "vice_president"))
            or any(_gone(c, departed) for c in exe.get("cabinet") or [])):
        return payload
    out = copy.deepcopy(payload)
    exe = out.get("executive") or {}
    for k in ("president", "vice_president"):
        if _gone(exe.get(k), departed):
            exe[k] = _vacant_executive(exe[k])
    exe["cabinet"] = [_vacant_executive(c) if _gone(c, departed) else c for c in exe.get("cabinet") or []]
    return out


def find_former_federal_person(payload: Optional[dict], person_id: str) -> Optional[dict]:
    for rec in (payload or {}).get("_former_members") or []:
        if rec.get("id") == person_id:
            return {**rec, "role_type": "cabinet", "former": True, "chamber": "Executive"}
    return None
