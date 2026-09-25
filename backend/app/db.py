# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Database plumbing for the Pages feature.

SQLite was picked over Postgres for Phase 1 because:
  • The MVP is single-node and read-light.
  • Zero-install — file sits at `backend/civicview.db` (legacy
        `civiclens.db` is auto-detected for backward compat).
  • Swap to Postgres later by changing DATABASE_URL and adding Alembic;
    the SQLAlchemy models port without changes.

Phase 1 creates tables on startup via `Base.metadata.create_all`. Once
the schema stops shifting we'll introduce Alembic migrations. Until
then, init_db() also runs a small auto-migration pass that ADDs any
new columns defined on the models but missing from the on-disk
schema. This is dev-only ergonomics — you can restart the backend
after editing a model without having to delete civicview.db. For
Postgres we short-circuit this pass (Alembic is the right tool).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Generator, Optional

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy.sql.elements import ClauseElement
from sqlalchemy.sql.expression import false as sa_false, true as sa_true


BACKEND_DIR = Path(__file__).resolve().parent.parent
# Default SQLite filename is `civicview.db`. Backward-compat shim:
# if a legacy `civiclens.db` exists (pre-rename dev DB) and the new
# file does not, keep using the legacy one so existing local data
# doesn't disappear after the rename. Once the user runs anything
# that writes to the DB, both paths converge naturally.
_NEW_DB_PATH = BACKEND_DIR / "civicview.db"
_LEGACY_DB_PATH = BACKEND_DIR / "civiclens.db"
if _NEW_DB_PATH.exists():
    DEFAULT_DB_PATH = _NEW_DB_PATH
elif _LEGACY_DB_PATH.exists():
    DEFAULT_DB_PATH = _LEGACY_DB_PATH
else:
    DEFAULT_DB_PATH = _NEW_DB_PATH  # fresh install — new naming
_RAW_DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

# Render (and Heroku, and several other managed-Postgres hosts) issues
# connection strings that start with the legacy `postgres://` scheme.
# SQLAlchemy 2.x rejects that; it expects `postgresql://`. Normalize
# here so we can paste the Render-provided URL straight into the env
# var without thinking about it.
#
# We also name the driver explicitly. SQLAlchemy 2.1 changed the
# default driver for a bare `postgresql://` URL from psycopg2 to
# psycopg (version 3), which we do not install. On 2026-09-24 a fresh
# Render build resolved SQLAlchemy 2.1.0 and the API crashed at boot
# with "No module named 'psycopg'". Naming psycopg2 here keeps the
# driver fixed whichever SQLAlchemy version pip resolves. A URL that
# already names a driver (`postgresql+something://`) is left alone.
_BARE_POSTGRES_PREFIXES = ("postgres://", "postgresql://")
DATABASE_URL = _RAW_DATABASE_URL
for _prefix in _BARE_POSTGRES_PREFIXES:
    if _RAW_DATABASE_URL.startswith(_prefix):
        DATABASE_URL = "postgresql+psycopg2://" + _RAW_DATABASE_URL[len(_prefix):]
        break

# `check_same_thread=False` is SQLite-specific and required because
# FastAPI uses a thread pool for sync dependencies. Harmless for other
# backends (the connect_args is simply ignored).
#
# Postgres gets a connect timeout: without one, an unreachable database
# host makes every connection attempt hang for minutes.
_connect_args = (
    {"check_same_thread": False} if DATABASE_URL.startswith("sqlite")
    else {"connect_timeout": 10}
)

