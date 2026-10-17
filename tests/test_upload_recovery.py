from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from backend.app.api.routes import messages
from backend.app.models.account import User, UserRole
from backend.app.models.media import Track


def test_cors_plan_preserves_existing_rules_and_adds_local_put():
    from scripts.set_b2_cors import build_cors_rules

    existing = [
        {
            "AllowedOrigins": ["https://hypersynced.app"],
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedHeaders": ["*"],
        }
    ]
    before = deepcopy(existing)
    rules = build_cors_rules(existing, ["http://localhost:4153", "https://hypersynced.app"])
    assert existing == before
    assert rules[0] == before[0]
    assert rules[-1]["AllowedOrigins"] == ["http://localhost:4153", "https://hypersynced.app"]
    assert "PUT" in rules[-1]["AllowedMethods"]
    assert "content-type" in [value.lower() for value in rules[-1]["AllowedHeaders"]]
    assert build_cors_rules(rules, rules[-1]["AllowedOrigins"]) == rules


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://site.test/path",
        "https://u:p@site.test",
        "https://site.test?x=1",
        "file:///tmp/test",
    ],
)
def test_cors_rejects_non_origin_values(origin):
    from scripts.set_b2_cors import build_cors_rules

    with pytest.raises(ValueError):
        build_cors_rules([], [origin])


def test_cors_preview_never_writes_and_apply_preserves_existing_rules():
    from scripts.set_b2_cors import configure_cors

    client = MagicMock()
    existing = {"AllowedOrigins": ["https://another-app.test"], "AllowedMethods": ["GET"]}
    client.get_bucket_cors.return_value = {"CORSRules": [existing]}
    configure_cors(client, "test-bucket", ["http://localhost:4153"], apply=False)
    client.put_bucket_cors.assert_not_called()
    configure_cors(client, "test-bucket", ["http://localhost:4153"], apply=True)
    assert client.put_bucket_cors.call_args.kwargs["CORSConfiguration"]["CORSRules"][0] == existing


@pytest.mark.asyncio
async def test_repeated_admin_notification_dismissal_is_harmless():
    user = User(id=uuid4(), role=UserRole.ADMIN)
    session = MagicMock(execute=AsyncMock(), commit=AsyncMock())
    session.execute.return_value.scalar_one_or_none.return_value = None
    notification_id = uuid4()
    await messages.read_admin_notification(notification_id, user, session)
    await messages.read_admin_notification(notification_id, user, session)
    assert session.commit.await_count == 2


@pytest.mark.asyncio
async def test_notification_dismissal_keeps_admin_authorization():
    from fastapi import HTTPException

    user = User(id=uuid4(), role=UserRole.USER)
    session = MagicMock(execute=AsyncMock(), commit=AsyncMock())
    with pytest.raises(HTTPException) as error:
        await messages.read_admin_notification(uuid4(), user, session)
    assert error.value.status_code == 403
    session.execute.assert_not_awaited()


def test_unreadable_cors_policy_is_never_overwritten():
    from botocore.exceptions import ClientError

    from scripts.set_b2_cors import configure_cors

    client = MagicMock()
    client.get_bucket_cors.side_effect = ClientError(
        {"Error": {"Code": "AccessDenied"}},
        "GetBucketCors",
    )
    with pytest.raises(ClientError):
        configure_cors(client, "test-bucket", ["http://localhost:4153"], apply=True)
    client.put_bucket_cors.assert_not_called()


def test_cors_can_initialize_bucket_without_a_policy():
    from botocore.exceptions import ClientError

    from scripts.set_b2_cors import configure_cors

    client = MagicMock()
    client.get_bucket_cors.side_effect = ClientError(
        {"Error": {"Code": "NoSuchCORSConfiguration"}},
        "GetBucketCors",
    )
    rules = configure_cors(client, "test-bucket", ["http://localhost:4153"], apply=True)
    assert len(rules) == 1
    client.put_bucket_cors.assert_called_once()


@pytest.mark.asyncio
async def test_metadata_lookup_releases_transaction_and_preserves_concurrent_edits(monkeypatch):
    from backend.app.services import music_metadata

    track = Track(
        id=uuid4(),
        title="Song",
        artist="Artist",
        duration_seconds=120,
        genre=None,
        release_year=None,
    )
    session = MagicMock(commit=AsyncMock(), refresh=AsyncMock(), rollback=AsyncMock())

    async def lookup(**_kwargs):
        session.commit.assert_awaited_once()
        return {
            "source": "test",
            "recording_id": "1",
            "genre": "Rock",
            "release_year": 2020,
            "confidence": 1.0,
        }

    async def refresh(_track):
        # Another request filled this field while the provider was slow.
        track.genre = "Jazz"

    session.refresh.side_effect = refresh
    monkeypatch.setattr(music_metadata, "lookup_external_track_metadata", lookup)
    monkeypatch.setattr(music_metadata, "refresh_smart_playlists_for_track", AsyncMock())
    result = await music_metadata.enrich_track_metadata(session, track)
    assert result["genre"] == "Jazz"
    assert result["release_year"] == 2020
    session.refresh.assert_awaited_once_with(track)


@pytest.mark.asyncio
async def test_upload_releases_connection_during_io_and_cleans_concurrent_duplicate(monkeypatch):
    from io import BytesIO

    from fastapi import BackgroundTasks, HTTPException, UploadFile
    from starlette.datastructures import Headers

    from backend.app.api.routes import admin

    active = False
    checks = 0

    async def duplicate(*_args, **_kwargs):
        nonlocal active, checks
        active = True
        checks += 1
        return None if checks == 1 else SimpleNamespace(title="Song", artist="Artist")

    async def finish():
        nonlocal active
        active = False

    async def lock(*_args, **_kwargs):
        nonlocal active
        active = True

    def compress(content, **_kwargs):
        assert not active, "compression must not hold a database connection"
        return SimpleNamespace(
            content=content, final_size=len(content), mime_type="audio/mpeg", extension="mp3"
        )

    def upload(*_args, **_kwargs):
        assert not active, "B2 upload must not hold a database connection"

    bucket = SimpleNamespace(upload_bytes=upload)
    cleanup = AsyncMock()
    monkeypatch.setattr(admin, "_find_duplicate_track", duplicate)
    monkeypatch.setattr(admin, "lock_track_identity", lock)
    monkeypatch.setattr(admin, "compress_audio_for_storage", compress)
    monkeypatch.setattr(admin, "get_b2_bucket", lambda: bucket)
    monkeypatch.setattr(admin, "delete_all_object_versions", cleanup)
    monkeypatch.setattr(admin, "extract_embedded_audio_metadata", lambda _content: {})
    monkeypatch.setattr(
        admin,
        "resolve_track_metadata",
        lambda **_kwargs: {
            "title": "Song",
            "artist": "Artist",
            "album": "Album",
            "genre": "",
            "duration_seconds": 120,
        },
    )
    session = MagicMock(
        commit=AsyncMock(side_effect=finish), rollback=AsyncMock(side_effect=finish)
    )
    file = UploadFile(
        BytesIO(b"audio"), filename="song.mp3", headers=Headers({"content-type": "audio/mpeg"})
    )
    with pytest.raises(HTTPException) as error:
        await admin.upload_track(
            file,
            "Song",
            "Artist",
            "Album",
            120,
            User(id=uuid4(), role=UserRole.ADMIN),
            session,
            BackgroundTasks(),
        )
    assert error.value.status_code == 409
    assert checks == 2
    cleanup.assert_awaited_once()
    assert cleanup.call_args.args[0] is bucket
    assert cleanup.call_args.args[1].startswith("audio/")
