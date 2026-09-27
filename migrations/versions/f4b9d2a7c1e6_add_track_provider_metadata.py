"""add canonical provider metadata to tracks

Revision ID: f4b9d2a7c1e6
Revises: e3a8c5f1d7b2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f4b9d2a7c1e6"
down_revision: str | Sequence[str] | None = (
    "e3a8c5f1d7b2"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tracks",
        sa.Column(
            "isrc",
            sa.String(
                length=32,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "tracks",
        sa.Column(
            "deezer_track_id",
            sa.String(
                length=64,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "tracks",
        sa.Column(
            "apple_track_id",
            sa.String(
                length=64,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "tracks",
        sa.Column(
            "source_provider",
            sa.String(
                length=40,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "tracks",
        sa.Column(
            "source_id",
            sa.String(
                length=160,
            ),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_tracks_isrc",
        "tracks",
        [
            "isrc",
        ],
        unique=False,
    )

    op.create_index(
        "ix_tracks_deezer_track_id",
        "tracks",
        [
            "deezer_track_id",
        ],
        unique=False,
    )

    op.create_index(
        "ix_tracks_apple_track_id",
        "tracks",
        [
            "apple_track_id",
        ],
        unique=False,
    )

    op.create_index(
        "ix_tracks_source_id",
        "tracks",
        [
            "source_id",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tracks_source_id",
        table_name="tracks",
    )

    op.drop_index(
        "ix_tracks_apple_track_id",
        table_name="tracks",
    )

    op.drop_index(
        "ix_tracks_deezer_track_id",
        table_name="tracks",
    )

    op.drop_index(
        "ix_tracks_isrc",
        table_name="tracks",
    )

    op.drop_column(
        "tracks",
        "source_id",
    )

    op.drop_column(
        "tracks",
        "source_provider",
    )

    op.drop_column(
        "tracks",
        "apple_track_id",
    )

    op.drop_column(
        "tracks",
        "deezer_track_id",
    )

    op.drop_column(
        "tracks",
        "isrc",
    )
