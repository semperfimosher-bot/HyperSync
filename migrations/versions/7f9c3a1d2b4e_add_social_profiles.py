"""add social profiles and listening history

Revision ID: 7f9c3a1d2b4e
Revises: 2b10a940e4dc
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7f9c3a1d2b4e"

down_revision: str | Sequence[str] | None = "2b10a940e4dc"

branch_labels: str | Sequence[str] | None = None

depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column(
            "is_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )

    op.create_table(
        "user_follows",
        sa.Column(
            "follower_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "following_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "follower_id",
            "following_id",
        ),
        sa.ForeignKeyConstraint(
            ["follower_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["following_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "follower_id",
            "following_id",
            name="uq_user_follows_pair",
        ),
        sa.CheckConstraint(
            "follower_id <> following_id",
            name="ck_user_follows_not_self",
        ),
    )

    op.create_table(
        "listening_events",
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
            "track_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "listened_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "id",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["tracks.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_listening_events_user_id",
        "listening_events",
        ["user_id"],
    )

    op.create_index(
        "ix_listening_events_track_id",
        "listening_events",
        ["track_id"],
    )

    op.create_index(
        "ix_listening_events_listened_at",
        "listening_events",
        ["listened_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_listening_events_listened_at",
        table_name="listening_events",
    )

    op.drop_index(
        "ix_listening_events_track_id",
        table_name="listening_events",
    )

    op.drop_index(
        "ix_listening_events_user_id",
        table_name="listening_events",
    )

    op.drop_table(
        "listening_events",
    )

    op.drop_table(
        "user_follows",
    )

    op.drop_column(
        "user_profiles",
        "is_public",
    )
