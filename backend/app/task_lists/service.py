import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.scheduled_task import ScheduledTask
from app.models.task_list import TaskList
from app.task_lists.schemas import TaskListCreate, TaskListUpdate
from app.tasks.service import get_or_create_default_user


def list_task_lists(db: Session, *, user_id: uuid.UUID | None = None) -> list[TaskList]:
    user_id = user_id or get_or_create_default_user(db).id
    statement = (
        select(TaskList)
        .where(TaskList.user_id == user_id)
        .order_by(TaskList.name, TaskList.created_at)
    )
    return list(db.scalars(statement).all())


def create_task_list(
    db: Session,
    data: TaskListCreate,
    *,
    user_id: uuid.UUID | None = None,
) -> TaskList:
    user_id = user_id or get_or_create_default_user(db).id
    task_list = TaskList(
        user_id=user_id,
        name=data.name.strip(),
        color=data.color,
        updated_at=datetime.now(UTC),
    )
    db.add(task_list)
    db.commit()
    db.refresh(task_list)
    return task_list


def update_task_list(
    db: Session,
    task_list_id: uuid.UUID,
    data: TaskListUpdate,
    *,
    user_id: uuid.UUID | None = None,
) -> TaskList:
    user_id = user_id or get_or_create_default_user(db).id
    task_list = get_task_list_or_404(db, task_list_id, user_id=user_id)

    updates = data.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None:
        task_list.name = updates["name"].strip()
    if "color" in updates and updates["color"] is not None:
        task_list.color = updates["color"]

    task_list.updated_at = datetime.now(UTC)
    db.add(task_list)
    db.commit()
    db.refresh(task_list)
    return task_list


def delete_task_list(
    db: Session,
    task_list_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
) -> None:
    user_id = user_id or get_or_create_default_user(db).id
    task_list = get_task_list_or_404(db, task_list_id, user_id=user_id)

    tasks = db.scalars(
        select(ScheduledTask).where(
            ScheduledTask.list_id == task_list_id,
            ScheduledTask.user_id == user_id,
        ),
    ).all()
    for task in tasks:
        task.list_id = None
        task.updated_at = datetime.now(UTC)

    db.delete(task_list)
    db.commit()


def get_task_list_or_404(db: Session, task_list_id: uuid.UUID, *, user_id: uuid.UUID) -> TaskList:
    task_list = db.scalar(
        select(TaskList).where(
            TaskList.id == task_list_id,
            TaskList.user_id == user_id,
        )
    )
    if task_list is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return task_list
