from uuid import uuid4

import pytest

from backend.app.database import get_session_factory
from backend.app.models.account import UserAppState
from backend.app.models.media import Track
from backend.app.services.playback import build_account_playback_queue


def _track(track_id, *, published=True) -> Track:
    return Track(
        id=track_id,
        title=f"Track {track_id}",
        artist="Playback Service",
        album="Queue Contract",
        b2_object_key=f"audio/{track_id}.mp3",
        mime_type="audio/mpeg",
        file_size=4096,
        duration_seconds=180,
        is_published=published,
    )


@pytest.mark.asyncio
async def test_queue_canonicalization_preserves_selected_track_and_omits_unpublished() -> None:
    first_id = uuid4()
    unpublished_id = uuid4()
    missing_id = uuid4()
    selected_id = uuid4()

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add_all(
            [
                _track(first_id),
                _track(unpublished_id, published=False),
                _track(selected_id),
            ]
        )
        await session.commit()

        state = UserAppState(
            user_id=uuid4(),
            playback_queue_track_ids=[
                str(first_id),
                str(unpublished_id),
                str(missing_id),
                str(selected_id),
            ],
            playback_queue_index=1,
        )

        queue, queue_index = await build_account_playback_queue(
            session,
            state,
            selected_id,
        )

    assert [item.id for item in queue] == [
        first_id,
        selected_id,
    ]
    assert queue_index == 1


@pytest.mark.asyncio
async def test_queue_canonicalization_caps_at_500() -> None:
    ignored_track_id = uuid4()
    queue_ids = [uuid4() for _ in range(500)] + [ignored_track_id]

    session_factory = get_session_factory()
    async with session_factory() as session:
        session.add(_track(ignored_track_id))
        await session.commit()

        state = UserAppState(
            user_id=uuid4(),
            playback_queue_track_ids=[
                str(track_id)
                for track_id in queue_ids
            ],
            playback_queue_index=500,
        )

        queue, queue_index = await build_account_playback_queue(
            session,
            state,
            None,
        )

    assert queue == []
    assert queue_index is None
