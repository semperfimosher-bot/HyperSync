"""persist account playback queue

Revision ID: e3a8c5f1d7b2
Revises: d2f7a9c4e6b1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "e3a8c5f1d7b2"
down_revision: str | Sequence[str] | None = (
    "d2f7a9c4e6b1"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_app_state",
        sa.Column(
            "playback_queue_track_ids",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )

    op.add_column(
        "user_app_state",
        sa.Column(
            "playback_queue_index",
            sa.Integer(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "user_app_state",
        "playback_queue_index",
    )

    op.drop_column(
        "user_app_state",
        "playback_queue_track_ids",
    )
