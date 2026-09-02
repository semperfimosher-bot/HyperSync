"""add track lyrics cache

Revision ID: f3e91b7c4d2a
Revises: d8f4a1c6b2e7
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f3e91b7c4d2a"

down_revision: str | Sequence[str] | None = "d8f4a1c6b2e7"

branch_labels: str | Sequence[str] | None = None

depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "track_lyrics",
        sa.Column(
            "track_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "lrclib_id",
            sa.BigInteger(),
            nullable=True,
        ),
        sa.Column(
            "plain_lyrics",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "synced_lyrics",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "instrumental",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text(
                "false",
            ),
        ),
        sa.Column(
            "checked_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.text(
                "now()",
            ),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.text(
                "now()",
            ),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.text(
                "now()",
            ),
        ),
        sa.ForeignKeyConstraint(
            ["track_id"],
            ["tracks.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "track_id",
        ),
    )


def downgrade() -> None:
    op.drop_table(
        "track_lyrics",
    )
