"""Preserve earliest memberships and enforce playlist membership uniqueness.

Revision ID: 74c2e8f1a9b6
Revises: 6a4d9e8b1c2f
"""

from alembic import op

revision = "74c2e8f1a9b6"
down_revision = "6a4d9e8b1c2f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Block concurrent writers through cleanup and invariant installation.
    op.execute("LOCK TABLE playlist_tracks IN ACCESS EXCLUSIVE MODE")
    op.execute("""
        DELETE FROM playlist_tracks WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY playlist_id, track_id ORDER BY created_at, id
                ) AS occurrence FROM playlist_tracks
            ) AS duplicates WHERE occurrence > 1
        )
    """)
    op.execute("""
        WITH positions AS (
            SELECT id, row_number() OVER (
                PARTITION BY playlist_id ORDER BY position, created_at, id
            ) - 1 AS new_position FROM playlist_tracks
        )
        UPDATE playlist_tracks AS membership
        SET position = positions.new_position
        FROM positions WHERE membership.id = positions.id
    """)
    op.create_unique_constraint(
        "uq_playlist_tracks_playlist_track", "playlist_tracks", ["playlist_id", "track_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_playlist_tracks_playlist_track", "playlist_tracks", type_="unique")
