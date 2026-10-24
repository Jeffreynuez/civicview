# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Ballot measure plain-English explanations (2026-10-24).

Run:  cd backend && python3 tests/test_ballot_measure_plain_english.py   (exit 0 = pass)

What it checks:
  Lookup            an unknown measure id answers 404 on both routes; a
                    statewide and a county measure are found by id.
  Reviewed          the explanations shipped in
                    app/data/ballot_measure_explanations.json match the
                    data's current wording, keep their figures to it and
                    end with the two vote lines; they are served without a
                    model call, and not once the wording changes.
  No AI by reading  GET never calls the model and answers plain_english
                    null until an explanation is saved.
  Not configured    without an Anthropic key, generate answers 503 and
                    saves nothing.
  Official text     the model gets only the measure's official text from
                    the elections data (title, summary, threshold, origin)
                    and the neutral system prompt.
  Saved once        a second generate returns the saved text without a
                    second model call; GET returns it too.
  Text changes      when the data's official wording changes, the old
                    explanation stops showing and the next generate
                    writes a new one into the same row.
  Numbers           an explanation with a figure the official text doesn't
                    have is not saved: one retry, then a 502.
  Rate limit        generate is in the AI rate limit; GET is not.
"""
import os
import sys
import tempfile


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ.pop("ANTHROPIC_API_KEY", None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.WARNING)

    import app.main as m
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.middleware import rate_limit
    from app.models.pages import BallotMeasureExplanation
    from app.routers.elections import service as elections
    from app.services import ai_service, ballot_measure_service

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    MID = "fl-2026-amend-1"
    measure = elections.get_measure(MID)
    check(measure is not None and measure["state"] == "FL", f"statewide measure by id: {measure}")
    official = measure["summary"]

    # A county measure is found the same way (added to the loaded data only).
    fl = elections._elections_by_state["FL"]
    bm = fl.setdefault("ballot_measures", {"state": [], "counties": {}})
    bm.setdefault("counties", {})["Test"] = [{"id": "fl-test-county-q1", "title": "Library hours",
                                             "level": "county", "county": "Test",
                                             "summary": "Shall the county library open on Sundays?"}]
    county = elections.get_measure("fl-test-county-q1")
    check(county is not None and county["county"] == "Test", f"county measure by id: {county}")
    check(elections.get_measure("no-such-measure") is None, "unknown id is None")

    calls = []

    def fake_chat(system, messages, max_tokens=512, model=ai_service.DEFAULT_MODEL, temperature=0.3, reserved=False):
        calls.append({"system": system, "user": messages[0]["content"], "model": model})
        return ai_service.AIResult(error=None, text=(
            "This amendment would let Florida keep more money in its budget stabilization fund.\n\n"
            "- The limit rises from 10% to 25% of general revenue collections.\n"
            "- It needs 60% of the vote to pass.\n\n"
            "**A Yes vote means:** the limit rises to 25%.\n"
            "**A No vote means:** the limit stays at 10%."
        ))

    import json
    with open(os.path.join(os.path.dirname(__file__), "..", "app", "data", "ballot_measure_explanations.json")) as fh:
        reviewed = {e["measure_id"]: e for e in json.load(fh)["explanations"]}
    check(MID in reviewed, "the Florida amendments ship with reviewed explanations")
    for rid, e in reviewed.items():
        rm = elections.get_measure(rid)
        src = ballot_measure_service.source_text(rm) if rm else ""
        check(rm is not None and e["source_hash"] == ballot_measure_service.source_hash(src),
              f"{rid}: the reviewed explanation was written from the data's current wording, prompt and model "
              "(if the wording changed, write and review it again)")
        check(not ballot_measure_service.unsupported_numbers(e["plain_english"], src), f"{rid}: figures all in the official text")
        check("**A Yes vote means:**" in e["plain_english"] and "**A No vote means:**" in e["plain_english"],
              f"{rid}: ends with the two vote lines")

    with TestClient(m.app) as c:
        # ── Lookup ───────────────────────────────────────────────────
        check(c.get("/api/ballot-measures/no-such-measure/plain-english").status_code == 404, "GET unknown id should 404")
        check(c.post("/api/ballot-measures/no-such-measure/plain-english/generate").status_code == 404,
              "generate unknown id should 404")

        # ── Reviewed ─────────────────────────────────────────────────
        real_chat = ai_service.chat
        ai_service.chat = fake_chat
        try:
            r = c.get(f"/api/ballot-measures/{MID}/plain-english")
            check(r.json().get("plain_english") == reviewed[MID]["plain_english"], f"GET serves the reviewed text: {r.text[:200]}")
            r = c.post(f"/api/ballot-measures/{MID}/plain-english/generate")
            check(r.status_code == 200 and r.json().get("plain_english") == reviewed[MID]["plain_english"] and not calls,
                  f"generate serves the reviewed text without a model call: {r.status_code} calls={len(calls)}")
        finally:
            ai_service.chat = real_chat

        # From here the wording differs from what was reviewed.
        def set_summary(text):
            for item in fl["ballot_measures"]["state"]:
                if item.get("id") == MID:
                    item["summary"] = text
        set_summary(official + " (test wording)")

        # ── No AI by reading ─────────────────────────────────────────
        r = c.get(f"/api/ballot-measures/{MID}/plain-english")
        check(r.status_code == 200 and r.json().get("plain_english") is None, f"GET before any: {r.status_code} {r.text[:200]}")

        # ── Not configured ───────────────────────────────────────────
        r = c.post(f"/api/ballot-measures/{MID}/plain-english/generate")
        check(r.status_code == 503, f"generate with no key should 503: {r.status_code} {r.text[:200]}")
        with SessionLocal() as db:
            check(db.query(BallotMeasureExplanation).count() == 0, "nothing saved without a key")

        # ── Numbers ──────────────────────────────────────────────────
        def wrong_number(system, messages, **kw):
            calls.append({"system": system, "user": messages[0]["content"]})
            return ai_service.AIResult(error=None, text=(
                "This amendment would move $900 million into the fund.\n\n- It needs 60% of the votes cast on it to pass.\n\n"
                "**A Yes vote means:** it passes.\n**A No vote means:** it does not."))
        ai_service.chat = wrong_number
        try:
            r = c.post(f"/api/ballot-measures/{MID}/plain-english/generate")
            check(r.status_code == 502 and len(calls) == 2, f"a made-up figure: one retry, then 502: {r.status_code} calls={len(calls)}")
            with SessionLocal() as db:
                check(db.query(BallotMeasureExplanation).count() == 0, "an explanation with a made-up figure is not saved")
            check(ballot_measure_service.unsupported_numbers("Up to $150,000 in 2027 and 25%.", "to $150,000 in 2027, 10% to 25%") == set(),
                  "figures written the same way as the official text pass")
            check(ballot_measure_service.unsupported_numbers("about 30%", "from 10% to 25%") == {"30%", "30"},
                  "a figure that isn't in the official text is caught")
        finally:
            ai_service.chat = real_chat
        calls.clear()

        # ── Official text in, explanation saved ──────────────────────
        ai_service.chat = fake_chat
        try:
            r = c.post(f"/api/ballot-measures/{MID}/plain-english/generate")
            check(r.status_code == 200, f"generate: {r.status_code} {r.text[:200]}")
            j = r.json()
            check(j.get("plain_english", "").startswith("This amendment would let Florida"), f"generate text: {j}")
            check(j.get("model") == ballot_measure_service.MODEL and j.get("generated_at"), f"generate meta: {j}")
            check(len(calls) == 1, f"one model call: {len(calls)}")
            check(calls and calls[0]["model"] == ballot_measure_service.MODEL, "written with the ballot measure model")
            if calls:
                user, system = calls[0]["user"], calls[0]["system"]
                check(official in user, "the model gets the official ballot summary word for word")
                for piece in ("Budget Stabilization Fund", "60%", "Placed on the ballot by the Legislature",
                              "Florida", "Constitutional Amendment"):
                    check(piece in user, f"the model gets {piece!r}")
                check("NEUTRALITY" in system and "how to vote" in system and "A Yes vote means" in system,
                      "neutral system prompt with the vote lines")
                check("use only the official text" in system and "Never narrow or widen" in system,
                      "the prompt keeps the model to the official text and its limits")

            # ── Saved once ───────────────────────────────────────────
            r = c.post(f"/api/ballot-measures/{MID}/plain-english/generate")
            check(r.status_code == 200 and len(calls) == 1, f"second generate uses the saved text: calls={len(calls)}")
            r = c.get(f"/api/ballot-measures/{MID}/plain-english")
            check(r.json().get("plain_english", "").startswith("This amendment"), f"GET returns the saved text: {r.text[:200]}")

            # ── Text changes ─────────────────────────────────────────
            set_summary(official + " (corrected)")
            r = c.get(f"/api/ballot-measures/{MID}/plain-english")
            check(r.json().get("plain_english") is None, "a changed official text hides the old explanation")
            r = c.post(f"/api/ballot-measures/{MID}/plain-english/generate")
            check(r.status_code == 200 and len(calls) == 2, f"a changed text writes a new one: calls={len(calls)}")
            check("(corrected)" in calls[-1]["user"], "the new one is written from the new text")
            with SessionLocal() as db:
                rows = db.query(BallotMeasureExplanation).filter(BallotMeasureExplanation.measure_id == MID).all()
                check(len(rows) == 1 and rows[0].source_hash == ballot_measure_service.source_hash(
                    ballot_measure_service.source_text(elections.get_measure(MID))),
                    "one row per measure, hashed from the current text")
            # Back to the reviewed wording: the reviewed text shows again.
            set_summary(official)
            r = c.get(f"/api/ballot-measures/{MID}/plain-english")
            check(r.json().get("plain_english") == reviewed[MID]["plain_english"], "the original wording brings the reviewed text back")
        finally:
            ai_service.chat = real_chat

    # ── Rate limit ───────────────────────────────────────────────────
    check(bool(rate_limit._AI_RE.match(f"/api/ballot-measures/{MID}/plain-english/generate")), "generate is AI rate limited")
    check(not rate_limit._AI_RE.match(f"/api/ballot-measures/{MID}/plain-english"), "GET is not AI rate limited")

    os.unlink(db_file.name)
    if failures:
        print("FAILED:")
        for f in failures:
            print("  -", f)
        return 1
    print("ALL CHECKS PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
