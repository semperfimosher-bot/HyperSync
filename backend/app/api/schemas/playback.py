from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class PlaybackTrackResponse(
    BaseModel,
):
    id: UUID

    title: str

    artist: str

    album: str | None
    genre: str | None = None
    release_year: int | None = None

    duration_seconds: int | None

    audio_url: str | None = None

    artwork_url: str | None = None

    mime_type: str | None = None

    file_size: int | None = None

    media_version: str | None = None

    artwork_version: str | None = None


class PlaybackStateResponse(
    BaseModel,
):
    track: PlaybackTrackResponse | None = None

    position_seconds: float = 0.0

    paused: bool = True

    device_id: str | None = None

    queue: list[
        PlaybackTrackResponse
    ] = Field(
        default_factory=list,
    )

    queue_index: int | None = None

    updated_at: datetime | None = None


class PlaybackStateUpdateRequest(
    BaseModel,
):
    track_id: UUID | None = None

    position_seconds: float = Field(
        default=0.0,
        ge=0,
        le=86_400,
    )

    paused: bool = True

    queue_track_ids: list[
        UUID
    ] = Field(
        default_factory=list,
        max_length=500,
    )

    queue_index: int | None = Field(
        default=None,
        ge=0,
        le=499,
    )

    device_id: str = Field(
        min_length=1,
        max_length=64,
    )


PlaybackDeviceKind = Literal[
    "desktop",
    "mobile",
    "tablet",
    "browser",
]


class PlaybackDevicePollRequest(
    BaseModel,
):
    device_id: str = Field(
        min_length=1,
        max_length=64,
    )

    name: str = Field(
        min_length=1,
        max_length=120,
    )

    device_type: PlaybackDeviceKind = (
        "browser"
    )


class PlaybackDeviceResponse(
    BaseModel,
):
    device_id: str

    name: str

    device_type: PlaybackDeviceKind

    is_online: bool

    is_active: bool

    last_seen_at: datetime


PlaybackRemoteAction = Literal[
    "play",
    "pause",
    "next",
    "previous",
    "seek",
    "volume",
    "transfer",
    "play_track",
    "stop",
]


class PlaybackRemoteCommandRequest(
    BaseModel,
):
    source_device_id: str = Field(
        min_length=1,
        max_length=64,
    )

    action: PlaybackRemoteAction

    value: float | None = None

    track_id: UUID | None = None

    queue_track_ids: list[
        UUID
    ] = Field(
        default_factory=list,
        max_length=500,
    )

    queue_index: int | None = Field(
        default=None,
        ge=0,
        le=499,
    )

    position_seconds: float | None = Field(
        default=None,
        ge=0,
        le=86_400,
    )

    paused: bool | None = None


class PlaybackRemoteCommandResponse(
    BaseModel,
):
    id: UUID

    source_device_id: str

    target_device_id: str

    action: PlaybackRemoteAction

    value: float | None = None

    queue: list[
        PlaybackTrackResponse
    ] = Field(
        default_factory=list,
    )

    queue_index: int | None = None

    created_at: datetime


class PlaybackDevicePollResponse(
    BaseModel,
):
    devices: list[
        PlaybackDeviceResponse
    ]

    commands: list[
        PlaybackRemoteCommandResponse
    ]

    playback_state: PlaybackStateResponse
