from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy import text


def test_alembic_upgrade_head_initializes_fresh_database(tmp_path: Path) -> None:
    database_path = tmp_path / "calendar.db"
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.set_main_option(
        "sqlalchemy.url",
        f"sqlite:///{database_path}",
    )

    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{database_path}")
    inspector = inspect(engine)

    assert set(inspector.get_table_names()) >= {
        "alembic_version",
        "app_settings",
        "daily_todo_notifications",
        "users",
        "task_lists",
        "scheduled_tasks",
    }
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    scheduled_task_columns = {
        column["name"] for column in inspector.get_columns("scheduled_tasks")
    }
    assert "password_hash" in user_columns
    assert "is_admin" in user_columns
    assert "timezone" in user_columns
    assert "notification_offset_minutes" in scheduled_task_columns
    app_settings_columns = {
        column["name"] for column in inspector.get_columns("app_settings")
    }
    assert "week_start" in app_settings_columns
    assert "daily_todo_notification_enabled" in app_settings_columns
    daily_notification_columns = {
        column["name"] for column in inspector.get_columns("daily_todo_notifications")
    }
    assert daily_notification_columns >= {
        "id",
        "user_id",
        "local_date",
        "timezone",
        "scheduled_for",
        "status",
        "attempts",
        "available_at",
        "locked_at",
        "locked_by",
        "last_error",
        "status_reason",
        "sent_at",
        "skipped_at",
        "cancelled_at",
        "created_at",
        "updated_at",
    }
    daily_notification_unique_constraints = {
        tuple(constraint["column_names"])
        for constraint in inspector.get_unique_constraints("daily_todo_notifications")
    }
    assert ("user_id", "local_date") in daily_notification_unique_constraints
    daily_notification_indexes = {
        index["name"]: tuple(index["column_names"])
        for index in inspector.get_indexes("daily_todo_notifications")
    }
    assert (
        daily_notification_indexes["ix_daily_todo_notifications_status_available_at"]
        == ("status", "available_at")
    )
    assert daily_notification_indexes["ix_daily_todo_notifications_locked_at"] == (
        "locked_at",
    )
    assert daily_notification_indexes["ix_daily_todo_notifications_user_id"] == (
        "user_id",
    )

    with engine.connect() as connection:
        user_count = connection.execute(text("SELECT COUNT(*) FROM users")).scalar_one()

    assert user_count == 0
