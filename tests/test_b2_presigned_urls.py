from types import SimpleNamespace

from backend.app.services import (
    b2 as b2_service,
)


def test_create_presigned_download_url(
    monkeypatch,
) -> None:
    calls = {}

    class FakeS3Client:
        def generate_presigned_url(
            self,
            client_method,
            Params=None,
            ExpiresIn=None,
        ):
            calls["sign"] = {
                "client_method": client_method,
                "params": Params,
                "expires_in": ExpiresIn,
            }

            return "https://s3.example.test/hypersync/audio/demo.wav?X-Amz-Signature=test"

    fake_s3_client = FakeS3Client()

    def fake_boto_client(
        service_name,
        **kwargs,
    ):
        calls["client"] = {
            "service_name": service_name,
            **kwargs,
        }

        return fake_s3_client

    monkeypatch.setattr(
        b2_service,
        "boto3",
        SimpleNamespace(
            client=fake_boto_client,
        ),
        raising=False,
    )

    monkeypatch.setattr(
        b2_service,
        "get_settings",
        lambda: SimpleNamespace(
            b2_endpoint=("https://s3.us-west-004.backblazeb2.com"),
            b2_key_id=("example-key-id"),
            b2_application_key=("example-application-key"),
            b2_bucket_name=("hypersync"),
            b2_presigned_url_ttl_seconds=(86400),
        ),
    )

    if hasattr(
        b2_service,
        "get_b2_s3_client",
    ):
        (b2_service.get_b2_s3_client.cache_clear())

    result = b2_service.create_presigned_download_url(
        "audio/demo.wav",
    )

    assert result == ("https://s3.example.test/hypersync/audio/demo.wav?X-Amz-Signature=test")

    assert calls["client"]["service_name"] == "s3"

    assert calls["client"]["endpoint_url"] == ("https://s3.us-west-004.backblazeb2.com")

    assert calls["client"]["region_name"] == "us-west-004"

    assert calls["client"]["aws_access_key_id"] == "example-key-id"

    assert calls["client"]["aws_secret_access_key"] == "example-application-key"

    assert calls["client"]["config"].signature_version == "s3v4"

    assert calls["sign"] == {
        "client_method": "get_object",
        "params": {
            "Bucket": "hypersync",
            "Key": "audio/demo.wav",
        },
        "expires_in": 86400,
    }

    if hasattr(
        b2_service,
        "get_b2_s3_client",
    ):
        (b2_service.get_b2_s3_client.cache_clear())
