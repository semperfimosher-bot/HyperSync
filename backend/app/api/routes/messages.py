from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    HTTPException,
    Request,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import (
    and_,
    delete,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.orm import selectinload

from ...config import get_settings
from ...models.account import (
    AccountType,
    User,
)
from ...models.messaging import (
    Message,
    PushSubscription,
)
from ...security.rate_limit import enforce_rate_limit
from ...services.message_retention import (
    MESSAGE_RETENTION_AFTER_VIEW,
    delete_expired_messages,
)
from ...services.web_push import (
    PushSubscriptionData,
    deliver_message_push,
    web_push_enabled,
)
from ..dependencies import (
    CurrentUser,
    DatabaseSession,
)


router = APIRouter(
    prefix="/messages",
    tags=["messages"],
)

class MessageCreateRequest(BaseModel):
    body: str = Field(
        min_length=1,
        max_length=2000,
    )


class MessageResponse(BaseModel):
    id: UUID
    sender_username: str
    recipient_username: str
    body: str
    created_at: datetime
    viewed_at: datetime | None
    expires_at: datetime | None
    mine: bool


class MessageUserResponse(BaseModel):
    username: str
    display_name: str
    avatar_url: str | None = None


class ConversationSummary(BaseModel):
    username: str
    display_name: str
    avatar_url: str | None = None
    latest_body: str
    latest_at: datetime
    unread_count: int


class ConversationListResponse(BaseModel):
    conversations: list[ConversationSummary]
    unread_count: int


class ConversationResponse(BaseModel):
    participant: MessageUserResponse
    messages: list[MessageResponse]


class MessageNotification(BaseModel):
    message_id: UUID
    sender_username: str
    sender_display_name: str
    sender_avatar_url: str | None = None
    preview: str
    created_at: datetime


class NotificationResponse(BaseModel):
    unread_count: int
    notifications: list[MessageNotification]


class PushKeys(BaseModel):
    p256dh: str = Field(
        min_length=1,
        max_length=1024,
    )
    auth: str = Field(
        min_length=1,
        max_length=1024,
    )


class PushSubscriptionRequest(BaseModel):
    endpoint: str = Field(
        min_length=1,
        max_length=4096,
    )
    keys: PushKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(
        min_length=1,
        max_length=4096,
    )


class PushConfigResponse(BaseModel):
    enabled: bool
    public_key: str | None = None


def _avatar_url(
    user: User,
) -> str | None:
    if (
        user.profile is None
        or not user.profile.avatar_object_key
    ):
        return None

    return (
        "/api/users/"
        + str(user.username)
        + "/avatar"
    )


def _message_user(
    user: User,
) -> MessageUserResponse:
    return MessageUserResponse(
        username=user.username or "",
        display_name=(
            user.profile.display_name
            if user.profile
            else user.username or "User"
        ),
        avatar_url=_avatar_url(user),
    )


def _message_response(
    message: Message,
    viewer: User,
    sender: User,
    recipient: User,
) -> MessageResponse:
    expires_at = (
        message.viewed_at
        + MESSAGE_RETENTION_AFTER_VIEW
        if message.viewed_at
        else None
    )

    return MessageResponse(
        id=message.id,
        sender_username=sender.username or "",
        recipient_username=recipient.username or "",
        body=message.body,
        created_at=message.created_at,
        viewed_at=message.viewed_at,
        expires_at=expires_at,
        mine=message.sender_id == viewer.id,
    )


async def _cleanup_expired(
    session: DatabaseSession,
) -> None:
    await delete_expired_messages(
        session,
    )


async def _get_message_user(
    session: DatabaseSession,
    username: str,
) -> User:
    normalized = username.strip().lower()

    result = await session.execute(
        select(User)
        .options(
            selectinload(User.profile),
        )
        .where(
            User.username_normalized == normalized,
            User.account_type == AccountType.REGISTERED,
            User.is_active.is_(True),
        )
    )

    target = result.scalar_one_or_none()

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    return target


async def _load_users(
    session: DatabaseSession,
    user_ids: set[UUID],
) -> dict[UUID, User]:
    if not user_ids:
        return {}

    result = await session.execute(
        select(User)
        .options(
            selectinload(User.profile),
        )
        .where(
            User.id.in_(user_ids),
        )
    )

    return {
        user.id: user
        for user in result.scalars().all()
    }


@router.get(
    "/conversations",
    response_model=ConversationListResponse,
)
async def list_conversations(
    user: CurrentUser,
    session: DatabaseSession,
) -> ConversationListResponse:
    await _cleanup_expired(session)

    result = await session.execute(
        select(Message)
        .where(
            or_(
                Message.sender_id == user.id,
                Message.recipient_id == user.id,
            )
        )
        .order_by(
            Message.created_at.desc(),
        )
        .limit(500)
    )

    messages = result.scalars().all()

    latest_by_user: dict[UUID, Message] = {}
    other_ids: set[UUID] = set()

    for message in messages:
        other_id = (
            message.recipient_id
            if message.sender_id == user.id
            else message.sender_id
        )

        other_ids.add(other_id)
        latest_by_user.setdefault(
            other_id,
            message,
        )

    unread_result = await session.execute(
        select(
            Message.sender_id,
            func.count(Message.id),
        )
        .where(
            Message.recipient_id == user.id,
            Message.viewed_at.is_(None),
        )
        .group_by(
            Message.sender_id,
        )
    )

    unread_by_user = {
        sender_id: int(count)
        for sender_id, count
        in unread_result.all()
    }

    users = await _load_users(
        session,
        other_ids,
    )

    conversations: list[ConversationSummary] = []

    for other_id, message in latest_by_user.items():
        other = users.get(other_id)

        if other is None:
            continue

        summary = _message_user(other)

        conversations.append(
            ConversationSummary(
                username=summary.username,
                display_name=summary.display_name,
                avatar_url=summary.avatar_url,
                latest_body=message.body,
                latest_at=message.created_at,
                unread_count=unread_by_user.get(
                    other_id,
                    0,
                ),
            )
        )

    await session.commit()

    return ConversationListResponse(
        conversations=conversations,
        unread_count=sum(
            unread_by_user.values()
        ),
    )


@router.get(
    "/conversations/{username}",
    response_model=ConversationResponse,
)
async def get_conversation(
    username: str,
    user: CurrentUser,
    session: DatabaseSession,
) -> ConversationResponse:
    await _cleanup_expired(session)

    target = await _get_message_user(
        session,
        username,
    )

    if target.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot message yourself.",
        )

    viewed_at = datetime.now(UTC)

    await session.execute(
        update(Message)
        .where(
            Message.sender_id == target.id,
            Message.recipient_id == user.id,
            Message.viewed_at.is_(None),
        )
        .values(
            viewed_at=viewed_at,
        )
    )

    result = await session.execute(
        select(Message)
        .where(
            or_(
                and_(
                    Message.sender_id == user.id,
                    Message.recipient_id == target.id,
                ),
                and_(
                    Message.sender_id == target.id,
                    Message.recipient_id == user.id,
                ),
            )
        )
        .order_by(
            Message.created_at.desc(),
        )
        .limit(500)
    )

    messages = list(
        reversed(
            result.scalars().all()
        )
    )

    await session.commit()

    return ConversationResponse(
        participant=_message_user(target),
        messages=[
            _message_response(
                message,
                user,
                (
                    user
                    if message.sender_id == user.id
                    else target
                ),
                (
                    target
                    if message.recipient_id == target.id
                    else user
                ),
            )
            for message in messages
        ],
    )


