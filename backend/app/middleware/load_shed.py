from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError

logger = logging.getLogger(__name__)


def install_load_shedding_middleware(
    app: FastAPI,
    *,
    max_concurrent_requests: int,
    acquire_timeout_seconds: float,
    retry_after_seconds: int,
) -> None:
    """Bound in-flight API work and turn DB saturation into 503s.

    This is deliberately process-local. The database pool remains the hard
    connection limit; this middleware prevents an individual API process from
    accumulating an unbounded number of requests waiting behind that pool.
    """

    limit = max(1, int(max_concurrent_requests))
    acquire_timeout = max(0.05, float(acquire_timeout_seconds))
    retry_after = max(1, int(retry_after_seconds))
    app.state.request_admission = asyncio.Semaphore(limit)

    @app.middleware("http")
    async def load_shedding(
        request: Request,
        call_next,
    ):
        semaphore = request.app.state.request_admission

        try:
            await asyncio.wait_for(
                semaphore.acquire(),
                timeout=acquire_timeout,
            )
        except TimeoutError:
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Server is busy. Try again shortly."
                },
                headers={
                    "Retry-After": str(retry_after),
                },
            )

        try:
            return await call_next(request)
        except SQLAlchemyTimeoutError:
            logger.warning(
                "Database pool saturated while handling %s %s",
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Database is busy. Try again shortly."
                },
                headers={
                    "Retry-After": str(retry_after),
                },
            )
        except OperationalError as exc:
            if not getattr(exc, "connection_invalidated", False):
                raise

            logger.warning(
                "Database connection became unavailable while handling %s %s",
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Database is temporarily unavailable. Try again shortly."
                },
                headers={
                    "Retry-After": str(retry_after),
                },
            )
        except DBAPIError as exc:
            if not getattr(exc, "connection_invalidated", False):
                raise

            logger.warning(
                "Database connection failed while handling %s %s",
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Database is temporarily unavailable. Try again shortly."
                },
                headers={
                    "Retry-After": str(retry_after),
                },
            )
        finally:
            semaphore.release()
