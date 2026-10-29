from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ...models.account import AccountType, User, UserProfile
from ...services.b2 import delete_all_object_versions, get_b2_bucket
from ..dependencies import AdminUser, DatabaseSession

router = APIRouter(
    prefix="/admin",
    tags=["administration"],
)


@router.get("/access")
async def check_admin_access(
    user: AdminUser,
):
    return {
        "authorized": True,
        "user_id": str(user.id),
        "username": user.username,
        "role": user.role.value,
        "message": "Administrator access granted.",
    }


async def _delete_admin_selected_user(
    session: DatabaseSession,
    target: User,
) -> int:
    avatar_object_key = (
        target.profile.avatar_object_key
        if target.profile is not None
        else None
    )

    deleted_avatar_versions = 0

    if avatar_object_key:
        try:
            bucket = get_b2_bucket()

            deleted_avatar_versions = (
                await delete_all_object_versions(
                    bucket,
                    avatar_object_key,
                )
            )

        except Exception as exc:
            await session.rollback()

            raise HTTPException(
                status_code=(
                    status.HTTP_500_INTERNAL_SERVER_ERROR
                ),
                detail=(
                    "Unable to remove the user's "
                    "avatar data from B2. "
                    "The account was not deleted."
                ),
            ) from exc

    try:
        await session.delete(
            target,
        )

        await session.commit()

    except Exception as exc:
        await session.rollback()

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Unable to delete the user account "
                "and related database data."
            ),
        ) from exc

    return deleted_avatar_versions


@router.get(
    "/users",
)
async def admin_search_users(
    q: str,
    user: AdminUser,
    session: DatabaseSession,
):
    term = q.strip()

    if not term:
        return {
            "users": [],
        }

    pattern = (
        f"%{term}%"
    )

    result = await session.execute(
        select(
            User,
        )
        .outerjoin(
            UserProfile,
            UserProfile.user_id
            == User.id,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            User.account_type
            == AccountType.REGISTERED,
            (
                User.username.ilike(
                    pattern,
                )
                | User.email.ilike(
                    pattern,
                )
                | UserProfile.display_name.ilike(
                    pattern,
                )
            ),
        )
        .order_by(
            User.username.asc(),
        )
        .limit(
            50,
        )
    )

    users = (
        result.scalars().all()
    )

    return {
        "users": [
            {
                "id":
                    str(
                        found.id,
                    ),
                "username":
                    found.username
                    or "",
                "email":
                    found.email
                    or "",
                "display_name":
                    (
                        found.profile.display_name
                        if found.profile
                        else found.username
                        or "User"
                    ),
                "role":
                    found.role.value,
                "active":
                    bool(
                        found.is_active,
                    ),
                "member_since":
                    (
                        found.created_at.isoformat()
                        if found.created_at
                        else None
                    ),
                "has_avatar":
                    bool(
                        found.profile
                        and found.profile.avatar_object_key
                    ),
                "is_current_admin":
                    found.id
                    == user.id,
            }
            for found in users
        ],
    }


@router.delete(
    "/users/{user_id}",
)
async def admin_delete_user(
    user_id: UUID,
    user: AdminUser,
    session: DatabaseSession,
):
    if user_id == user.id:
        raise HTTPException(
            status_code=(
                status.HTTP_400_BAD_REQUEST
            ),
            detail=(
                "You cannot delete the admin "
                "account currently signed in."
            ),
        )

    result = await session.execute(
        select(
            User,
        )
        .options(
            selectinload(
                User.profile,
            ),
        )
        .where(
            User.id
            == user_id,
        )
    )

    target = (
        result.scalar_one_or_none()
    )

    if target is None:
        raise HTTPException(
            status_code=(
                status.HTTP_404_NOT_FOUND
            ),
            detail=(
                "User account not found."
            ),
        )

    username = (
        target.username
        or str(
            target.id,
        )
    )

    deleted_avatar_versions = (
        await _delete_admin_selected_user(
            session,
            target,
        )
    )

    return {
        "success": True,
        "username":
            username,
        "deleted_avatar_versions":
            deleted_avatar_versions,
        "message": (
            "User account, sessions, profile, "
            "follows, playlists, saved playlists, "
            "listening history, app state, and "
            "profile avatar data were deleted."
        ),
    }
