from contextlib import contextmanager
from typing import Any, cast

import pytest


def coordination():
    from migrations.coordination import migration_lock

    return cast(Any, migration_lock)


class Connection:
    def __init__(self, external=False):
        self.active = external
        self.events = []

    def in_transaction(self):
        return self.active

    def execute(self, sql, params):
        self.active = True
        self.events.append(str(sql))

    def commit(self):
        self.events.append("commit")
        self.active = False

    def rollback(self):
        self.events.append("rollback")
        self.active = False

    def invalidate(self):
        self.events.append("invalidate")


@contextmanager
def migration_transaction(connection):
    connection.active = True
    connection.events.append("DDL and version")
    yield
    connection.commit()


def test_acquisition_does_not_leave_implicit_transaction_around_alembic():
    connection = Connection()
    with coordination()(connection):
        assert not connection.in_transaction()
        with migration_transaction(connection):
            pass
    assert "pg_advisory_lock" in connection.events[0]
    assert connection.events[1:4] == ["commit", "DDL and version", "commit"]
    assert "pg_advisory_unlock" in connection.events[4]
    assert connection.events[-1] == "commit"
    assert "rollback" not in connection.events


def test_failure_rolls_back_failed_owned_transaction_before_unlock():
    connection = Connection()
    with pytest.raises(RuntimeError, match="migration failed"):
        with coordination()(connection):
            connection.active = True
            raise RuntimeError("migration failed")
    assert connection.events[2] == "rollback"
    assert "pg_advisory_unlock" in connection.events[3]


def test_external_transaction_remains_owned_by_caller_and_holds_xact_lock():
    connection = Connection(external=True)
    with coordination()(connection):
        connection.events.append("DDL and version")
    assert any("pg_advisory_xact_lock" in event for event in connection.events)
    assert connection.in_transaction()
    assert "commit" not in connection.events
    assert "rollback" not in connection.events


def test_failed_unlock_invalidates_connection_and_preserves_original_error():
    class FailedConnection(Connection):
        def execute(self, sql, params):
            if "unlock" in str(sql):
                raise ValueError("transaction aborted")
            super().execute(sql, params)

    connection = FailedConnection(external=True)
    with pytest.raises(RuntimeError, match="migration failed"):
        with coordination()(connection):
            raise RuntimeError("migration failed")
    assert connection.events[-1] == "invalidate"


def test_failed_acquisition_discards_session_with_unknown_lock_state():
    class FailedAcquisition(Connection):
        def execute(self, sql, params):
            raise RuntimeError("connection lost while acquiring")

    connection = FailedAcquisition()
    with pytest.raises(RuntimeError, match="connection lost"):
        with coordination()(connection):
            pass
    assert "invalidate" in connection.events
