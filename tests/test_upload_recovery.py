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
            "corsRuleName": "nativeDownloads",
            "allowedOrigins": ["https://hypersynced.app"],
            "allowedOperations": ["b2_download_file_by_name"],
            "allowedHeaders": ["*"],
        }
    ]
    before = deepcopy(existing)
    rules = build_cors_rules(existing, ["http://localhost:4153", "https://hypersynced.app"])
    assert existing == before
    assert rules[0] == before[0]
    assert rules[-1]["allowedOrigins"] == ["http://localhost:4153", "https://hypersynced.app"]
    assert "s3_put" in rules[-1]["allowedOperations"]
    assert "content-type" in [value.lower() for value in rules[-1]["allowedHeaders"]]
    assert build_cors_rules(rules, rules[-1]["allowedOrigins"]) == rules


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

    existing = [
        {
            "corsRuleName": "nativeDownloads",
            "allowedOrigins": ["https://another-app.test"],
            "allowedOperations": ["b2_download_file_by_name"],
        },
        {
            "corsRuleName": "existingS3",
            "allowedOrigins": ["https://hypersynced.app"],
            "allowedOperations": ["s3_get", "s3_head"],
        },
    ]
    fresh = SimpleNamespace(cors_rules=deepcopy(existing), revision=42, update=MagicMock())
    bucket = MagicMock()
    bucket.get_fresh_state.return_value = fresh
    configure_cors(bucket, ["http://localhost:4153"], apply=False)
    fresh.update.assert_not_called()
    configure_cors(bucket, ["http://localhost:4153"], apply=True)
    kwargs = fresh.update.call_args.kwargs
    assert set(kwargs) == {"cors_rules", "if_revision_is"}
    assert kwargs["if_revision_is"] == 42
    assert kwargs["cors_rules"][:2] == existing
    assert fresh.cors_rules == existing


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
    from scripts.set_b2_cors import configure_cors

    bucket = MagicMock()
    bucket.get_fresh_state.side_effect = PermissionError("read denied")
    with pytest.raises(PermissionError):
        configure_cors(bucket, ["http://localhost:4153"], apply=True)
    bucket.update.assert_not_called()


def test_cors_can_initialize_bucket_without_a_policy():
    from scripts.set_b2_cors import configure_cors

    fresh = SimpleNamespace(cors_rules=[], revision=0, update=MagicMock())
    bucket = MagicMock()
    bucket.get_fresh_state.return_value = fresh
    rules = configure_cors(bucket, ["http://localhost:4153"], apply=True)
    assert len(rules) == 1
    fresh.update.assert_called_once_with(cors_rules=rules, if_revision_is=0)


@pytest.mark.parametrize("rules,revision", [(None, 1), ([], None)])
def test_cors_refuses_unknown_policy_or_revision(rules, revision):
    from scripts.set_b2_cors import configure_cors

    fresh = SimpleNamespace(cors_rules=rules, revision=revision, update=MagicMock())
    bucket = MagicMock()
    bucket.get_fresh_state.return_value = fresh
    with pytest.raises(RuntimeError):
        configure_cors(bucket, ["http://localhost:4153"], apply=True)
    fresh.update.assert_not_called()


def test_cors_conflicting_revision_is_not_retried():
    from scripts.set_b2_cors import configure_cors

    fresh = SimpleNamespace(
        cors_rules=[], revision=42, update=MagicMock(side_effect=RuntimeError("conflict"))
    )
    bucket = MagicMock()
    bucket.get_fresh_state.return_value = fresh
    with pytest.raises(RuntimeError, match="conflict"):
        configure_cors(bucket, ["http://localhost:4153"], apply=True)
    fresh.update.assert_called_once()


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
    session = MagicMock(
        commit=AsyncMock(),
        refresh=AsyncMock(),
        rollback=AsyncMock(),
        flush=AsyncMock(),
        execute=AsyncMock(),
    )

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
            file=file,
            title="Song",
            artist="Artist",
            album="Album",
            duration_seconds=120,
            user=User(id=uuid4(), role=UserRole.ADMIN),
            session=session,
            background_tasks=BackgroundTasks(),
        )
    assert error.value.status_code == 409
    assert checks == 2
    cleanup.assert_awaited_once()
    assert cleanup.call_args.args[0] is bucket
    assert cleanup.call_args.args[1].startswith("audio/")


