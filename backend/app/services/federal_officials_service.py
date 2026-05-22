# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Federal Officials Service
Loads a curated snapshot of national-level officials from
/data/federal/federal_officials.json.

Mirrors the shape of StateOfficialsService so the frontend can reuse the
same tab/accordion UI (Executive / Judicial / Congress / Elections).
"""
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_PATH = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "federal"
    / "federal_officials.json"
)


class FederalOfficialsService:
    def __init__(self):
        self._payload: dict = {}
        self._load()

    def _load(self) -> None:
        if not DATA_PATH.exists():
            logger.warning(
                "FederalOfficialsService: data file missing at %s", DATA_PATH
            )
            return
        try:
            with DATA_PATH.open("r", encoding="utf-8") as fh:
                self._payload = json.load(fh) or {}
            exec_block = self._payload.get("executive", {}) or {}
            jud_block = self._payload.get("judiciary", {}) or {}
            scotus = (jud_block.get("supreme_court") or {}).get("members") or []
            logger.info(
                "FederalOfficialsService: loaded (cabinet=%d, justices=%d)",
                len(exec_block.get("cabinet", []) or []),
                len(scotus),
            )
        except (json.JSONDecodeError, OSError) as e:
            logger.error(
                "FederalOfficialsService: failed to load %s: %s", DATA_PATH, e
            )
            self._payload = {}

    def get_federal_officials(self) -> dict:
        """Return the full federal-officials payload."""
        return self._payload

    def get_executive(self) -> Optional[dict]:
        return self._payload.get("executive")

    def get_judiciary(self) -> Optional[dict]:
        return self._payload.get("judiciary")

    def get_congress(self) -> Optional[dict]:
        return self._payload.get("congress")

    def get_elections(self) -> Optional[dict]:
        return self._payload.get("elections")

    # ── Lookup + role derivation ──────────────────────────────────────
    def find_by_id(self, person_id: str) -> Optional[dict]:
        """Return the federal official's dict with an injected `role_type`
        and a chamber label for the Profile UI, or None if not found.

        Search order: president → VP → cabinet → SCOTUS → senate leadership
        → house leadership.
        """
        if not person_id:
            return None
        pid = str(person_id).strip()

        exec_block = self._payload.get("executive", {}) or {}
        jud_block = self._payload.get("judiciary", {}) or {}
        cong = self._payload.get("congress", {}) or {}

        president = exec_block.get("president")
        if president and president.get("id") == pid:
            return _inject_role(president, "president", chamber="Executive Branch")

        vp = exec_block.get("vice_president")
        if vp and vp.get("id") == pid:
            return _inject_role(vp, "vice_president", chamber="Executive Branch")

        for m in exec_block.get("cabinet", []) or []:
            if m.get("id") == pid:
                return _inject_role(m, "cabinet", chamber=m.get("department") or "Cabinet")

        for j in (jud_block.get("supreme_court") or {}).get("members", []) or []:
            if j.get("id") == pid:
                return _inject_role(j, "scotus", chamber="Supreme Court")

        for m in (cong.get("senate") or {}).get("leadership", []) or []:
            if m.get("id") == pid:
                return _inject_role(m, "congress_leader", chamber="U.S. Senate")
        for m in (cong.get("house") or {}).get("leadership", []) or []:
            if m.get("id") == pid:
                return _inject_role(m, "congress_leader", chamber="U.S. House")

        return None

    def reload(self) -> None:
        self._payload = {}
        self._load()


def _inject_role(d: dict, role_type: str, chamber: str = None) -> dict:
    """Return a copy of an official dict with `role_type`, `chamber`, and a
    best-effort photoUrl (Wikipedia if present; else None)."""
    out = dict(d)
    out["role_type"] = role_type
    if chamber and not out.get("chamber"):
        out["chamber"] = chamber
    return out
