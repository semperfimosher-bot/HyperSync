"""persist on-demand candidate and provision state

Revision ID: c8f3d6a1e9b4
Revises: b7e2c5d9a1f4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c8f3d6a1e9b4"
down_revision: str | Sequence[str] | None = (
    "b7e2c5d9a1f4"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "on_demand_candidates",
        sa.Column(
            "candidate_key",
            sa.String(
                length=160,
            ),
            nullable=False,
        ),
        sa.Column(
            "payload",
            sa.JSON(),
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
        sa.PrimaryKeyConstraint(
            "candidate_key",
            name=op.f(
                "pk_on_demand_candidates",
            ),
        ),
    )

    op.create_index(
        op.f(
            "ix_on_demand_candidates_expires_at",
        ),
        "on_demand_candidates",
        [
            "expires_at",
        ],
        unique=False,
    )

    op.create_table(
        "on_demand_provisions",
        sa.Column(
            "id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "candidate_key",
            sa.String(
                length=160,
            ),
            nullable=False,
        ),
        sa.Column(
            "candidate_payload",
            sa.JSON(),
            nullable=False,
        ),
        sa.Column(
            "state",
            sa.String(
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "source_payload",
            sa.JSON(),
            nullable=True,
        ),
        sa.Column(
            "track_id",
            sa.Uuid(),
            nullable=True,
        ),
        sa.Column(
            "error",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "ingest_started",
            sa.Boolean(),
            server_default=sa.false(),
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
            [
                "track_id",
            ],
            [
                "tracks.id",
            ],
            name=op.f(
                "fk_on_demand_provisions_track_id_tracks",
            ),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name=op.f(
                "pk_on_demand_provisions",
            ),
        ),
    )

    for column in (
        "candidate_key",
        "expires_at",
        "state",
        "track_id",
    ):
        op.create_index(
            op.f(
                "ix_on_demand_provisions_"
                + column,
            ),
            "on_demand_provisions",
            [
                column,
            ],
            unique=False,
        )

    op.create_table(
        "on_demand_pending_listeners",
        sa.Column(
            "provision_id",
            sa.Uuid(),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            nullable=False,
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
            [
                "provision_id",
            ],
            [
                "on_demand_provisions.id",
            ],
            name=op.f(
                "fk_on_demand_pending_listeners_provision_id_on_demand_provisions",
            ),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            [
                "user_id",
            ],
            [
                "users.id",
            ],
            name=op.f(
                "fk_on_demand_pending_listeners_user_id_users",
            ),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "provision_id",
            "user_id",
            name=op.f(
                "pk_on_demand_pending_listeners",
            ),
        ),
    )

    op.create_index(
        op.f(
            "ix_on_demand_pending_listeners_user_id",
        ),
        "on_demand_pending_listeners",
        [
            "user_id",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f(
            "ix_on_demand_pending_listeners_user_id",
        ),
        table_name=(
            "on_demand_pending_listeners"
        ),
    )

    op.drop_table(
        "on_demand_pending_listeners",
    )

    for column in (
        "track_id",
        "state",
        "expires_at",
        "candidate_key",
    ):
        op.drop_index(
            op.f(
                "ix_on_demand_provisions_"
                + column,
            ),
            table_name="on_demand_provisions",
        )

    op.drop_table(
        "on_demand_provisions",
    )

    op.drop_index(
        op.f(
            "ix_on_demand_candidates_expires_at",
        ),
        table_name="on_demand_candidates",
    )

    op.drop_table(
        "on_demand_candidates",
    )
