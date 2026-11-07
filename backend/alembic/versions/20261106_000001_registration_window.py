"""Add instance registration window.

Revision ID: 20261106_000001
Revises: 20260702_000001
"""
from alembic import op
import sqlalchemy as sa

revision = "20261106_000001"
down_revision = "20260702_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "registration_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("open_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("INSERT INTO registration_settings (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table("registration_settings")
