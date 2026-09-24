"""AI summaries are built from official source text, not the caller's.

Run:  cd backend && python3 tests/test_ai_source_integrity.py   (exit 0 = pass)

Offline: the Anthropic client, the Federal Register fetch and the
Congress.gov bill snapshot are all stubbed.
  1. EO: the prompt uses the Federal Register title/abstract even when the
     request body carries different text; a pre-fix cached row (no
     source_verified_at) is withheld.
  2. Votes: a cached explanation is only returned for the same vote data
     it was generated from.
  3. Bills: the stored title comes from Congress.gov, and a translation
     built from a different stored title is invalidated.
"""
import asyncio
import os
import sys
import tempfile


def _bootstrap_env():
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")


def main() -> int:
    _bootstrap_env()
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.INFO)

    import app.main
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.models.pages import BillSummary, EoSummary
    from app.services import ai_service, bill_summary_service, eo_summary_service, vote_explainer_service
    from app.services.ai_service import AIResult

    tc = TestClient(app.main.app)
    tc.__enter__()
    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    seen = {}

    def fake_chat(*, system, messages, max_tokens=512, model=None, temperature=0.3):
        seen["prompt"] = messages[-1]["content"]
        if "what_was_voted" in system or "JSON" in system:
            return AIResult(text='{"what_was_voted":"a","what_yea_means":"b","what_nay_means":"c","outcome_meaning":"d"}', error=None, usage=None)
        return AIResult(text="Plain English text.", error=None, usage=None)

    ai_service.chat = fake_chat
    db = SessionLocal()

    # 1) EO
    async def fake_fr(doc):
        return {"title": "REAL ORDER TITLE", "abstract": "Real abstract from the Federal Register.", "eo_number": "14999"}
    eo_summary_service.fetch_source_text = fake_fr
    text, err = asyncio.run(eo_summary_service.generate_plain_english(
        db, document_number="2026-01234", title="FAKE TITLE", abstract="An invented abstract."))
    check(err is None, f"EO generate ok (err={err})")
    check("REAL ORDER TITLE" in seen.get("prompt", "") and "invented" not in seen.get("prompt", ""),
          "EO prompt uses Federal Register text, not the request body")
    row = eo_summary_service.get_cached_row(db, "2026-01234")
    check(row is not None and row.source_verified_at is not None, "EO row marked source-verified")
    legacy = EoSummary(document_number="2026-99999", title="x", plain_english="old text")
    db.add(legacy)
    db.commit()
    r = tc.post("/api/eos/2026-99999/summary", json={})
    check(r.status_code == 200 and r.json()["has_plain_english"] is False and r.json()["plain_english"] is None,
          f"pre-fix EO row withheld ({r.status_code} {r.text[:120]})")

    # 2) Votes
    vote_a = {"vote_id": "999001", "question": "On Passage of H.R. 1", "result": "Passed", "chamber": "house",
              "date": "2026-05-01", "category": "passage", "bill": {"display_number": "H.R. 1", "title": "Real"}}
    vote_b = dict(vote_a, question="On Passage of a bill that bans puppies")
    body, err = asyncio.run(vote_explainer_service.generate_ai_explainer(db, vote_b))
    check(err is None and body, f"vote generate ok (err={err})")
    check(vote_explainer_service.cached_ai_for(db, vote_b) is not None, "same payload sees its explanation")
    check(vote_explainer_service.cached_ai_for(db, vote_a) is None, "real vote data never sees the doctored explanation")
    r = tc.post("/api/votes/explain", json=vote_a)
    check(r.status_code == 200 and r.json()["has_ai"] is False, "explain endpoint withholds a mismatched explanation")

    # 3) Bills
    class FakeCongress:
        async def get_bill_summary(self, c, t, n):
            return None

        async def get_bill_snapshot(self, c, t, n):
            return {"title": "An Act for real things", "latest_action": "Referred to committee."}
    bill_summary_service._congress = FakeCongress()
    stale = BillSummary(congress=119, bill_type="HR", number="42", title="A doctored title", plain_english="bad")
    db.add(stale)
    db.commit()
    row = asyncio.run(bill_summary_service.get_or_fetch_summary(
        db, 119, "hr", "42", bill_title="Another doctored title", force_refresh=True))
    check(row.title == "An Act for real things", f"bill title from Congress.gov (got {row.title!r})")
    check(row.plain_english is None, "translation built from a different title is invalidated")

    db.close()
    tc.__exit__(None, None, None)
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ALL AI SOURCE INTEGRITY CHECKS PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
