# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""GET /api/photo-credits: who took each Wikimedia Commons photo, and its license.

Serves backend/app/data/photo_credits.json, which
scripts/build_photo_credits.py builds from the Wikimedia Commons API.
The frontend shows a credit line under large profile photos and lists
every entry on /photo-credits (audit P2: CC BY and CC BY-SA photos must
name the author and license wherever they appear). Public, read-only,
the same for every visitor, so it is edge-cacheable.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()

_CREDITS_PATH = Path(__file__).resolve().parent.parent / "data" / "photo_credits.json"


@lru_cache(maxsize=1)
def _load() -> dict:
    try:
        doc = json.loads(_CREDITS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"retrieved": None, "credits": []}
    credits = [
        {"photo_url": url, **entry}
        for url, entry in sorted(
            doc.get("credits", {}).items(),
            key=lambda item: ((item[1].get("subjects") or ["~"])[0].lower(), item[0]),
        )
    ]
    return {"retrieved": doc.get("retrieved"), "credits": credits}


@router.get("")
def list_photo_credits() -> dict:
    return _load()
