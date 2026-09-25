from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Sequence
from typing import TypedDict

from pywebpush import (
    WebPushException,
    webpush,
)
from sqlalchemy import delete

from ..config import get_settings
from ..database import get_session_factory
from ..models.messaging import PushSubscription


logger = logging.getLogger(
    __name__,
)


class PushSubscriptionData(
    TypedDict,
):
    endpoint: str
    p256dh: str
    auth: str


def web_push_enabled() -> bool:
    settings = get_settings()

    return bool(
        settings.web_push_vapid_public_key
        and settings.web_push_vapid_private_key
        and settings.web_push_vapid_subject
    )


def _send_one(
    subscription: PushSubscriptionData,
    sender_username: str,
) -> bool:
    settings = get_settings()

    try:
        webpush(
            subscription_info={
                "endpoint":
                    subscription[
                        "endpoint"
                    ],
                "keys": {
                    "p256dh":
                        subscription[
                            "p256dh"
                        ],
                    "auth":
                        subscription[
                            "auth"
                        ],
                },
            },
            data=json.dumps(
                {
                    "type":
                        "message",
                    "title":
                        "New HyperSync message",
                    "body":
                        (
                            "New message from @"
                            + sender_username
                        ),
                    "username":
                        sender_username,
                    "url":
                        "/?view=messages&user="
                        + sender_username,
                }
            ),
            vapid_private_key=(
                settings
                .web_push_vapid_private_key
            ),
            vapid_claims={
                "sub":
                    settings
                    .web_push_vapid_subject,
            },
            timeout=5,
        )

        return False

    except WebPushException as exc:
        if exc.status_code in (
            404,
            410,
        ):
            return True

        logger.warning(
            "Web push failed with status %s.",
            exc.status_code,
        )

        return False

    except Exception:
        logger.exception(
            "Unexpected web push delivery failure.",
        )

        return False


async def deliver_message_push(
    subscriptions: Sequence[
        PushSubscriptionData
    ],
    sender_username: str,
) -> None:
    if (
        not subscriptions
        or not web_push_enabled()
    ):
        return

    results = await asyncio.gather(
        *[
            asyncio.to_thread(
                _send_one,
                subscription,
                sender_username,
            )
            for subscription
            in subscriptions
        ],
        return_exceptions=True,
    )

    stale_endpoints = [
        subscription["endpoint"]
        for subscription, result
        in zip(
            subscriptions,
            results,
            strict=True,
        )
        if result is True
    ]

    if not stale_endpoints:
        return

    session_factory =
        get_session_factory()

    async with session_factory() as session:
        await session.execute(
            delete(
                PushSubscription,
            ).where(
                PushSubscription.endpoint.in_(
                    stale_endpoints,
                )
            )
        )

        await session.commit()
