from fastapi import APIRouter

from ...api.routes.auth import UserResponse, make_user_response
from ..dependencies import CurrentUser

router = APIRouter(
    prefix="/users",
    tags=["users"],
)


@router.get(
    "/me",
    response_model=UserResponse,
)
async def get_me(
    user: CurrentUser,
):
    return make_user_response(user)
