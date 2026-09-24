# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Unit test for the threat/incitement moderation service (Task #41, Phase 0).

Offline — stubs ai_service.chat so no real Anthropic call is made. Guards:
  1.  A clean verdict ('none') → decision 'publish', verdict row written.
  2.  A credible_threat ≥0.75 → decision 'auto_hide' RECORDED, but in
      shadow mode the content's hide_reason stays None (nothing hidden).
  3.  self_harm → decision 'resources' (never punitive).
  4.  Fail-open: chat error → 'skipped'; unparseable text → 'skipped';
      empty content → 'skipped'. None of these raise.
  5.  Verdict rows carry the policy_version.

Run:  cd backend && python3 tests/test_moderation.py   (exit 0 = pass)
"""
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
    from app.services import ai_service, moderation_service
    from app.services import moderation_policy as policy
    from app.services.ai_service import AIResult
    from app.models.pages import ContentModerationVerdict, Post

    # Enter the app lifespan so startup auto-migrate creates the tables
    # (incl. content_moderation_verdicts) — same path the other tests use.
    _tc = TestClient(app.main.app)
    _tc.__enter__()

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    reserved_seen = []

    def stub_chat(*, result_text=None, error=None):
        def _chat(*, system, messages, max_tokens=512, model=None, temperature=0.3, reserved=False):
            reserved_seen.append(reserved)
            return AIResult(text=result_text, error=error, usage=None)
        return _chat

    db = SessionLocal()

    # A real content row so we can assert shadow mode leaves it untouched.
    post = Post(official_id="bd-fl-19", body="Test post body for moderation.")
    db.add(post)
    db.commit()
    db.refresh(post)
    pid = post.id

    def run(result_text=None, error=None, text="some content"):
        ai_service.chat = stub_chat(result_text=result_text, error=error)
        return moderation_service.assess(
            db, content_type="post", content_id=pid, text=text,
            author_kind="citizen", author_id=1,
        )

    # 1) clean
    v = run('{"category": "none", "severity": 0.0, "rationale": "ok", "offending_span": null}')
    check(v["category"] == "none" and v["decision"] == "publish", "clean -> publish")
    check(v["policy_version"] == policy.POLICY_VERSION, "verdict carries policy_version")

    # 2) credible threat -> auto_hide recorded, but shadow leaves content alone
    v = run('{"category": "credible_threat", "severity": 0.92, "rationale": "specific threat", "offending_span": "x"}')
    check(v["category"] == "credible_threat" and v["decision"] == "auto_hide", "threat -> auto_hide decision")
    db.refresh(post)
    check(post.hide_reason is None, "shadow mode: content NOT hidden")

    # 3) self_harm -> resources
    v = run('{"category": "self_harm", "severity": 0.8, "rationale": "self-harm", "offending_span": null}')
    check(v["decision"] == "resources", "self_harm -> resources")

    # 4) fail-open paths
    v = run(result_text=None, error="rate_limited")
    check(v["decision"] == "skipped", "ai error -> skipped")
    v = run(result_text="totally not json")
    check(v["decision"] == "skipped", "unparseable -> skipped")
    v = run(result_text='{"category":"none","severity":0}', text="   ")
    check(v["decision"] == "skipped", "empty content -> skipped")

    # 5) fenced JSON still parses
    v = run('```json\n{"category": "doxxing", "severity": 0.7, "rationale": "address", "offending_span": "123 Main St"}\n```')
    check(v["category"] == "doxxing" and v["decision"] == "auto_hide", "fenced json + doxxing -> auto_hide")

    # the screen draws on the reserved share of the AI budget (audit S4)
    check(reserved_seen and all(reserved_seen), "moderation calls chat with reserved=True")

    # rows actually persisted
    cnt = db.query(ContentModerationVerdict).filter(
        ContentModerationVerdict.content_id == pid).count()
    check(cnt >= 7, f"verdict rows persisted (got {cnt})")

    db.close()
    _tc.__exit__(None, None, None)

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ALL MODERATION PHASES PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
