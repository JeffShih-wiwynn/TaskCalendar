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
    assert "notification_offset_minutes" in scheduled_task_columns

    with engine.connect() as connection:
        user_count = connection.execute(text("SELECT COUNT(*) FROM users")).scalar_one()

    assert user_count == 0
