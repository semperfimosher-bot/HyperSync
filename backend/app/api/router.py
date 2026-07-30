from fastapi import APIRouter

from .routes import health

api_router = APIRouter()
api_router.include_router(health.router)
