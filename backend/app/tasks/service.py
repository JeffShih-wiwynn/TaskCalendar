import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.scheduled_task import ScheduledTask
from app.models.user import User
from app.tasks.schemas import ScheduledTaskCreate, ScheduledTaskUpdate

DEFAULT_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEFAULT_USERNAME = "default"


def list_tasks(
    db: Session,
    *,
    range_start: datetime | None = None,
    range_end: datetime | None = None,
    completed: bool | None = None,
    list_id: uuid.UUID | None = None,
) -> list[ScheduledTask]:
    statement: Select[tuple[ScheduledTask]] = select(ScheduledTask).order_by(
        ScheduledTask.scheduled_start.is_(None),
        ScheduledTask.scheduled_start,
        ScheduledTask.created_at,
    )

    if completed is not None:
        statement = statement.where(ScheduledTask.completed.is_(completed))

    if list_id is not None:
        statement = statement.where(ScheduledTask.list_id == list_id)

    if range_start is not None or range_end is not None:
        if range_start is None or range_end is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Both from and to are required for range filtering",
            )
        if range_end <= range_start:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="to must be after from",
            )
        statement = statement.where(
            ScheduledTask.scheduled_start < range_end,
            ScheduledTask.scheduled_end > range_start,
        )

    return list(db.scalars(statement).all())


def create_task(db: Session, data: ScheduledTaskCreate) -> ScheduledTask:
    task_data = data.model_dump()
    task_data["user_id"] = task_data["user_id"] or get_or_create_default_user(db).id
    task = ScheduledTask(**task_data)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def get_task_or_404(db: Session, task_id: uuid.UUID) -> ScheduledTask:
    task = db.get(ScheduledTask, task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def update_task(db: Session, task_id: uuid.UUID, data: ScheduledTaskUpdate) -> ScheduledTask:
    task = get_task_or_404(db, task_id)
    updates = data.model_dump(exclude_unset=True)

    if "completed" in updates:
        now = datetime.now(UTC)
        if updates["completed"] and not task.completed:
            task.completed_at = now
        elif not updates["completed"]:
            task.completed_at = None

    for field, value in updates.items():
        setattr(task, field, value)

    task.updated_at = datetime.now(UTC)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task_id: uuid.UUID) -> None:
    task = get_task_or_404(db, task_id)
    db.delete(task)
    db.commit()


def complete_task(db: Session, task_id: uuid.UUID) -> ScheduledTask:
    task = get_task_or_404(db, task_id)
    task.completed = True
    task.completed_at = datetime.now(UTC)
    task.updated_at = datetime.now(UTC)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def uncomplete_task(db: Session, task_id: uuid.UUID) -> ScheduledTask:
    task = get_task_or_404(db, task_id)
    task.completed = False
    task.completed_at = None
    task.updated_at = datetime.now(UTC)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def get_or_create_default_user(db: Session) -> User:
    user = db.get(User, DEFAULT_USER_ID)
    if user is not None:
        return user

    user = User(id=DEFAULT_USER_ID, username=DEFAULT_USERNAME)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
