"""persist catalog bot scans and items

Revision ID: a8d3f6c1e9b2
Revises: f4b9d2a7c1e6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "a8d3f6c1e9b2"
down_revision: str | Sequence[str] | None = (
    "f4b9d2a7c1e6"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bot_catalog_scans",
        sa.Column(
            "state",
            sa.String(
                length=32,
            ),
            nullable=False,
            server_default="queued",
        ),
        sa.Column(
            "auto_ingest",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "track_limit_per_artist",
            sa.Integer(),
            nullable=False,
            server_default="500",
        ),
        sa.Column(
            "ingest_concurrency",
            sa.Integer(),
            nullable=False,
            server_default="2",
        ),
        sa.Column(
            "artist_total",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "artists_scanned",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "artist_failures",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "current_artist",
            sa.String(
                length=255,
            ),
            nullable=True,
        ),
        sa.Column(
            "missing_discovered",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "ingest_started",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "ingest_ready",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "ingest_failed",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "cancel_requested",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "last_error",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(
                timezone=True,
            ),
            nullable=True,
        ),
        sa.Column(
            "finished_at",
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
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_bot_catalog_scans",
        ),
    )

    op.create_index(
        "ix_bot_catalog_scans_state",
        "bot_catalog_scans",
        [
            "state",
        ],
        unique=False,
    )

    op.create_index(
        "ix_bot_catalog_scans_cancel_requested",
        "bot_catalog_scans",
        [
            "cancel_requested",
        ],
        unique=False,
    )

    op.create_table(
        "bot_catalog_scan_items",
        sa.Column(
            "scan_id",
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
            "payload",
            sa.JSON(),
            nullable=False,
        ),
        sa.Column(
            "state",
            sa.String(
                length=32,
            ),
            nullable=False,
            server_default="discovered",
        ),
        sa.Column(
            "track_id",
            sa.Uuid(),
            nullable=True,
        ),
        sa.Column(
            "attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "error",
            sa.Text(),
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
            [
                "scan_id",
            ],
            [
                "bot_catalog_scans.id",
            ],
            name=(
                "fk_bot_catalog_scan_items_scan_id_"
                "bot_catalog_scans"
            ),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name="pk_bot_catalog_scan_items",
        ),
        sa.UniqueConstraint(
            "scan_id",
            "candidate_key",
            name=(
                "uq_bot_catalog_scan_items_scan_candidate"
            ),
        ),
    )

    op.create_index(
        "ix_bot_catalog_scan_items_scan_id",
        "bot_catalog_scan_items",
        [
            "scan_id",
        ],
        unique=False,
    )

    op.create_index(
        "ix_bot_catalog_scan_items_state",
        "bot_catalog_scan_items",
        [
            "state",
        ],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bot_catalog_scan_items_state",
        table_name="bot_catalog_scan_items",
    )

    op.drop_index(
        "ix_bot_catalog_scan_items_scan_id",
        table_name="bot_catalog_scan_items",
    )

    op.drop_table(
        "bot_catalog_scan_items",
    )

    op.drop_index(
        "ix_bot_catalog_scans_cancel_requested",
        table_name="bot_catalog_scans",
    )

    op.drop_index(
        "ix_bot_catalog_scans_state",
        table_name="bot_catalog_scans",
    )

    op.drop_table(
        "bot_catalog_scans",
    )
