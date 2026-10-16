# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Election reminders (2026-10-16). See services/election_reminders.py.

Citizen (signed in):
  GET  /api/election-reminders/settings   on or off, and the states covered
  PUT  /api/election-reminders/settings   {"enabled": bool}
  POST /api/election-reminders/off        the one-tap "Turn off election
                                          reminders" on a reminder

Admin (mounted at /api/admin/election-reminders, before the general
admin router):
  GET  /api/admin/election-reminders      preview: every scheduled
                                          reminder with its date, state,
                                          kind, wording, source and
                                          recipient count, and what will
                                          not be sent and why
  POST /api/admin/election-reminders/run  send what is due now (still
                                          does nothing while
                                          ELECTION_REMINDERS_ENABLED is off)

Personal or admin-only, so never edge-cached (main.py caches only the
public prefixes it lists).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import CitizenAccount
from app.services import election_reminders as er
from app.services.admin_auth import get_current_admin

router = APIRouter()
admin_router = APIRouter()


def _require_citizen(citizen: Optional[CitizenAccount]) -> CitizenAccount:
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Sign in to change election reminders.")
    return citizen


class ReminderSettingsBody(BaseModel):
    enabled: bool


@router.get("/settings")
def get_settings(citizen: Optional[CitizenAccount] = Depends(get_optional_citizen)):
    return er.citizen_settings(_require_citizen(citizen))


@router.put("/settings")
def put_settings(
    body: ReminderSettingsBody,
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    citizen = _require_citizen(citizen)
    if body.enabled:
        citizen.election_reminders_off_at = None
    elif citizen.election_reminders_off_at is None:
        citizen.election_reminders_off_at = datetime.utcnow()
    db.add(citizen)
    db.commit()
    return er.citizen_settings(citizen)


@router.post("/off")
def turn_off(
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    citizen = _require_citizen(citizen)
    if citizen.election_reminders_off_at is None:
        citizen.election_reminders_off_at = datetime.utcnow()
        db.add(citizen)
        db.commit()
    return er.citizen_settings(citizen)


@admin_router.get("")
def admin_preview(db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    return er.preview(db)


@admin_router.post("/run")
def admin_run(db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    return er.run_due(db)
