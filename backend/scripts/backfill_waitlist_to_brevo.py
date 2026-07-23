# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
One-time backfill: push every existing citizen_waitlist row into the
Brevo list, so contacts captured before the backend->Brevo sync was
wired are present for the launch welcome campaign.

The going-forward sync happens automatically in
app/routers/waitlist.py (via app/services/brevo_service.py); this
script only catches up the history.

Usage (from backend/, with env vars set):
    BREVO_API_KEY=...  BREVO_WAITLIST_LIST_ID=...  DATABASE_URL=... \
        python scripts/backfill_waitlist_to_brevo.py
    # add --dry-run to preview counts without calling Brevo

De-dupes by email (a person can have multiple rows from different
CTAs); the first-seen row's state + clicked_from are used.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from app.db import SessionLocal  # noqa: E402
from app.models.pages import CitizenWaitlist  # noqa: E402
from app.services import brevo_service  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview unique-email count without calling Brevo.")
    parser.add_argument("--sleep", type=float, default=0.2,
                        help="Seconds to wait between Brevo calls (rate safety).")
    args = parser.parse_args()

    if not args.dry_run and not brevo_service.is_configured():
        print("ERROR: BREVO_API_KEY and/or BREVO_WAITLIST_LIST_ID not set. "
              "Set them (or use --dry-run) and retry.")
        return 1

    db = SessionLocal()
    try:
        rows = (
            db.query(CitizenWaitlist)
            .order_by(CitizenWaitlist.created_at.asc())
            .all()
        )
    finally:
        db.close()

    # Collapse to first-seen row per email.
    seen: dict[str, CitizenWaitlist] = {}
    for r in rows:
        key = (r.email or "").strip().lower()
        if key and key not in seen:
            seen[key] = r

    print(f"Total rows: {len(rows)}  |  unique emails: {len(seen)}")
    if args.dry_run:
        for email, r in list(seen.items())[:20]:
            print(f"  would sync: {email}  state={r.state}  source={r.clicked_from}")
        if len(seen) > 20:
            print(f"  ... and {len(seen) - 20} more")
        return 0

    ok = 0
    fail = 0
    for email, r in seen.items():
        if brevo_service.sync_waitlist_contact(email, r.state, r.clicked_from):
            ok += 1
        else:
            fail += 1
            print(f"  FAILED: {email}")
        time.sleep(args.sleep)

    print(f"Done. synced={ok}  failed={fail}  (list id "
          f"{brevo_service._list_id()})")
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
