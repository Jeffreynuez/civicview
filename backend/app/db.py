# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Database plumbing for the Pages feature.

SQLite was picked over Postgres for Phase 1 because:
  • The MVP is single-node and read-light.
  • Zero-install — file sits at `backend/civiclens.db`.
  • Swap to Postgres later by changing DATABASE_URL and adding Alembic;
    the SQLAlchemy models port without changes.

Phase 1 creates tables on startup via `Base.metadata.create_all`. Once
the schema stops shifting we'll introduce Alembic migrations. Until
then, init_db() also runs a small auto-migration pass that ADDs any
new columns defined on the models but missing from the on-disk
schema. This is dev-only ergonomics — you can restart the backend
after editing a model without having to delete civiclens.db. For
Postgres we short-circuit this pass (Alembic is the right tool).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Generator, Optional

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session


BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BACKEND_DIR / "civiclens.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

# `check_same_thread=False` is SQLite-specific and required because
# FastAPI uses a thread pool for sync dependencies. Harmless for other
# backends (the connect_args is simply ignored).
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


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

    Handles three kinds of input:
      1. server_default=text("'full'") — already raw SQL, use as-is.
      2. server_default="full" — plain string; SQLAlchemy wraps it in
         a TextClause that str()s back to "full" WITHOUT quotes. We
         detect this case with the passthrough set; anything that
         doesn't look like a known SQL expression gets string-quoted.
      3. default=<scalar> — Python-side default; we quote/serialize
         by type.
    """
    if col.server_default is not None:
        raw = str(col.server_default.arg).strip()
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
            return "1" if val else "0"
        if isinstance(val, (int, float)):
            return str(val)
        if isinstance(val, str):
            return _sql_quote_string(val)

    return None


def init_db() -> None:
    """Create all tables if they don't exist + dev auto-migrate any
    new columns on existing tables. Safe to call repeatedly. Invoked
    from main.py's lifespan startup hook."""
    # Import models so they're registered with Base.metadata. The import
    # is inside the function to avoid a circular at module-load time.
    from app.models import pages  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _auto_migrate_new_columns()
    _auto_migrate_nullability_changes()


def _auto_migrate_new_columns() -> None:
    """Dev-ergonomics auto-migration.

    `Base.metadata.create_all` only creates tables that are missing —
    it never alters existing ones. When a model gains a new column
    between runs (e.g. adding CitizenAccount.verified or
    RepAccount.owner_state during Phase 1.5), the ORM's SELECT will
    reference a column that doesn't exist on disk and every request
    that touches that table will 500.

    This pass inspects each declared model, compares its columns to
    what SQLite (or Postgres) reports for the actual table, and
    ALTER TABLE ADDs anything missing. We only run on SQLite and only
    for NULL-safe, default-safe additions — if a new column is NOT
    NULL without a server_default we skip it and log loudly so the
    developer notices and either (a) adds a server_default to the
    model or (b) deletes the DB and starts fresh.

    Production: this function is a no-op on non-SQLite connections;
    use Alembic there.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return

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
                logger.warning(
                    "Auto-migrate skipped %s.%s — NOT NULL without a default. "
                    "Delete civiclens.db or add a default, then restart.",
                    table.name, col.name,
                )
                continue

            # Compose the column definition SQLite will accept.
            col_type = col.type.compile(dialect=engine.dialect)
            parts = [f'"{col.name}"', col_type]
            if not col.nullable:
                parts.append("NOT NULL")

            # Resolve a literal default. Booleans serialize to 0/1 in
            # SQLite, strings get SQL-quoted, NULL stays NULL. We never
            # want to emit a bare word like `DEFAULT full` — SQLite
            # parses that as an identifier and errors out.
            default_clause: str | None = _render_server_default(col)
            if default_clause is not None:
                parts.append(f"DEFAULT {default_clause}")

            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN ' + " ".join(parts)
            logger.info("Auto-migrate: %s", ddl)
            with engine.begin() as conn:
                conn.execute(text(ddl))


def _auto_migrate_nullability_changes() -> None:
    """Second auto-migration pass: handle columns whose nullability has
    loosened since the table was created.

    Motivating case: `poll_votes.voter_token` was NOT NULL in Phase 1
    (anonymous-only voting). In Phase 1.5 voter_token became optional
    because citizen_id is the authoritative identity and we want
    citizen rows to save voter_token=NULL. SQLite can't ALTER COLUMN a
    constraint directly — we have to rebuild the table. This function
    detects any `nullable in model but NOT NULL on disk` mismatch and
    rebuilds the affected tables while preserving every row. Indexes
    declared on the model are recreated automatically by
    `Table.create()`. If the model *tightened* nullability (now NOT
    NULL but NULLs on disk) we skip the rebuild and log loudly — the
    dev can decide whether to wipe the data or add a backfill.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return

    inspector = inspect(engine)
    tables_to_rebuild: list[str] = []
    for mapper in Base.registry.mappers:
        table = mapper.local_table
        if table is None or table.name not in inspector.get_table_names():
            continue
        on_disk_cols = {c["name"]: c for c in inspector.get_columns(table.name)}
        for col in table.columns:
            on_disk = on_disk_cols.get(col.name)
            if on_disk is None:
                continue  # handled by the ADD COLUMN pass
            # Relaxing: model says nullable, disk says NOT NULL → rebuild.
            if col.nullable and not on_disk["nullable"]:
                logger.warning(
                    "Auto-migrate: %s.%s is NOT NULL on disk but nullable in model — "
                    "will rebuild %s to relax the constraint.",
                    table.name, col.name, table.name,
                )
                tables_to_rebuild.append(table.name)
                break

    for name in tables_to_rebuild:
        _rebuild_sqlite_table(name)


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
        conn.execute(text(
            f'CREATE TABLE "{backup_name}" AS SELECT * FROM "{table_name}"'
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
            f'INSERT INTO "{table_name}" ({col_list}) '
            f'SELECT {col_list} FROM "{backup_name}"'
        ))
        # 5) Remove the backup.
        conn.execute(text(f'DROP TABLE "{backup_name}"'))
