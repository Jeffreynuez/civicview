# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Admin view of the daily bill update pass (2026-10-17).

  GET  /api/admin/bill-updates       what is watched, the last passes, recent updates
  POST /api/admin/bill-updates/run   run a pass now (sends what it finds)

See services/bill_updates.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import bill_updates
from app.services.admin_auth import get_current_admin

admin_router = APIRouter()


@admin_router.get("")
def admin_status(db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    return {**bill_updates.status(db), "last_pass_this_process": dict(bill_updates.LAST_PASS)}


@admin_router.post("/run")
async def admin_run(admin: dict = Depends(get_current_admin)):
    return await bill_updates.run_pass(force=True)
