"""add track release year

Revision ID: c6a1e8d4b9f2
Revises: b5e9d2a4c7f1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c6a1e8d4b9f2"
down_revision: str | Sequence[str] | None = (
    "b5e9d2a4c7f1"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tracks",
        sa.Column(
            "release_year",
            sa.Integer(),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_tracks_release_year",
        "tracks",
        ["release_year"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_tracks_release_year",
        table_name="tracks",
    )

    op.drop_column(
        "tracks",
        "release_year",
    )
