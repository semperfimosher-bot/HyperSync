import asyncio
from functools import lru_cache
from typing import Any
from urllib.parse import urlsplit

import b2sdk.v2 as b2
import boto3
from botocore.config import Config

from ..config import get_settings


@lru_cache
def get_b2_client() -> b2.B2Api:
    settings = get_settings()

    if not settings.b2_key_id:
        raise RuntimeError("B2_KEY_ID is not configured.")

    if not settings.b2_application_key:
        raise RuntimeError("B2_APPLICATION_KEY is not configured.")

    info = b2.InMemoryAccountInfo()
    api = b2.B2Api(account_info=info)  # type: ignore[arg-type]

    api.authorize_account(
        "production",
        settings.b2_key_id,
        settings.b2_application_key,
    )

    return api


def get_b2_bucket():
    settings = get_settings()

    if not settings.b2_bucket_name:
        raise RuntimeError("B2_BUCKET_NAME is not configured.")

    return get_b2_client().get_bucket_by_name(settings.b2_bucket_name)


def get_b2_endpoint() -> str:
    settings = get_settings()

    if not settings.b2_endpoint:
        raise RuntimeError("B2_ENDPOINT is not configured.")

    return settings.b2_endpoint


@lru_cache
def get_b2_s3_client():
    settings = get_settings()

    endpoint = settings.b2_endpoint.strip().rstrip("/")


    if not endpoint:
        raise RuntimeError("B2_ENDPOINT is not configured.")

    if not settings.b2_key_id:
        raise RuntimeError("B2_KEY_ID is not configured.")

    if not settings.b2_application_key:
        raise RuntimeError("B2_APPLICATION_KEY is not configured.")

    hostname = (
        urlsplit(
            endpoint,
        ).hostname
        or ""
    )

    hostname_parts = hostname.split(".")


    if (
        len(hostname_parts) < 4
        or hostname_parts[0] != "s3"
        or not hostname.endswith(".backblazeb2.com")
    ):
        raise RuntimeError(
            "B2_ENDPOINT must be a "
            "Backblaze S3 endpoint, "
            "for example "
            "https://s3.us-west-004."
            "backblazeb2.com"
        )

    region = hostname_parts[1]

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=(settings.b2_key_id),
        aws_secret_access_key=(settings.b2_application_key),
        config=Config(
            signature_version="s3v4",
            s3={
                "addressing_style": "path",
            },
        ),
    )


def create_presigned_download_url(
    object_key: str,
) -> str:
    if object_key.startswith(
        (
            "http://",
            "https://",
        ),
    ):
        return object_key

    settings = get_settings()

    if not settings.b2_bucket_name:
        raise RuntimeError("B2_BUCKET_NAME is not configured.")

    ttl = max(
        int(settings.b2_presigned_url_ttl_seconds),
        60,
    )

    return get_b2_s3_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.b2_bucket_name,
            "Key": object_key,
        },
        ExpiresIn=ttl,
    )


async def delete_all_object_versions(
    bucket: Any,
    object_key: str,
) -> int:
    versions = await asyncio.to_thread(
        bucket.list_file_versions,
        file_name=object_key,
    )

    deleted = 0

    for version in versions:
        file_id = getattr(
            version,
            "file_id",
            None,
        )

        if file_id is None:
            file_id = getattr(
                version,
                "id_",
                None,
            )

        if file_id is None:
            raise RuntimeError("B2 file version does not have a file ID.")

        file_name = version.file_name

        print(f"[B2 DELETE] {file_name} id={file_id}")

        await asyncio.to_thread(
            bucket.delete_file_version,
            file_id,
            file_name,
        )

        deleted += 1

    print(f"[B2 DELETE] Deleted {deleted} version(s) for {object_key}")

    return deleted
