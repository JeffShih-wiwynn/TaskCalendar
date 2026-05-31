"""add week start to app settings

Revision ID: 20260601_000001
Revises: 20260530_000001
Create Date: 2026-06-01 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260601_000001"
down_revision = "20260530_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column(
            "week_start",
            sa.String(length=6),
            nullable=False,
            server_default="sunday",
        ),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "week_start")
