from fastapi import APIRouter

from .routes import (
    admin,
    audio,
    auth,
    bot,
    catalog,
    health,
    media,
    messages,
    playlists,
    recommendations,
    search,
    system,
    users,
)

api_router = APIRouter()


api_router.include_router(
    health.router,
)


api_router.include_router(
    system.router,
    prefix="/api",
)


api_router.include_router(
    auth.router,
    prefix="/api",
)


api_router.include_router(
    users.router,
    prefix="/api",
)


api_router.include_router(
    admin.router,
    prefix="/api",
)

api_router.include_router(
    catalog.router,
    prefix="/api",
)

api_router.include_router(
    media.router,
    prefix="/api",
)

api_router.include_router(
    messages.router,
    prefix="/api",
)

api_router.include_router(
    recommendations.router,
    prefix="/api",
)

api_router.include_router(
    search.router,
    prefix="/api",
)

api_router.include_router(
    audio.router,
    prefix="/api",
)

api_router.include_router(
    bot.router,
    prefix="/api",
)

api_router.include_router(
    playlists.router,
    prefix="/api",
)
