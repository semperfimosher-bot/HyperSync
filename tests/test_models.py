from backend.app.models import Base


def test_account_tables_are_registered() -> None:
    expected_tables = {
        "users",
        "user_profiles",
        "user_sessions",
    }

    assert expected_tables.issubset(
        Base.metadata.tables,
    )


def test_users_table_has_required_columns() -> None:
    users_table = Base.metadata.tables["users"]

    expected_columns = {
        "id",
        "account_type",
        "email",
        "username",
        "username_normalized",
        "password_hash",
        "role",
        "is_active",
        "is_email_verified",
        "last_login_at",
        "created_at",
        "updated_at",
    }

    assert expected_columns.issubset(
        users_table.columns.keys(),
    )


def test_sessions_do_not_store_raw_tokens() -> None:
    sessions_table = Base.metadata.tables["user_sessions"]

    column_names = set(
        sessions_table.columns.keys(),
    )

    assert "refresh_token_hash" in column_names
    assert "refresh_token" not in column_names
