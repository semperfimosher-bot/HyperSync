"""add durable media deletion outbox

Revision ID: c9f1e4a7b2d6
Revises: b7e2c5d9a1f4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c9f1e4a7b2d6"
down_revision: str | Sequence[str] | None = (
    "b7e2c5d9a1f4"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_deletion_jobs",
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "track_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "object_keys",
            sa.JSON(),
            nullable=False,
        ),
        sa.Column(
            "state",
            sa.String(
                length=24,
            ),
            nullable=False,
        ),
        sa.Column(
            "attempts",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "deleted_versions",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "last_error",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "finished_at",
            sa.DateTime(
                timezone=True,
            ),
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
            name="pk_media_deletion_jobs",
        ),
    )

    op.create_index(
        "ix_media_deletion_jobs_track_id",
        "media_deletion_jobs",
        [
            "track_id",
        ],
        unique=False,
    )

    op.create_index(
        "ix_media_deletion_jobs_state",
        "media_deletion_jobs",
        [
            "state",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_media_deletion_jobs_state",
        table_name="media_deletion_jobs",
    )

    op.drop_index(
        "ix_media_deletion_jobs_track_id",
        table_name="media_deletion_jobs",
    )

    op.drop_table(
        "media_deletion_jobs",
    )
