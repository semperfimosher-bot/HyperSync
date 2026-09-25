"""add messaging and push subscriptions

Revision ID: e4c9a2b7d1f5
Revises: a1c5e9f2b7d4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "e4c9a2b7d1f5"
down_revision: str | Sequence[str] | None = (
    "a1c5e9f2b7d4"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "messages",
        sa.Column(
            "sender_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "recipient_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "body",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "viewed_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=True,
        ),
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
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
        sa.CheckConstraint(
            "sender_id <> recipient_id",
            name="ck_messages_messages_not_self",
        ),
        sa.ForeignKeyConstraint(
            ["sender_id"],
            ["users.id"],
            ondelete="CASCADE",
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
        "ix_messages_sender_id",
        "messages",
        ["sender_id"],
        unique=False,
    )

    op.create_index(
        "ix_messages_recipient_id",
        "messages",
        ["recipient_id"],
        unique=False,
    )

    op.create_index(
        "ix_messages_recipient_viewed_created",
        "messages",
        [
            "recipient_id",
            "viewed_at",
            "created_at",
        ],
        unique=False,
    )

    op.create_index(
        "ix_messages_sender_recipient_created",
        "messages",
        [
            "sender_id",
            "recipient_id",
            "created_at",
        ],
        unique=False,
    )

    op.create_table(
        "push_subscriptions",
        sa.Column(
            "user_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "endpoint",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "p256dh",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "auth",
            sa.Text(),
            nullable=False,
        ),
        sa.Column(
            "user_agent",
            sa.String(
                length=512,
            ),
            nullable=True,
        ),
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
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
        sa.UniqueConstraint(
            "endpoint",
        ),
    )

    op.create_index(
        "ix_push_subscriptions_user_id",
        "push_subscriptions",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_push_subscriptions_user_id",
        table_name="push_subscriptions",
    )

    op.drop_table(
        "push_subscriptions",
    )

    op.drop_index(
        "ix_messages_sender_recipient_created",
        table_name="messages",
    )

    op.drop_index(
        "ix_messages_recipient_viewed_created",
        table_name="messages",
    )

    op.drop_index(
        "ix_messages_recipient_id",
        table_name="messages",
    )

    op.drop_index(
        "ix_messages_sender_id",
        table_name="messages",
    )

    op.drop_table(
        "messages",
    )
