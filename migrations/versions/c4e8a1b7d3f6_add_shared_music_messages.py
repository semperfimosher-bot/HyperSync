"""add shared music messages

Revision ID: c4e8a1b7d3f6
Revises: b1d4e7f9c2a5
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c4e8a1b7d3f6"
down_revision: str | Sequence[str] | None = (
    "b1d4e7f9c2a5"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "shared_kind",
            sa.String(
                length=16,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "messages",
        sa.Column(
            "shared_key",
            sa.String(
                length=512,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "messages",
        sa.Column(
            "shared_title",
            sa.String(
                length=300,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "messages",
        sa.Column(
            "shared_subtitle",
            sa.String(
                length=300,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "messages",
        sa.Column(
            "shared_artwork_url",
            sa.Text(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "messages",
        "shared_artwork_url",
    )

    op.drop_column(
        "messages",
        "shared_subtitle",
    )

    op.drop_column(
        "messages",
        "shared_title",
    )

    op.drop_column(
        "messages",
        "shared_key",
    )

    op.drop_column(
        "messages",
        "shared_kind",
    )
