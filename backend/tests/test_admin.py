from collections.abc import Generator

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.admin.router import delete_user, get_user, list_users
from app.auth.dependencies import get_current_admin_user
from app.auth.schemas import UserRead
from app.core.database import Base
from app.models.user import User
from app.task_lists import service as task_list_service
from app.task_lists.schemas import TaskListCreate
from app.tasks import service as task_service
from app.tasks.schemas import ScheduledTaskCreate


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


def test_admin_user_management_requires_admin_access(db_session: Session) -> None:
    admin = create_user(db_session, "admin", is_admin=True)
    alice = create_user(db_session, "alice")

    response = list_users(db_session, current_admin=admin)
    serialized = [UserRead.model_validate(user).model_dump() for user in response]

    assert [user.username for user in response] == ["admin", "alice"]
    assert all("password_hash" not in user for user in serialized)

    with pytest.raises(HTTPException) as exc_info:
        get_current_admin_user(alice)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Admin access required"


def test_admin_can_view_basic_user_info(db_session: Session) -> None:
    admin = create_user(db_session, "admin", is_admin=True)
    alice = create_user(db_session, "alice")

    response = get_user(alice.id, db_session, current_admin=admin)

    assert response.id == alice.id
    assert response.username == "alice"
    assert response.is_admin is False


def test_admin_delete_user_removes_only_target_user_data(db_session: Session) -> None:
    admin = create_user(db_session, "admin", is_admin=True)
    alice = create_user(db_session, "alice")
    bob = create_user(db_session, "bob")
    alice_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Alice list"),
        user_id=alice.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Alice task", list_id=alice_list.id),
        user_id=alice.id,
    )
    bob_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Bob list"),
        user_id=bob.id,
    )
    task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Bob task", list_id=bob_list.id),
        user_id=bob.id,
    )

    response = delete_user(alice.id, db_session, current_admin=admin)

    assert response.message == "User deleted"
    assert db_session.get(User, alice.id) is None
    assert task_service.list_tasks(db_session, user_id=alice.id) == []
    assert task_list_service.list_task_lists(db_session, user_id=alice.id) == []
    assert db_session.get(User, bob.id) is not None
    assert [task.title for task in task_service.list_tasks(db_session, user_id=bob.id)] == [
        "Bob task"
    ]
    assert [
        task_list.name
        for task_list in task_list_service.list_task_lists(db_session, user_id=bob.id)
    ] == ["Bob list"]


def test_admin_cannot_delete_last_admin_account(db_session: Session) -> None:
    admin = create_user(db_session, "admin", is_admin=True)

    with pytest.raises(HTTPException) as exc_info:
        delete_user(admin.id, db_session, current_admin=admin)

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Cannot delete the last admin account"
    assert db_session.get(User, admin.id) is not None


def create_user(db_session: Session, username: str, *, is_admin: bool = False) -> User:
    user = User(username=username, is_admin=is_admin)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user
