from __future__ import annotations

from typing import AsyncIterator
from uuid import UUID

import httpx
from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import (
    RedirectResponse,
    StreamingResponse,
)
from pydantic import (
    BaseModel,
    Field,
)

from ...config import get_settings
from ...models.account import (
    AccountType,
)
from ...security.rate_limit import (
    enforce_rate_limit,
)
from ...services.on_demand_ingestion import (
    get_provision_session,
    prepare_candidate,
    provision_status,
    search_and_remember,
    source_headers,
)
from ..dependencies import (
    CurrentUser,
)

router = APIRouter(
    prefix="/on-demand",
    tags=["on-demand"],
)


class PrepareOnDemandRequest(
    BaseModel,
):
    candidate_key: str = Field(
        min_length=1,
        max_length=160,
    )


def _require_registered(
    user,
) -> None:
    if (
        user.account_type
        != AccountType.REGISTERED
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_403_FORBIDDEN
            ),
            detail=(
                "A registered account is required "
                "for on-demand music."
            ),
        )


@router.get("/search")
async def search_on_demand(
    request: Request,
    user: CurrentUser,
    q: str = Query(
        min_length=2,
        max_length=180,
    ),
    limit: int | None = Query(
        default=None,
        ge=1,
        le=15,
    ),
):
    _require_registered(
        user,
    )

    settings = get_settings()

    await enforce_rate_limit(
        request,
        scope="on-demand-search",
        identity=str(
            user.id,
        ),
        include_client=False,
        limit=(
            settings
            .on_demand_search_rate_limit
        ),
        window_seconds=(
            settings
            .on_demand_rate_window_seconds
        ),
    )

    candidates = (
        await search_and_remember(
            q,
            limit=limit,
        )
    )

    return {
        "query":
            q.strip(),
        "tracks": [
            {
                **candidate.as_dict(),
                "source_type":
                    "on_demand",
                "provision_key":
                    candidate.key,
                "match_label":
                    "AVAILABLE ON DEMAND",
                "matched_field":
                    "external",
                "user_play_count":
                    0,
                "global_play_count":
                    0,
            }
            for candidate
            in candidates
        ],
    }


@router.post("/prepare")
async def prepare_on_demand(
    payload: PrepareOnDemandRequest,
    request: Request,
    user: CurrentUser,
):
    _require_registered(
        user,
    )

    settings = get_settings()

    await enforce_rate_limit(
        request,
        scope="on-demand-prepare",
        identity=str(
            user.id,
        ),
        include_client=False,
        limit=(
            settings
            .on_demand_prepare_rate_limit
        ),
        window_seconds=(
            settings
            .on_demand_rate_window_seconds
        ),
    )

    try:
        result = await prepare_candidate(
            payload.candidate_key,
        )

    except KeyError as exc:
        raise HTTPException(
            status_code=(
                status.HTTP_410_GONE
            ),
            detail=str(
                exc,
            ),
        ) from exc

    except Exception as exc:
        raise HTTPException(
            status_code=(
                status.HTTP_503_SERVICE_UNAVAILABLE
            ),
            detail=(
                "Unable to prepare this recording "
                f"right now: {str(exc)[:240]}"
            ),
        ) from exc

    if (
        result.get(
            "state",
        )
        == "failed"
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_502_BAD_GATEWAY
            ),
            detail=(
                result.get(
                    "error",
                )
                or "Unable to prepare this recording."
            ),
        )

    return result


@router.get(
    "/{provision_id}/status",
)
async def get_on_demand_status(
    provision_id: UUID,
    user: CurrentUser,
):
    _require_registered(
        user,
    )

    result = await provision_status(
        provision_id,
    )

    if result is None:
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "Provisioning session not found."
            ),
        )

    return result


@router.get(
    "/{provision_id}/stream",
)
async def stream_on_demand(
    provision_id: UUID,
    request: Request,
):
    session = (
        await get_provision_session(
            provision_id,
        )
    )

    if session is None:
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "Temporary playback session expired."
            ),
        )

    if session.track_id is not None:
        return RedirectResponse(
            url=(
                "/api/audio/"
                + str(
                    session.track_id,
                )
            ),
            status_code=307,
        )

    source = session.source

    if source is None:
        raise HTTPException(
            status_code=(
                status.HTTP_425_TOO_EARLY
            ),
            detail=(
                "Audio source is still preparing."
            ),
            headers={
                "Retry-After":
                    "1",
            },
        )

    headers = source_headers(
        source,
    )

    range_header = (
        request.headers.get(
            "range",
        )
    )

    if range_header:
        headers[
            "Range"
        ] = range_header

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=8.0,
            read=None,
            write=8.0,
            pool=8.0,
        ),
        follow_redirects=True,
    )

    try:
        upstream_request = (
            client.build_request(
                "GET",
                source.direct_url,
                headers=headers,
            )
        )

        upstream = await client.send(
            upstream_request,
            stream=True,
        )

        if (
            upstream.status_code
            not in {
                200,
                206,
            }
        ):
            await upstream.aclose()

            await client.aclose()

            raise HTTPException(
                status_code=(
                    status.HTTP_502_BAD_GATEWAY
                ),
                detail=(
                    "Temporary audio source "
                    "is unavailable."
                ),
            )

    except HTTPException:
        raise

    except httpx.HTTPError as exc:
        await client.aclose()

        raise HTTPException(
            status_code=(
                status.HTTP_502_BAD_GATEWAY
            ),
            detail=(
                "Unable to open the temporary "
                "audio stream."
            ),
        ) from exc

    async def body() -> AsyncIterator[
        bytes
    ]:
        try:
            async for chunk in (
                upstream.aiter_bytes()
            ):
                yield chunk

        finally:
            await upstream.aclose()

            await client.aclose()

    response_headers: dict[
        str,
        str,
    ] = {
        "Cache-Control":
            "private, no-store",
        "Accept-Ranges":
            upstream.headers.get(
                "accept-ranges",
                "bytes",
            ),
    }

    for header_name in (
        "content-length",
        "content-range",
        "etag",
        "last-modified",
    ):
        value = upstream.headers.get(
            header_name,
        )

        if value:
            response_headers[
                "-".join(
                    part.capitalize()
                    for part in header_name
                    .split(
                        "-",
                    )
                )
            ] = value

    media_type = (
        upstream.headers.get(
            "content-type",
        )
        or source.mime_type
        or "audio/webm"
    )

    return StreamingResponse(
        body(),
        status_code=(
            upstream.status_code
        ),
        media_type=media_type,
        headers=response_headers,
    )
