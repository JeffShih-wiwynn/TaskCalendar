"""add google calendar connection

Revision ID: 20260701_000001
Revises: 20260601_000001
Create Date: 2026-07-01 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260701_000001"
down_revision = "20260601_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "google_calendar_connections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("google_calendar_id", sa.String(length=255), nullable=True),
        sa.Column("google_calendar_summary", sa.String(length=255), nullable=True),
        sa.Column("encrypted_refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("last_successful_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_google_calendar_connections_status"),
        "google_calendar_connections",
        ["status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_calendar_connections_user_id"),
        "google_calendar_connections",
        ["user_id"],
        unique=True,
    )

    op.create_table(
        "google_oauth_states",
        sa.Column("state", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("return_to", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("state"),
    )
    op.create_index(
        op.f("ix_google_oauth_states_expires_at"),
        "google_oauth_states",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_google_oauth_states_user_id"),
        "google_oauth_states",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_google_oauth_states_user_id"), table_name="google_oauth_states")
    op.drop_index(op.f("ix_google_oauth_states_expires_at"), table_name="google_oauth_states")
    op.drop_table("google_oauth_states")

    op.drop_index(
        op.f("ix_google_calendar_connections_user_id"),
        table_name="google_calendar_connections",
    )
    op.drop_index(
        op.f("ix_google_calendar_connections_status"),
        table_name="google_calendar_connections",
    )
    op.drop_table("google_calendar_connections")