@router.post(
    "/conversations/{username}",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    username: str,
    payload: MessageCreateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: CurrentUser,
    session: DatabaseSession,
) -> MessageResponse:
    settings = get_settings()

    enforce_rate_limit(
        request,
        scope="message-send",
        identity=str(user.id),
        limit=settings.message_send_rate_limit,
        window_seconds=(
            settings.message_send_rate_window_seconds
        ),
    )

    await _cleanup_expired(session)

    target = await _get_message_user(
        session,
        username,
    )

    if target.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot message yourself.",
        )

    body = payload.body.strip()

    if not body:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty.",
        )

    message = Message(
        sender_id=user.id,
        recipient_id=target.id,
        body=body,
    )

    session.add(message)
    await session.flush()

    subscription_result = await session.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == target.id,
        )
    )

    subscriptions: list[PushSubscriptionData] = [
        {
            "endpoint": subscription.endpoint,
            "p256dh": subscription.p256dh,
            "auth": subscription.auth,
        }
        for subscription
        in subscription_result.scalars().all()
    ]

    await session.commit()

    if subscriptions:
        background_tasks.add_task(
            deliver_message_push,
            subscriptions,
            user.username
            or "HyperSync user",
        )

    return _message_response(
        message,
        user,
        user,
        target,
    )


