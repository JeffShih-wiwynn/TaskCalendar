"""add all_day to scheduled tasks

Revision ID: 20260517_000001
Revises: 20260514_000002
Create Date: 2026-05-17 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260517_000001"
down_revision = "20260514_000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scheduled_tasks",
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("scheduled_tasks", "all_day")
