from fastapi import APIRouter

from ..dependencies import AdminUser

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
