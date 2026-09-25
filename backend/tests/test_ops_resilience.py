"""Uploads don't stall the API; daily state survives restarts (audit O6, O7).

Run:  cd backend && python3 tests/test_ops_resilience.py   (exit 0 = pass)

  1. O6: while an image upload waits on a slow storage write, another
     request (/healthz) still answers at once. The upload handler used
     to be async and called the blocking R2 write on the event loop.
  2. O7: the database engine pings pooled connections before use.
  3. O7: AI token spend is stored per day, adds up atomically, is
     queued off the request path and written by the background flush,
     and a fresh process folds in the stored total instead of starting
     from zero; a failed load is retried instead of taken as zero.
  4. O7: the retention jobs run as one unit, and one failing job does
     not stop the others; an account past its grace period is purged.
  5. O7: the weekly digest claims each citizen with a conditional
     UPDATE, so a second process cannot send the same digest, and a
     failed or empty send releases the claim.
"""
import os
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime, timedelta

_failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


def _utcnow():
    # Naive UTC, the same convention the models use.
    return datetime.now(UTC).replace(tzinfo=None)


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod-" + "x" * 32)
    os.environ["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.CRITICAL)

    from fastapi.testclient import TestClient
    import app.main
    from app.db import engine, SessionLocal
    from app.auth import issue_session_token, compute_csrf_token
    from app.models.pages import RepAccount, CitizenAccount, AiDailySpend
    from app.services import image_storage, ai_service, maintenance, digest_service

    with TestClient(app.main.app) as client:
        db = SessionLocal()

        # 1. Upload does not block other requests.
        rep = RepAccount(official_id="xx-upload-rep", email="up@x.test", password_hash="x",
                         display_name="Uploader")
        db.add(rep)
        db.commit()
        token = issue_session_token(rep.id, rep.session_epoch or 0)
        headers = {"Authorization": f"Bearer {token}", "X-CSRF-Token": compute_csrf_token(token)}

        class SlowStorage:
            def write(self, name, data, content_type):
                time.sleep(1.5)

        real_get_storage = image_storage.get_storage
        image_storage.get_storage = lambda: SlowStorage()
        upload_status = {}

        def do_upload():
            png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
            r = client.post("/api/pages/images/upload", headers=headers,
                            files={"file": ("a.png", png, "image/png")})
            upload_status["code"] = r.status_code

        try:
            t = threading.Thread(target=do_upload)
            t.start()
            time.sleep(0.3)  # the upload is now inside the slow write
            started = time.monotonic()
            r = client.get("/healthz")
            waited = time.monotonic() - started
            t.join(timeout=10)
        finally:
            image_storage.get_storage = real_get_storage
        check("upload succeeds", upload_status.get("code") == 200, str(upload_status))
        check("healthz answers during a slow upload", r.status_code == 200 and waited < 0.8,
              f"status {r.status_code}, waited {waited:.2f}s")

        # 2. Pre-ping.
        check("engine pings pooled connections", engine.pool._pre_ping is True)

        # 3. AI spend persistence.
        today = _utcnow().date()
        check("direct write succeeds", ai_service._persist_usage(today, 100, 20) is True)
        ai_service._persist_usage(today, 50, 5)
        db.expire_all()
        row = db.get(AiDailySpend, today)
        check("spend stored and added up", row is not None and (row.input_tokens, row.output_tokens) == (150, 25),
              str(row and (row.input_tokens, row.output_tokens)))
        # A new process: module state starts empty, then loads the total.
        ai_service._spend_date = None
        ai_service._spend_input_tokens = 0
        ai_service._spend_output_tokens = 0
        ai_service._pending.clear()
        ai_service._load_if_needed()  # the flusher thread's first round
        check("fresh process starts from the stored total",
              (ai_service._spend_input_tokens, ai_service._spend_output_tokens) == (150, 25),
              str((ai_service._spend_input_tokens, ai_service._spend_output_tokens)))
        # Calls are queued, not written on the request path; the flush
        # writes them and the in-memory total already includes them.
        with ai_service._spend_lock:
            ai_service._record_usage(30, 3)
        db.expire_all()
        check("a call is queued, not written inline", db.get(AiDailySpend, today).input_tokens == 150)
        ai_service._flush_pending()
        db.expire_all()
        row = db.get(AiDailySpend, today)
        check("the flush writes the queued tokens", (row.input_tokens, row.output_tokens) == (180, 28)
              and not ai_service._pending, str((row.input_tokens, row.output_tokens, ai_service._pending)))
        # A failed load keeps counting in memory and retries later,
        # instead of treating the day as loaded from zero.
        real_load = ai_service._load_persisted_spend
        ai_service._load_persisted_spend = lambda _day: None
        try:
            ai_service._spend_date = None
            with ai_service._spend_lock:
                ai_service._record_usage(7, 1)
            ai_service._load_if_needed()
            check("failed load is not taken as loaded", ai_service._loaded_for is None
                  and ai_service._spend_input_tokens == 7, str((ai_service._loaded_for, ai_service._spend_input_tokens)))
        finally:
            ai_service._load_persisted_spend = real_load
        ai_service._load_retry_at = 0.0
        ai_service._load_if_needed()
        check("retry folds in the stored total plus unwritten tokens",
              ai_service._loaded_for == today and ai_service._spend_input_tokens == 187,
              str((ai_service._loaded_for, ai_service._spend_input_tokens)))
        ai_service._flush_pending()
        ai_service._DAILY_INPUT_CAP = 1000
        ai_service._RESERVE_FRACTION = 0.0
        check("stored total counts toward the cap", ai_service._would_exceed_cap(900, 0)
              and not ai_service._would_exceed_cap(800, 0))

        # 4. Retention jobs.
        gone = CitizenAccount(email="gone@x.test", password_hash="x", display_name="Gone",
                              city="Miami", state="FL", self_deleted_at=_utcnow() - timedelta(days=40),
                              purge_after=_utcnow() - timedelta(days=1))
        db.add(gone)
        db.commit()
        gone_id = gone.id
        results = maintenance.run_retention_jobs()
        check("all four retention jobs ran", len(results) == 4 and set(results.values()) == {"ok"}, str(results))
        db.expire_all()
        check("account past its grace period purged", db.get(CitizenAccount, gone_id) is None)
        real_jobs = maintenance._jobs

        def _boom():
            raise RuntimeError("simulated")

        maintenance._jobs = lambda: [("first", _boom)] + real_jobs()[1:]
        try:
            results = maintenance.run_retention_jobs()
        finally:
            maintenance._jobs = real_jobs
        check("one failing job does not stop the rest",
              results.get("first") == "failed" and list(results.values()).count("ok") == 3, str(results))

        # 5. Digest claims.
        cz = CitizenAccount(email="reader@example.org", password_hash="x", display_name="Reader",
                            city="Miami", state="FL", digest_opt_in=True)
        db.add(cz)
        db.commit()
        cid = cz.id
        cutoff = _utcnow() - timedelta(days=6)
        db2 = SessionLocal()
        first = digest_service._claim_for_send(db, cid, cutoff)
        second = digest_service._claim_for_send(db2, cid, cutoff)
        check("first process claims the citizen", first is not None)
        check("second process cannot claim the same citizen", second is None)
        digest_service._release_claim(db, cid, first, None)
        db.expire_all()
        check("release puts the citizen back in the due list", db.get(CitizenAccount, cid).digest_last_sent_at is None)
        db2.close()

        sends = []

        class FakeEmail:
            ok = True

            def send(self, **kw):
                sends.append(kw["to"])
                return FakeEmail.ok

        import app.services.email_service as email_service
        real_email = email_service.get_email_service
        real_build, real_render = digest_service.build_digest, digest_service.render_digest
        email_service.get_email_service = lambda: FakeEmail()
        digest_service.build_digest = lambda _db, _c: {"x": 1}
        digest_service.render_digest = lambda _d: ("s", "<p>h</p>", "t")
        try:
            FakeEmail.ok = False
            s1 = digest_service.send_weekly_digests(db)
            db.expire_all()
            check("failed send releases the claim",
                  s1["failed"] == 1 and db.get(CitizenAccount, cid).digest_last_sent_at is None, str(s1))
            FakeEmail.ok = True
            s2 = digest_service.send_weekly_digests(db)
            s3 = digest_service.send_weekly_digests(db)
            db.expire_all()
            check("successful send stamps and is not repeated",
                  s2["sent"] == 1 and s3["eligible"] == 0 and sends.count("reader@example.org") == 2
                  and db.get(CitizenAccount, cid).digest_last_sent_at is not None, f"{s2} {s3} {sends}")
        finally:
            email_service.get_email_service = real_email
            digest_service.build_digest, digest_service.render_digest = real_build, real_render
        db.close()

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
