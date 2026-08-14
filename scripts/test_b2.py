from backend.app.services.b2 import get_b2_bucket
from backend.app.config import get_settings

settings = get_settings()
bucket = get_b2_bucket()

print("B2 CONNECTION OK")
print("Bucket:", settings.b2_bucket_name)

count = 0

for file_version in bucket.ls(latest_only=True):
    file_name = file_version[0].file_name
    print("Object:", file_name)

    count += 1

    if count >= 5:
        break

print("Objects checked:", count)
