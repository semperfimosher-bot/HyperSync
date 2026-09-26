import asyncio
from collections.abc import AsyncIterator
from contextlib import (
    asynccontextmanager,
    suppress,
)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .api.router import api_router
from .config import get_settings
from .database import (
    check_database,
    close_database,
    ensure_demo_data,
)
from .services.admin_notifications import (
    record_admin_activity,
)
from .services.message_retention import (
    cleanup_expired_messages,
)
from .security.tokens import (
    InvalidAccessTokenError,
    decode_access_token,
)

DATABASE_KEEPALIVE_SECONDS = 240.0
MESSAGE_RETENTION_CLEANUP_SECONDS = 3600.0

_ACTIVITY_EXCLUDED_PREFIXES = (
    "/api/users/me/listening",
    "/api/users/me/app-state",
    "/api/users/me/playback-state",
    "/api/users/me/playback-devices",
    "/api/messages/push/",
    "/api/messages/admin-notifications/",
    "/api/messages/notifications/",
    "/api/messages/messages/",
    "/api/recommendations/autoplay",
    "/api/admin/tracks/upload/prepare",
    "/api/admin/tracks/upload/cancel",
    "/api/auth/refresh",
)

_ACTIVITY_EXCLUDED_PATHS = {
    "/api/auth/register",
}


def _activity_description(
    method: str,
    path: str,
) -> tuple[str, str] | None:
    if (
        method not in {
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
        }
        or (
            method == "POST"
            and path.startswith(
                "/api/messages/conversations/"
            )
        )
        or (
            method in {
                "POST",
                "DELETE",
            }
            and path.startswith(
                "/api/playlists/liked/tracks/"
            )
        )
        or (
            method in {
                "POST",
                "DELETE",
            }
            and path.startswith(
                "/api/playlists/"
            )
            and "/tracks" in path
        )
        or path in _ACTIVITY_EXCLUDED_PATHS
        or any(
            path.startswith(prefix)
            for prefix
            in _ACTIVITY_EXCLUDED_PREFIXES
        )
    ):
        return None

    if path.startswith(
        "/api/auth/",
    ):
        if path.endswith(
            "/login",
        ):
            return (
                "auth",
                "User signed in",
            )

        if "password-recovery" in path:
            return (
                "auth",
                "Password recovery activity",
            )

        return (
            "auth",
            "Account session activity",
        )

    if path.startswith(
        "/api/messages/",
    ):
        return (
            "message",
            "Message activity",
        )

    if path.startswith(
        "/api/playlists",
    ):
        return (
            "playlist",
            "Playlist or library activity",
        )

    if path.startswith(
        "/api/users/",
    ):
        return (
            "profile",
            "User profile or social activity",
        )

    if path.startswith(
        "/api/admin/",
    ):
        return (
            "admin",
            "Administrator action",
        )

    if path.startswith(
        "/api/bot/",
    ):
        return (
            "bot",
            "Bot control activity",
        )

    return (
        "activity",
        "HyperSync activity",
    )


def _request_actor_user_id(
    request: Request,
):
    authorization = (
        request.headers.get(
            "authorization",
            "",
        )
        .strip()
    )

    if not authorization.lower().startswith(
        "bearer ",
    ):
        return None

    token = authorization[7:].strip()

    if not token:
        return None

    try:
        return decode_access_token(
            token,
        ).user_id
    except InvalidAccessTokenError:
        return None



async def keep_database_warm() -> None:
    while True:
        await asyncio.sleep(
            DATABASE_KEEPALIVE_SECONDS,
        )

        try:
            await check_database()
        except Exception:
            # A temporary database/network failure
            # should not kill the FastAPI process.
            continue


async def run_message_retention_cleanup() -> None:
    while True:
        try:
            await cleanup_expired_messages()
        except Exception:
            # Retention cleanup must never take down the API.
            pass

        await asyncio.sleep(
            MESSAGE_RETENTION_CLEANUP_SECONDS,
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await ensure_demo_data()

    # Pay any database wake-up/connection cost
    # during backend startup instead of login.
    await check_database()

    keepalive_task = asyncio.create_task(
        keep_database_warm(),
    )

    retention_task = asyncio.create_task(
        run_message_retention_cleanup(),
    )

    try:
        yield
    finally:
        keepalive_task.cancel()
        retention_task.cancel()

        with suppress(
            asyncio.CancelledError,
        ):
            await keepalive_task

        with suppress(
            asyncio.CancelledError,
        ):
            await retention_task

        await close_database()


settings = get_settings()

app = FastAPI(
    title=f"{settings.app_name} API",
    version=settings.app_version,
    lifespan=lifespan,
    docs_url=(
        "/docs"
        if settings.api_docs_enabled
        else None
    ),
    redoc_url=None,
    openapi_url=(
        "/openapi.json"
        if settings.api_docs_enabled
        else None
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

@app.middleware("http")
async def admin_activity_notifications(
    request: Request,
    call_next,
):
    response = await call_next(
        request,
    )

    description = _activity_description(
        request.method.upper(),
        request.url.path,
    )

    if (
        description is not None
        and 200
        <= response.status_code
        < 400
    ):
        kind, title = description

        await record_admin_activity(
            kind=kind,
            title=title,
            body=(
                request.method.upper()
                + " "
                + request.url.path
            ),
            actor_user_id=(
                _request_actor_user_id(
                    request,
                )
            ),
        )

    return response



@app.middleware("http")
async def security_headers(
    request: Request,
    call_next,
):
    response = await call_next(
        request,
    )

    response.headers[
        "X-Content-Type-Options"
    ] = "nosniff"

    response.headers[
        "X-Frame-Options"
    ] = "DENY"

    response.headers[
        "Referrer-Policy"
    ] = "strict-origin-when-cross-origin"

    response.headers[
        "Permissions-Policy"
    ] = (
        "camera=(), microphone=(), "
        "geolocation=(), payment=()"
    )

    response.headers[
        "Content-Security-Policy"
    ] = (
        "frame-ancestors 'none'; "
        "base-uri 'none'"
    )

    if settings.environment == "production":
        response.headers[
            "Strict-Transport-Security"
        ] = (
            "max-age=31536000; "
            "includeSubDomains"
        )

    return response


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "application": settings.app_name,
        "status": "online",
        "documentation": (
            "/docs"
            if settings.api_docs_enabled
            else "disabled"
        ),
    }
