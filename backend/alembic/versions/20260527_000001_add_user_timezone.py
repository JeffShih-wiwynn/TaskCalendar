"""add user timezone

Revision ID: 20260527_000001
Revises: 20260522_000001
Create Date: 2026-05-27 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260527_000001"
down_revision = "20260522_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("timezone", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "timezone")
