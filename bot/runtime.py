from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from typing import Any

logger = logging.getLogger(__name__)

_tasks: set[
    asyncio.Task[Any]
] = set()


def _task_done(
    task: asyncio.Task[Any],
) -> None:
    _tasks.discard(
        task,
    )

    if task.cancelled():
        return

    try:
        error = task.exception()
    except asyncio.CancelledError:
        return

    if error is not None:
        logger.exception(
            "Background task failed: %s",
            task.get_name(),
            exc_info=(
                type(error),
                error,
                error.__traceback__,
            ),
        )


def spawn_background_task(
    awaitable: Awaitable[Any],
    *,
    name: str,
) -> asyncio.Task[Any]:
    task = asyncio.create_task(
        awaitable,
        name=name,
    )

    _tasks.add(
        task,
    )

    task.add_done_callback(
        _task_done,
    )

    return task


def active_background_tasks() -> tuple[
    asyncio.Task[Any],
    ...,
]:
    return tuple(
        task
        for task in _tasks
        if not task.done()
    )


async def shutdown_background_tasks() -> None:
    tasks = list(
        active_background_tasks()
    )

    if not tasks:
        return

    for task in tasks:
        task.cancel()

    await asyncio.gather(
        *tasks,
        return_exceptions=True,
    )
