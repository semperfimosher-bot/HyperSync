"""smart listening signals

Revision ID: d9f4c2b7a1e3
Revises: c7a2e9f4b1d6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9f4c2b7a1e3"
down_revision: str | Sequence[str] | None = (
    "c7a2e9f4b1d6"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tracks",
        sa.Column(
            "genre",
            sa.String(120),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_tracks_genre",
        "tracks",
        ["genre"],
        unique=False,
    )

    op.add_column(
        "listening_events",
        sa.Column(
            "progress_seconds",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.add_column(
        "listening_events",
        sa.Column(
            "completion_ratio",
            sa.Float(),
            nullable=True,
        ),
    )

    op.add_column(
        "listening_events",
        sa.Column(
            "completed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.add_column(
        "listening_events",
        sa.Column(
            "skipped",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.add_column(
        "listening_events",
        sa.Column(
            "ended_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "listening_events",
        "ended_at",
    )

    op.drop_column(
        "listening_events",
        "skipped",
    )

    op.drop_column(
        "listening_events",
        "completed",
    )

    op.drop_column(
        "listening_events",
        "completion_ratio",
    )

    op.drop_column(
        "listening_events",
        "progress_seconds",
    )

    op.drop_index(
        "ix_tracks_genre",
        table_name="tracks",
    )

    op.drop_column(
        "tracks",
        "genre",
    )
