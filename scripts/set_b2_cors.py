"""Preview or apply browser upload CORS using the B2 Native API, preserving other rules.

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
    rules = [deepcopy(rule) for rule in existing if rule.get("corsRuleName") != RULE_ID]
    rules.append(
        {
            "corsRuleName": RULE_ID,
            "allowedOrigins": normalized,
            "allowedOperations": ["s3_get", "s3_head", "s3_put"],
            "allowedHeaders": ["Content-Type", "Range"],
            "exposeHeaders": [
                "Accept-Ranges",
                "Content-Length",
                "Content-Range",
                "Content-Type",
                "ETag",
            ],
            "maxAgeSeconds": 300,
        }
    )
    return rules


def configure_cors(bucket: Any, origins: list[str], *, apply: bool = False):
    # S3 GetBucketCors hides Native rules, and PutBucketCors rejects buckets
    # containing them. Native reads/updates can preserve both kinds of rule.
    fresh = bucket.get_fresh_state()
    if not isinstance(fresh.cors_rules, list):
        raise RuntimeError("Unable to read the complete bucket CORS policy; no changes made.")
    rules = build_cors_rules(fresh.cors_rules, origins)
    if apply:
        if not isinstance(fresh.revision, int):
            raise RuntimeError("Unable to read the bucket revision; no changes made.")
        # Reject concurrent changes instead of overwriting another operator's edit.
        fresh.update(cors_rules=rules, if_revision_is=fresh.revision)
    return rules


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", action="append", help="Exact browser origin; may be repeated")
    parser.add_argument(
        "--apply", action="store_true", help="Apply the previewed policy to the bucket"
    )
    args = parser.parse_args()
    from backend.app.config import get_settings
    from backend.app.services.b2 import get_b2_bucket

    settings = get_settings()
    if not settings.b2_bucket_name:
        raise RuntimeError("B2_BUCKET_NAME is not configured.")
    rules = configure_cors(
        get_b2_bucket(),
        args.origin if args.origin is not None else list(DEFAULT_ORIGINS),
        apply=args.apply,
    )
    print(
        json.dumps(
            {"bucket": settings.b2_bucket_name, "api": "B2 Native", "corsRules": rules}, indent=2
        )
    )
    print("CORS applied." if args.apply else "Preview only; use --apply to update this bucket.")


if __name__ == "__main__":
    main()
