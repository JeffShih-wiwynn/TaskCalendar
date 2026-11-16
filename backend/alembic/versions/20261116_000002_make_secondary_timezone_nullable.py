"""make secondary user timezone nullable

Revision ID: 20261116_000002
Revises: 20261116_000001
Create Date: 2026-11-16 16:36:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20261116_000002"
down_revision = "20261116_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "secondary_timezone",
            existing_type=sa.String(length=100),
            nullable=True,
            server_default=None,
        )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE users SET secondary_timezone = 'Asia/Taipei' "
            "WHERE secondary_timezone IS NULL"
        )
    )
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "secondary_timezone",
            existing_type=sa.String(length=100),
            nullable=False,
        )
