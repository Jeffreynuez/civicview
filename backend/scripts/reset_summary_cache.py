#!/usr/bin/env python3
# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
"""
One-off cache reset: clear cached AI text so it re-generates under the
CURRENT prompt / logic on next view.

Covers all three AI caches:
  • Bill plain-English translations   (bill_summaries.plain_english)
  • EO plain-English translations     (eo_summaries.plain_english)
  • Vote explainers                   (vote_explainers.ai_*)  — the
    "what was this vote?" answer. Clear these after fixing the explainer
    so old "not specified" answers regenerate WITH the bill's CRS summary.

The free SOURCE text (CRS summary / EO abstract) is NEVER cleared — only
the AI layer on top of it. Each cleared row re-generates exactly ONCE the
next time someone opens it (one Haiku call), then re-caches. No recurring cost.

IMPORTANT ordering: deploy the code fix FIRST, THEN run this. If you clear
the cache before the fixed code is live, rows regenerate with the OLD logic
and re-cache the wrong answer.

Usage (set DATABASE_URL to the TARGET db — e.g. prod; unset = local dev):
    DATABASE_URL=<url> python scripts/reset_summary_cache.py             # dry run (counts only)
    DATABASE_URL=<url> python scripts/reset_summary_cache.py --apply     # clear all three caches
    DATABASE_URL=<url> python scripts/reset_summary_cache.py --apply --skip-votes   # translations only
"""
import os
import sys


def main() -> int:
    apply = "--apply" in sys.argv
    skip_votes = "--skip-votes" in sys.argv
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from app.db import SessionLocal
    from app.models.pages import BillSummary, EoSummary, VoteExplainer

    db = SessionLocal()
    try:
        total = 0

        # ── Bill + EO plain-English translations ──────────────────────
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

        # ── Vote explainers (the "what was this vote?" AI answer) ─────
        if not skip_votes:
            nv = db.query(VoteExplainer).filter(
                VoteExplainer.ai_what_was_voted.isnot(None)
            ).count()
            total += nv
            print(f"vote_explainers: {nv} cached AI explainer(s)")
            if apply and nv:
                db.query(VoteExplainer).filter(
                    VoteExplainer.ai_what_was_voted.isnot(None)
                ).update(
                    {
                        VoteExplainer.ai_what_was_voted: None,
                        VoteExplainer.ai_what_yea_means: None,
                        VoteExplainer.ai_what_nay_means: None,
                        VoteExplainer.ai_outcome_meaning: None,
                        VoteExplainer.ai_model: None,
                        VoteExplainer.ai_generated_at: None,
                    },
                    synchronize_session=False,
                )

        if apply:
            db.commit()
            print(f"Cleared {total} cached AI row(s). Each re-generates once on next view.")
        else:
            print(f"DRY RUN — {total} would be cleared. Re-run with --apply to do it.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
