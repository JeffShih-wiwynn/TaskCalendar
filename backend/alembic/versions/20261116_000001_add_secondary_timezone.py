"""add secondary user timezone

Revision ID: 20261116_000001
Revises: 20261106_000001
Create Date: 2026-11-16 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20261116_000001"
down_revision = "20261106_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "secondary_timezone",
            sa.String(length=100),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "secondary_timezone")
