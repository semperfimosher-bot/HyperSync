from fastapi import APIRouter

from ...models import (
    SystemResetState,
)
from ..dependencies import (
    DatabaseSession,
)


router = APIRouter(
    prefix="/system",
    tags=["system"],
)


@router.get(
    "/reset-state",
)
async def get_reset_state(
    session: DatabaseSession,
):
    state = await session.get(
        SystemResetState,
        1,
    )

    if state is None:
        state = SystemResetState(
            id=1,
            generation=0,
        )

        session.add(
            state,
        )

        await session.commit()

    return {
        "generation":
            int(
                state.generation
                or 0
            ),
    }
