"""scope app settings to users

Revision ID: 20260529_000001
Revises: 20260527_000001
Create Date: 2026-05-29 00:00:01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260529_000001"
down_revision = "20260527_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("user_id", sa.Uuid(), nullable=True))

    op.execute(
        """
        UPDATE app_settings
        SET user_id = (
            SELECT id
            FROM users
            ORDER BY created_at
            LIMIT 1
        )
        WHERE user_id IS NULL
        AND EXISTS (SELECT 1 FROM users)
        """
    )
    op.execute("DELETE FROM app_settings WHERE user_id IS NULL")

    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.alter_column(
            "user_id",
            existing_type=sa.Uuid(),
            nullable=False,
        )
        batch_op.create_index(
            op.f("ix_app_settings_user_id"),
            ["user_id"],
            unique=True,
        )
        batch_op.create_foreign_key(
            op.f("fk_app_settings_user_id_users"),
            "users",
            ["user_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.drop_constraint(
            op.f("fk_app_settings_user_id_users"),
            type_="foreignkey",
        )
        batch_op.drop_index(op.f("ix_app_settings_user_id"))
        batch_op.drop_column("user_id")
