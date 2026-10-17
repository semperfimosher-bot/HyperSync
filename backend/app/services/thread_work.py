"""Keep owned files and admission permits alive until blocking work settles."""

import asyncio


async def run_blocking(function, /, *args, **kwargs):
    task = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        # A cancelled coroutine cannot stop a running thread. Repeated shutdown
        # cancellation must not release the caller's files while it still runs.
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except BaseException:
                break
        if not task.cancelled():
            task.exception()  # retrieve a worker failure; preserve cancellation
        raise


async def run_blocking_resource(function, cleanup, /, *args, **kwargs):
    """Also close an acquired resource if cancellation prevents its delivery."""
    acquired = []
    def create():
        value = function(*args, **kwargs)
        acquired.append(value)
        return value
    try:
        return await run_blocking(create)
    except BaseException:
        if acquired:
            try:
                await run_blocking(cleanup, acquired[0])
            except Exception:
                pass  # Preserve the original cancellation or operation failure.
        raise
