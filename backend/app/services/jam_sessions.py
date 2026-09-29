"""Durable, account-scoped Jam state shared by all backend replicas."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.account import User
from ..models.jam import JamMember, JamQueueItem, JamSession
from ..models.media import Track
from ..time_utils import as_utc_aware

MAX_MEMBERS = 20
MAX_QUEUE = 200
INVITE_TTL = timedelta(hours=24)


def utcnow() -> datetime:
    return datetime.now(UTC)


def invitation() -> tuple[str, str]:
    code = secrets.token_urlsafe(32)
    return code, hashlib.sha256(code.encode("ascii")).hexdigest()


def position(jam: JamSession, now: datetime) -> float:
    if jam.paused:
        return jam.position_seconds
    return max(0.0, jam.position_seconds + (now - as_utc_aware(jam.anchor_at)).total_seconds())


async def member_jam(session: AsyncSession, user_id: UUID) -> JamSession | None:
    result = await session.execute(
        select(JamSession)
        .join(JamMember, JamMember.jam_id == JamSession.id)
        .where(JamMember.user_id == user_id, JamSession.ended_at.is_(None))
    )
    return result.scalar_one_or_none()


async def require_jam(session: AsyncSession, jam_id: UUID, user_id: UUID) -> JamSession:
    result = await session.execute(
        select(JamSession)
        .join(JamMember, JamMember.jam_id == JamSession.id)
        .where(JamSession.id == jam_id, JamMember.user_id == user_id, JamSession.ended_at.is_(None))
    )
    jam = result.scalar_one_or_none()
    if jam is None:
        raise HTTPException(404, "Jam not found.")
    return jam


def require_host(jam: JamSession, user_id: UUID) -> None:
    if jam.host_id != user_id:
        raise HTTPException(403, "Only the Jam host can do that.")


async def advance(session: AsyncSession, jam: JamSession, revision: int) -> None:
    # Compare-and-swap is safe across replicas; a stale writer cannot overwrite a queue edit.
    result = await session.execute(
        update(JamSession)
        .where(
            JamSession.id == jam.id, JamSession.revision == revision, JamSession.ended_at.is_(None)
        )
        .values(revision=revision + 1, updated_at=utcnow())
    )
    if cast(CursorResult[Any], result).rowcount != 1:
        raise HTTPException(409, "Jam changed. Refresh and try again.")
    jam.revision = revision + 1


async def snapshot(session: AsyncSession, jam: JamSession) -> dict[str, Any]:
    now = utcnow()
    members = (
        await session.execute(
            select(User.id, User.username)
            .join(JamMember, JamMember.user_id == User.id)
            .where(JamMember.jam_id == jam.id)
            .order_by(JamMember.joined_at, User.id)
        )
    ).all()
    rows = (
        await session.execute(
            select(JamQueueItem, Track)
            .join(Track, Track.id == JamQueueItem.track_id)
            .where(JamQueueItem.jam_id == jam.id)
            .order_by(JamQueueItem.position, JamQueueItem.id)
        )
    ).all()
    queue = [
        {
            "id": str(item.id),
            "track_id": str(track.id),
            "added_by_id": str(item.added_by_id),
            "track": {
                "id": str(track.id),
                "title": track.title,
                "artist": track.artist,
                "album": track.album,
                "duration_seconds": track.duration_seconds,
                "audio_url": f"/api/audio/{track.id}",
                "artwork_url": f"/api/catalog/tracks/{track.id}/artwork",
            },
        }
        for item, track in rows
    ]
    current = next(
        (entry["track"] for entry in queue if entry["id"] == str(jam.current_item_id)), None
    )
    if (
        current
        and not jam.paused
        and current["duration_seconds"]
        and position(jam, now) >= current["duration_seconds"]
    ):
        try:
            await advance(session, jam, jam.revision)
        except HTTPException:
            await session.rollback()
            await session.refresh(jam)
            return await snapshot(session, jam)
        index = next(
            (i for i, entry in enumerate(queue) if entry["id"] == str(jam.current_item_id)),
            -1,
        )
        following = queue[index + 1] if index + 1 < len(queue) else None
        jam.current_item_id = UUID(following["id"]) if following else None
        jam.current_track_id = UUID(following["track_id"]) if following else None
        jam.position_seconds = 0.0
        jam.anchor_at = now
        jam.paused = following is None
        await session.commit()
        return await snapshot(session, jam)
    return {
        "id": str(jam.id),
        "host_id": str(jam.host_id),
        "mode": jam.mode,
        "allow_guest_control": jam.allow_guest_control,
        "revision": jam.revision,
        "paused": jam.paused,
        "position_seconds": min(position(jam, now), float(current["duration_seconds"] or 86400))
        if current
        else 0.0,
        "server_time": now.isoformat(),
        "current_track_id": str(jam.current_track_id) if jam.current_track_id else None,
        "current_item_id": str(jam.current_item_id) if jam.current_item_id else None,
        "current_track": current,
        "queue": queue,
        "members": [{"user_id": str(user_id), "username": name} for user_id, name in members],
        "ended": jam.ended_at is not None,
    }


async def create(session: AsyncSession, user_id: UUID, mode: str) -> dict[str, Any]:
    if await member_jam(session, user_id):
        raise HTTPException(409, "Leave your current Jam first.")
    code, digest = invitation()
    jam = JamSession(
        host_id=user_id,
        mode=mode,
        invite_hash=digest,
        invite_expires_at=utcnow() + INVITE_TTL,
        anchor_at=utcnow(),
    )
    session.add(jam)
    await session.flush()
    session.add(JamMember(jam_id=jam.id, user_id=user_id))
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "Leave your current Jam first.") from exc
    return {**await snapshot(session, jam), "invite_code": code}


async def join(session: AsyncSession, user_id: UUID, code: str) -> dict[str, Any]:
    if await member_jam(session, user_id):
        raise HTTPException(409, "Leave your current Jam first.")
    digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
    jam = (
        await session.execute(
            select(JamSession)
            .where(
                JamSession.invite_hash == digest,
                JamSession.ended_at.is_(None),
                JamSession.invite_expires_at > utcnow(),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if jam is None:
        raise HTTPException(404, "Invitation expired or invalid.")
    count = await session.scalar(
        select(func.count()).select_from(JamMember).where(JamMember.jam_id == jam.id)
    )
    if (count or 0) >= MAX_MEMBERS:
        raise HTTPException(409, "Jam is full.")
    session.add(JamMember(jam_id=jam.id, user_id=user_id))
    await advance(session, jam, jam.revision)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "Already in a Jam.") from exc
    return await snapshot(session, jam)


async def end(session: AsyncSession, jam: JamSession, revision: int) -> dict[str, Any]:
    await advance(session, jam, revision)
    jam.ended_at = utcnow()
    await session.flush()
    result = await snapshot(session, jam)
    await session.execute(delete(JamMember).where(JamMember.jam_id == jam.id))
    await session.commit()
    return result
