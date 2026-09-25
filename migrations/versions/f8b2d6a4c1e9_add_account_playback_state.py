"""add account playback state

Revision ID: f8b2d6a4c1e9
Revises: e4c9a2b7d1f5
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f8b2d6a4c1e9"
down_revision: str | Sequence[str] | None = (
    "e4c9a2b7d1f5"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_app_state",
        sa.Column(
            "playback_track_id",
            sa.Uuid(),
            nullable=True,
        ),
    )

    op.add_column(
        "user_app_state",
        sa.Column(
            "playback_position_seconds",
            sa.Float(),
            nullable=False,
            server_default="0",
        ),
    )

    op.add_column(
        "user_app_state",
        sa.Column(
            "playback_paused",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    op.add_column(
        "user_app_state",
        sa.Column(
            "playback_device_id",
            sa.String(
                length=64,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "user_app_state",
        sa.Column(
            "playback_updated_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=True,
        ),
    )

    op.create_foreign_key(
        "fk_user_app_state_playback_track_id_tracks",
        "user_app_state",
        "tracks",
        [
            "playback_track_id",
        ],
        [
            "id",
        ],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_user_app_state_playback_track_id_tracks",
        "user_app_state",
        type_="foreignkey",
    )

    op.drop_column(
        "user_app_state",
        "playback_updated_at",
    )

    op.drop_column(
        "user_app_state",
        "playback_device_id",
    )

    op.drop_column(
        "user_app_state",
        "playback_paused",
    )

    op.drop_column(
        "user_app_state",
        "playback_position_seconds",
    )

    op.drop_column(
        "user_app_state",
        "playback_track_id",
    )
