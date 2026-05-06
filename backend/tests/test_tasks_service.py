import uuid
from collections.abc import Generator
from datetime import datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models import User
from app.tasks import service
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


@pytest.fixture()
def user_id(db_session: Session) -> uuid.UUID:
    user = User(username="test-user")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user.id


def test_create_task(db_session: Session, user_id: uuid.UUID) -> None:
    task = service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title="Plan calendar MVP",
            scheduled_start=parse_dt("2026-05-07T07:00:00+08:00"),
            scheduled_end=parse_dt("2026-05-07T09:00:00+08:00"),
        ),
    )

    assert task.id is not None
    assert task.title == "Plan calendar MVP"
    assert task.completed is False
    assert task.timezone == "Asia/Taipei"
    assert task.completed_at is None


def test_create_task_without_user_uses_default_user(db_session: Session) -> None:
    task = service.create_task(
        db_session,
        ScheduledTaskCreate(title="No auth task"),
    )

    assert task.user_id == service.DEFAULT_USER_ID


def test_reject_invalid_time_range(user_id: uuid.UUID) -> None:
    with pytest.raises(ValidationError):
        ScheduledTaskCreate(
            user_id=user_id,
            title="Invalid range",
            scheduled_start=parse_dt("2026-05-07T09:00:00+08:00"),
            scheduled_end=parse_dt("2026-05-07T07:00:00+08:00"),
        )


def test_complete_task(db_session: Session, user_id: uuid.UUID) -> None:
    task = create_task(db_session, user_id, title="Complete me")

    completed = service.complete_task(db_session, task.id)

    assert completed.completed is True
    assert completed.completed_at is not None


def test_uncomplete_task(db_session: Session, user_id: uuid.UUID) -> None:
    task = create_task(db_session, user_id, title="Uncomplete me")
    service.complete_task(db_session, task.id)

    uncompleted = service.uncomplete_task(db_session, task.id)

    assert uncompleted.completed is False
    assert uncompleted.completed_at is None


def test_range_filtering(db_session: Session, user_id: uuid.UUID) -> None:
    included = create_task(
        db_session,
        user_id,
        title="Overlaps range",
        scheduled_start=parse_dt("2026-05-07T08:00:00+08:00"),
        scheduled_end=parse_dt("2026-05-07T10:00:00+08:00"),
    )
    create_task(
        db_session,
        user_id,
        title="Outside range",
        scheduled_start=parse_dt("2026-05-07T12:00:00+08:00"),
        scheduled_end=parse_dt("2026-05-07T13:00:00+08:00"),
    )

    tasks = service.list_tasks(
        db_session,
        range_start=parse_dt("2026-05-07T09:00:00+08:00"),
        range_end=parse_dt("2026-05-07T11:00:00+08:00"),
    )

    assert [task.id for task in tasks] == [included.id]


def create_task(
    db_session: Session,
    user_id: uuid.UUID,
    *,
    title: str,
    scheduled_start: datetime | None = None,
    scheduled_end: datetime | None = None,
):
    return service.create_task(
        db_session,
        ScheduledTaskCreate(
            user_id=user_id,
            title=title,
            scheduled_start=scheduled_start,
            scheduled_end=scheduled_end,
        ),
    )


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)
