#!/usr/bin/env python3
# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
"""
One-off cache reset: clear cached AI plain-English translations so they
re-generate under the CURRENT (neutral) prompt on next view.

Clears ONLY the AI-translation columns (plain_english + its model /
generated_at metadata) — NOT the free CRS / abstract source text, which
stays cached. Scoped to rows that actually HAVE a translation, so nothing
that was never translated is touched.

Cost: each cleared row re-translates exactly ONCE the next time someone
opens it (one Haiku call), then re-caches. There is no recurring cost.

Usage (point DATABASE_URL at the target DB — e.g. prod):
    DATABASE_URL=<url> python scripts/reset_summary_cache.py           # dry run (counts only)
    DATABASE_URL=<url> python scripts/reset_summary_cache.py --apply   # actually clear
"""
import os
import sys


def main() -> int:
    apply = "--apply" in sys.argv
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from app.db import SessionLocal
    from app.models.pages import BillSummary, EoSummary

    db = SessionLocal()
    try:
        total = 0
        for label, Model in (("bill_summaries", BillSummary), ("eo_summaries", EoSummary)):
            n = db.query(Model).filter(Model.plain_english.isnot(None)).count()
            total += n
            print(f"{label}: {n} cached translation(s)")
            if apply and n:
                db.query(Model).filter(Model.plain_english.isnot(None)).update(
                    {
                        Model.plain_english: None,
                        Model.plain_english_model: None,
                        Model.plain_english_generated_at: None,
                    },
                    synchronize_session=False,
                )
        if apply:
            db.commit()
            print(f"Cleared {total} cached translation(s). Each re-translates once on next view.")
        else:
            print(f"DRY RUN — {total} would be cleared. Re-run with --apply to do it.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
