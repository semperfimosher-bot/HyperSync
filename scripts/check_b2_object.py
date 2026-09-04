from botocore.exceptions import ClientError

from backend.app.config import get_settings
from backend.app.services.b2 import get_b2_s3_client

settings = get_settings()
client = get_b2_s3_client()

key = (
    "audio/"
    "4659ad28-cd53-4b8a-89aa-65eedfd6fe21.mp3"
)

try:
    response = client.head_object(
        Bucket=settings.b2_bucket_name,
        Key=key,
    )

    print("B2 HEAD OK")
    print("status:", response["ResponseMetadata"]["HTTPStatusCode"])
    print("length:", response.get("ContentLength"))

except ClientError as exc:
    error = exc.response.get("Error", {})
    metadata = exc.response.get("ResponseMetadata", {})

    print("B2 HEAD FAILED")
    print("status:", metadata.get("HTTPStatusCode"))
    print("code:", error.get("Code"))
    print("message:", error.get("Message"))
    