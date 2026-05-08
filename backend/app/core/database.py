from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_db_and_tables() -> None:
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    ensure_scheduled_task_columns()


def ensure_scheduled_task_columns() -> None:
    inspector = inspect(engine)
    if "scheduled_tasks" not in inspector.get_table_names():
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("scheduled_tasks")
    }
    for statement in missing_scheduled_task_column_statements(existing_columns):
        with engine.begin() as connection:
            connection.execute(text(statement))


def missing_scheduled_task_column_statements(
    existing_columns: set[str],
) -> list[str]:
    dialect_name = engine.dialect.name
    uuid_type = "UUID" if dialect_name == "postgresql" else "VARCHAR(36)"
    timestamptz_type = (
        "TIMESTAMP WITH TIME ZONE" if dialect_name == "postgresql" else "DATETIME"
    )

    candidates = [
        (
            "recurrence_rule",
            "ALTER TABLE scheduled_tasks ADD COLUMN recurrence_rule VARCHAR(255)",
        ),
        (
            "recurrence_series_id",
            f"ALTER TABLE scheduled_tasks ADD COLUMN recurrence_series_id {uuid_type}",
        ),
        (
            "notification_enabled",
            "ALTER TABLE scheduled_tasks ADD COLUMN notification_enabled BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        (
            "notification_offset_minutes",
            "ALTER TABLE scheduled_tasks ADD COLUMN notification_offset_minutes INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "notification_channel",
            "ALTER TABLE scheduled_tasks ADD COLUMN notification_channel VARCHAR(50)",
        ),
        (
            "notification_sent_at",
            f"ALTER TABLE scheduled_tasks ADD COLUMN notification_sent_at {timestamptz_type}",
        ),
    ]

    return [
        statement
        for column_name, statement in candidates
        if column_name not in existing_columns
    ]
