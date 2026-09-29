"""Add durable Jam sessions and shared queues.

Revision ID: 6a4d9e8b1c2f
Revises: c8f3d6a1e9b4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6a4d9e8b1c2f"
down_revision: str | Sequence[str] | None = "c8f3d6a1e9b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "jam_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "host_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("invite_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("invite_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("allow_guest_control", sa.Boolean(), nullable=False),
        sa.Column("current_track_id", sa.Uuid(), sa.ForeignKey("tracks.id", ondelete="SET NULL")),
        sa.Column("current_item_id", sa.Uuid()),
        sa.Column("position_seconds", sa.Float(), nullable=False),
        sa.Column("anchor_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paused", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_jam_sessions_host_id", "jam_sessions", ["host_id"])
    op.create_table(
        "jam_members",
        sa.Column(
            "jam_id",
            sa.Uuid(),
            sa.ForeignKey("jam_sessions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_jam_members_user_id", "jam_members", ["user_id"], unique=True)
    op.create_table(
        "jam_queue_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "jam_id",
            sa.Uuid(),
            sa.ForeignKey("jam_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "track_id", sa.Uuid(), sa.ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "added_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_jam_queue_items_jam_id", "jam_queue_items", ["jam_id"])


def downgrade() -> None:
    op.drop_index("ix_jam_queue_items_jam_id", table_name="jam_queue_items")
    op.drop_table("jam_queue_items")
    op.drop_index("ix_jam_members_user_id", table_name="jam_members")
    op.drop_table("jam_members")
    op.drop_index("ix_jam_sessions_host_id", table_name="jam_sessions")
    op.drop_table("jam_sessions")
