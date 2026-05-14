import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.task_lists import service
from app.task_lists.schemas import TaskListCreate, TaskListRead, TaskListUpdate

router = APIRouter(prefix="/api/task-lists", tags=["task-lists"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[TaskListRead])
def list_task_lists(db: DbSession, current_user: CurrentUser) -> list[TaskListRead]:
    return service.list_task_lists(db, user_id=current_user.id)


@router.post("", response_model=TaskListRead, status_code=status.HTTP_201_CREATED)
def create_task_list(data: TaskListCreate, db: DbSession, current_user: CurrentUser) -> TaskListRead:
    return service.create_task_list(db, data, user_id=current_user.id)


@router.patch("/{task_list_id}", response_model=TaskListRead)
def update_task_list(
    task_list_id: uuid.UUID,
    data: TaskListUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> TaskListRead:
    return service.update_task_list(db, task_list_id, data, user_id=current_user.id)


@router.delete("/{task_list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_list(task_list_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> Response:
    service.delete_task_list(db, task_list_id, user_id=current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
