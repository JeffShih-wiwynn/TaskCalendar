"""add daily todo notifications

Revision ID: 20260701_000006
Revises: 20260701_000005
Create Date: 2026-07-01 00:00:06
"""

from alembic import op
import sqlalchemy as sa


revision = "20260701_000006"
down_revision = "20260701_000005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daily_todo_notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(length=100), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.String(length=100), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("status_reason", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("skipped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "local_date",
            name="uq_daily_todo_notifications_user_local_date",
        ),
    )
    op.create_index(
        "ix_daily_todo_notifications_status_available_at",
        "daily_todo_notifications",
        ["status", "available_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_daily_todo_notifications_locked_at"),
        "daily_todo_notifications",
        ["locked_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_daily_todo_notifications_user_id"),
        "daily_todo_notifications",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_daily_todo_notifications_user_id"), table_name="daily_todo_notifications")
    op.drop_index(op.f("ix_daily_todo_notifications_locked_at"), table_name="daily_todo_notifications")
    op.drop_index("ix_daily_todo_notifications_status_available_at", table_name="daily_todo_notifications")
    op.drop_table("daily_todo_notifications")
