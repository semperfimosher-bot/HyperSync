import asyncio

from fastapi import APIRouter

from bot.service import (
    get_state,
    queue_job,
    start_bot,
    stop_bot,
)
from bot.worker import (
    run_process,
    run_scan,
)

from ..dependencies import AdminUser

router = APIRouter(
    prefix="/admin/bot",
    tags=["admin-bot"],
)


@router.get("/status")
async def bot_status(
    user: AdminUser,
):
    state = get_state()

    return {
        "running": state.running,
        "status": state.status,
        "current_job": state.current_job,
        "queued_jobs": state.queued_jobs,
        "completed_jobs": state.completed_jobs,
        "failed_jobs": state.failed_jobs,
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
):
    queue_job()

    asyncio.create_task(
        run_scan(),
    )

    return {
        "accepted": True,
        "message": "Catalog scan queued.",
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
