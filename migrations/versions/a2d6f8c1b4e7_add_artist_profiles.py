"""add artist profiles and follows

Revision ID: a2d6f8c1b4e7
Revises: f1a7c9d3e5b2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a2d6f8c1b4e7"
down_revision: str | Sequence[str] | None = (
    "f1a7c9d3e5b2"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "artist_profiles",
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "name",
            sa.String(
                length=255,
            ),
            nullable=False,
        ),
        sa.Column(
            "normalized_name",
            sa.String(
                length=255,
            ),
            nullable=False,
        ),
        sa.Column(
            "bio",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(
                timezone=True,
            ),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(
                timezone=True,
            ),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            "id",
        ),
        sa.UniqueConstraint(
            "normalized_name",
        ),
    )

    op.create_index(
        "ix_artist_profiles_normalized_name",
        "artist_profiles",
        ["normalized_name"],
        unique=True,
    )

    op.create_table(
        "artist_follows",
        sa.Column(
            "user_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "artist_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(
                timezone=True,
            ),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(
                timezone=True,
            ),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artist_profiles.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id",
            "artist_id",
        ),
    )

    op.create_index(
        "ix_artist_follows_artist_id",
        "artist_follows",
        ["artist_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_artist_follows_artist_id",
        table_name="artist_follows",
    )
    op.drop_table(
        "artist_follows",
    )

    op.drop_index(
        "ix_artist_profiles_normalized_name",
        table_name="artist_profiles",
    )
    op.drop_table(
        "artist_profiles",
    )
