"""add profile avatar

Revision ID: 9a4c7e2b1f6d
Revises: 7f9c3a1d2b4e
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9a4c7e2b1f6d"

down_revision: str | Sequence[str] | None = "7f9c3a1d2b4e"

branch_labels: str | Sequence[str] | None = None

depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column(
            "avatar_object_key",
            sa.String(length=512),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "user_profiles",
        "avatar_object_key",
    )
