# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""One rule for "this citizen is a verified person".

A citizen counts as verified only when `verified` is set by a real
method. Demo accounts carry verified_method='demo' (or nothing) and do
not count, whatever their verified flag says. Used wherever a demo
account must not stand in for a real person: report auto-hide
(moderation.py) and demographic answers on polls (audit S10).
"""
from __future__ import annotations

from typing import Any


def is_verified_person(citizen: Any) -> bool:
    if citizen is None:
        return False
    method = (getattr(citizen, "verified_method", None) or "").lower()
    return bool(getattr(citizen, "verified", False)) and method not in ("", "demo")