@router.get(
    "/notifications",
    response_model=NotificationResponse,
)
async def message_notifications(
    user: CurrentUser,
    session: DatabaseSession,
) -> NotificationResponse:
    await _cleanup_expired(session)

    result = await session.execute(
        select(Message)
        .where(
            Message.recipient_id == user.id,
            Message.viewed_at.is_(None),
        )
        .order_by(
            Message.created_at.desc(),
        )
        .limit(20)
    )

    unread = result.scalars().all()

    sender_ids = {
        message.sender_id
        for message in unread
    }

    users = await _load_users(
        session,
        sender_ids,
    )

    count_result = await session.execute(
        select(
            func.count(Message.id),
        ).where(
            Message.recipient_id == user.id,
            Message.viewed_at.is_(None),
        )
    )

    total = int(
        count_result.scalar_one()
        or 0
    )

    await session.commit()

    notifications: list[MessageNotification] = []

    for message in unread:
        sender = users.get(
            message.sender_id,
        )

        if sender is None:
            continue

        summary = _message_user(sender)

        notifications.append(
            MessageNotification(
                message_id=message.id,
                sender_username=summary.username,
                sender_display_name=(
                    summary.display_name
                ),
                sender_avatar_url=(
                    summary.avatar_url
                ),
                preview=message.body[:120],
                created_at=message.created_at,
            )
        )

    return NotificationResponse(
        unread_count=total,
        notifications=notifications,
    )


@router.get(
    "/push/config",
    response_model=PushConfigResponse,
)
async def push_config(
    user: CurrentUser,
) -> PushConfigResponse:
    del user

    settings = get_settings()
    enabled = web_push_enabled()

    return PushConfigResponse(
        enabled=enabled,
        public_key=(
            settings.web_push_vapid_public_key
            if enabled
            else None
        ),
    )


@router.post(
    "/push/subscriptions",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def subscribe_push(
    payload: PushSubscriptionRequest,
    request: Request,
    user: CurrentUser,
    session: DatabaseSession,
) -> None:
    result = await session.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint
            == payload.endpoint,
        )
    )

    subscription = result.scalar_one_or_none()

    if subscription is None:
        subscription = PushSubscription(
            user_id=user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            user_agent=request.headers.get(
                "user-agent",
            ),
        )
        session.add(subscription)
    else:
        subscription.user_id = user.id
        subscription.p256dh = payload.keys.p256dh
        subscription.auth = payload.keys.auth
        subscription.user_agent = request.headers.get(
            "user-agent",
        )

    await session.commit()


@router.delete(
    "/push/subscriptions",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unsubscribe_push(
    payload: PushUnsubscribeRequest,
    user: CurrentUser,
    session: DatabaseSession,
) -> None:
    await session.execute(
        delete(PushSubscription).where(
            PushSubscription.user_id == user.id,
            PushSubscription.endpoint
            == payload.endpoint,
        )
    )

    await session.commit()
