from collections.abc import Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.backup.router import export_backup
from app.backup.service import BACKUP_SCHEMA_VERSION, export_user_backup
from app.core.database import Base
from app.models import User
from app.task_lists import service as task_list_service
from app.task_lists.schemas import TaskListCreate
from app.tasks import service as task_service
from app.tasks.schemas import ScheduledTaskCreate


def test_export_user_backup_includes_only_current_user_data(db_session: Session) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")

    alice_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Alice list", color="#2f80ed"),
        user_id=alice.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Alice task", list_id=alice_list.id),
        user_id=alice.id,
    )

    bob_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Bob list", color="#27ae60"),
        user_id=bob.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Bob task", list_id=bob_list.id),
        user_id=bob.id,
    )

    payload = export_user_backup(db_session, user_id=alice.id)

    assert payload["schema_version"] == BACKUP_SCHEMA_VERSION
    assert isinstance(payload["exported_at"], str)
    assert {key for key in payload.keys()} == {"schema_version", "exported_at", "tasks", "task_lists"}
    assert [task_list["name"] for task_list in payload["task_lists"]] == ["Alice list"]
    assert [task["title"] for task in payload["tasks"]] == ["Alice task"]
    assert all(item["user_id"] == str(alice.id) for item in payload["tasks"])
    assert all(item["user_id"] == str(alice.id) for item in payload["task_lists"])


def test_export_backup_route_returns_current_user_only(db_session: Session) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")

    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Alice task"),
        user_id=alice.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Bob task"),
        user_id=bob.id,
    )

    response = export_backup(db_session, current_user=alice)

    assert [task["title"] for task in response.tasks] == ["Alice task"]
    assert all(task["user_id"] == str(alice.id) for task in response.tasks)
    assert response.schema_version == BACKUP_SCHEMA_VERSION


def test_export_user_backup_does_not_expose_password_hashes(db_session: Session) -> None:
    alice = create_user(db_session, "alice")
    payload = export_user_backup(db_session, user_id=alice.id)

    assert "password_hash" not in str(payload)
    assert "access_token" not in str(payload)
    assert "jwt" not in str(payload).lower()


def create_user(db_session: Session, username: str) -> User:
    user = User(username=username)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with TestingSessionLocal() as session:
        yield session

    Base.metadata.drop_all(bind=engine)
