import pytest

from types import SimpleNamespace
from unittest.mock import Mock

from backend.app.services import b2 as b2_service


VALID_SETTINGS = {
    "b2_key_id": "fixture-key-id",
    "b2_application_key": "fixture-application-key",
    "b2_bucket_name": "fixture-bucket",
}


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://s3.us-west-004.backblazeb2.com",
        "https://user:password@s3.us-west-004.backblazeb2.com",
        "https://s3.us-west-004.backblazeb2.com/other-bucket",
        "https://s3.us-west-004.backblazeb2.com/?redirect=example",
        "https://s3.us-west-004.backblazeb2.com/#fragment",
        "https://s3.us-west-004.backblazeb2.com:8443",
        "https://storage.attacker.example",
    ],
)
def test_s3_client_rejects_unsafe_or_malformed_endpoint_origins(
    monkeypatch,
    endpoint: str,
) -> None:
    client_factory = Mock()
    monkeypatch.setattr(
        b2_service,
        "get_settings",
        lambda: SimpleNamespace(
            **VALID_SETTINGS,
            b2_endpoint=endpoint,
        ),
    )
    monkeypatch.setattr(
        b2_service,
        "boto3",
        SimpleNamespace(client=client_factory),
    )
    b2_service.get_b2_s3_client.cache_clear()

    try:
        with pytest.raises(
            RuntimeError,
            match="HTTPS Backblaze S3 endpoint origin",
        ):
            b2_service.get_b2_s3_client()

        client_factory.assert_not_called()
    finally:
        b2_service.get_b2_s3_client.cache_clear()


def test_s3_client_accepts_https_backblaze_endpoint_origin(monkeypatch) -> None:
    client_factory = Mock(return_value=object())
    endpoint = "https://s3.us-west-004.backblazeb2.com"
    monkeypatch.setattr(
        b2_service,
        "get_settings",
        lambda: SimpleNamespace(
            **VALID_SETTINGS,
            b2_endpoint=endpoint,
        ),
    )
    monkeypatch.setattr(
        b2_service,
        "boto3",
        SimpleNamespace(client=client_factory),
    )
    b2_service.get_b2_s3_client.cache_clear()

    try:
        assert b2_service.get_b2_s3_client() is not None
        assert client_factory.call_args.kwargs["endpoint_url"] == endpoint
        assert client_factory.call_args.kwargs["region_name"] == "us-west-004"
    finally:
        b2_service.get_b2_s3_client.cache_clear()
