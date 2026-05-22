# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Events Service

Loads curated upcoming public events / town halls from a static JSON file
and exposes simple lookup helpers. Events are filtered to upcoming-only
based on the current server time.

Schema note (Task #71): keys in events.json may be either bioguide_ids
(Congress members) OR federal-official IDs (e.g., 'us-pres-trump',
'us-vp-vance', 'us-cabinet-rubio'). The lookup is type-agnostic — the
service treats every key as an opaque "official_id". The legacy
get_member_events() helper stays as a thin alias for callers that still
think in bioguide_id terms.
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "events.json"


class EventsService:
    def __init__(self):
        # Keys are opaque official_ids — bioguide_ids for Congress,
        # federal-official IDs (us-pres-*, us-vp-*, us-cabinet-*,
        # us-scotus-*) for everyone else.
        self._events_by_official: dict[str, list[dict]] = {}
        self._loaded_at: Optional[datetime] = None
        self._load()

    def _load(self) -> None:
        try:
            with DATA_PATH.open("r", encoding="utf-8") as fh:
                raw = json.load(fh)
            self._events_by_official = raw.get("events", {}) or {}
            self._loaded_at = datetime.utcnow()
            total = sum(len(v) for v in self._events_by_official.values())
            logger.info(
                "EventsService: loaded %d events for %d officials from %s",
                total,
                len(self._events_by_official),
                DATA_PATH,
            )
        except FileNotFoundError:
            logger.warning("EventsService: events.json not found at %s", DATA_PATH)
            self._events_by_official = {}
        except json.JSONDecodeError as e:
            logger.error("EventsService: failed to parse events.json: %s", e)
            self._events_by_official = {}

    @staticmethod
    def _parse_date(date_str: str) -> Optional[datetime]:
        if not date_str:
            return None
        try:
            # Accept naive ISO timestamps; treat as local wall-clock time.
            return datetime.fromisoformat(date_str.replace("Z", ""))
        except (ValueError, TypeError):
            return None

    def _filter_upcoming(self, events: list[dict]) -> list[dict]:
        now = datetime.now()
        upcoming = []
        for evt in events:
            dt = self._parse_date(evt.get("date", ""))
            if dt is None or dt >= now:
                upcoming.append(evt)
        upcoming.sort(key=lambda e: self._parse_date(e.get("date", "")) or datetime.max)
        return upcoming

    def get_events_for_official(self, official_id: str) -> list[dict]:
        """Return upcoming events for a single official_id, soonest first.

        Accepts both bioguide_ids (Congress) and federal-official IDs
        (us-pres-*, etc.). Empty list when the id has no curated events.
        """
        if not official_id:
            return []
        raw = self._events_by_official.get(official_id, [])
        return self._filter_upcoming(raw)

    # Legacy alias — preserved so existing call sites that still think in
    # bioguide_id terms (the original Phase 1.5 code path) keep working.
    def get_member_events(self, bioguide_id: str) -> list[dict]:
        return self.get_events_for_official(bioguide_id)

    def get_all_upcoming_events(self) -> list[dict]:
        """Return a flat list of all upcoming events across all officials,
        each enriched with both `official_id` and the legacy `bioguide_id`
        key (same value), sorted by date ascending. The duplicate key is
        for backward compatibility — frontend can read either."""
        flat: list[dict] = []
        for official_id, events in self._events_by_official.items():
            for evt in events:
                flat.append({
                    **evt,
                    "official_id": official_id,
                    "bioguide_id": official_id,
                })
        return self._filter_upcoming(flat)

    def reload(self) -> None:
        """Force a reload from disk (useful if the curated JSON changes)."""
        self._load()
