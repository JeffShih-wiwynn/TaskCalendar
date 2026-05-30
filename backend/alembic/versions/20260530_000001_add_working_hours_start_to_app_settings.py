"""add working hours start to app settings

Revision ID: 20260530_000001
Revises: 20260529_000001
Create Date: 2026-05-30 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260530_000001"
down_revision = "20260529_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column(
            "working_hours_start",
            sa.String(length=5),
            nullable=False,
            server_default="08:00",
        ),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "working_hours_start")
