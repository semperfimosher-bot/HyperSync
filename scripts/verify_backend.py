from importlib import import_module

from backend.app.main import app
from backend.app.models import Base

REQUIRED_PACKAGES = {
    "alembic",
    "asyncpg",
    "fastapi",
    "sqlalchemy",
}

EXPECTED_TABLES = {
    "users",
    "user_profiles",
    "user_sessions",
}


def verify_required_packages() -> None:
    for package_name in sorted(REQUIRED_PACKAGES):
        import_module(package_name)


def verify_application() -> None:
    if app.title != "HyperSync API":
        raise RuntimeError(f"Unexpected API title: {app.title!r}")


def verify_models() -> None:
    actual_tables = set(Base.metadata.tables)
    missing_tables = EXPECTED_TABLES - actual_tables

    if missing_tables:
        raise RuntimeError(f"Missing registered model tables: {sorted(missing_tables)}")


def main() -> None:
    verify_required_packages()
    verify_application()
    verify_models()


if __name__ == "__main__":
    main()
