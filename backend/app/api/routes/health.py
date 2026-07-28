from fastapi import APIRouter, Response, status

from ...config import get_settings
from ...database import check_database

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live_health() -> dict[str, str]:
    settings = get_settings()

    return {
        "application": settings.app_name,
        "api": "healthy",
        "version": settings.app_version,
    }


@router.get("/health")
@router.get("/health/ready")
async def ready_health(response: Response) -> dict[str, str]:
    settings = get_settings()

    try:
        await check_database()
    except Exception:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "application": settings.app_name,
            "api": "healthy",
            "database": "unhealthy",
            "version": settings.app_version,
        }

    return {
        "application": settings.app_name,
        "api": "healthy",
        "database": "healthy",
        "version": settings.app_version,
    }