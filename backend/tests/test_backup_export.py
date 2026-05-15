from collections.abc import Generator

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.backup.router import export_backup, import_backup
from app.backup.schemas import BackupImportRequest
from app.backup.service import BACKUP_SCHEMA_VERSION, export_user_backup, import_user_backup
from app.core.config import settings
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


def test_import_backup_route_imports_backup_for_authenticated_user(
    db_session: Session,
) -> None:
    source = create_user(db_session, "source")
    target = create_user(db_session, "target")
    source_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Source list", color="#2f80ed"),
        user_id=source.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Source task", list_id=source_list.id),
        user_id=source.id,
    )
    payload = export_user_backup(db_session, user_id=source.id)

    response = import_backup(
        BackupImportRequest.model_validate(payload),
        db_session,
        current_user=target,
    )

    assert response.imported_task_lists == 1
    assert response.imported_tasks == 1
    target_lists = task_list_service.list_task_lists(db_session, user_id=target.id)
    target_tasks = task_service.list_tasks(db_session, user_id=target.id)
    source_tasks = task_service.list_tasks(db_session, user_id=source.id)
    assert [task_list.name for task_list in target_lists] == ["Source list"]
    assert [task.title for task in target_tasks] == ["Source task"]
    assert all(task.user_id == target.id for task in target_tasks)
    assert [task.title for task in source_tasks] == ["Source task"]


def test_import_backup_route_rejects_invalid_json_and_rolls_back(
    db_session: Session,
) -> None:
    user = create_user(db_session, "alice")
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Existing task"),
        user_id=user.id,
    )
    invalid_payload = {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "exported_at": "2026-05-15T00:00:00+00:00",
        "tasks": [
            {
                "id": "6d4f6788-22c6-4227-9e22-b5c5789a0770",
                "user_id": str(user.id),
                "list_id": "484f790e-ff00-4a5a-9cd5-afcae95dab1d",
                "title": "Invalid task",
                "notes": None,
                "completed": False,
                "scheduled_start": None,
                "scheduled_end": None,
                "due_at": None,
                "timezone": "Asia/Taipei",
                "priority": None,
                "unscheduled_order": None,
                "recurrence_rule": None,
                "recurrence_series_id": None,
                "notification_enabled": False,
                "notification_offset_minutes": 0,
                "notification_channel": None,
                "notification_sent_at": None,
                "created_at": "2026-05-15T00:00:00+00:00",
                "updated_at": "2026-05-15T00:00:00+00:00",
                "completed_at": None,
            }
        ],
        "task_lists": [],
    }

    with pytest.raises(ValidationError):
        BackupImportRequest.model_validate(invalid_payload)

    tasks = task_service.list_tasks(db_session, user_id=user.id)
    assert [task.title for task in tasks] == ["Existing task"]


def test_import_backup_route_isolates_import_to_authenticated_user(
    db_session: Session,
) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Alice existing"),
        user_id=alice.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Bob private"),
        user_id=bob.id,
    )
    payload = export_user_backup(db_session, user_id=bob.id)

    response = import_backup(
        BackupImportRequest.model_validate(payload),
        db_session,
        current_user=alice,
    )

    assert response.imported_tasks == 1
    alice_tasks = task_service.list_tasks(db_session, user_id=alice.id)
    bob_tasks = task_service.list_tasks(db_session, user_id=bob.id)
    assert [task.title for task in alice_tasks] == ["Bob private"]
    assert all(task.user_id == alice.id for task in alice_tasks)
    assert [task.title for task in bob_tasks] == ["Bob private"]
    assert all(task.user_id == bob.id for task in bob_tasks)


