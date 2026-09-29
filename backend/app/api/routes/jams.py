"""Authenticated collaborative listening without sharing account credentials."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from ...models.account import AccountType
from ...models.jam import JamMember, JamQueueItem
from ...models.media import Track
from ...security.rate_limit import enforce_rate_limit
from ...services import jam_sessions as jams
from ..dependencies import CurrentUser, DatabaseSession

router = APIRouter(prefix="/jams", tags=["jams"])


class CreateJam(BaseModel):
    mode: Literal["host", "everyone"] = "host"


class JoinJam(BaseModel):
    invite_code: str = Field(min_length=40, max_length=128)


class Revision(BaseModel):
    revision: int = Field(ge=1)


class QueueAddition(Revision):
    track_id: UUID


class QueueReorder(Revision):
    item_ids: list[UUID] = Field(max_length=200)


class ModeChange(Revision):
    mode: Literal["host", "everyone"]


class PermissionChange(Revision):
    allow_guest_control: bool


class PlaybackChange(Revision):
    action: Literal["play", "pause", "seek", "next"]
    position_seconds: float | None = Field(default=None, ge=0, le=86400)


def registered(user: CurrentUser) -> None:
    if user.account_type != AccountType.REGISTERED:
        raise HTTPException(403, "A registered account is required for Jam.")


async def rate(request: Request, user: CurrentUser, scope: str) -> None:
    await enforce_rate_limit(
        request,
        scope=f"jam-{scope}",
        identity=str(user.id),
        limit=60,
        window_seconds=60,
        include_client=False,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_jam(
    payload: CreateJam, request: Request, user: CurrentUser, session: DatabaseSession
):
    registered(user)
    await rate(request, user, "create")
    return await jams.create(session, user.id, payload.mode)


@router.get("/current")
async def current_jam(user: CurrentUser, session: DatabaseSession):
    registered(user)
    jam = await jams.member_jam(session, user.id)
    return await jams.snapshot(session, jam) if jam else None


@router.post("/join")
async def join_jam(payload: JoinJam, request: Request, user: CurrentUser, session: DatabaseSession):
    registered(user)
    await rate(request, user, "join")
    return await jams.join(session, user.id, payload.invite_code)


@router.get("/{jam_id}")
async def get_jam(jam_id: UUID, user: CurrentUser, session: DatabaseSession):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    return await jams.snapshot(session, jam)


@router.post("/{jam_id}/end")
async def end_jam(jam_id: UUID, payload: Revision, user: CurrentUser, session: DatabaseSession):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    jams.require_host(jam, user.id)
    return await jams.end(session, jam, payload.revision)


@router.post("/{jam_id}/leave")
async def leave_jam(jam_id: UUID, payload: Revision, user: CurrentUser, session: DatabaseSession):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    if jam.host_id == user.id:
        return await jams.end(session, jam, payload.revision)
    await jams.advance(session, jam, payload.revision)
    await session.execute(
        delete(JamMember).where(JamMember.jam_id == jam.id, JamMember.user_id == user.id)
    )
    await session.commit()
    return {"left": True}


@router.post("/{jam_id}/invite")
async def rotate_invite(
    jam_id: UUID, payload: Revision, user: CurrentUser, session: DatabaseSession
):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    jams.require_host(jam, user.id)
    await jams.advance(session, jam, payload.revision)
    code, digest = jams.invitation()
    jam.invite_hash = digest
    jam.invite_expires_at = jams.utcnow() + jams.INVITE_TTL
    await session.commit()
    return {**await jams.snapshot(session, jam), "invite_code": code}


@router.delete("/{jam_id}/members/{member_id}")
async def remove_member(
    jam_id: UUID,
    member_id: UUID,
    payload: Revision,
    user: CurrentUser,
    session: DatabaseSession,
):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    jams.require_host(jam, user.id)
    if member_id == jam.host_id:
        raise HTTPException(400, "The host must end the Jam instead.")
    member = await session.get(JamMember, (jam.id, member_id))
    if member is None:
        raise HTTPException(404, "Member not found.")
    await jams.advance(session, jam, payload.revision)
    await session.delete(member)
    await session.commit()
    return await jams.snapshot(session, jam)


@router.post("/{jam_id}/mode")
async def change_mode(
    jam_id: UUID, payload: ModeChange, user: CurrentUser, session: DatabaseSession
):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    jams.require_host(jam, user.id)
    await jams.advance(session, jam, payload.revision)
    jam.mode = payload.mode
    await session.commit()
    return await jams.snapshot(session, jam)


@router.post("/{jam_id}/permissions")
async def change_permissions(
    jam_id: UUID, payload: PermissionChange, user: CurrentUser, session: DatabaseSession
):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    jams.require_host(jam, user.id)
    await jams.advance(session, jam, payload.revision)
    jam.allow_guest_control = payload.allow_guest_control
    await session.commit()
    return await jams.snapshot(session, jam)


@router.post("/{jam_id}/queue")
async def add_to_queue(
    jam_id: UUID,
    payload: QueueAddition,
    request: Request,
    user: CurrentUser,
    session: DatabaseSession,
):
    registered(user)
    await rate(request, user, "queue")
    jam = await jams.require_jam(session, jam_id, user.id)
    track = await session.get(Track, payload.track_id)
    if track is None or not track.is_published or not track.b2_object_key:
        raise HTTPException(404, "Track unavailable.")
    await jams.advance(session, jam, payload.revision)
    count = await session.scalar(
        select(func.count()).select_from(JamQueueItem).where(JamQueueItem.jam_id == jam.id)
    )
    if (count or 0) >= jams.MAX_QUEUE:
        raise HTTPException(409, "Jam queue is full.")
    session.add(
        JamQueueItem(jam_id=jam.id, track_id=track.id, added_by_id=user.id, position=count or 0)
    )
    await session.commit()
    return await jams.snapshot(session, jam)


@router.post("/{jam_id}/queue/reorder")
async def reorder_queue(
    jam_id: UUID, payload: QueueReorder, user: CurrentUser, session: DatabaseSession
):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    jams.require_host(jam, user.id)
    items = (
        (await session.execute(select(JamQueueItem).where(JamQueueItem.jam_id == jam.id)))
        .scalars()
        .all()
    )
    if len(payload.item_ids) != len(items) or set(payload.item_ids) != {item.id for item in items}:
        raise HTTPException(400, "Queue order must contain every item exactly once.")
    await jams.advance(session, jam, payload.revision)
    by_id = {item.id: item for item in items}
    for position, item_id in enumerate(payload.item_ids):
        by_id[item_id].position = position
    await session.commit()
    return await jams.snapshot(session, jam)


@router.delete("/{jam_id}/queue/{item_id}")
async def remove_from_queue(
    jam_id: UUID, item_id: UUID, payload: Revision, user: CurrentUser, session: DatabaseSession
):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    jams.require_host(jam, user.id)
    item = await session.get(JamQueueItem, item_id)
    if item is None or item.jam_id != jam.id:
        raise HTTPException(404, "Queue item not found.")
    await jams.advance(session, jam, payload.revision)
    await session.delete(item)
    if jam.current_item_id == item.id:
        jam.current_track_id = None
        jam.current_item_id = None
        jam.paused = True
    await session.commit()
    return await jams.snapshot(session, jam)


@router.post("/{jam_id}/playback")
async def change_playback(
    jam_id: UUID, payload: PlaybackChange, user: CurrentUser, session: DatabaseSession
):
    registered(user)
    jam = await jams.require_jam(session, jam_id, user.id)
    if jam.host_id != user.id and not jam.allow_guest_control:
        raise HTTPException(403, "The host controls playback.")
    if payload.action == "seek" and jam.host_id != user.id:
        raise HTTPException(403, "Only the host can seek.")
    await jams.advance(session, jam, payload.revision)
    now = jams.utcnow()
    jam.position_seconds = jams.position(jam, now)
    jam.anchor_at = now
    if payload.action == "pause":
        jam.paused = True
    elif payload.action == "play":
        if jam.current_track_id is None:
            first = (
                await session.execute(
                    select(JamQueueItem)
                    .where(JamQueueItem.jam_id == jam.id)
                    .order_by(JamQueueItem.position, JamQueueItem.id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            jam.current_track_id = first.track_id if first else None
            jam.current_item_id = first.id if first else None
            jam.position_seconds = 0.0
        jam.paused = jam.current_track_id is None
    elif payload.action == "seek":
        jam.position_seconds = payload.position_seconds or 0.0
    elif payload.action == "next":
        items = (
            (
                await session.execute(
                    select(JamQueueItem)
                    .where(JamQueueItem.jam_id == jam.id)
                    .order_by(JamQueueItem.position, JamQueueItem.id)
                )
            )
            .scalars()
            .all()
        )
        current_index = next(
            (i for i, item in enumerate(items) if item.id == jam.current_item_id), -1
        )
        next_item = items[current_index + 1] if current_index + 1 < len(items) else None
        jam.current_track_id = next_item.track_id if next_item else None
        jam.current_item_id = next_item.id if next_item else None
        jam.position_seconds = 0.0
        jam.paused = next_item is None
    await session.commit()
    return await jams.snapshot(session, jam)
