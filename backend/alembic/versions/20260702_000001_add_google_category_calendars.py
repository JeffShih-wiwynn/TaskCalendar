"""add category-specific Google Calendar routing

Revision ID: 20260702_000001
Revises: 20260701_000006
Create Date: 2026-07-02 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260702_000001"
down_revision = "20260701_000006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_lists",
        sa.Column(
            "google_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.create_table(
        "google_category_calendars",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_list_id", sa.Uuid(), nullable=False),
        sa.Column("google_calendar_id", sa.String(length=255), nullable=False),
        sa.Column("google_calendar_summary", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["task_list_id"], ["task_lists.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("google_calendar_id"),
        sa.UniqueConstraint("task_list_id"),
    )
    op.create_index(
        op.f("ix_google_category_calendars_user_id"),
        "google_category_calendars",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_category_calendars_task_list_id"),
        "google_category_calendars",
        ["task_list_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_google_category_calendars_status"),
        "google_category_calendars",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_google_category_calendars_status"), table_name="google_category_calendars")
    op.drop_index(op.f("ix_google_category_calendars_task_list_id"), table_name="google_category_calendars")
    op.drop_index(op.f("ix_google_category_calendars_user_id"), table_name="google_category_calendars")
    op.drop_table("google_category_calendars")
    op.drop_column("task_lists", "google_sync_enabled")
