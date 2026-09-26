"""add persistent rate limit buckets

Revision ID: d2f7a9c4e6b1
Revises: c6a1e8d4b9f2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "d2f7a9c4e6b1"
down_revision: str | Sequence[str] | None = (
    "c6a1e8d4b9f2"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_buckets",
        sa.Column(
            "key",
            sa.String(
                length=160,
            ),
            nullable=False,
        ),
        sa.Column(
            "window_started_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "request_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint(
            "key",
            name=(
                "pk_rate_limit_buckets"
            ),
        ),
    )

    op.create_index(
        "ix_rate_limit_buckets_updated_at",
        "rate_limit_buckets",
        [
            "updated_at",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_rate_limit_buckets_updated_at",
        table_name=(
            "rate_limit_buckets"
        ),
    )

    op.drop_table(
        "rate_limit_buckets",
    )
