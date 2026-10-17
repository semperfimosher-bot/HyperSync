"""Coordinate Alembic invocations on the direct PostgreSQL connection."""

from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.engine import Connection

# Stable across versions and replicas; do not use Python's randomized hash().
MIGRATION_LOCK_ID = 0x485950455253594E


@contextmanager
def migration_lock(connection: Connection):
    external_transaction = connection.in_transaction()
    acquired = False
    failed = False
    try:
        connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": MIGRATION_LOCK_ID})
        acquired = True
        if external_transaction:
            # Keep competitors blocked until the caller actually commits DDL/version.
            connection.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": MIGRATION_LOCK_ID}
            )
        else:
            # SELECT autobegins. End ONLY this acquisition transaction so Alembic
            # owns and commits its DDL/version transaction rather than rolling it
            # back when the connection closes. Session lock survives this commit.
            connection.commit()
        yield
    except BaseException:
        failed = True
        if not acquired:
            # The server may have taken the lock before a network/cancellation
            # error reached us. Never reuse a session with unknown lock state.
            connection.invalidate()
        if not external_transaction and connection.in_transaction():
            connection.rollback()
        raise
    finally:
        if acquired:
            try:
                connection.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": MIGRATION_LOCK_ID}
                )
                if not external_transaction:
                    connection.commit()
            except BaseException:
                # Aborted transactions cannot execute unlock; physically discard
                # this session so its lock cannot return to a connection pool.
                connection.invalidate()
                if not failed:
                    raise
