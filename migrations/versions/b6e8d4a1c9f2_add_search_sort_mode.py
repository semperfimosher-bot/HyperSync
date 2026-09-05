"""add search sort mode

Revision ID: b6e8d4a1c9f2
Revises: f3e91b7c4d2a
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b6e8d4a1c9f2"

down_revision: str | Sequence[str] | None = "f3e91b7c4d2a"

branch_labels: str | Sequence[str] | None = None

depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_app_state",
        sa.Column(
            "search_sort_mode",
            sa.String(length=20),
            nullable=False,
            server_default="smart",
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "user_app_state",
        "search_sort_mode",
    )
