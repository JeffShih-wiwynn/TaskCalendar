from collections.abc import Generator

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import User
from app.task_lists import service as task_list_service
from app.task_lists.schemas import TaskListCreate, TaskListUpdate
from app.tasks import service as task_service
from app.tasks.schemas import ScheduledTaskCreate, ScheduledTaskUpdate


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


@pytest.fixture()
def users(db_session: Session) -> tuple[User, User]:
    alice = User(username="alice")
    bob = User(username="bob")
    db_session.add_all([alice, bob])
    db_session.commit()
    db_session.refresh(alice)
    db_session.refresh(bob)
    return alice, bob


def test_tasks_are_scoped_to_user(db_session: Session, users: tuple[User, User]) -> None:
    alice, bob = users
    alice_task = task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Alice task"),
        user_id=alice.id,
    )
    bob_task = task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Bob task"),
        user_id=bob.id,
    )

    alice_tasks = task_service.list_tasks(db_session, user_id=alice.id)
    bob_tasks = task_service.list_tasks(db_session, user_id=bob.id)

    assert [task.id for task in alice_tasks] == [alice_task.id]
    assert [task.id for task in bob_tasks] == [bob_task.id]


def test_cross_user_task_access_is_not_allowed(
    db_session: Session,
    users: tuple[User, User],
) -> None:
    alice, bob = users
    task = task_service.create_task(
        db_session,
        ScheduledTaskCreate(title="Private task"),
        user_id=alice.id,
    )

    assert_not_found(
        lambda: task_service.get_task_or_404(db_session, task.id, user_id=bob.id)
    )
    assert_not_found(
        lambda: task_service.update_task(
            db_session,
            task.id,
            ScheduledTaskUpdate(title="Stolen task"),
            user_id=bob.id,
        )
    )
    assert_not_found(lambda: task_service.delete_task(db_session, task.id, user_id=bob.id))
    assert_not_found(lambda: task_service.complete_task(db_session, task.id, user_id=bob.id))

    unchanged = task_service.get_task_or_404(db_session, task.id, user_id=alice.id)
    assert unchanged.title == "Private task"
    assert unchanged.completed is False


def test_task_list_ownership_is_enforced(
    db_session: Session,
    users: tuple[User, User],
) -> None:
    alice, bob = users
    alice_list = task_list_service.create_task_list(
        db_session,
        TaskListCreate(name="Alice list", color="#2f80ed"),
        user_id=alice.id,
    )

    assert task_list_service.list_task_lists(db_session, user_id=bob.id) == []
    assert_not_found(
        lambda: task_service.create_task(
            db_session,
            ScheduledTaskCreate(title="Wrong category", list_id=alice_list.id),
            user_id=bob.id,
        )
    )
    assert_not_found(
        lambda: task_list_service.update_task_list(
            db_session,
            alice_list.id,
            TaskListUpdate(name="Bob edit"),
            user_id=bob.id,
        )
    )
    assert_not_found(
        lambda: task_list_service.delete_task_list(db_session, alice_list.id, user_id=bob.id)
    )


def assert_not_found(action) -> None:
    with pytest.raises(HTTPException) as exc_info:
        action()

    assert exc_info.value.status_code == 404
