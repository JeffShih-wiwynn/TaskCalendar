"""add google sync outbox

Revision ID: 20260701_000003
Revises: 20260701_000002
Create Date: 2026-07-01 00:00:03
"""

from alembic import op
import sqlalchemy as sa


revision = "20260701_000003"
down_revision = "20260701_000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "google_sync_outbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("operation", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.String(length=100), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["scheduled_tasks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_google_sync_outbox_status_available_at",
        "google_sync_outbox",
        ["status", "available_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_sync_outbox_idempotency_key"),
        "google_sync_outbox",
        ["idempotency_key"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_sync_outbox_locked_at"),
        "google_sync_outbox",
        ["locked_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_sync_outbox_status"),
        "google_sync_outbox",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_sync_outbox_task_id"),
        "google_sync_outbox",
        ["task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_sync_outbox_user_id"),
        "google_sync_outbox",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_google_sync_outbox_user_id"), table_name="google_sync_outbox")
    op.drop_index(op.f("ix_google_sync_outbox_task_id"), table_name="google_sync_outbox")
    op.drop_index(op.f("ix_google_sync_outbox_status"), table_name="google_sync_outbox")
    op.drop_index(op.f("ix_google_sync_outbox_locked_at"), table_name="google_sync_outbox")
    op.drop_index(op.f("ix_google_sync_outbox_idempotency_key"), table_name="google_sync_outbox")
    op.drop_index("ix_google_sync_outbox_status_available_at", table_name="google_sync_outbox")
    op.drop_table("google_sync_outbox")
