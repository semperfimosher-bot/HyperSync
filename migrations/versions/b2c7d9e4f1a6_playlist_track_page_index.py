"""Index playlist membership ordering for bounded page reads.

Revision ID: b2c7d9e4f1a6
Revises: 83d1f6b2c4a7
"""

from alembic import op

revision = "b2c7d9e4f1a6"
down_revision = "83d1f6b2c4a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_playlist_tracks_page_order",
        "playlist_tracks",
        ["playlist_id", "position", "created_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_playlist_tracks_page_order",
        table_name="playlist_tracks",
    )
