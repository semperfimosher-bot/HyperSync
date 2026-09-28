import asyncio

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    status,
)
from pydantic import (
    BaseModel,
    Field,
)

from bot.service import (
    get_state,
    queue_job,
    start_bot,
    stop_bot,
)
from bot.worker import (
    cancel_scan,
    run_process,
    run_scan,
    scan_running,
)

from ...services.bot_catalog_jobs import (
    catalog_scan_is_active,
    create_catalog_scan,
    request_scan_cancel,
    scan_snapshot,
)
from ...services.on_demand_ingestion import (
    active_provisions,
    prepare_candidate,
    search_and_remember,
)
from ..dependencies import AdminUser


class AdminBotIngestRequest(
    BaseModel,
):
    candidate_key: str = Field(
        min_length=1,
        max_length=160,
    )

class AdminBotScanRequest(
    BaseModel,
):
    auto_ingest: bool = False
    track_limit_per_artist: int = Field(
        default=500,
        ge=1,
        le=500,
    )
    ingest_concurrency: int = Field(
        default=2,
        ge=1,
        le=4,
    )

router = APIRouter(
    prefix="/admin/bot",
    tags=["admin-bot"],
)


@router.get("/status")
async def bot_status(
    user: AdminUser,
):
    state = get_state()

    persisted_scan = (
        await scan_snapshot()
    )

    return {
        "running": state.running,
        "status": state.status,
        "current_job": state.current_job,
        "queued_jobs": state.queued_jobs,
        "completed_jobs": state.completed_jobs,
        "failed_jobs": state.failed_jobs,
        "catalog_scan": (
            persisted_scan
            or state.catalog_scan
        ),
        "provisions":
            await active_provisions(),
        "events": [
            {
                "id": event.id,
                "timestamp": event.timestamp.isoformat(),
                "level": event.level,
                "message": event.message,
            }
            for event in state.events
        ],
    }


@router.post("/start")
async def bot_start(
    user: AdminUser,
):
    return start_bot()


@router.post("/stop")
async def bot_stop(
    user: AdminUser,
):
    return stop_bot()


@router.post("/scan")
async def bot_scan(
    user: AdminUser,
    payload: AdminBotScanRequest | None = None,
):
    request = (
        payload
        or AdminBotScanRequest()
    )

    if (
        scan_running()
        or await catalog_scan_is_active()
    ):
        raise HTTPException(
            status_code=(
                status.HTTP_409_CONFLICT
            ),
            detail=(
                "A catalog gap scan is already running."
            ),
        )

    scan = await create_catalog_scan(
        auto_ingest=(
            request.auto_ingest
        ),
        track_limit_per_artist=(
            request.track_limit_per_artist
        ),
        ingest_concurrency=(
            request.ingest_concurrency
        ),
    )

    queue_job()

    asyncio.create_task(
        run_scan(
            auto_ingest=(
                request.auto_ingest
            ),
            track_limit_per_artist=(
                request.track_limit_per_artist
            ),
            ingest_concurrency=(
                request.ingest_concurrency
            ),
            scan_id=scan.id,
        )
    )

    return {
        "accepted": True,
        "auto_ingest":
            request.auto_ingest,
        "scan_id":
            str(
                scan.id,
            ),
        "message": (
            "Catalog gap scan queued with auto-ingest."
            if request.auto_ingest
            else "Catalog gap discovery scan queued."
        ),
    }


@router.post("/scan/cancel")
async def bot_scan_cancel(
    user: AdminUser,
):
    del user

    memory_accepted = cancel_scan()

    durable_accepted = (
        await request_scan_cancel()
    )

    accepted = (
        memory_accepted
        or durable_accepted
    )

    return {
        "accepted": accepted,
        "message": (
            "Catalog gap scan cancellation requested."
            if accepted
            else "No catalog gap scan is running."
        ),
    }


@router.post("/process")
async def bot_process(
    user: AdminUser,
):
    queue_job()

    asyncio.create_task(
        run_process(),
    )

    return {
        "accepted": True,
        "message": "Processing job queued.",
    }



@router.get(
    "/music-search",
)
async def bot_music_search(
    user: AdminUser,
    q: str = Query(
        min_length=2,
        max_length=180,
    ),
    kind: str = Query(
        default="song",
        pattern="^(song|album|artist)$",
    ),
):
    candidates = (
        await search_and_remember(
            q,
            limit=15,
            kind=kind,
        )
    )

    return {
        "query":
            q.strip(),
        "kind":
            kind,
        "tracks": [
            {
                **candidate.as_dict(),
                "provision_key":
                    candidate.key,
            }
            for candidate
            in candidates
        ],
    }


@router.post(
    "/ingest",
)
async def bot_ingest(
    payload: AdminBotIngestRequest,
    user: AdminUser,
):
    try:
        return await prepare_candidate(
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
                "Unable to start bot ingest: "
                f"{str(exc)[:240]}"
            ),
        ) from exc
