from backend.app.config import Settings


def test_staging_environment_is_supported_without_production_mode():
    settings = Settings(
        environment="staging",
        database_url="postgresql://verification:verification@localhost/hypersync",
        jwt_secret="stage-kB7aD9mQ3pX8vN2hL5rT1wZ6cF4sY0jR9uE7",
        frontend_public_url="https://hypersync-staging.example.test",
        frontend_origins="https://hypersync-staging.example.test",
    )

    assert settings.environment == "staging"
    assert settings.sqlalchemy_database_url.startswith(
        "postgresql+asyncpg://"
    )
    assert settings.frontend_public_url in settings.cors_origins
