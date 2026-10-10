from __future__ import annotations

from collections.abc import AsyncIterator
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
    record_provision_play,
    refresh_source,
    search_and_remember,
    source_headers,
    stream_token_matches,
    warm_candidate_keys,
)
from ..dependencies import (
    CurrentUser,
)

router = APIRouter(
    prefix="/on-demand",
    tags=["on-demand"],
)

ON_DEMAND_SEARCH_RESULT_LIMIT = 20
ON_DEMAND_ARTIST_RESULT_LIMIT = 100


class PrepareOnDemandRequest(
    BaseModel,
):
    candidate_key: str = Field(
        min_length=1,
        max_length=160,
    )


class WarmOnDemandRequest(
    BaseModel,
):
    candidate_keys: list[str] = Field(
        min_length=1,
        max_length=500,
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
    limit: int = Query(
        default=ON_DEMAND_SEARCH_RESULT_LIMIT,
        ge=1,
        le=ON_DEMAND_SEARCH_RESULT_LIMIT,
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


@router.get("/artist")
async def search_on_demand_artist(
    request: Request,
    user: CurrentUser,
    name: str = Query(
        min_length=2,
        max_length=180,
    ),
    limit: int = Query(
        default=ON_DEMAND_ARTIST_RESULT_LIMIT,
        ge=1,
        le=ON_DEMAND_ARTIST_RESULT_LIMIT,
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
            name,
            limit=limit,
            kind="artist",
            prewarm=False,
        )
    )

    return {
        "artist":
            name.strip(),
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


@router.post("/warm")
async def warm_on_demand(
    payload: WarmOnDemandRequest,
    request: Request,
    user: CurrentUser,
):
    _require_registered(
        user,
    )

    settings = get_settings()

    await enforce_rate_limit(
        request,
        scope="on-demand-warm",
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

    sessions = await warm_candidate_keys(
        payload.candidate_keys,
    )

    return {
        "warmed":
            len(sessions),
        "sessions":
            sessions,
    }


@router.post("/queue")
async def queue_on_demand(
    payload: PrepareOnDemandRequest,
    request: Request,
    user: CurrentUser,
):
    """
    Queueing is an explicit commitment to play this recording soon.

    Unlike ordinary search/prewarm preparation, this resolves the
    temporary stream and starts publication immediately so the next
    track has both a ready stream and a B2/catalog ingest already
    running before the current song ends.
    """
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
            start_ingest=True,
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
                "Unable to prepare this queued recording "
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
                or "Unable to prepare this queued recording."
            ),
        )

    return result


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


@router.post(
    "/{provision_id}/played",
)
async def mark_on_demand_played(
    provision_id: UUID,
    user: CurrentUser,
):
    _require_registered(
        user,
    )

    result = await record_provision_play(
        provision_id,
        user.id,
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
    token: str = Query(
        min_length=24,
        max_length=128,
    ),
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

    if not stream_token_matches(
        session,
        token,
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_403_FORBIDDEN
            ),
            detail=(
                "Temporary playback token is invalid."
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

    range_header = (
        request.headers.get(
            "range",
        )
    )

    upstream = None
    client = None

    # Temporary Googlevideo URLs can expire or be rejected between
    # preparation and browser playback. Re-resolve once before returning
    # a gateway error, while keeping invalid HyperSync tokens non-retriable.
    for attempt in range(2):
        headers = source_headers(
            source,
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
        except httpx.HTTPError as exc:
            await client.aclose()
            client = None

            if attempt == 0:
                try:
                    source = await refresh_source(
                        session,
                    )
                except Exception:
                    source = None

                if source is not None:
                    continue

            raise HTTPException(
                status_code=(
                    status.HTTP_502_BAD_GATEWAY
                ),
                detail=(
                    "Unable to open the temporary "
                    "audio stream."
                ),
            ) from exc

        if upstream.status_code in {
            200,
            206,
        }:
            break

        retryable_upstream = (
            upstream.status_code in {
                403,
                404,
                410,
                429,
            }
            or upstream.status_code >= 500
        )

        await upstream.aclose()
        await client.aclose()
        upstream = None
        client = None

        if attempt == 0 and retryable_upstream:
            try:
                source = await refresh_source(
                    session,
                )
            except Exception:
                source = None

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

            if source is not None:
                continue

        raise HTTPException(
            status_code=(
                status.HTTP_502_BAD_GATEWAY
            ),
            detail=(
                "Temporary audio source "
                "is unavailable."
            ),
        )

    if upstream is None or client is None:
        raise HTTPException(
            status_code=(
                status.HTTP_502_BAD_GATEWAY
            ),
            detail=(
                "Temporary audio source "
                "is unavailable."
            ),
        )

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

