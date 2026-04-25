"""
Events Service
Loads curated upcoming public events / town halls from a static JSON file and
exposes simple lookup helpers. Events are filtered to upcoming-only based on
the current server time.
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
        self._events_by_member: dict[str, list[dict]] = {}
        self._loaded_at: Optional[datetime] = None
        self._load()

    def _load(self) -> None:
        try:
            with DATA_PATH.open("r", encoding="utf-8") as fh:
                raw = json.load(fh)
            self._events_by_member = raw.get("events", {}) or {}
            self._loaded_at = datetime.utcnow()
            total = sum(len(v) for v in self._events_by_member.values())
            logger.info(
                "EventsService: loaded %d events for %d members from %s",
                total,
                len(self._events_by_member),
                DATA_PATH,
            )
        except FileNotFoundError:
            logger.warning("EventsService: events.json not found at %s", DATA_PATH)
            self._events_by_member = {}
        except json.JSONDecodeError as e:
            logger.error("EventsService: failed to parse events.json: %s", e)
            self._events_by_member = {}

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

    def get_member_events(self, bioguide_id: str) -> list[dict]:
        """Return upcoming events for a single bioguide_id, soonest first."""
        if not bioguide_id:
            return []
        raw = self._events_by_member.get(bioguide_id, [])
        return self._filter_upcoming(raw)

    def get_all_upcoming_events(self) -> list[dict]:
        """Return a flat list of all upcoming events across all members,
        each enriched with the bioguide_id key, sorted by date ascending."""
        flat: list[dict] = []
        for bioguide_id, events in self._events_by_member.items():
            for evt in events:
                flat.append({**evt, "bioguide_id": bioguide_id})
        return self._filter_upcoming(flat)

    def reload(self) -> None:
        """Force a reload from disk (useful if the curated JSON changes)."""
        self._load()
