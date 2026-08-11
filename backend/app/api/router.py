from fastapi import APIRouter

from .routes import admin, auth, health, users

api_router = APIRouter()


api_router.include_router(
    health.router,
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
