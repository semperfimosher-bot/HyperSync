import pytest

from scripts.verification.environment import create_environment, load_test_settings, owned_cleanup


def test_test_settings_ignore_hosted_credentials_and_dotenv(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://secret@production.invalid/live")
    monkeypatch.setenv("B2_APPLICATION_KEY", "hosted-storage-secret")
    monkeypatch.setenv("SMTP_PASSWORD", "hosted-mail-secret")
    from backend.app.config import Settings

    fake_env = tmp_path / "fake.env"
    fake_env.write_text("JWT_SECRET=hosted-jwt-secret\nB2_BUCKET_NAME=real-bucket\n")
    monkeypatch.setitem(Settings.model_config, "env_file", fake_env)
    environment = create_environment(tmp_path / "run")
    settings = load_test_settings(environment)
    assert settings.database_url.startswith("sqlite+aiosqlite:///")
    assert str(environment.root) in settings.database_url
    assert len(settings.jwt_secret) >= 32
    assert settings.jwt_secret != "hosted-jwt-secret"
    assert settings.b2_application_key == settings.smtp_password == settings.b2_bucket_name == ""
    assert settings.frontend_public_url in settings.cors_origins
    assert settings.environment == "test"


def test_cleanup_requires_marker_and_rejects_external_symlink(tmp_path):
    environment = create_environment(tmp_path / "run")
    outside = tmp_path / "keep"
    outside.mkdir()
    (outside / "file").write_text("preserve")
    link = environment.root / "outside"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("OS does not permit symlink creation")
    owned_cleanup(environment)
    assert (outside / "file").read_text() == "preserve"
    environment = create_environment(tmp_path / "another")
    (environment.root / ".owner").write_text("different-run")
    with pytest.raises(ValueError):
        owned_cleanup(environment)
    assert environment.root.exists()


def test_runs_never_reuse_existing_directory(tmp_path):
    first = create_environment(tmp_path / "one")
    second = create_environment(tmp_path / "two")
    assert first.run_id != second.run_id
    assert first.database_url != second.database_url
    with pytest.raises(FileExistsError):
        create_environment(tmp_path / "one")


def test_child_keeps_execution_runtime_without_inheriting_app_secrets(tmp_path, monkeypatch):
    from scripts.verification.environment import child_environment

    monkeypatch.setenv("CODEX_NETWORK_ALLOW_LOCAL_BINDING", "1")
    monkeypatch.setenv("B2_APPLICATION_KEY", "do-not-inherit")
    monkeypatch.setenv("UNRELATED_PRIVATE_TOKEN", "do-not-inherit")
    values = child_environment(create_environment(tmp_path / "run"))
    assert values["CODEX_NETWORK_ALLOW_LOCAL_BINDING"] == "1"
    assert values["B2_APPLICATION_KEY"] == ""
    assert "UNRELATED_PRIVATE_TOKEN" not in values
