from fastapi import FastAPI

app = FastAPI(title="HyperSync API", version="0.1.0")


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "application": "HyperSync",
        "status": "online",
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "application": "HyperSync",
        "api": "healthy",
    }