@pytest.mark.parametrize("apply", [False, True])
def test_cors_cli_uses_native_api(monkeypatch, capsys, apply):
    from backend.app import config
    from backend.app.services import b2
    from scripts import set_b2_cors

    fresh = SimpleNamespace(cors_rules=[], revision=3, update=MagicMock())
    bucket = MagicMock()
    bucket.get_fresh_state.return_value = fresh
    monkeypatch.setattr(
        config, "get_settings", lambda: SimpleNamespace(b2_bucket_name="test-bucket")
    )
    monkeypatch.setattr(b2, "get_b2_bucket", lambda: bucket)
    s3 = MagicMock(side_effect=AssertionError("S3 cannot manage a Native CORS policy"))
    monkeypatch.setattr(b2, "get_b2_s3_client", s3)
    monkeypatch.setattr("sys.argv", ["set_b2_cors"] + (["--apply"] if apply else []))
    set_b2_cors.main()
    output = capsys.readouterr().out
    assert '"api": "B2 Native"' in output
    assert '"s3_put"' in output
    assert fresh.update.call_count == int(apply)
    s3.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "metadata", [{}, {"album": "", "genre": ""}, {"album": "Album", "genre": "Rock"}]
)
@pytest.mark.parametrize("direct", [True, False])
@pytest.mark.parametrize("commit_lost", [False, True])
async def test_upload_accepts_missing_metadata_and_schedules_enrichment(
    monkeypatch, metadata, direct, commit_lost
):
    import httpx
    from fastapi import FastAPI

    from backend.app.api import dependencies
    from backend.app.api.routes import admin

    app = FastAPI()
    endpoint = admin.finalize_direct_track_upload if direct else admin.upload_track
    app.add_api_route("/upload", endpoint, methods=["POST"])
    session = MagicMock(commit=AsyncMock(), rollback=AsyncMock())

    async def commit():
        if commit_lost and session.add.called:
            raise ConnectionError("commit acknowledgement lost after durable write")

    session.commit.side_effect = commit
    cleanup = AsyncMock()
    monkeypatch.setattr(admin, "delete_all_object_versions", cleanup)
    app.dependency_overrides[dependencies.require_admin] = lambda: User(
        id=uuid4(), role=UserRole.ADMIN
    )
    app.dependency_overrides[dependencies.get_database_session] = lambda: session
    monkeypatch.setattr(admin, "get_b2_bucket", lambda: MagicMock())
    monkeypatch.setattr(
        admin, "head_b2_object", lambda _key: {"ContentLength": 5, "ContentType": "audio/mpeg"}
    )
    monkeypatch.setattr(admin, "_find_duplicate_track", AsyncMock(return_value=None))
    for helper in [
        "lock_track_identity",
        "ensure_artist_profiles_for_credit",
        "sync_track_media_identity",
    ]:
        monkeypatch.setattr(admin, helper, AsyncMock())
    queued = []

    async def enqueue(_session, track_id):
        queued.append(track_id)

    monkeypatch.setattr(admin, "enqueue_track_maintenance", enqueue, raising=False)
    monkeypatch.setattr(
        admin,
        "extract_embedded_audio_metadata",
        lambda _content: {
            "title": None,
            "artist": None,
            "album": None,
            "genre": None,
            "duration_seconds": None,
        },
    )
    monkeypatch.setattr(
        admin,
        "compress_audio_for_storage",
        lambda content, **_kwargs: SimpleNamespace(
            content=content,
            final_size=len(content),
            mime_type="audio/mpeg",
            extension="mp3",
            compressed=False,
            savings_bytes=0,
            savings_percent=0.0,
            source_codec=None,
            source_bitrate_kbps=None,
        ),
    )
    data = {"title": "Song", "artist": "Artist", "duration_seconds": "120", **metadata}
    if direct:
        data.update(object_key="audio/test.mp3", mime_type="audio/mpeg", original_file_size="5")
        files = {"multipart_marker": (None, "true")}
    else:
        files = {"file": ("song.mp3", b"audio", "audio/mpeg")}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/upload", data=data, files=files)
    if commit_lost:
        assert response.status_code == 500
        assert queued, "the commit included maintenance work"
        cleanup.assert_not_awaited()
        return
    assert response.status_code == 200, response.text
    assert response.json()["metadata_enrichment_scheduled"] is True
    stored = session.add.call_args.args[0]
    assert stored.genre == (metadata.get("genre") or None)
    assert stored.album == (metadata.get("album") or None)
    assert queued == [stored.id], "maintenance must be durable before returning success"
