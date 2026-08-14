from functools import lru_cache

import b2sdk.v2 as b2
from b2sdk.v2 import InMemoryAccountInfo

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
