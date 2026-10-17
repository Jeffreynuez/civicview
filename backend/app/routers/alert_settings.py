# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""The notification settings list (2026-10-17).

  GET   /api/alert-settings   the signed-in citizen's list
  PATCH /api/alert-settings   change one row: {"row": "bills", "value": "bell_push_email"}

One row per request, so two devices, or a device and an email's
unsubscribe link, never undo each other's changes (the synced prefs
blob is replaced whole, which is why the list is not stored there).
The weekly email digest is a row too ("digest": "weekly" | "off"),
backed by CitizenAccount.digest_opt_in.
Rules and storage: services/alert_settings.py.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth_citizen import get_optional_citizen
from app.db import get_db
from app.models.pages import CitizenAccount
from app.services import alert_settings as als

router = APIRouter()

DIGEST_CHOICES = ("weekly", "off")


def _require(citizen: Optional[CitizenAccount]) -> CitizenAccount:
    if citizen is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to change notification settings.")
    return citizen


def _payload(citizen: CitizenAccount) -> dict:
    from app.services.digest_service import is_demo_email

    return {
        "settings": als.settings_for(citizen),
        "choices": {row: als.choices_for(row) for row in als.ROW_ORDER},
        "digest": "weekly" if citizen.digest_opt_in else "off",
        # A demo account's generated address receives no mail.
        "email_available": bool(citizen.email) and not is_demo_email(citizen.email),
    }


@router.get("")
def get_alert_settings(citizen: Optional[CitizenAccount] = Depends(get_optional_citizen)):
    return _payload(_require(citizen))


class AlertSettingIn(BaseModel):
    row: str = Field(max_length=32)
    value: str = Field(max_length=32)


@router.patch("")
def patch_alert_setting(
    body: AlertSettingIn,
    db: Session = Depends(get_db),
    citizen: Optional[CitizenAccount] = Depends(get_optional_citizen),
):
    citizen = _require(citizen)
    if body.row == "digest":
        if body.value not in DIGEST_CHOICES:
            raise HTTPException(status_code=422, detail="Unknown choice.")
        citizen.digest_opt_in = body.value == "weekly"
        db.add(citizen)
        db.commit()
    else:
        try:
            als.set_choice(db, citizen, body.row, body.value)
        except ValueError:
            raise HTTPException(status_code=422, detail="Unknown setting or choice.")
    db.refresh(citizen)
    return _payload(citizen)
