"""add user admin role

Revision ID: 20260522_000001
Revises: 20260517_000001
Create Date: 2026-05-22 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260522_000001"
down_revision = "20260517_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        """
        UPDATE users
        SET is_admin = TRUE
        WHERE id = (
            SELECT id
            FROM users
            ORDER BY created_at ASC, username ASC
            LIMIT 1
        )
        """
    )


def downgrade() -> None:
    op.drop_column("users", "is_admin")
