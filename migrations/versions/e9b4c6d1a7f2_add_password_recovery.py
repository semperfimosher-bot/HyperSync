"""add password recovery records

Revision ID: e9b4c6d1a7f2
Revises: c4e8a1b7d3f6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "e9b4c6d1a7f2"
down_revision: str | Sequence[str] | None = (
    "c4e8a1b7d3f6"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_recoveries",
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "otp_hash",
            sa.String(
                length=64,
            ),
            nullable=False,
        ),
        sa.Column(
            "reset_token_hash",
            sa.String(
                length=64,
            ),
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
        ),
        sa.Column(
            "attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "consumed_at",
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
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id",
        ),
    )

    op.create_index(
        op.f("ix_password_recoveries_user_id"),
        "password_recoveries",
        ["user_id"],
        unique=False,
    )

    op.create_index(
        op.f("ix_password_recoveries_reset_token_hash"),
        "password_recoveries",
        ["reset_token_hash"],
        unique=True,
    )

    op.create_index(
        op.f("ix_password_recoveries_expires_at"),
        "password_recoveries",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_password_recoveries_expires_at"),
        table_name="password_recoveries",
    )
    op.drop_index(
        op.f("ix_password_recoveries_reset_token_hash"),
        table_name="password_recoveries",
    )
    op.drop_index(
        op.f("ix_password_recoveries_user_id"),
        table_name="password_recoveries",
    )
    op.drop_table("password_recoveries")
