"""Production refuses to start in a broken state; /healthz tells the truth.

Run:  cd backend && python3 tests/test_startup_safety.py   (exit 0 = pass)

Guards the 2026-09-25 safety-net changes (audit O2 and O3):
  1. check_production_config does nothing outside production.
  2. In production it refuses a missing or SQLite DATABASE_URL.
  3. In production it logs each missing recommended setting as an ERROR.
  4. A failed ADD COLUMN is recorded; init_db() raises
     SchemaMigrationError in production and only logs in development.
  5. A missing NOT NULL column with no default is a failure too.
  6. The app lifespan re-raises a database setup failure in production
     and starts anyway in development.
  7. /healthz returns 200 when the database answers and 503 when not.
  8. wait_for_database retries a connection error, then gives up.
"""
import logging
import os
import sys
import tempfile

_failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


class _ListHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


def _set_env(**kw):
    for k, v in kw.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod-" + "x" * 32)
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    _set_env(RENDER=None, CIVICVIEW_ENV="development")
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    logging.disable(logging.NOTSET)

    from app.services import runtime_env

    # 1. Outside production: no-op.
    check("dev: config check is a no-op", runtime_env.check_production_config() == [])

    # 2. Production refuses a SQLite / missing DATABASE_URL.
    _set_env(CIVICVIEW_ENV="production")
    raised = False
    try:
        runtime_env.check_production_config()
    except runtime_env.ProductionConfigError:
        raised = True
    check("prod: sqlite DATABASE_URL refused", raised)

    saved_url = os.environ["DATABASE_URL"]
    _set_env(DATABASE_URL=None)
    raised = False
    try:
        runtime_env.check_production_config()
    except runtime_env.ProductionConfigError:
        raised = True
    check("prod: missing DATABASE_URL refused", raised)

    # 3. Production with Postgres URL: missing settings logged as ERROR.
    _set_env(DATABASE_URL="postgresql://u:p@db.example.invalid/civicview",
             ANTHROPIC_API_KEY=None, R2_ACCOUNT_ID=None)
    log = logging.getLogger("test.config")
    handler = _ListHandler()
    log.addHandler(handler)
    log.setLevel(logging.DEBUG)
    _set_env(FIREBASE_SERVICE_ACCOUNT_JSON=None, COOKIE_SECURE="false")
    missing = runtime_env.check_production_config(log=log)
    by_msg = {r.getMessage(): r.levelno for r in handler.records}
    check("prod: missing settings returned", "ANTHROPIC_API_KEY" in missing and "R2_ACCOUNT_ID" in missing, str(missing))
    check("prod: core setting logged at ERROR",
          any("ANTHROPIC_API_KEY" in m and lv == logging.ERROR for m, lv in by_msg.items()), str(by_msg))
    check("prod: optional setting logged at WARNING",
          any("FIREBASE_SERVICE_ACCOUNT_JSON" in m and lv == logging.WARNING for m, lv in by_msg.items()), str(by_msg))
    check("prod: message says what it costs",
          any("ANTHROPIC_API_KEY" in m and "AI summaries" in m for m in by_msg), str(list(by_msg)[:3]))
    check("prod: COOKIE_SECURE=false is reported", "COOKIE_SECURE" in missing, str(missing))
    check("prod: set settings are not reported", "ALLOWED_ORIGINS" not in missing, str(missing))
    _set_env(COOKIE_SECURE=None)

    _set_env(DATABASE_URL=saved_url, CIVICVIEW_ENV="development")

    # 4 and 5. Auto-migrate failures.
    from sqlalchemy import text
    import app.db as db
    db.init_db()
    with db.engine.begin() as conn:
        conn.execute(text('ALTER TABLE "citizen_accounts" DROP COLUMN "session_epoch"'))

    real_render = db._render_server_default
    db._render_server_default = lambda col: "(((" if col.name == "session_epoch" else real_render(col)
    try:
        # Development: logs, does not raise.
        raised = False
        try:
            db.init_db()
        except db.SchemaMigrationError:
            raised = True
        check("dev: failed ADD COLUMN does not stop init_db", not raised)
        check("dev: failure recorded",
              any("citizen_accounts.session_epoch" in f for f in db._MIGRATION_FAILURES),
              str(db._MIGRATION_FAILURES))

        # Production: raises.
        _set_env(CIVICVIEW_ENV="production")
        raised = None
        try:
            db.init_db()
        except db.SchemaMigrationError as e:
            raised = str(e)
        check("prod: failed ADD COLUMN raises SchemaMigrationError", raised is not None)
        check("prod: error names the column", raised and "citizen_accounts.session_epoch" in raised, str(raised))

        # Emergency override: logs, starts anyway.
        _set_env(CIVICVIEW_ALLOW_SCHEMA_DRIFT="true")
        raised = False
        try:
            db.init_db()
        except db.SchemaMigrationError:
            raised = True
        check("prod + override: does not raise", not raised)
        _set_env(CIVICVIEW_ALLOW_SCHEMA_DRIFT=None, CIVICVIEW_ENV="development")
    finally:
        db._render_server_default = real_render

    # The real renderer repairs it on the next run, and failures clear.
    db.init_db()
    check("repaired run records no failures", db._MIGRATION_FAILURES == [], str(db._MIGRATION_FAILURES))

    # 5. NOT NULL without any default is a recorded failure.
    from sqlalchemy import Column, Integer
    from app.models.pages import CitizenAccount
    table = CitizenAccount.__table__
    extra = Column("zz_required_no_default", Integer, nullable=False)
    table.append_column(extra)
    try:
        db.init_db()
        check("NOT NULL without default is a failure",
              any("zz_required_no_default" in f for f in db._MIGRATION_FAILURES),
              str(db._MIGRATION_FAILURES))
    finally:
        table._columns.remove(extra)
    db.init_db()
    check("failures clear once the model is fixed", db._MIGRATION_FAILURES == [], str(db._MIGRATION_FAILURES))

    # 6. Lifespan: production re-raises a database setup failure.
    logging.disable(logging.CRITICAL)
    import app.main as main_mod
    from fastapi.testclient import TestClient

    def _boom():
        raise db.SchemaMigrationError("simulated")

    real_init = main_mod.init_db
    main_mod.init_db = _boom
    try:
        _set_env(CIVICVIEW_ENV="production",
                 DATABASE_URL="postgresql://u:p@db.example.invalid/civicview")
        # check_production_config passes with a Postgres URL; the
        # database itself is never reached because wait_for_database
        # is stubbed too.
        real_wait = main_mod.wait_for_database
        main_mod.wait_for_database = lambda: None
        raised = False
        try:
            with TestClient(main_mod.app):
                pass
        except Exception:
            raised = True
        check("prod: lifespan refuses to start after DB setup failure", raised)

        _set_env(CIVICVIEW_ENV="development", DATABASE_URL=saved_url)
        started = False
        try:
            with TestClient(main_mod.app) as client:
                started = client.get("/").status_code == 200
        except Exception as e:
            print("   dev start error:", repr(e))
        check("dev: lifespan still starts after DB setup failure", started)
        main_mod.wait_for_database = real_wait
    finally:
        main_mod.init_db = real_init
        _set_env(CIVICVIEW_ENV="development", DATABASE_URL=saved_url)

    # 7. /healthz.
    with TestClient(main_mod.app) as client:
        r = client.get("/healthz")
        check("healthz 200 when the database answers",
              r.status_code == 200 and r.json().get("database") == "ok", f"{r.status_code} {r.text}")
        check("healthz is not cacheable", r.headers.get("cache-control") == "no-store", str(r.headers.get("cache-control")))

        class _DeadEngine:
            def connect(self):
                raise RuntimeError("database is down")

        real_engine = main_mod._health_engine
        main_mod._health_engine = _DeadEngine()
        try:
            r = client.get("/healthz")
            check("healthz 503 when the database does not answer",
                  r.status_code == 503 and r.json().get("database") == "unreachable", f"{r.status_code} {r.text}")
        finally:
            main_mod._health_engine = real_engine

    # 8. wait_for_database retries, then gives up.
    from sqlalchemy.exc import OperationalError

    class _Conn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, *a, **k):
            return None

    class _FlakyEngine:
        def __init__(self, fail_times):
            self.calls = 0
            self.fail_times = fail_times

        def connect(self):
            self.calls += 1
            if self.calls <= self.fail_times:
                raise OperationalError("SELECT 1", {}, Exception("connection refused"))
            return _Conn()

    real_engine = db.engine
    try:
        flaky = _FlakyEngine(fail_times=2)
        db.engine = flaky
        db.wait_for_database(attempts=5, delay_seconds=0)
        check("wait_for_database retries until the database answers", flaky.calls == 3, str(flaky.calls))

        dead = _FlakyEngine(fail_times=99)
        db.engine = dead
        raised = False
        try:
            db.wait_for_database(attempts=3, delay_seconds=0)
        except OperationalError:
            raised = True
        check("wait_for_database gives up after the last attempt", raised and dead.calls == 3, str(dead.calls))
    finally:
        db.engine = real_engine

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
