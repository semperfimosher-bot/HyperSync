"""add admin activity notifications

Revision ID: f1a7c9d3e5b2
Revises: e9b4c6d1a7f2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "f1a7c9d3e5b2"
down_revision: str | Sequence[str] | None = (
    "e9b4c6d1a7f2"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_notifications",
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "recipient_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "kind",
            sa.String(
                length=64,
            ),
            nullable=False,
        ),
        sa.Column(
            "title",
            sa.String(
                length=160,
            ),
            nullable=False,
        ),
        sa.Column(
            "body",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "actor_username",
            sa.String(
                length=32,
            ),
            nullable=True,
        ),
        sa.Column(
            "viewed_at",
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
        sa.ForeignKeyConstraint(
            ["recipient_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id",
        ),
    )

    op.create_index(
        "ix_admin_notifications_recipient_id",
        "admin_notifications",
        ["recipient_id"],
        unique=False,
    )

    op.create_index(
        "ix_admin_notifications_recipient_viewed_created",
        "admin_notifications",
        [
            "recipient_id",
            "viewed_at",
            "created_at",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_admin_notifications_recipient_viewed_created",
        table_name="admin_notifications",
    )

    op.drop_index(
        "ix_admin_notifications_recipient_id",
        table_name="admin_notifications",
    )

    op.drop_table(
        "admin_notifications",
    )
