from backend.app.config import get_settings
from backend.app.services.b2 import (
    get_b2_s3_client,
)

settings = get_settings()

if not settings.b2_bucket_name:
    raise RuntimeError(
        "B2_BUCKET_NAME is not configured."
    )

client = get_b2_s3_client()

client.put_bucket_cors(
    Bucket=settings.b2_bucket_name,
    CORSConfiguration={
        "CORSRules": [
            {
                "AllowedOrigins": [
                    "https://hypersynced.app",
                ],
                "AllowedMethods": [
                    "GET",
                    "HEAD",
                ],
                "AllowedHeaders": [
                    "*",
                ],
                "ExposeHeaders": [
                    "Accept-Ranges",
                    "Content-Length",
                    "Content-Range",
                    "Content-Type",
                    "ETag",
                ],
                "MaxAgeSeconds": 86400,
            },
        ],
    },
)

print(
    "B2 S3 CORS configured for "
    "https://hypersynced.app"
)
