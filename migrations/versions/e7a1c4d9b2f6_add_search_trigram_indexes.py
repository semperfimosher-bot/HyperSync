"""add search trigram indexes

Revision ID: e7a1c4d9b2f6
Revises: b6e8d4a1c9f2
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e7a1c4d9b2f6"

down_revision: str | Sequence[str] | None = "b6e8d4a1c9f2"

branch_labels: str | Sequence[str] | None = None

depends_on: str | Sequence[str] | None = None


TRACK_INDEXES = (
    (
        "ix_tracks_title_trgm",
        "title",
    ),
    (
        "ix_tracks_artist_trgm",
        "artist",
    ),
    (
        "ix_tracks_album_trgm",
        "album",
    ),
)

USER_INDEXES = (
    (
        "ix_users_username_trgm",
        "username",
    ),
    (
        "ix_users_username_normalized_trgm",
        "username_normalized",
    ),
)

PROFILE_INDEXES = (
    (
        "ix_user_profiles_display_name_trgm",
        "display_name",
    ),
)


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name != "postgresql":
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    for (
        index_name,
        column_name,
    ) in TRACK_INDEXES:
        op.create_index(
            index_name,
            "tracks",
            [column_name],
            unique=False,
            postgresql_using="gin",
            postgresql_ops={
                column_name: "gin_trgm_ops",
            },
        )

    for (
        index_name,
        column_name,
    ) in USER_INDEXES:
        op.create_index(
            index_name,
            "users",
            [column_name],
            unique=False,
            postgresql_using="gin",
            postgresql_ops={
                column_name: "gin_trgm_ops",
            },
        )

    for (
        index_name,
        column_name,
    ) in PROFILE_INDEXES:
        op.create_index(
            index_name,
            "user_profiles",
            [column_name],
            unique=False,
            postgresql_using="gin",
            postgresql_ops={
                column_name: "gin_trgm_ops",
            },
        )


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name != "postgresql":
        return

    for (
        index_name,
        _,
    ) in reversed(
        PROFILE_INDEXES,
    ):
        op.drop_index(
            index_name,
            table_name="user_profiles",
        )

    for (
        index_name,
        _,
    ) in reversed(
        USER_INDEXES,
    ):
        op.drop_index(
            index_name,
            table_name="users",
        )

    for (
        index_name,
        _,
    ) in reversed(
        TRACK_INDEXES,
    ):
        op.drop_index(
            index_name,
            table_name="tracks",
        )
