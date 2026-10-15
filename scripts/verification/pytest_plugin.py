"""Prevent verification pytest from falling back to a developer's backend/.env."""

from backend.app.config import Settings, get_settings

Settings.model_config["env_file"] = None
get_settings.cache_clear()
