import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.task_lists import service
from app.task_lists.schemas import TaskListCreate, TaskListRead, TaskListUpdate

router = APIRouter(prefix="/api/task-lists", tags=["task-lists"])

DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=list[TaskListRead])
def list_task_lists(db: DbSession) -> list[TaskListRead]:
    return service.list_task_lists(db)


@router.post("", response_model=TaskListRead, status_code=status.HTTP_201_CREATED)
def create_task_list(data: TaskListCreate, db: DbSession) -> TaskListRead:
    return service.create_task_list(db, data)


@router.patch("/{task_list_id}", response_model=TaskListRead)
def update_task_list(
    task_list_id: uuid.UUID,
    data: TaskListUpdate,
    db: DbSession,
) -> TaskListRead:
    return service.update_task_list(db, task_list_id, data)


@router.delete("/{task_list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_list(task_list_id: uuid.UUID, db: DbSession) -> Response:
    service.delete_task_list(db, task_list_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
