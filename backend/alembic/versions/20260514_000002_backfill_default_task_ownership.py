"""backfill default task ownership

Revision ID: 20260514_000002
Revises: 20260511_000001
Create Date: 2026-05-14 00:00:02
"""

from alembic import op


revision = "20260514_000002"
down_revision = "20260511_000001"
branch_labels = None
depends_on = None

DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE task_lists
        SET user_id = '{DEFAULT_USER_ID}'
        WHERE user_id IS NULL
        """
    )
    op.execute(
        f"""
        UPDATE scheduled_tasks
        SET user_id = '{DEFAULT_USER_ID}'
        WHERE user_id IS NULL
        """
    )


def downgrade() -> None:
    pass
