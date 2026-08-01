"""add daily todo notification setting

Revision ID: 20260701_000005
Revises: 20260701_000004
Create Date: 2026-07-01 00:00:05
"""

from alembic import op
import sqlalchemy as sa


revision = "20260701_000005"
down_revision = "20260701_000004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column(
            "daily_todo_notification_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "daily_todo_notification_enabled")
