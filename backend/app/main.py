import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="HyperSync API",
    version="0.1.0",
)

frontend_origin = os.getenv(
    "FRONTEND_ORIGIN",
    "http://localhost:5173",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        frontend_origin,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "application": "HyperSync",
        "status": "online",
        "documentation": "/docs",
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "application": "HyperSync",
        "api": "healthy",
        "version": "0.1.0",
    }