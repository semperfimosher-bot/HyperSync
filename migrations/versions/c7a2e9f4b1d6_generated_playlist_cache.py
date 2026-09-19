"""generated playlist cache

Revision ID: c7a2e9f4b1d6
Revises: a4d8c1e5f2b7
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7a2e9f4b1d6"
down_revision: str | Sequence[str] | None = "a4d8c1e5f2b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "playlists",
        "owner_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )

    op.add_column(
        "playlists",
        sa.Column(
            "generated_key",
            sa.String(length=96),
            nullable=True,
        ),
    )

    op.add_column(
        "playlists",
        sa.Column(
            "generated_query",
            sa.String(length=200),
            nullable=True,
        ),
    )

    op.add_column(
        "playlists",
        sa.Column(
            "generated_kind",
            sa.String(length=32),
            nullable=True,
        ),
    )

    op.add_column(
        "playlists",
        sa.Column(
            "generator_version",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.add_column(
        "playlists",
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.create_index(
        op.f(
            "ix_playlists_generated_key",
        ),
        "playlists",
        [
            "generated_key",
        ],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        op.f(
            "ix_playlists_generated_key",
        ),
        table_name="playlists",
    )

    op.drop_column(
        "playlists",
        "generated_at",
    )

    op.drop_column(
        "playlists",
        "generator_version",
    )

    op.drop_column(
        "playlists",
        "generated_kind",
    )

    op.drop_column(
        "playlists",
        "generated_query",
    )

    op.drop_column(
        "playlists",
        "generated_key",
    )

    # Generated global playlists have no
    # owner, so remove them before restoring
    # the NOT NULL constraint.
    op.execute(
        """
        DELETE FROM playlists
        WHERE owner_id IS NULL
        """
    )

    op.alter_column(
        "playlists",
        "owner_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
