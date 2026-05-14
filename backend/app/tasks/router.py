import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.tasks import service
from app.tasks.schemas import ScheduledTaskCreate, ScheduledTaskRead, ScheduledTaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[ScheduledTaskRead])
def list_tasks(
    db: DbSession,
    current_user: CurrentUser,
    range_start: Annotated[datetime | None, Query(alias="from")] = None,
    range_end: Annotated[datetime | None, Query(alias="to")] = None,
    completed: bool | None = None,
    list_id: uuid.UUID | None = None,
    view: str | None = None,
) -> list[ScheduledTaskRead]:
    return service.list_tasks(
        db,
        user_id=current_user.id,
        range_start=range_start,
        range_end=range_end,
        completed=completed,
        list_id=list_id,
        view=view,
    )


@router.post("", response_model=ScheduledTaskRead, status_code=status.HTTP_201_CREATED)
def create_task(data: ScheduledTaskCreate, db: DbSession, current_user: CurrentUser) -> ScheduledTaskRead:
    return service.create_task(db, data, user_id=current_user.id)


@router.get("/{task_id}", response_model=ScheduledTaskRead)
def get_task(task_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> ScheduledTaskRead:
    return service.get_task_or_404(db, task_id, user_id=current_user.id)


@router.patch("/{task_id}", response_model=ScheduledTaskRead)
def update_task(
    task_id: uuid.UUID,
    data: ScheduledTaskUpdate,
    db: DbSession,
    current_user: CurrentUser,
    update_scope: Literal["single", "series"] = "single",
) -> ScheduledTaskRead:
    return service.update_task(
        db,
        task_id,
        data,
        user_id=current_user.id,
        update_scope=update_scope,
    )


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
    delete_scope: Literal["single", "following"] = "single",
) -> Response:
    service.delete_task(db, task_id, user_id=current_user.id, delete_scope=delete_scope)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{task_id}/complete", response_model=ScheduledTaskRead)
def complete_task(task_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> ScheduledTaskRead:
    return service.complete_task(db, task_id, user_id=current_user.id)


@router.post("/{task_id}/uncomplete", response_model=ScheduledTaskRead)
def uncomplete_task(task_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> ScheduledTaskRead:
    return service.uncomplete_task(db, task_id, user_id=current_user.id)
