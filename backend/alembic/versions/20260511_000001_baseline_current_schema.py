"""baseline current schema

Revision ID: 20260511_000001
Revises:
Create Date: 2026-05-11 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260511_000001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("discord_webhook_url", sa.Text(), nullable=True),
        sa.Column("discord_message_template", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    op.create_table(
        "task_lists",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_task_lists_user_id"), "task_lists", ["user_id"], unique=False)

    op.create_table(
        "scheduled_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("list_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("scheduled_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scheduled_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timezone", sa.String(length=100), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("unscheduled_order", sa.Integer(), nullable=True),
        sa.Column("recurrence_rule", sa.String(length=255), nullable=True),
        sa.Column("recurrence_series_id", sa.Uuid(), nullable=True),
        sa.Column("notification_enabled", sa.Boolean(), nullable=False),
        sa.Column("notification_offset_minutes", sa.Integer(), nullable=False),
        sa.Column("notification_channel", sa.String(length=50), nullable=True),
        sa.Column("notification_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["list_id"], ["task_lists.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_scheduled_tasks_list_id"),
        "scheduled_tasks",
        ["list_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_scheduled_tasks_recurrence_series_id"),
        "scheduled_tasks",
        ["recurrence_series_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_scheduled_tasks_user_id"),
        "scheduled_tasks",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_scheduled_tasks_user_id"), table_name="scheduled_tasks")
    op.drop_index(
        op.f("ix_scheduled_tasks_recurrence_series_id"),
        table_name="scheduled_tasks",
    )
    op.drop_index(op.f("ix_scheduled_tasks_list_id"), table_name="scheduled_tasks")
    op.drop_table("scheduled_tasks")

    op.drop_index(op.f("ix_task_lists_user_id"), table_name="task_lists")
    op.drop_table("task_lists")

    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_table("users")

    op.drop_table("app_settings")
