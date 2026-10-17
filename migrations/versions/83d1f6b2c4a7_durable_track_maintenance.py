"""Persist track maintenance jobs with retryable expiring claims.

Revision ID: 83d1f6b2c4a7
Revises: 74c2e8f1a9b6
"""

from alembic import op
import sqlalchemy as sa

revision = "83d1f6b2c4a7"
down_revision = "74c2e8f1a9b6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "maintenance_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "track_id", sa.Uuid(), sa.ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("generation", sa.Integer(), server_default="0", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "available_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
        sa.Column("lock_token", sa.Uuid()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("kind", "track_id", name="uq_maintenance_jobs_kind_track"),
    )
    op.create_index(
        "ix_maintenance_jobs_claim",
        "maintenance_jobs",
        ["completed_at", "available_at", "locked_until"],
    )


def downgrade():
    op.drop_table("maintenance_jobs")
