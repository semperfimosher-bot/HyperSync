from collections.abc import AsyncIterator
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.config import get_settings
from backend.app.database import close_database, get_engine, get_session_factory
from backend.app.main import app
from backend.app.models import Base
from backend.app.models.jam import JamSession
from backend.app.models.media import Track
from backend.app.services.jam_sessions import utcnow


@pytest.fixture(autouse=True)
async def jam_schema(monkeypatch: pytest.MonkeyPatch, tmp_path) -> AsyncIterator[None]:
    async def no_auth_rate_limit(*args: object, **kwargs: object) -> None:
        pass

    monkeypatch.setattr("backend.app.api.routes.auth.enforce_rate_limit", no_auth_rate_limit)
    await close_database()
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'jam.db'}")
    get_settings.cache_clear()
    async with get_engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield
    await close_database()
    get_settings.cache_clear()


async def _member(client: AsyncClient, label: str) -> dict[str, str]:
    name = f"jam-{label}-{uuid4().hex[:8]}"
    password = "jam-test-password-123"
    response = await client.post(
        "/api/auth/register",
        json={"username": name, "email": f"{name}@example.com", "password": password},
    )
    assert response.status_code == 201, response.text
    response = await client.post("/api/auth/login", json={"username": name, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_jam_invite_membership_and_host_permissions() -> None:
    async with (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as guest_client,
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as outsider_client,
    ):
        host = await _member(client, "host")
        guest = await _member(guest_client, "guest")
        outsider = await _member(outsider_client, "outsider")

        created = await client.post("/api/jams", headers=host, json={"mode": "everyone"})
        assert created.status_code == 201, created.text
        jam = created.json()
        invite = jam.pop("invite_code")
        assert len(invite) >= 40
        jam_id = jam["id"]

        denied = await outsider_client.get(f"/api/jams/{jam_id}", headers=outsider)
        assert denied.status_code == 404
        assert invite not in str(denied.json())

        joined = await guest_client.post(
            "/api/jams/join", headers=guest, json={"invite_code": invite}
        )
        assert joined.status_code == 200, joined.text
        assert joined.json()["id"] == jam_id
        assert "invite_code" not in joined.json()

        forbidden = await guest_client.post(
            f"/api/jams/{jam_id}/end", headers=guest, json={"revision": joined.json()["revision"]}
        )
        assert forbidden.status_code == 403
        ended = await client.post(
            f"/api/jams/{jam_id}/end", headers=host, json={"revision": joined.json()["revision"]}
        )
        assert ended.status_code == 200, ended.text
        assert (await guest_client.get("/api/jams/current", headers=guest)).json() is None


@pytest.mark.asyncio
async def test_jam_queue_rejects_unpublished_tracks_and_stale_revision() -> None:
    published, unpublished = uuid4(), uuid4()
    async with get_session_factory()() as session:
        session.add_all(
            [
                Track(
                    id=published,
                    title="Jam Track",
                    artist="Band",
                    b2_object_key=f"jam/{published}.mp3",
                    mime_type="audio/mpeg",
                    file_size=1024,
                    duration_seconds=120,
                    is_published=True,
                ),
                Track(
                    id=unpublished,
                    title="Hidden Track",
                    artist="Band",
                    b2_object_key=f"jam/{unpublished}.mp3",
                    mime_type="audio/mpeg",
                    file_size=1024,
                    duration_seconds=120,
                    is_published=False,
                ),
            ]
        )
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        host = await _member(client, "queue")
        created = (await client.post("/api/jams", headers=host, json={"mode": "host"})).json()
        jam_id, revision = created["id"], created["revision"]
        rejected = await client.post(
            f"/api/jams/{jam_id}/queue",
            headers=host,
            json={"track_id": str(unpublished), "revision": revision},
        )
        assert rejected.status_code == 404
        added = await client.post(
            f"/api/jams/{jam_id}/queue",
            headers=host,
            json={"track_id": str(published), "revision": revision},
        )
        assert added.status_code == 200, added.text
        assert added.json()["queue"][0]["track_id"] == str(published)
        assert "invite_code" not in added.json()
        stale = await client.post(
            f"/api/jams/{jam_id}/queue",
            headers=host,
            json={"track_id": str(published), "revision": revision},
        )
        assert stale.status_code == 409


@pytest.mark.asyncio
async def test_rotated_and_expired_invitations_and_removed_member() -> None:
    async with (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as host_client,
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as guest_client,
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as third_client,
    ):
        host = await _member(host_client, "owner")
        guest = await _member(guest_client, "member")
        third = await _member(third_client, "third")
        created = (await host_client.post("/api/jams", headers=host, json={})).json()
        jam_id, old_code = created["id"], created["invite_code"]
        rotated = await host_client.post(
            f"/api/jams/{jam_id}/invite",
            headers=host,
            json={"revision": created["revision"]},
        )
        assert rotated.status_code == 200, rotated.text
        new_code = rotated.json()["invite_code"]
        assert new_code != old_code
        assert (
            await guest_client.post("/api/jams/join", headers=guest, json={"invite_code": old_code})
        ).status_code == 404
        joined = await guest_client.post(
            "/api/jams/join", headers=guest, json={"invite_code": new_code}
        )
        assert joined.status_code == 200, joined.text
        member_id = next(
            item["user_id"]
            for item in joined.json()["members"]
            if item["user_id"] != joined.json()["host_id"]
        )
        kicked = await host_client.request(
            "DELETE",
            f"/api/jams/{jam_id}/members/{member_id}",
            headers=host,
            json={"revision": joined.json()["revision"]},
        )
        assert kicked.status_code == 200, kicked.text
        assert (await guest_client.get(f"/api/jams/{jam_id}", headers=guest)).status_code == 404

        async with get_session_factory()() as session:
            jam = await session.get(JamSession, UUID(jam_id))
            assert jam is not None
            jam.invite_expires_at = utcnow() - timedelta(seconds=1)
            await session.commit()
        assert (
            await third_client.post("/api/jams/join", headers=third, json={"invite_code": new_code})
        ).status_code == 404


@pytest.mark.asyncio
async def test_jam_playback_permissions_and_queue_timeline() -> None:
    track_id = uuid4()
    async with get_session_factory()() as session:
        session.add(
            Track(
                id=track_id,
                title="Timeline",
                artist="Band",
                b2_object_key=f"jam/{track_id}.mp3",
                mime_type="audio/mpeg",
                file_size=1024,
                duration_seconds=180,
                is_published=True,
            )
        )
        await session.commit()
    async with (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as host_client,
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as guest_client,
    ):
        host = await _member(host_client, "playhost")
        guest = await _member(guest_client, "playguest")
        created = (
            await host_client.post("/api/jams", headers=host, json={"mode": "everyone"})
        ).json()
        jam_id = created["id"]
        joined = (
            await guest_client.post(
                "/api/jams/join", headers=guest, json={"invite_code": created["invite_code"]}
            )
        ).json()
        queued = (
            await guest_client.post(
                f"/api/jams/{jam_id}/queue",
                headers=guest,
                json={"track_id": str(track_id), "revision": joined["revision"]},
            )
        ).json()
        denied = await guest_client.post(
            f"/api/jams/{jam_id}/playback",
            headers=guest,
            json={"action": "play", "revision": queued["revision"]},
        )
        assert denied.status_code == 403
        playing = await host_client.post(
            f"/api/jams/{jam_id}/playback",
            headers=host,
            json={"action": "play", "revision": queued["revision"]},
        )
        assert playing.status_code == 200, playing.text
        assert playing.json()["current_track_id"] == str(track_id)
        assert playing.json()["paused"] is False
        assert playing.json()["position_seconds"] >= 0
        assert "server_time" in playing.json()
        permission = (
            await host_client.post(
                f"/api/jams/{jam_id}/permissions",
                headers=host,
                json={"allow_guest_control": True, "revision": playing.json()["revision"]},
            )
        ).json()
        paused = await guest_client.post(
            f"/api/jams/{jam_id}/playback",
            headers=guest,
            json={"action": "pause", "revision": permission["revision"]},
        )
        assert paused.status_code == 200, paused.text
        assert paused.json()["paused"] is True
        denied_seek = await guest_client.post(
            f"/api/jams/{jam_id}/playback",
            headers=guest,
            json={"action": "seek", "position_seconds": 55, "revision": paused.json()["revision"]},
        )
        assert denied_seek.status_code == 403


@pytest.mark.asyncio
async def test_duplicate_track_entries_advance_to_the_end() -> None:
    track_id = uuid4()
    async with get_session_factory()() as session:
        session.add(
            Track(
                id=track_id,
                title="Repeat",
                artist="Band",
                b2_object_key=f"jam/{track_id}.mp3",
                mime_type="audio/mpeg",
                file_size=1024,
                duration_seconds=10,
                is_published=True,
            )
        )
        await session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        host = await _member(client, "repeat")
        jam = (await client.post("/api/jams", headers=host, json={})).json()
        for _ in range(2):
            response = await client.post(
                f"/api/jams/{jam['id']}/queue",
                headers=host,
                json={"track_id": str(track_id), "revision": jam["revision"]},
            )
            assert response.status_code == 200, response.text
            jam = response.json()
        for action in ("play", "next", "next"):
            response = await client.post(
                f"/api/jams/{jam['id']}/playback",
                headers=host,
                json={"action": action, "revision": jam["revision"]},
            )
            assert response.status_code == 200, response.text
            jam = response.json()
        assert jam["paused"] is True
        assert jam["current_track_id"] is None


@pytest.mark.asyncio
async def test_finished_track_advances_when_host_is_offline() -> None:
    track_id = uuid4()
    async with get_session_factory()() as session:
        session.add(
            Track(
                id=track_id,
                title="Short",
                artist="Band",
                b2_object_key=f"jam/{track_id}.mp3",
                mime_type="audio/mpeg",
                file_size=1024,
                duration_seconds=10,
                is_published=True,
            )
        )
        await session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        host = await _member(client, "autonext")
        jam = (await client.post("/api/jams", headers=host, json={})).json()
        for _ in range(2):
            jam = (
                await client.post(
                    f"/api/jams/{jam['id']}/queue",
                    headers=host,
                    json={"track_id": str(track_id), "revision": jam["revision"]},
                )
            ).json()
        jam = (
            await client.post(
                f"/api/jams/{jam['id']}/playback",
                headers=host,
                json={"action": "play", "revision": jam["revision"]},
            )
        ).json()
        first_item = jam["current_item_id"]
        async with get_session_factory()() as session:
            row = await session.get(JamSession, UUID(jam["id"]))
            assert row is not None
            row.anchor_at = utcnow() - timedelta(seconds=12)
            await session.commit()
        refreshed = await client.get(f"/api/jams/{jam['id']}", headers=host)
        assert refreshed.status_code == 200, refreshed.text
        assert refreshed.json()["current_item_id"] != first_item
        assert refreshed.json()["paused"] is False


@pytest.mark.asyncio
async def test_host_reorders_queue_and_rejects_missing_items() -> None:
    track_ids = [uuid4(), uuid4()]
    async with get_session_factory()() as session:
        session.add_all(
            Track(
                id=track_id,
                title=f"Order {index}",
                artist="Band",
                b2_object_key=f"jam/{track_id}.mp3",
                mime_type="audio/mpeg",
                file_size=1024,
                duration_seconds=30,
                is_published=True,
            )
            for index, track_id in enumerate(track_ids)
        )
        await session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        host = await _member(client, "order")
        jam = (await client.post("/api/jams", headers=host, json={})).json()
        for track_id in track_ids:
            jam = (
                await client.post(
                    f"/api/jams/{jam['id']}/queue",
                    headers=host,
                    json={"track_id": str(track_id), "revision": jam["revision"]},
                )
            ).json()
        ids = [item["id"] for item in jam["queue"]]
        invalid = await client.post(
            f"/api/jams/{jam['id']}/queue/reorder",
            headers=host,
            json={"item_ids": ids[:1], "revision": jam["revision"]},
        )
        assert invalid.status_code == 400
        reordered = await client.post(
            f"/api/jams/{jam['id']}/queue/reorder",
            headers=host,
            json={"item_ids": ids[::-1], "revision": jam["revision"]},
        )
        assert reordered.status_code == 200, reordered.text
        assert [item["id"] for item in reordered.json()["queue"]] == ids[::-1]
