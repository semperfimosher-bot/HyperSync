"""link admin notifications to source messages

Revision ID: b5e9d2a4c7f1
Revises: a2d6f8c1b4e7
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "b5e9d2a4c7f1"
down_revision: str | Sequence[str] | None = (
    "a2d6f8c1b4e7"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "admin_notifications",
        sa.Column(
            "source_message_id",
            sa.Uuid(),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_admin_notifications_source_message_id",
        "admin_notifications",
        ["source_message_id"],
        unique=False,
    )

    op.create_foreign_key(
        "fk_admin_notifications_source_message_id_messages",
        "admin_notifications",
        "messages",
        ["source_message_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_admin_notifications_source_message_id_messages",
        "admin_notifications",
        type_="foreignkey",
    )

    op.drop_index(
        "ix_admin_notifications_source_message_id",
        table_name="admin_notifications",
    )

    op.drop_column(
        "admin_notifications",
        "source_message_id",
    )
