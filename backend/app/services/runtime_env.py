# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Is this process the production deployment?

Render sets RENDER=true on every service it runs, so production is
detected without a new variable to remember. CIVICVIEW_ENV=production
forces the answer anywhere else, and CIVICVIEW_ENV=development forces
it off (a local run that happens to have RENDER set).
"""
from __future__ import annotations

import os


def is_production() -> bool:
    explicit = (os.getenv("CIVICVIEW_ENV") or "").strip().lower()
    if explicit in ("production", "prod"):
        return True
    if explicit in ("development", "dev", "test"):
        return False
    return (os.getenv("RENDER") or "").strip().lower() in ("true", "1", "yes")
