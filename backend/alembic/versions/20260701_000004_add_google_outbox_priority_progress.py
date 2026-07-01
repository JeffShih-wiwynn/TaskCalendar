"""add google outbox priority and progress

Revision ID: 20260701_000004
Revises: 20260701_000003
Create Date: 2026-07-01 00:00:04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260701_000004"
down_revision = "20260701_000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "google_sync_outbox",
        sa.Column("priority", sa.Integer(), nullable=False, server_default="50"),
    )
    op.add_column(
        "google_sync_outbox",
        sa.Column("progress_state", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_google_sync_outbox_claim_priority",
        "google_sync_outbox",
        ["status", "available_at", "priority", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_sync_outbox_priority"),
        "google_sync_outbox",
        ["priority"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_google_sync_outbox_priority"), table_name="google_sync_outbox")
    op.drop_index("ix_google_sync_outbox_claim_priority", table_name="google_sync_outbox")
    op.drop_column("google_sync_outbox", "progress_state")
    op.drop_column("google_sync_outbox", "priority")
