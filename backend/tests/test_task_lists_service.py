from collections.abc import Generator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.task_lists import service
from app.task_lists.schemas import TaskListCreate
from app.tasks.schemas import ScheduledTaskCreate
from app.tasks.service import create_task
from app.tasks.service import DEFAULT_USER_ID


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


def test_create_and_list_task_lists(db_session: Session) -> None:
    created = service.create_task_list(db_session, TaskListCreate(name="Work", color="#2f80ed"))

    task_lists = service.list_task_lists(db_session)

    assert created.user_id == DEFAULT_USER_ID
    assert [task_list.name for task_list in task_lists] == ["Work"]
    assert task_lists[0].color == "#2f80ed"


def test_delete_task_list_clears_tasks(db_session: Session) -> None:
    task_list = service.create_task_list(db_session, TaskListCreate(name="Work"))
    task = create_task(
        db_session,
        ScheduledTaskCreate(title="Categorized task", list_id=task_list.id),
    )

    service.delete_task_list(db_session, task_list.id)

    db_session.refresh(task)
    assert task.list_id is None
