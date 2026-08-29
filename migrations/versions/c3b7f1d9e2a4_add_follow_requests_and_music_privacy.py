"""add follow requests and music privacy

Revision ID: c3b7f1d9e2a4
Revises: 9a4c7e2b1f6d
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3b7f1d9e2a4"

down_revision: str | Sequence[str] | None = "9a4c7e2b1f6d"

branch_labels: str | Sequence[str] | None = None

depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column(
            "music_activity_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.add_column(
        "user_follows",
        sa.Column(
            "accepted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # Existing follows were already accepted under the old system,
    # so preserve them as accepted relationships.
    op.execute(
        """
        UPDATE user_follows
        SET accepted_at = CURRENT_TIMESTAMP
        WHERE accepted_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column(
        "user_follows",
        "accepted_at",
    )

    op.drop_column(
        "user_profiles",
        "music_activity_public",
    )
