"""add user app state

Revision ID: d8f4a1c6b2e7
Revises: c3b7f1d9e2a4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d8f4a1c6b2e7"

down_revision: str | Sequence[str] | None = "c3b7f1d9e2a4"

branch_labels: str | Sequence[str] | None = None

depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_app_state",
        sa.Column(
            "user_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "active_page",
            sa.String(
                length=32,
            ),
            nullable=False,
            server_default=sa.text(
                "'home'",
            ),
        ),
        sa.Column(
            "search_query",
            sa.String(
                length=200,
            ),
            nullable=False,
            server_default=sa.text(
                "''",
            ),
        ),
        sa.Column(
            "profile_username",
            sa.String(
                length=32,
            ),
            nullable=True,
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
        sa.PrimaryKeyConstraint(
            "user_id",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
    )


def downgrade() -> None:
    op.drop_table(
        "user_app_state",
    )
