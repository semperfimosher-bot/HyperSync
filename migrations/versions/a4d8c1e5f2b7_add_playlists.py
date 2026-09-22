"""add playlists

Revision ID: a4d8c1e5f2b7
Revises: e7a1c4d9b2f6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4d8c1e5f2b7"
down_revision: str | Sequence[str] | None = "e7a1c4d9b2f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "playlists",
        sa.Column(
            "owner_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "title",
            sa.String(length=120),
            nullable=False,
        ),
        sa.Column(
            "description",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "visibility",
            sa.String(length=16),
            server_default="private",
            nullable=False,
        ),
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "visibility IN ('private', 'unlisted', 'public', 'generated')",
            name=op.f("ck_playlists_playlist_visibility_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["users.id"],
            name=op.f("fk_playlists_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name=op.f("pk_playlists"),
        ),
    )

    op.create_index(
        op.f("ix_playlists_owner_id"),
        "playlists",
        ["owner_id"],
        unique=False,
    )

    op.create_index(
        op.f("ix_playlists_visibility"),
        "playlists",
        ["visibility"],
        unique=False,
    )

    op.create_table(
        "playlist_tracks",
        sa.Column(
            "playlist_id",
            sa.Uuid(),
            nullable=False,
        ),
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
            "id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["playlist_id"],
            ["playlists.id"],
            name=op.f("fk_playlist_tracks_playlist_id_playlists"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["tracks.id"],
            name=op.f("fk_playlist_tracks_track_id_tracks"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name=op.f("pk_playlist_tracks"),
        ),
    )

    op.create_index(
        op.f("ix_playlist_tracks_playlist_id"),
        "playlist_tracks",
        ["playlist_id"],
        unique=False,
    )

    op.create_index(
        op.f("ix_playlist_tracks_track_id"),
        "playlist_tracks",
        ["track_id"],
        unique=False,
    )

    op.create_table(
        "saved_playlists",
        sa.Column(
            "user_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "playlist_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_saved_playlists_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["playlist_id"],
            ["playlists.id"],
            name=op.f("fk_saved_playlists_playlist_id_playlists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id",
            "playlist_id",
            name=op.f("pk_saved_playlists"),
        ),
    )


def downgrade() -> None:
    op.drop_table("saved_playlists")

    op.drop_index(
        op.f("ix_playlist_tracks_track_id"),
        table_name="playlist_tracks",
    )

    op.drop_index(
        op.f("ix_playlist_tracks_playlist_id"),
        table_name="playlist_tracks",
    )

    op.drop_table("playlist_tracks")

    op.drop_index(
        op.f("ix_playlists_visibility"),
        table_name="playlists",
    )

    op.drop_index(
        op.f("ix_playlists_owner_id"),
        table_name="playlists",
    )

    op.drop_table("playlists")
