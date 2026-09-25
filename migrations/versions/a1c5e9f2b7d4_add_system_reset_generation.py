"""add global reset generation state

Revision ID: a1c5e9f2b7d4
Revises: d9f4c2b7a1e3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a1c5e9f2b7d4"
down_revision: (
    str
    | Sequence[str]
    | None
) = "d9f4c2b7a1e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_reset_state",
        sa.Column(
            "id",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "generation",
            sa.BigInteger(),
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
            "id",
            name=(
                "pk_system_reset_state"
            ),
        ),
    )

    op.execute(
        sa.text(
            "INSERT INTO "
            "system_reset_state "
            "(id, generation) "
            "VALUES (1, 0)"
        )
    )


def downgrade() -> None:
    op.drop_table(
        "system_reset_state",
    )
