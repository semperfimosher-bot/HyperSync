from __future__ import annotations

import asyncio

import bot.service


async def run_scan() -> None:
    bot.service.job_started("catalog-scan")

    try:
        # Real catalog/B2 scan will go here.
        await asyncio.sleep(1)

        bot.service.job_completed(
            "Catalog scan completed.",
        )

    except Exception as exc:
        bot.service.job_failed(
            f"Catalog scan failed: {exc}",
        )


async def run_process() -> None:
    bot.service.job_started("process-queue")

    try:
        # Real processing pipeline will go here.
        await asyncio.sleep(1)

        bot.service.job_completed(
            "Processing queue completed.",
        )

    except Exception as exc:
        bot.service.job_failed(
            f"Processing failed: {exc}",
        )
