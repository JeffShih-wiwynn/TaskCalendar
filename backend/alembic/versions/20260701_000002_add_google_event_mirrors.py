"""add google event mirrors

Revision ID: 20260701_000002
Revises: 20260701_000001
Create Date: 2026-07-01 00:00:02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260701_000002"
down_revision = "20260701_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "google_event_mirrors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("google_calendar_id", sa.String(length=255), nullable=False),
        sa.Column("google_event_id", sa.String(length=255), nullable=False),
        sa.Column("last_task_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_payload_hash", sa.String(length=64), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["scheduled_tasks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "task_id"),
        sa.UniqueConstraint("google_calendar_id", "google_event_id"),
    )
    op.create_index(
        op.f("ix_google_event_mirrors_task_id"),
        "google_event_mirrors",
        ["task_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_event_mirrors_user_id"),
        "google_event_mirrors",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_google_event_mirrors_user_id"), table_name="google_event_mirrors")
    op.drop_index(op.f("ix_google_event_mirrors_task_id"), table_name="google_event_mirrors")
    op.drop_table("google_event_mirrors")