def test_backup_round_trip_restores_exported_user_data(
    db_session: Session,
) -> None:
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")

    alice_work = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Work", color="#2f80ed"),
        user_id=alice.id,
    )
    alice_personal = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Personal", color="#27ae60"),
        user_id=alice.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="No time", notes="Unscheduled task"),
        user_id=alice.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(
            title="Due today",
            due_at=datetime(2026, 5, 15, tzinfo=UTC),
            list_id=alice_work.id,
        ),
        user_id=alice.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(
            title="Calendar block",
            scheduled_start=datetime(2026, 5, 15, 9, 0, tzinfo=UTC),
            scheduled_end=datetime(2026, 5, 15, 10, 30, tzinfo=UTC),
            list_id=alice_personal.id,
        ),
        user_id=alice.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(
            title="Done task",
            completed=True,
            list_id=alice_personal.id,
        ),
        user_id=alice.id,
    )

    bob_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Bob list", color="#f2994a"),
        user_id=bob.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Bob task", list_id=bob_list.id),
        user_id=bob.id,
    )

    original_alice_export = export_user_backup(db_session, user_id=alice.id)
    original_bob_export = export_user_backup(db_session, user_id=bob.id)

    alice_work_task = next(
        task
        for task in task_service.list_tasks(db_session, user_id=alice.id)
        if task.title == "Due today"
    )
    task_service.delete_task(db_session, task_id=alice_work_task.id, user_id=alice.id)
    task_list_service.delete_task_list(db_session, task_list_id=alice_personal.id, user_id=alice.id)
    task_list_service.delete_task_list(db_session, task_list_id=alice_work.id, user_id=alice.id)
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Temporary replacement task"),
        user_id=alice.id,
    )

    import_user_backup(
        db_session,
        BackupImportRequest.model_validate(original_alice_export),
        user_id=alice.id,
    )

    restored_alice_export = export_user_backup(db_session, user_id=alice.id)
    restored_bob_export = export_user_backup(db_session, user_id=bob.id)

    assert strip_export_metadata(restored_alice_export) == strip_export_metadata(
        original_alice_export
    )
    assert strip_export_metadata(restored_bob_export) == strip_export_metadata(
        original_bob_export
    )

    restored_alice_task_titles = sorted(task["title"] for task in restored_alice_export["tasks"])
    assert restored_alice_task_titles == [
        "Calendar block",
        "Done task",
        "Due today",
        "No time",
    ]
    assert sorted(task_list["name"] for task_list in restored_alice_export["task_lists"]) == [
        "Personal",
        "Work",
    ]
    assert {task["completed"] for task in restored_alice_export["tasks"]} == {False, True}
    assert any(task["scheduled_start"] is None and task["scheduled_end"] is None for task in restored_alice_export["tasks"])
    assert any(task["due_at"] is not None for task in restored_alice_export["tasks"])
    assert any(task["scheduled_start"] is not None for task in restored_alice_export["tasks"])
    assert all(item["user_id"] == str(alice.id) for item in restored_alice_export["tasks"])
    assert all(item["user_id"] == str(alice.id) for item in restored_alice_export["task_lists"])


def test_backup_export_serializes_datetimes_in_configured_timezone(
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "app_timezone", "America/New_York")
    user = create_user(db_session, "alice")
    task = task_service.create_task(
        db_session,
        ScheduledTaskCreate(
            title="Timezone export",
            scheduled_start=datetime(2026, 5, 15, 14, 0, tzinfo=UTC),
            scheduled_end=datetime(2026, 5, 15, 15, 0, tzinfo=UTC),
        ),
        user_id=user.id,
    )
    task.scheduled_start = datetime(2026, 5, 15, 14, 0, tzinfo=UTC)
    task.scheduled_end = datetime(2026, 5, 15, 15, 0, tzinfo=UTC)
    db_session.add(task)
    db_session.commit()

    payload = export_user_backup(db_session, user_id=user.id)

    assert payload["exported_at"].endswith("-04:00")
    assert payload["tasks"][0]["scheduled_start"] == "2026-05-15T14:00:00-04:00"
    assert payload["tasks"][0]["scheduled_end"] == "2026-05-15T15:00:00-04:00"


def create_user(db_session: Session, username: str) -> User:
    user = User(username=username)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def strip_export_metadata(payload: dict) -> dict:
    return {
        "schema_version": payload["schema_version"],
        "tasks": sorted(
            (
                {
                    key: value
                    for key, value in task.items()
                    if key != "created_at" and key != "updated_at" and key != "completed_at"
                }
                for task in payload["tasks"]
            ),
            key=lambda item: item["id"],
        ),
        "task_lists": sorted(
            (
                {
                    key: value
                    for key, value in task_list.items()
                    if key != "created_at" and key != "updated_at"
                }
                for task_list in payload["task_lists"]
            ),
            key=lambda item: item["id"],
        ),
    }


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