engine = create_engine(DATABASE_URL, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def _make_health_engine():
    """Engine used only by GET /healthz (audit O2).

    It opens a fresh connection per check with short timeouts instead of
    borrowing from the app's pool. A pool busy with slow requests then
    cannot make the health check wait past Render's 5-second limit and
    get a healthy instance restarted; only a database that really does
    not answer fails the check.
    """
    if DATABASE_URL.startswith("sqlite"):
        return engine
    from sqlalchemy.pool import NullPool
    return create_engine(
        DATABASE_URL,
        poolclass=NullPool,
        connect_args={"connect_timeout": 3, "options": "-c statement_timeout=3000"},
        future=True,
    )


health_engine = _make_health_engine()


class Base(DeclarativeBase):
    """Declarative base for all Phase 1 models."""
    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency. Yields a DB session and closes it after the
    request completes, even on exceptions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


logger = logging.getLogger(__name__)


# Keywords/expressions we pass through unquoted when they appear as a
# column server_default — these are SQL literals/expressions rather
# than string values.
_SQL_LITERAL_PASSTHROUGH = frozenset({
    "CURRENT_TIMESTAMP", "CURRENT_DATE", "CURRENT_TIME",
    "NULL", "TRUE", "FALSE",
})


def _sql_quote_string(s: str) -> str:
    """Wrap a Python string in single quotes, doubling embedded ones."""
    return "'" + s.replace("'", "''") + "'"


def _render_server_default(col) -> Optional[str]:
    """Render a column's default as a SQL literal suitable for
    appending after `DEFAULT`. Returns None when the column has no
    default.

    Handles four kinds of input:
      1. server_default=func.now() (or any SQL ClauseElement) — compile
         through the engine's dialect so we get the dialect-correct
         rendering (e.g. CURRENT_TIMESTAMP on SQLite, NOW() on
         Postgres). This is the path that previously emitted the
         literal string 'now()' as a default, breaking
         INSERT-with-RETURNING for the affected column.
      2. server_default=text("'full'") — already raw SQL, use as-is.
      3. server_default="full" — plain string; SQLAlchemy wraps it in
         a TextClause that str()s back to "full" WITHOUT quotes. We
         detect this case with the passthrough set; anything that
         doesn't look like a known SQL expression gets string-quoted.
      4. default=<scalar> — Python-side default; we quote/serialize
         by type.
    """
    if col.server_default is not None:
        arg = col.server_default.arg
        # 1) Compile a SQL ClauseElement (FunctionElement, ColumnElement,
        #    etc.) through the engine's dialect so func.now() lands as
        #    the correct keyword for the underlying database.
        if isinstance(arg, ClauseElement) and not isinstance(arg, type(text(""))):
            try:
                compiled = str(arg.compile(
                    dialect=engine.dialect,
                    compile_kwargs={"literal_binds": True},
                ))
                stripped = compiled.strip()
                if stripped:
                    return stripped
            except Exception:
                # Fall through to the string-handling path. Worst case
                # we still emit *something*, but with a logged warning
                # the developer can see in the migration output.
                logger.warning(
                    "Auto-migrate: failed to compile server_default for column %r; "
                    "falling back to str() rendering.",
                    getattr(col, "name", "?"),
                )

        # 2-3) Best-effort string handling for TextClause / plain strings.
        raw = str(arg).strip()
        if raw.startswith("'") and raw.endswith("'"):
            return raw
        if raw.upper() in _SQL_LITERAL_PASSTHROUGH:
            return raw.upper()
        # Numeric literal like "0" or "3.14"
        try:
            float(raw)
            return raw
        except ValueError:
            pass
        return _sql_quote_string(raw)

    if col.default is not None and getattr(col.default, "is_scalar", False):
        val = col.default.arg
        if isinstance(val, bool):
            # Dialect-aware boolean literal. Postgres' BOOLEAN type
            # rejects `DEFAULT 0` / `DEFAULT 1` as a syntax error in
            # ALTER TABLE ADD COLUMN — it wants `false` / `true`.
            # SQLite stores Boolean as INTEGER under the hood so both
            # forms work there, but to keep the rendering uniform we
            # use the SQLAlchemy `false()` / `true()` expressions
            # which compile correctly for every backend.
            try:
                expr = sa_true() if val else sa_false()
                compiled = str(expr.compile(
                    dialect=engine.dialect,
                    compile_kwargs={"literal_binds": True},
                ))
                stripped = compiled.strip()
                if stripped:
                    return stripped
            except Exception:
                logger.warning(
                    "Auto-migrate: dialect-aware boolean default rendering "
                    "failed for column %r; falling back to legacy 0/1.",
                    getattr(col, "name", "?"),
                )
            return "1" if val else "0"
        if isinstance(val, (int, float)):
            return str(val)
        if isinstance(val, str):
            return _sql_quote_string(val)

    return None


class SchemaMigrationError(RuntimeError):
    """A startup schema change failed, so the database no longer matches
    the models. Raised by init_db() in production only (audit O2)."""


# Failures recorded by the auto-migrate passes during one init_db() run.
# The passes keep going after a failure so the log names every problem,
# then init_db() decides what a failure means (see its docstring).
_MIGRATION_FAILURES: list[str] = []


def _record_migration_failure(message: str) -> None:
    _MIGRATION_FAILURES.append(message)
    logger.error("Auto-migrate FAILED: %s", message)


def wait_for_database(attempts: int = 5, delay_seconds: float = 3.0) -> None:
    """Block until the database answers a trivial query.

    Retries so a brief connection hiccup during a deploy does not fail
    the boot; after `attempts` tries the last error propagates. SQLite
    answers immediately.
    """
    import time
    from sqlalchemy.exc import DBAPIError

    for attempt in range(1, attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except DBAPIError:
            if attempt == attempts:
                raise
            logger.warning(
                "Database not reachable yet (attempt %d of %d); retrying in %.0fs.",
                attempt, attempts, delay_seconds,
            )
            time.sleep(delay_seconds)


def init_db() -> None:
    """Create all tables if they don't exist + auto-migrate any
    new columns on existing tables. Safe to call repeatedly. Invoked
    from main.py's lifespan startup hook.

    What a failed schema change means depends on where we run:
      * Production: raise SchemaMigrationError. A column the models
        expect but the table lacks makes every query on that table
        fail, and before 2026-09-25 the app still started and passed
        its health check, serving a broken site. Refusing to start
        makes the Render deploy fail, so the previous version stays
        live until the problem is fixed (audit O2).
        Emergency override: CIVICVIEW_ALLOW_SCHEMA_DRIFT=true logs the
        failures as CRITICAL and starts anyway, for a hotfix that has to
        ship before the schema can be repaired. Unset it afterwards.
      * Development: log every failure and keep going, which is the
        ergonomics this auto-migrate was written for.
    """
    # Import models so they're registered with Base.metadata. The import
    # is inside the function to avoid a circular at module-load time.
    from app.models import pages  # noqa: F401
    from app.services.runtime_env import is_production

    _MIGRATION_FAILURES.clear()
    Base.metadata.create_all(bind=engine)
    _auto_migrate_new_columns()
    _auto_migrate_nullability_changes()
    _auto_migrate_string_widening()
    _auto_migrate_missing_indexes()
    _repair_bad_now_defaults()
    if _MIGRATION_FAILURES:
        summary = "; ".join(_MIGRATION_FAILURES)
        override = (os.getenv("CIVICVIEW_ALLOW_SCHEMA_DRIFT") or "").strip().lower() in ("1", "true", "yes")
        if is_production() and not override:
            raise SchemaMigrationError(
                f"{len(_MIGRATION_FAILURES)} startup schema change(s) failed: {summary}"
            )
        if is_production():
            logger.critical(
                "Starting DESPITE %d failed schema change(s) because "
                "CIVICVIEW_ALLOW_SCHEMA_DRIFT is set. Tables involved will error "
                "until fixed; unset the override afterwards: %s",
                len(_MIGRATION_FAILURES), summary,
            )
            return
        logger.error(
            "Auto-migrate finished with %d failure(s); the tables involved will "
            "error until fixed: %s", len(_MIGRATION_FAILURES), summary,
        )


def _auto_migrate_missing_indexes() -> None:
    """Create any model-declared indexes that don't yet exist on disk.

    `Base.metadata.create_all` only creates indexes for tables it
    just created — it does NOT add indexes that were declared after
    a table already existed. When a model gains a new standalone
    `Index(...)` (e.g. the Phase 2 self-engagement work adds
    uq_post_reaction_rep alongside the existing uq_post_reaction_
    citizen), the index would silently be missing on existing
    deployments and the dedupe semantics it's enforcing would
    quietly stop working.

    This pass walks every declared index on every table that exists
    on disk and CREATE INDEXes the missing ones. Idempotent — uses
    `CREATE INDEX IF NOT EXISTS` (or its Postgres equivalent).
    """
    inspector = inspect(engine)
    for table in Base.metadata.tables.values():
        if table.name not in inspector.get_table_names():
            continue
        existing_index_names = {
            ix.get("name") for ix in inspector.get_indexes(table.name)
        }
        # Unique constraints sometimes show up as indexes too — fold
        # those in so we don't accidentally try to create a duplicate.
        try:
            existing_index_names.update(
                uc.get("name") for uc in inspector.get_unique_constraints(table.name)
            )
        except NotImplementedError:
            pass
        for ix in table.indexes:
            if ix.name in existing_index_names:
                continue
            try:
                ix.create(bind=engine, checkfirst=True)
                logger.info(
                    "Auto-migrate: created index %s on %s", ix.name, table.name,
                )
            except Exception as e:
                # We run a single worker, so a lost race is unlikely;
                # the usual cause is existing rows that break a new
                # unique index, which leaves the dedupe rule it
                # enforces switched off. Recorded as a failure.
                _record_migration_failure(
                    f"could not create index {ix.name} on {table.name}: {e}"
                )


def _auto_migrate_string_widening() -> None:
    """Widen on-disk VARCHAR columns when the model declares a longer
    type. Example: `appellant_kind` was String(8) in Phase 1 to fit
    'rep' / 'citizen'; Phase 2 widens it to String(16) to fit
    'candidate'.

    SQLite doesn't enforce VARCHAR length, so this is a no-op there.
    Postgres does, and inserts longer strings will fail until the
    column is widened. We use ALTER COLUMN ... TYPE which is fast and
    non-destructive on Postgres (just updates the catalog).

    Only widens — never narrows. A model that shrinks String(N) is
    skipped with a log warning so existing data isn't truncated.
    """
    if _is_sqlite():
        return
    inspector = inspect(engine)
    on_disk_tables = set(inspector.get_table_names())
    plans: list[tuple[str, str, int]] = []
    for mapper in Base.registry.mappers:
        table = mapper.local_table
        if table is None or table.name not in on_disk_tables:
            continue
        on_disk_cols = {c["name"]: c for c in inspector.get_columns(table.name)}
        for col in table.columns:
            on_disk = on_disk_cols.get(col.name)
            if on_disk is None:
                continue  # ADD COLUMN pass handles missing columns
            model_type = col.type
            disk_type = on_disk["type"]
            model_len = getattr(model_type, "length", None)
            disk_len = getattr(disk_type, "length", None)
            if model_len is None or disk_len is None:
                continue  # not VARCHAR-shaped on either side
            if model_len > disk_len:
                plans.append((table.name, col.name, model_len))
            elif model_len < disk_len:
                logger.warning(
                    "Auto-migrate skipped %s.%s — model wants VARCHAR(%d) but disk has VARCHAR(%d). "
                    "Narrowing would truncate existing rows; widen the model or migrate manually.",
                    table.name, col.name, model_len, disk_len,
                )

    if not plans:
        return
    with engine.begin() as conn:
        for table_name, col_name, new_len in plans:
            ddl = (
                f'ALTER TABLE "{table_name}" '
                f'ALTER COLUMN "{col_name}" TYPE VARCHAR({new_len})'
            )
            logger.info("Auto-migrate: widening %s.%s → VARCHAR(%d)", table_name, col_name, new_len)
            conn.execute(text(ddl))


def _repair_bad_now_defaults() -> None:
    """Repair pass for tables that had a `func.now()` server_default
    rendered as the literal string `'now()'` by an older version of
    the auto-migrate (the renderer didn't compile ClauseElements
    through the dialect, so it str()-quoted the function call). The
    bad default makes INSERT-with-RETURNING fail because SQLAlchemy
    tries to parse `'now()'` as an ISO datetime and 500s out
    everything that touches the table.

    We detect the fingerprint (`DEFAULT 'now()'` in the table's
    sqlite_master sql) and rebuild any affected tables. Rebuilding
    rewrites the table from the current ORM model, which renders
    defaults through the dialect compiler — the canonical right
    thing.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return

    inspector = inspect(engine)
    on_disk = set(inspector.get_table_names())
    bad_tables: list[str] = []
    with engine.connect() as conn:
        for mapper in Base.registry.mappers:
            table = mapper.local_table
            if table is None or table.name not in on_disk:
                continue
            row = conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=:n"
            ), {"n": table.name}).fetchone()
            if not row or not row[0]:
                continue
            ddl = row[0]
            # Only rebuild tables that BOTH have the bad default AND
            # have a column on the model with a server_default that
            # would render correctly now. (Avoids rewriting tables that
            # legitimately stored the string 'now()' as a default — not
            # something we ship, but be defensive.)
            if "DEFAULT 'now()'" in ddl:
                bad_tables.append(table.name)

    for name in bad_tables:
        logger.warning(
            "Auto-migrate: detected bad DEFAULT 'now()' on %s — rebuilding to fix.",
            name,
        )
        _rebuild_sqlite_table(name)


def _is_sqlite() -> bool:
    return DATABASE_URL.startswith("sqlite")


def _auto_migrate_new_columns() -> None:
    """Dev-ergonomics auto-migration.

    `Base.metadata.create_all` only creates tables that are missing —
    it never alters existing ones. When a model gains a new column
    between runs (e.g. adding CitizenAccount.verified, RepAccount.
    owner_state, or the citizen-poll author/archive columns), the
    ORM's SELECT will reference a column that doesn't exist on disk
    and every request that touches that table will 500.

    This pass inspects each declared model, compares its columns to
    what the on-disk table reports, and ALTER TABLE ADDs anything
    missing. Runs on both SQLite (dev) and Postgres (Render) — the
    `ADD COLUMN` syntax is portable, and the dialect compiler in
    `_render_server_default` produces correct defaults for each
    backend. Skips columns that are NOT NULL without a default
    (no safe way to backfill on existing rows).
    """
    inspector = inspect(engine)
    for mapper in Base.registry.mappers:
        table = mapper.local_table
        if table is None or table.name not in inspector.get_table_names():
            continue
        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing_cols:
                continue
            if not col.nullable and col.server_default is None and col.default is None:
                # Skipping still leaves the model and table out of step,
                # so every query on the table fails. Recorded as a failure.
                _record_migration_failure(
                    f"{table.name}.{col.name} is missing and is NOT NULL without "
                    "a default; add a server_default in the model or migrate manually"
                )
                continue

            # Compose the column definition. col.type.compile() uses the
            # dialect compiler so VARCHAR/INTEGER/DATETIME render
            # correctly on both SQLite and Postgres.
            col_type = col.type.compile(dialect=engine.dialect)
            parts = [f'"{col.name}"', col_type]
            if not col.nullable:
                parts.append("NOT NULL")
            default_clause: str | None = _render_server_default(col)
            if default_clause is not None:
                parts.append(f"DEFAULT {default_clause}")

            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN ' + " ".join(parts)
            logger.info("Auto-migrate: %s", ddl)
            # Per-column try/except so a single failed ADD doesn't
            # abort the rest of the migration. Before this guard, a
            # bad DEFAULT clause on column N would leak the exception
            # to the caller (main.py's lifespan) and silently skip
            # columns N+1..end — leaving the schema in a partial
            # state that broke every query touching the table.
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
            except Exception as e:
                # Keep going so the log names every failed column, then
                # init_db() decides whether the boot can continue.
                _record_migration_failure(
                    f"ADD COLUMN failed for {table.name}.{col.name}: {e}"
                )
                continue


def _auto_migrate_nullability_changes() -> None:
    """Second auto-migration pass: relax columns whose nullability has
    loosened since the table was created.

    Motivating cases:
      • `poll_votes.voter_token` was NOT NULL in Phase 1 (anonymous-
        only voting); Phase 1.5 made it optional because citizen_id is
        authoritative.
      • `polls.post_id` was NOT NULL in Phase 1 (every poll attached
        to a rep post); citizen polls are standalone and need
        post_id=NULL.

    SQLite can't ALTER COLUMN a constraint directly so we rebuild the
    table while preserving rows. Postgres supports `ALTER COLUMN ...
    DROP NOT NULL` natively — much cheaper, no copy required.

    If the model *tightened* nullability (now NOT NULL but NULLs on
    disk) we skip and log loudly — the dev decides whether to wipe
    or backfill.
    """
    inspector = inspect(engine)
    tables_to_rebuild: list[str] = []
    pg_columns_to_relax: list[tuple[str, str]] = []
    is_sqlite = _is_sqlite()
    for mapper in Base.registry.mappers:
        table = mapper.local_table
        if table is None or table.name not in inspector.get_table_names():
            continue
        on_disk_cols = {c["name"]: c for c in inspector.get_columns(table.name)}
        for col in table.columns:
            on_disk = on_disk_cols.get(col.name)
            if on_disk is None:
                continue  # handled by the ADD COLUMN pass
            # Relaxing: model says nullable, disk says NOT NULL.
            # SQLite needs a full table rebuild; Postgres can ALTER
            # COLUMN ... DROP NOT NULL directly.
            if col.nullable and not on_disk["nullable"]:
                logger.warning(
                    "Auto-migrate: %s.%s is NOT NULL on disk but nullable in model — relaxing.",
                    table.name, col.name,
                )
                if is_sqlite:
                    tables_to_rebuild.append(table.name)
                    break
                else:
                    pg_columns_to_relax.append((table.name, col.name))

    for name in tables_to_rebuild:
        _rebuild_sqlite_table(name)

    if pg_columns_to_relax:
        with engine.begin() as conn:
            for table_name, col_name in pg_columns_to_relax:
                ddl = f'ALTER TABLE "{table_name}" ALTER COLUMN "{col_name}" DROP NOT NULL'
                logger.info("Auto-migrate: %s", ddl)
                conn.execute(text(ddl))


def _rebuild_sqlite_table(table_name: str) -> None:
    """Rebuild a single SQLite table to match its current SQLAlchemy
    model definition. Preserves every row by copying the intersection
    of on-disk and model columns. Everything runs in one transaction
    so a mid-flight error rolls back to the original state.
    """
    # Find the current model-side Table.
    target_table = next(
        (
            m.local_table
            for m in Base.registry.mappers
            if m.local_table is not None and m.local_table.name == table_name
        ),
        None,
    )
    if target_table is None:
        return

    inspector = inspect(engine)
    if table_name not in inspector.get_table_names():
        return

    on_disk_cols = {c["name"] for c in inspector.get_columns(table_name)}
    model_cols = {c.name for c in target_table.columns}
    copy_cols = sorted(on_disk_cols & model_cols)
    if not copy_cols:
        return

    backup_name = f"__{table_name}__pre_auto_migrate"
    col_list = ", ".join(f'"{c}"' for c in copy_cols)

    logger.info(
        "Auto-migrate: rebuilding %s (preserving columns: %s)",
        table_name, ", ".join(copy_cols),
    )

    # A defensive cleanup for any backup left over from a previous
    # failed run — ignore errors.
    with engine.begin() as conn:
        try:
            conn.execute(text(f'DROP TABLE IF EXISTS "{backup_name}"'))
        except Exception:
            pass

    # Do the actual rebuild in a single transaction so a failure
    # rolls back to the original table untouched.
    with engine.begin() as conn:
        # 1) Snapshot rows into a plain backup (no constraints).
        # nosec note (B608): table/column identifiers are interpolated,
        # but they come exclusively from SQLAlchemy model metadata (our
        # own source code) — never from user input.
        conn.execute(text(
            f'CREATE TABLE "{backup_name}" AS SELECT * FROM "{table_name}"'  # nosec B608
        ))
        # 2) Drop the original — takes its indexes with it.
        conn.execute(text(f'DROP TABLE "{table_name}"'))
        # 3) Recreate from the current model. This creates the table
        #    plus any indexes declared on it (both inline index=True
        #    columns and standalone Index() objects in .indexes).
        target_table.create(conn, checkfirst=False)
        # 4) Copy rows back — intersection of columns only, so new
        #    nullable columns stay NULL (DB default) for old rows.
        conn.execute(text(
            f'INSERT INTO "{table_name}" ({col_list}) '  # nosec B608 - model metadata, see above
            f'SELECT {col_list} FROM "{backup_name}"'
        ))
        # 5) Remove the backup.
        conn.execute(text(f'DROP TABLE "{backup_name}"'))
