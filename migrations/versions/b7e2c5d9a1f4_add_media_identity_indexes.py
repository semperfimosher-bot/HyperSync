"""add canonical media identity indexes

Revision ID: b7e2c5d9a1f4
Revises: a8d3f6c1e9b2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "b7e2c5d9a1f4"
down_revision: str | Sequence[str] | None = (
    "a8d3f6c1e9b2"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "track_identities",
        sa.Column(
            "track_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "artist_key",
            sa.String(
                length=255,
            ),
            nullable=False,
        ),
        sa.Column(
            "primary_artist_key",
            sa.String(
                length=255,
            ),
            nullable=False,
        ),
        sa.Column(
            "title_key",
            sa.String(
                length=255,
            ),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            [
                "track_id",
            ],
            [
                "tracks.id",
            ],
            name=(
                "fk_track_identities_track_id_tracks"
            ),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "track_id",
            name="pk_track_identities",
        ),
    )

    op.create_index(
        "ix_track_identities_artist_key",
        "track_identities",
        [
            "artist_key",
        ],
        unique=False,
    )

    op.create_index(
        "ix_track_identities_primary_artist_key",
        "track_identities",
        [
            "primary_artist_key",
        ],
        unique=False,
    )

    op.create_index(
        "ix_track_identities_title_key",
        "track_identities",
        [
            "title_key",
        ],
        unique=False,
    )

    op.create_index(
        "ix_track_identities_artist_title",
        "track_identities",
        [
            "artist_key",
            "title_key",
        ],
        unique=False,
    )

    op.create_index(
        "ix_track_identities_primary_artist_title",
        "track_identities",
        [
            "primary_artist_key",
            "title_key",
        ],
        unique=False,
    )

    op.create_table(
        "track_artist_credits",
        sa.Column(
            "track_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "position",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "artist_name",
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
            "is_primary",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.ForeignKeyConstraint(
            [
                "track_id",
            ],
            [
                "tracks.id",
            ],
            name=(
                "fk_track_artist_credits_track_id_tracks"
            ),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "track_id",
            "position",
            name="pk_track_artist_credits",
        ),
        sa.UniqueConstraint(
            "track_id",
            "normalized_name",
            name=(
                "uq_track_artist_credits_track_artist"
            ),
        ),
    )

    op.create_index(
        "ix_track_artist_credits_normalized_name",
        "track_artist_credits",
        [
            "normalized_name",
        ],
        unique=False,
    )

    op.create_index(
        "ix_track_artist_credits_is_primary",
        "track_artist_credits",
        [
            "is_primary",
        ],
        unique=False,
    )

    op.create_index(
        "ix_track_artist_credits_artist_track",
        "track_artist_credits",
        [
            "normalized_name",
            "track_id",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_track_artist_credits_artist_track",
        table_name="track_artist_credits",
    )

    op.drop_index(
        "ix_track_artist_credits_is_primary",
        table_name="track_artist_credits",
    )

    op.drop_index(
        "ix_track_artist_credits_normalized_name",
        table_name="track_artist_credits",
    )

    op.drop_table(
        "track_artist_credits",
    )

    op.drop_index(
        "ix_track_identities_primary_artist_title",
        table_name="track_identities",
    )

    op.drop_index(
        "ix_track_identities_artist_title",
        table_name="track_identities",
    )

    op.drop_index(
        "ix_track_identities_title_key",
        table_name="track_identities",
    )

    op.drop_index(
        "ix_track_identities_primary_artist_key",
        table_name="track_identities",
    )

    op.drop_index(
        "ix_track_identities_artist_key",
        table_name="track_identities",
    )

    op.drop_table(
        "track_identities",
    )
