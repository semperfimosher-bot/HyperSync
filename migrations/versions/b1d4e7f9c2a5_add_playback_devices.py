"""add playback devices and remote commands

Revision ID: b1d4e7f9c2a5
Revises: a6f1c9d3e2b7
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "b1d4e7f9c2a5"
down_revision: str | Sequence[str] | None = (
    "a6f1c9d3e2b7"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "playback_devices",
        sa.Column(
            "user_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            sa.String(
                length=64,
            ),
            nullable=False,
        ),
        sa.Column(
            "name",
            sa.String(
                length=120,
            ),
            nullable=False,
        ),
        sa.Column(
            "device_type",
            sa.String(
                length=24,
            ),
            nullable=False,
            server_default="browser",
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            [
                "user_id",
            ],
            [
                "users.id",
            ],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id",
            "device_id",
        ),
    )

    op.create_index(
        op.f(
            "ix_playback_devices_last_seen_at",
        ),
        "playback_devices",
        [
            "last_seen_at",
        ],
        unique=False,
    )

    op.create_table(
        "playback_commands",
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "target_device_id",
            sa.String(
                length=64,
            ),
            nullable=False,
        ),
        sa.Column(
            "source_device_id",
            sa.String(
                length=64,
            ),
            nullable=False,
        ),
        sa.Column(
            "action",
            sa.String(
                length=24,
            ),
            nullable=False,
        ),
        sa.Column(
            "value",
            sa.Float(),
            nullable=True,
        ),
        sa.Column(
            "consumed_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            [
                "user_id",
            ],
            [
                "users.id",
            ],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id",
        ),
    )

    op.create_index(
        op.f(
            "ix_playback_commands_user_id",
        ),
        "playback_commands",
        [
            "user_id",
        ],
        unique=False,
    )

    op.create_index(
        op.f(
            "ix_playback_commands_target_device_id",
        ),
        "playback_commands",
        [
            "target_device_id",
        ],
        unique=False,
    )

    op.create_index(
        op.f(
            "ix_playback_commands_consumed_at",
        ),
        "playback_commands",
        [
            "consumed_at",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f(
            "ix_playback_commands_consumed_at",
        ),
        table_name="playback_commands",
    )

    op.drop_index(
        op.f(
            "ix_playback_commands_target_device_id",
        ),
        table_name="playback_commands",
    )

    op.drop_index(
        op.f(
            "ix_playback_commands_user_id",
        ),
        table_name="playback_commands",
    )

    op.drop_table(
        "playback_commands",
    )

    op.drop_index(
        op.f(
            "ix_playback_devices_last_seen_at",
        ),
        table_name="playback_devices",
    )

    op.drop_table(
        "playback_devices",
    )
