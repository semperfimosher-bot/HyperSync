"""Preview or explicitly apply browser upload CORS rules without replacing other rules.

From the repository root: python -m scripts.set_b2_cors [--apply]
The default exact origins cover production and the two local port-4153 origins.
Use repeated --origin arguments to supply a different exact-origin list.
"""

from __future__ import annotations

import argparse
import json
from copy import deepcopy
from typing import Any
from urllib.parse import urlsplit

from botocore.exceptions import ClientError

RULE_ID = "HyperSyncBrowserUploads"
DEFAULT_ORIGINS = (
    "https://hypersynced.app",
    "http://localhost:4153",
    "http://127.0.0.1:4153",
)


def build_cors_rules(existing: list[dict[str, Any]], origins: list[str]) -> list[dict[str, Any]]:
    normalized = []
    for origin in origins:
        parts = urlsplit(origin.strip())
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or "*" in parts.netloc
            or parts.username
            or parts.password
            or parts.path not in {"", "/"}
            or parts.query
            or parts.fragment
        ):
            raise ValueError(f"An exact HTTP(S) origin is required: {origin!r}")
        value = f"{parts.scheme}://{parts.netloc}"
        if value not in normalized:
            normalized.append(value)
    if not normalized:
        raise ValueError("At least one browser origin is required.")
    rules = [deepcopy(rule) for rule in existing if rule.get("ID") != RULE_ID]
    rules.append(
        {
            "ID": RULE_ID,
            "AllowedOrigins": normalized,
            "AllowedMethods": ["GET", "HEAD", "PUT"],
            "AllowedHeaders": ["Content-Type", "Range"],
            "ExposeHeaders": [
                "Accept-Ranges",
                "Content-Length",
                "Content-Range",
                "Content-Type",
                "ETag",
            ],
            "MaxAgeSeconds": 300,
        }
    )
    return rules


def configure_cors(client: Any, bucket: str, origins: list[str], *, apply: bool = False):
    try:
        existing = client.get_bucket_cors(Bucket=bucket).get("CORSRules", [])
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "NoSuchCORSConfiguration":
            raise  # Refuse to overwrite a policy that could not be read.
        existing = []
    rules = build_cors_rules(existing, origins)
    if apply:
        client.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": rules})
    return rules


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", action="append", help="Exact browser origin; may be repeated")
    parser.add_argument(
        "--apply", action="store_true", help="Apply the previewed policy to the bucket"
    )
    args = parser.parse_args()
    from backend.app.config import get_settings
    from backend.app.services.b2 import get_b2_s3_client

    settings = get_settings()
    if not settings.b2_bucket_name:
        raise RuntimeError("B2_BUCKET_NAME is not configured.")
    rules = configure_cors(
        get_b2_s3_client(),
        settings.b2_bucket_name,
        args.origin if args.origin is not None else list(DEFAULT_ORIGINS),
        apply=args.apply,
    )
    print(json.dumps({"bucket": settings.b2_bucket_name, "CORSRules": rules}, indent=2))
    print("CORS applied." if args.apply else "Preview only; use --apply to update this bucket.")


if __name__ == "__main__":
    main()
