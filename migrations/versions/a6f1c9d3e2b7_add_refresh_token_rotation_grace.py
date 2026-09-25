"""add refresh token rotation grace

Revision ID: a6f1c9d3e2b7
Revises: f8b2d6a4c1e9
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a6f1c9d3e2b7"
down_revision: str | Sequence[str] | None = (
    "f8b2d6a4c1e9"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column(
            "previous_refresh_token_hash",
            sa.String(
                length=64,
            ),
            nullable=True,
        ),
    )

    op.add_column(
        "user_sessions",
        sa.Column(
            "previous_refresh_valid_until",
            sa.DateTime(
                timezone=True,
            ),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_user_sessions_previous_refresh_token_hash",
        "user_sessions",
        [
            "previous_refresh_token_hash",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_sessions_previous_refresh_token_hash",
        table_name="user_sessions",
    )

    op.drop_column(
        "user_sessions",
        "previous_refresh_valid_until",
    )

    op.drop_column(
        "user_sessions",
        "previous_refresh_token_hash",
    )
