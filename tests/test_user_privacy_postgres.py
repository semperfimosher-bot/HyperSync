"""CI coverage using disposable PostgreSQL for actual relationship and join policy."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker

from backend.app.api.routes import users
from backend.app.models.account import AccountType, User, UserFollow, UserProfile
from scripts.verification.postgres_database import create_postgres_test_engine


def make_user(name, *, public=False, active=True):
    username = f"{name}-{uuid4().hex[:8]}"
    return User(
        account_type=AccountType.REGISTERED,
        username=username,
        username_normalized=username,
        email=f"{username}@example.test",
        password_hash="unused-test-hash",
        is_active=active,
        profile=UserProfile(display_name=name, music_activity_public=public),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("public", [False, True])
@pytest.mark.parametrize("relationship", ["anonymous", "none", "pending", "accepted", "self"])
async def test_following_matches_profile_with_real_relationships(public, relationship):
    engine = create_postgres_test_engine()
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            target = make_user("owner", public=public)
            outsider = make_user("viewer")
            followed = make_user("friend")
            pending = make_user("pending-friend")
            inactive = make_user("inactive-friend", active=False)
            reverse = make_user("reverse-friend")
            session.add_all([target, outsider, followed, pending, inactive, reverse])
            await session.flush()
            now = datetime.now(UTC)
            session.add_all(
                [
                    UserFollow(follower_id=target.id, following_id=followed.id, accepted_at=now),
                    UserFollow(follower_id=target.id, following_id=pending.id, accepted_at=None),
                    UserFollow(follower_id=target.id, following_id=inactive.id, accepted_at=now),
                    UserFollow(follower_id=reverse.id, following_id=target.id, accepted_at=now),
                ]
            )
            if relationship in {"pending", "accepted"}:
                session.add(
                    UserFollow(
                        follower_id=outsider.id,
                        following_id=target.id,
                        accepted_at=now if relationship == "accepted" else None,
                    )
                )
            await session.commit()
            viewer = (
                None
                if relationship == "anonymous"
                else target
                if relationship == "self"
                else outsider
            )
            assert target.username is not None
            profile = await users.get_public_profile(target.username, session, viewer)
            allowed = public or relationship in {"self", "accepted"}
            assert profile.can_view_activity is allowed
            if allowed:
                result = await users.get_following(target.username, session, viewer)
                assert [row.username for row in result] == [followed.username]
            else:
                with pytest.raises(HTTPException) as exc:
                    await users.get_following(target.username, session, viewer)
                assert exc.value.status_code == 403
                assert profile.following_count is None
                assert profile.recently_played == []
    finally:
        await engine.dispose()
