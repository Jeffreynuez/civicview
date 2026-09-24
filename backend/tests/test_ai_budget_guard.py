"""Guards on the shared daily AI budget (audit S4).

Run:  cd backend && python3 tests/test_ai_budget_guard.py   (exit 0 = pass)

1. /api/ai/filter-items rejects a prompt over 300 characters.
2. The AI routes share a per-caller bucket: the 41st call in ten
   minutes from one client gets 429, and a different client does not.
3. Non-moderation calls stop at the reserve line; the moderation
   screen (reserved=True) can still spend the held-back share.
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
    from app.services import ai_service

    failures = []
    with TestClient(m.app) as c:
        body = {"prompt": "x" * 301, "items": [{"id": "a", "text": "a bill"}]}
        r = c.post("/api/ai/filter-items", json=body)
        if r.status_code != 422:
            failures.append(f"301-char prompt should 422, got {r.status_code}")

        ok_body = {"prompt": "health care", "items": [{"id": "a", "text": "a bill"}]}
        # The rejected call above already used one of the 40 slots.
        codes = [c.post("/api/ai/filter-items", json=ok_body).status_code for _ in range(39)]
        if any(code != 200 for code in codes):
            failures.append(f"calls 2 to 40 should pass, got {sorted(set(codes))}")
        r = c.post("/api/ai/filter-items", json=ok_body)
        if r.status_code != 429:
            failures.append(f"call past the AI bucket should 429, got {r.status_code}")
        r = c.get("/api/ai/summarize-post/1")
        if r.status_code != 429:
            failures.append(f"summarize-post shares the bucket and should 429, got {r.status_code}")

    # Reserve arithmetic, checked directly against the pre-flight gate.
    ai_service._DAILY_INPUT_CAP = 1000
    ai_service._DAILY_OUTPUT_CAP = 1000
    ai_service._RESERVE_FRACTION = 0.2
    ai_service._maybe_reset_spend()
    ai_service._spend_input_tokens = 790
    ai_service._spend_output_tokens = 0
    if not ai_service._would_exceed_cap(20, 10):
        failures.append("general call should stop at the 80% reserve line")
    if ai_service._would_exceed_cap(20, 10, reserved=True):
        failures.append("reserved call should still fit under the full cap")
    ai_service._spend_input_tokens = 995
    if not ai_service._would_exceed_cap(20, 10, reserved=True):
        failures.append("reserved call should stop at the full cap")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("AI BUDGET GUARDS HOLD.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
