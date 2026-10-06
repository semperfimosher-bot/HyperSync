import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import (
    asynccontextmanager,
    suppress,
)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError

from bot.runtime import (
    shutdown_background_tasks,
)
from bot.worker import (
    resume_catalog_scan_on_startup,
)

from .api.router import api_router
from .config import get_settings
from .database import (
    check_database,
    close_database,
)
from .middleware.overload import (
    DatabaseAdmissionMiddleware,
    database_pool_timeout_handler,
)
from .security.tokens import (
    InvalidAccessTokenError,
    decode_access_token,
)
from .services.admin_notifications import (
    record_admin_activity,
)
from .services.artists import (
    backfill_missing_artist_profiles,
)
from .services.media_identity import (
    backfill_missing_media_identities,
)
from .services.message_retention import (
    cleanup_expired_messages,
)
from .services.on_demand_ingestion import (
    reset_transient_state,
    resume_on_demand_ingests_on_startup,
)

logger = logging.getLogger(__name__)


DATABASE_KEEPALIVE_SECONDS = 240.0
DATABASE_STARTUP_ATTEMPTS = 6
DATABASE_STARTUP_MAX_DELAY_SECONDS = 10.0
MESSAGE_RETENTION_CLEANUP_SECONDS = 3600.0
MEDIA_IDENTITY_RETRY_SECONDS = 30.0

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
    "/api/on-demand/",
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

    if (
        path.startswith(
            "/api/admin/bot/",
        )
        or path.startswith(
            "/api/bot/",
        )
    ):
        return (
            "bot",
            "Bot control activity",
        )

    if path.startswith(
        "/api/admin/",
    ):
        return (
            "admin",
            "Administrator action",
        )

    return (
        "activity",
        "HyperSynced activity",
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



async def wait_for_database_ready() -> None:
    for attempt in range(
        1,
        DATABASE_STARTUP_ATTEMPTS + 1,
    ):
        try:
            await check_database()
            return
        except Exception:
            if (
                attempt
                >= DATABASE_STARTUP_ATTEMPTS
            ):
                raise

            await asyncio.sleep(
                min(
                    float(
                        2 ** (attempt - 1)
                    ),
                    DATABASE_STARTUP_MAX_DELAY_SECONDS,
                )
            )


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
            # Retention cleanup must never take down the API,
            # but silent failures make production drift hard
            # to diagnose.
            logger.exception(
                "Message retention cleanup failed.",
            )

        await asyncio.sleep(
            MESSAGE_RETENTION_CLEANUP_SECONDS,
        )


async def run_media_identity_backfill() -> None:
    while True:
        try:
            processed = (
                await backfill_missing_media_identities(
                    batch_size=250,
                )
            )
        except Exception:
            # Identity sidecars are an optimization and
            # compatibility layer. A temporary backfill
            # failure must not take down the API or disable
            # maintenance for the lifetime of this process.
            logger.exception(
                "Media identity backfill failed; retrying.",
            )

            await asyncio.sleep(
                MEDIA_IDENTITY_RETRY_SECONDS,
            )
            continue

        if processed == 0:
            try:
                artist_profiles_processed = (
                    await backfill_missing_artist_profiles(
                        batch_size=250,
                    )
                )
            except Exception:
                logger.exception(
                    "Artist profile backfill failed; retrying.",
                )

                await asyncio.sleep(
                    MEDIA_IDENTITY_RETRY_SECONDS,
                )
                continue

            if artist_profiles_processed == 0:
                return

        # Yield between batches so startup maintenance
        # never monopolizes the event loop.
        await asyncio.sleep(
            0,
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Pay any database wake-up/connection cost before any
    # startup routine touches the database. This keeps a
    # sleeping or temporarily unavailable database inside
    # the retry envelope instead of failing earlier in
    # ensure_demo_data().
    await wait_for_database_ready()

    bot_resume_task = (
        await resume_catalog_scan_on_startup()
    )

    resumed_on_demand_ingests = (
        await resume_on_demand_ingests_on_startup()
    )

    if resumed_on_demand_ingests:
        logger.info(
            "Resumed %s interrupted on-demand ingest(s).",
            resumed_on_demand_ingests,
        )

    keepalive_task = asyncio.create_task(
        keep_database_warm(),
    )

    retention_task = asyncio.create_task(
        run_message_retention_cleanup(),
    )

    media_identity_task = asyncio.create_task(
        run_media_identity_backfill(),
    )

    try:
        yield
    finally:
        keepalive_task.cancel()
        retention_task.cancel()

        if not media_identity_task.done():
            media_identity_task.cancel()

            with suppress(
                asyncio.CancelledError,
            ):
                await media_identity_task

        if (
            bot_resume_task is not None
            and not bot_resume_task.done()
        ):
            bot_resume_task.cancel()

            with suppress(
                asyncio.CancelledError,
            ):
                await bot_resume_task

        with suppress(
            asyncio.CancelledError,
        ):
            await keepalive_task

        with suppress(
            asyncio.CancelledError,
        ):
            await retention_task

        # Any route-started bot task must stop before the
        # database engine closes. Durable catalog scans remain
        # resumable and will be picked up on the next startup.
        await shutdown_background_tasks()

        # On-demand source resolution and ingest tasks keep
        # references to DB/B2 work of their own. Drain them
        # explicitly before the database engine disappears.
        await reset_transient_state()

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
    DatabaseAdmissionMiddleware,
    max_concurrent_requests=(
        settings.api_max_concurrent_requests
    ),
    admission_timeout_seconds=(
        settings.api_admission_timeout_seconds
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(
    SQLAlchemyTimeoutError,
    database_pool_timeout_handler,
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

        try:
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
        except Exception:
            # Activity notifications are observability.
            # They must never turn an already-successful
            # core request into a user-visible failure.
            logger.exception(
                "Unable to record admin activity for %s %s",
                request.method.upper(),
                request.url.path,
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
