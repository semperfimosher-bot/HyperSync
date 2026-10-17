from types import SimpleNamespace
from unittest.mock import Mock

from backend.app.services import b2


def test_sdk_worker_and_buffer_budgets_are_explicit(monkeypatch):
    api = Mock()
    factory = Mock(return_value=api)
    monkeypatch.setattr(b2.b2, "B2Api", factory)
    monkeypatch.setattr(
        b2,
        "get_settings",
        lambda: SimpleNamespace(b2_key_id="fixture", b2_application_key="fixture-secret"),
    )
    b2.get_b2_client.cache_clear()
    try:
        assert b2.get_b2_client() is api
        options = factory.call_args.kwargs
        assert options["max_upload_workers"] == 1
        assert options["max_copy_workers"] == 1
        assert options["max_download_workers"] == 2
        assert options["max_download_streams_per_file"] == 1
        assert options["save_to_buffer_size"] == 256 * 1024
    finally:
        b2.get_b2_client.cache_clear()
